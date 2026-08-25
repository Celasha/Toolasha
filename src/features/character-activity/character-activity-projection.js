/**
 * Character Activity Projection Engine
 * Pure functions that project a character's current action + queue forward in time to find
 * the earliest trustworthy point at which useful progress stops (action ends, queue ends,
 * materials run out, or - resolved separately, at display time - the character's offline cap).
 *
 * Deliberately reuses Action Time Display's existing per-action duration/material-limit math
 * (already corrected for partial-progress-in-the-current-unit, TLA-015) rather than building a
 * second duration engine. This module's only job is to walk the queue sequentially and decide
 * where the trustworthy chain has to stop.
 */

import dataManager from '../../core/data-manager.js';
import actionTimeDisplay from '../actions/action-time-display.js';

const UNCERTAIN_ACTION_TYPES = new Set(['/action_types/labyrinth', '/action_types/enhancing']);

/**
 * An action type/hrid this feature will never assert a trustworthy deadline for - Combat and
 * Labyrinth have non-deterministic duration, and Enhancing has a stochastic outcome. Action Time
 * Display shows an expected-value estimate for Enhancing; this feature is intentionally stricter
 * (a false early warning is preferable to telling the player an alt is safe when it might not be).
 * @param {Object} actionObj - Entry from `dataManager.getCurrentActions()`
 * @param {Object} actionDetails - `dataManager.getActionDetails(actionObj.actionHrid)`
 * @returns {boolean}
 */
function isUncertainAction(actionObj, actionDetails) {
    if (actionObj.actionHrid?.includes('/combat/')) return true;
    return UNCERTAIN_ACTION_TYPES.has(actionDetails?.type);
}

function buildSegment({ actionObj, actionDetails, queuedIndex, startAt, endAt, certainty, stopCause }) {
    return {
        actionHrid: actionObj.actionHrid,
        actionName: actionDetails?.name || actionObj.actionHrid,
        actionTypeHrid: actionDetails?.type || null,
        startAt,
        endAt,
        queuedIndex,
        certainty,
        stopCause,
    };
}

/**
 * Project the character's current action + queue forward from `now`, using only the current
 * live action-queue data. Does not consider the offline-progress cap - that is deliberately
 * resolved later against a live `lastOfflineTime` (see `resolveDisplayProjection`), since while
 * this function runs the character is still connected and hasn't gone offline yet.
 * @param {number} [now] - Epoch ms to project from (defaults to `Date.now()`)
 * @returns {{segments: Array, terminalCause: string, terminalAt: number|null, certainty: string}}
 *      terminalCause is one of: 'idle' | 'action' | 'queue' | 'materials' | 'infinite' | 'unknown'
 */
export function computeLiveProjection(now = Date.now()) {
    const actions = dataManager.getCurrentActions();

    if (!actions || actions.length === 0) {
        return { segments: [], terminalCause: 'idle', terminalAt: now, certainty: 'trustworthy' };
    }

    const inventoryLookup = actionTimeDisplay.buildInventoryLookup(dataManager.getInventory());

    const segments = [];
    let currentTime = now;
    let terminalCause = null;
    let terminalAt = null;
    let certainty = 'trustworthy';

    for (let i = 0; i < actions.length; i++) {
        const actionObj = actions[i];
        const actionDetails = dataManager.getActionDetails(actionObj.actionHrid);

        if (!actionDetails || isUncertainAction(actionObj, actionDetails)) {
            segments.push(
                buildSegment({
                    actionObj,
                    actionDetails,
                    queuedIndex: i,
                    startAt: currentTime,
                    endAt: null,
                    certainty: 'uncertain',
                    stopCause: 'unknown',
                })
            );
            terminalCause = 'unknown';
            terminalAt = null;
            certainty = 'uncertain';
            break;
        }

        const timing = actionTimeDisplay.calculateSingleQueueActionTime(actionObj, actionDetails, inventoryLookup);

        if (timing.isTrulyInfinite) {
            segments.push(
                buildSegment({
                    actionObj,
                    actionDetails,
                    queuedIndex: i,
                    startAt: currentTime,
                    endAt: null,
                    certainty: 'trustworthy',
                    stopCause: 'infinite',
                })
            );
            terminalCause = 'infinite';
            terminalAt = null;
            break;
        }

        const segmentEndAt = currentTime + timing.totalTime * 1000;
        const stopCause = timing.limitType?.startsWith('material') ? 'materials' : 'count';

        segments.push(
            buildSegment({
                actionObj,
                actionDetails,
                queuedIndex: i,
                startAt: currentTime,
                endAt: segmentEndAt,
                certainty: 'trustworthy',
                stopCause,
            })
        );

        currentTime = segmentEndAt;

        if (i === actions.length - 1) {
            terminalAt = segmentEndAt;
            terminalCause = stopCause === 'materials' ? 'materials' : segments.length === 1 ? 'action' : 'queue';
        }
    }

    return { segments, terminalCause, terminalAt, certainty };
}

/**
 * Resolve a persisted projection into what should actually be displayed right now, applying the
 * offline-progress-cap overlay against a freshly-read native `lastOfflineTime` (from Character
 * Select) - never a value baked in at observation time, since while the character was still
 * connected it hadn't gone offline yet and the true offline boundary wasn't knowable.
 *
 * Never asserts a green/yellow offline deadline across a MooPass expiry boundary this evidence
 * can't prove the server's semantics for - falls back to 'unknown' (neutral, not a false
 * reassurance) in that case, per the fail-closed requirement.
 * @param {Object} stored - A persisted character-activity record (see character-activity-storage.js)
 * @param {number|null} freshLastOfflineTime - Native `lastOfflineTime` from Character Select, ms epoch
 * @returns {{terminalCause: string, terminalAt: number|null, segments: Array}}
 */
export function resolveDisplayProjection(stored, freshLastOfflineTime) {
    const { segments, terminalCause, terminalAt } = stored.projection;

    // Already uncertain/idle at observation time - the offline cap can never turn that into a
    // safe assertion, so there's nothing to overlay.
    if (terminalCause === 'unknown' || terminalCause === 'idle') {
        return { segments, terminalCause, terminalAt };
    }

    const offlineHourCap = stored.offline?.hourCap;
    if (!(offlineHourCap > 0) || freshLastOfflineTime == null) {
        // No trustworthy cap, or the character hasn't actually gone offline yet by any evidence
        // we have - an 'infinite' chain has no other possible deadline, so it's unknown; a
        // finite chain's own terminalAt still stands on its own.
        return terminalCause === 'infinite'
            ? { segments, terminalCause: 'unknown', terminalAt: null }
            : { segments, terminalCause, terminalAt };
    }

    const mooPassExpireTime = stored.offline?.mooPassExpireTime;
    const offlineLimitAt = freshLastOfflineTime + offlineHourCap * 3600 * 1000;

    if (mooPassExpireTime != null && mooPassExpireTime < offlineLimitAt) {
        // The saved cap may have included MooPass hours that won't all be honored - the server's
        // mid-offline MooPass-expiry behavior isn't provable from client evidence, so fail closed
        // rather than assert a deadline that assumes the full cap held.
        return terminalCause === 'infinite'
            ? { segments, terminalCause: 'unknown', terminalAt: null }
            : { segments, terminalCause, terminalAt };
    }

    if (terminalCause === 'infinite' || terminalAt === null || offlineLimitAt < terminalAt) {
        return { segments, terminalCause: 'offline', terminalAt: offlineLimitAt };
    }

    return { segments, terminalCause, terminalAt };
}
