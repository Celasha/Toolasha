/**
 * Character Activity Projection Engine
 * Pure functions that project a character's current action + queue forward in time to find the
 * earliest trustworthy point at which useful progress stops. Reuses Action Time Display's
 * existing per-action duration/material-limit math rather than a second duration engine.
 */

import dataManager from '../../core/data-manager.js';
import actionTimeDisplay from '../actions/action-time-display.js';
import loadoutState from '../../core/loadout-state.js';
import { resolveActionContext, resolveCurrentActionContext } from '../../utils/action-context.js';
import { calculateDrinkRemainingSeconds } from '../../utils/drink-calculator.js';
import { getDrinkConcentration, parseArtisanBonus } from '../../utils/tea-parser.js';

const UNCERTAIN_REASON_BY_TYPE = {
    '/action_types/labyrinth': 'labyrinth',
    '/action_types/enhancing': 'enhancing',
    '/action_types/special': 'special',
};

const RESOURCE_STOP_CAUSES = new Set(['materials', 'coins', 'upgrade-materials']);

// Combat has no dedicated action type of its own - identified by hrid, checked before the map.
function classifyUncertainty(actionObj, actionDetails) {
    if (actionObj.actionHrid?.includes('/combat/')) return 'combat';
    return UNCERTAIN_REASON_BY_TYPE[actionDetails?.type] || null;
}

// Gold/upgrade-item costs are distinct real reasons, not a generic "count" bucket.
function classifyStopCause(limitType) {
    if (!limitType) return 'count';
    if (limitType === 'gold') return 'coins';
    if (limitType.startsWith('material:')) return 'materials';
    if (limitType.startsWith('upgrade:')) return 'upgrade-materials';
    return 'count';
}

/** Enriched name matching native getActionDisplayName() - item name, enhancement level, combat tier/party. */
function buildDisplayName(actionObj, actionDetails) {
    const baseName = actionDetails?.name || actionObj.actionHrid;
    if (!actionDetails) return baseName;

    if (actionDetails.type === '/action_types/alchemy' && actionObj.primaryItemHash) {
        const { itemHrid } = actionTimeDisplay.parseItemHash(actionObj.primaryItemHash);
        const itemDetails = itemHrid ? dataManager.getItemDetails(itemHrid) : null;
        if (itemDetails?.name) return `${baseName}: ${itemDetails.name}`;
    }

    if (actionDetails.type === '/action_types/enhancing' && actionObj.primaryItemHash) {
        const { itemHrid, level } = actionTimeDisplay.parseItemHash(actionObj.primaryItemHash);
        const itemDetails = itemHrid ? dataManager.getItemDetails(itemHrid) : null;
        if (itemDetails?.name) return `${itemDetails.name} +${level}`;
    }

    if (actionObj.actionHrid?.includes('/combat/')) {
        let name = baseName;
        if (actionObj.difficultyTier >= 1) name += ` (T${actionObj.difficultyTier})`;
        if (actionObj.partyID) name += ' (Party)';
        return name;
    }

    return baseName;
}

/**
 * Consumed/deterministically-produced/stochastically-produced item hrids for one segment. Alchemy's
 * primary/secondary item selection and dynamic coin cost are tracked as consumed identities (for
 * fail-closed dependency purposes) without attempting to reproduce Alchemy's own bulk/catalyst/success
 * math here - see projectOrdinaryDeterministicInventory, which declines to project Alchemy at all.
 */
export function getSegmentInventoryFootprint(actionDetails, actionObj) {
    const consumed = new Set();
    const deterministicProduced = new Set();
    const stochasticProduced = new Set();
    if (!actionDetails) return { consumed, deterministicProduced, stochasticProduced };

    for (const input of actionDetails.inputItems || []) {
        if (input.itemHrid) consumed.add(input.itemHrid);
    }
    if (actionDetails.upgradeItemHrid) consumed.add(actionDetails.upgradeItemHrid);
    if (actionDetails.coinCost > 0) consumed.add('/items/coin');

    if (actionDetails.type === '/action_types/alchemy') {
        if (actionObj.primaryItemHash) {
            const { itemHrid } = actionTimeDisplay.parseItemHash(actionObj.primaryItemHash);
            if (itemHrid) consumed.add(itemHrid);
        }
        if (actionObj.secondaryItemHash) {
            const { itemHrid } = actionTimeDisplay.parseItemHash(actionObj.secondaryItemHash);
            if (itemHrid) consumed.add(itemHrid);
        }
        consumed.add('/items/coin');
    }

    for (const output of actionDetails.outputItems || []) {
        if (output.itemHrid) deterministicProduced.add(output.itemHrid);
    }
    for (const drop of actionDetails.dropTable || []) {
        if (drop.itemHrid) stochasticProduced.add(drop.itemHrid);
    }
    return { consumed, deterministicProduced, stochasticProduced };
}

function intersects(left, right) {
    for (const hrid of left) {
        if (right.has(hrid)) return true;
    }
    return false;
}

/** Maps a resolved timing limiter back to the item hrid it actually binds, or null. */
export function getLimitHrid(limitType) {
    if (limitType === 'gold') return '/items/coin';
    if (limitType?.startsWith('material:')) return limitType.slice('material:'.length);
    if (limitType?.startsWith('upgrade:')) return limitType.slice('upgrade:'.length);
    return null;
}

function cloneInventoryLookup(inventoryLookup) {
    return {
        byHrid: { ...(inventoryLookup?.byHrid || {}) },
        byEnhancedKey: { ...(inventoryLookup?.byEnhancedKey || {}) },
    };
}

/**
 * Applies a deterministic delta to a projected inventory lookup, keeping byHrid and byEnhancedKey (at
 * enhancement level 0 - ordinary recipe inputs/outputs/upgrade items are always base items) in sync.
 * calculateMaterialLimit()'s Alchemy branch reads byEnhancedKey, not byHrid, so leaving it stale would
 * let a later Alchemy segment compute a wrong-but-trustworthy result against inconsistent balances.
 */
function adjustProjectedItem(lookup, itemHrid, delta) {
    if (!itemHrid || !Number.isFinite(delta) || delta === 0) return;

    lookup.byHrid[itemHrid] = Math.max(0, (lookup.byHrid[itemHrid] || 0) + delta);

    const enhancedKey = `${itemHrid}::0`;
    lookup.byEnhancedKey[enhancedKey] = Math.max(0, (lookup.byEnhancedKey[enhancedKey] || 0) + delta);
}

/**
 * Projects the deterministic inventory delta of one ordinary recipe/gathering segment. Declines
 * (supported: false) for Alchemy (dynamic bulk/catalyst/success-rate coin math not replicated here) and
 * Enhancing (stochastic; already routed to its own uncertainty reason earlier in the loop for a live
 * queue - kept here only as a defensive guard). Uses timing.count (completed queued actions), never
 * baseActionsNeeded (time-consuming actions after efficiency) - materials are consumed per queued
 * action, matching Action Time Display's own resource-limiter semantics.
 */
export function projectOrdinaryDeterministicInventory(actionDetails, timing, inventoryLookup, actionContext) {
    if (!Number.isFinite(timing?.count) || timing.count < 0) {
        return { supported: false, inventoryLookup };
    }
    if (actionDetails.type === '/action_types/alchemy' || actionDetails.type === '/action_types/enhancing') {
        return { supported: false, inventoryLookup };
    }

    const next = cloneInventoryLookup(inventoryLookup);
    const context = actionContext ?? resolveActionContext(actionDetails.type);
    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};
    const drinkConcentration = getDrinkConcentration(context.equipment, itemDetailMap);
    const artisanBonus = parseArtisanBonus(context.drinks, itemDetailMap, drinkConcentration);
    const count = timing.count;

    for (const input of actionDetails.inputItems || []) {
        const perAction = input.count * (1 - artisanBonus);
        adjustProjectedItem(next, input.itemHrid, -(perAction * count));
    }
    if (actionDetails.upgradeItemHrid) {
        adjustProjectedItem(next, actionDetails.upgradeItemHrid, -count);
    }
    if (actionDetails.coinCost > 0) {
        adjustProjectedItem(next, '/items/coin', -(actionDetails.coinCost * count));
    }
    for (const output of actionDetails.outputItems || []) {
        adjustProjectedItem(next, output.itemHrid, output.count * count);
    }

    return { supported: true, inventoryLookup: next };
}

/**
 * Native queued actions use `characterLoadoutID` (capital ID) - Toolasha's DataManager preserves
 * the raw server object rather than renaming it. `0`/null/missing means no explicit native
 * loadout (the native queue/header UI itself only renders a loadout marker when truthy). A
 * malformed non-zero value fails closed rather than silently falling through to a predictive
 * default.
 * @param {Object} actionObj
 * @returns {{hasExplicitLoadout: boolean, loadoutId: number|null, malformed: boolean}}
 */
function getNativeQueuedLoadoutIdentity(actionObj) {
    const raw = actionObj?.characterLoadoutID;

    if (raw === undefined || raw === null || raw === 0 || raw === '0') {
        return { hasExplicitLoadout: false, loadoutId: null, malformed: false };
    }

    const loadoutId = Number(raw);
    if (!Number.isSafeInteger(loadoutId) || loadoutId <= 0) {
        return { hasExplicitLoadout: true, loadoutId: null, malformed: true };
    }

    return { hasExplicitLoadout: true, loadoutId, malformed: false };
}

/**
 * Resolve the equipment/drinks context for a queued (i>0) segment tagged with an explicit native
 * `characterLoadoutID`: use exactly that loadout, or fail closed (return `unresolvable: true`) if
 * it's missing/deleted/has unavailable equipment - never substitute an unrelated Toolasha
 * predictive default for a loadout the player explicitly configured for this queued action.
 * Drinks follow the same atomic-context rule as the predictive resolver
 * (resolveActionContext in action-context.js): an action-specific loadout's own resolved saved
 * drinks apply (`drinksApplicable === true`), but an All Skills loadout structurally never carries
 * real drink slots, so its always-blank drinks array is a void, not a player choice - use the
 * action's current drinks instead, preserving current-main semantics.
 * @param {number} loadoutId
 * @param {string} actionTypeHrid
 * @returns {{context: Object, unresolvable: false}|{context: null, unresolvable: true}}
 */
function resolveExplicitQueuedLoadoutContext(loadoutId, actionTypeHrid) {
    const snapshot = loadoutState.getUsableSnapshotById(loadoutId);
    if (!snapshot) return { context: null, unresolvable: true };

    const drinks = snapshot.drinksApplicable
        ? (snapshot.drinks || []).filter((entry) => entry.itemHrid)
        : resolveCurrentActionContext(actionTypeHrid).drinks;

    return {
        context: {
            equipment: new Map((snapshot.equipment || []).map((entry) => [entry.itemLocationHrid, entry])),
            drinks,
        },
        unresolvable: false,
    };
}

/**
 * Character Activity may publish an ETA only from a structurally valid timing result. Genuine
 * zero-work/zero-resource boundaries are valid; `Infinity` is valid only when the helper
 * explicitly proved a truly-unbounded action. Everything else non-finite, negative, or
 * contradictory (e.g. a finite queued row with real work remaining but no limiter explaining a
 * zero count) fails closed rather than reaching the persisted timeline.
 * @param {Object|null|undefined} timing
 * @param {Object} actionObj
 * @returns {boolean}
 */
function isTrustworthyTimingResult(timing, actionObj) {
    if (!timing || timing.timingUnavailable) return false;

    const { count, baseActionsNeeded, materialLimit } = timing;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return false;
    if (typeof baseActionsNeeded !== 'number' || !Number.isFinite(baseActionsNeeded) || baseActionsNeeded < 0) {
        return false;
    }
    if (materialLimit !== null && materialLimit !== undefined) {
        if (typeof materialLimit !== 'number' || !Number.isFinite(materialLimit) || materialLimit < 0) return false;
    }

    if (timing.isTrulyInfinite) return timing.totalTime === Infinity;

    const { totalTime, actionTimeSeconds } = timing;
    if (typeof totalTime !== 'number' || !Number.isFinite(totalTime) || totalTime < 0) return false;
    if (typeof actionTimeSeconds !== 'number' || !Number.isFinite(actionTimeSeconds) || actionTimeSeconds < 0) {
        return false;
    }

    if (actionObj?.hasMaxCount) {
        const { maxCount, currentCount } = actionObj;
        if (typeof maxCount !== 'number' || !Number.isFinite(maxCount)) return false;
        if (typeof currentCount !== 'number' || !Number.isFinite(currentCount)) return false;
        const remaining = maxCount - currentCount;
        if (remaining < 0 || count > remaining) return false;
        if (remaining > 0 && count === 0 && !timing.limitType) return false;
    } else if (count === 0 && !timing.limitType) {
        // A non-finite native action that isn't truly infinite must have a concrete limiter.
        return false;
    }

    return true;
}

/**
 * Epoch ms when the drink(s) slotted for an action type run out, or null. Memoized per type per
 * projection call; a revisited type still checks the same fixed instant, which can only truncate
 * a segment earlier than the true cutoff (the drink isn't consumed while a different type runs).
 */
function getDrinkCutoffAt(actionTypeHrid, now, cache) {
    if (cache.has(actionTypeHrid)) return cache.get(actionTypeHrid);

    const drinks = calculateDrinkRemainingSeconds(actionTypeHrid) || [];
    const minRemainingSeconds = drinks.length ? Math.min(...drinks.map((d) => d.totalSeconds)) : null;
    const cutoffAt = minRemainingSeconds != null ? now + minRemainingSeconds * 1000 : null;

    cache.set(actionTypeHrid, cutoffAt);
    return cutoffAt;
}

function buildSegment({
    actionObj,
    actionDetails,
    queuedIndex,
    remainingQueuedCount,
    startAt,
    endAt,
    certainty,
    stopCause,
}) {
    return {
        actionHrid: actionObj.actionHrid,
        actionName: actionDetails?.name || actionObj.actionHrid,
        displayName: buildDisplayName(actionObj, actionDetails),
        actionTypeHrid: actionDetails?.type || null,
        startAt,
        endAt,
        queuedIndex,
        remainingQueuedCount,
        certainty,
        stopCause,
    };
}

/**
 * Project the queue forward from `now`. Does not consider the offline-progress cap - see
 * `resolveDisplayProjection`, resolved separately against a live `lastOfflineTime`.
 * @param {number} [now]
 * @returns {{segments: Array, terminalCause: string, terminalAt: number|null, certainty: string}}
 */
export function computeLiveProjection(now = Date.now()) {
    const actions = dataManager.getCurrentActions();

    if (!actions || actions.length === 0) {
        return { segments: [], terminalCause: 'idle', terminalAt: now, certainty: 'trustworthy' };
    }

    let inventoryLookup = actionTimeDisplay.buildInventoryLookup(dataManager.getInventory());
    const drinkCutoffCache = new Map();
    const unknownBalanceHrids = new Set();
    const possibleExtraHrids = new Set();

    const segments = [];
    let currentTime = now;
    let terminalCause = null;
    let terminalAt = null;
    let certainty = 'trustworthy';

    function pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, startAt, stopCause) {
        segments.push(
            buildSegment({
                actionObj,
                actionDetails,
                queuedIndex: i,
                remainingQueuedCount,
                startAt,
                endAt: null,
                certainty: 'uncertain',
                stopCause,
            })
        );
        terminalCause = 'unknown';
        terminalAt = null;
        certainty = 'uncertain';
    }

    function pushDrinkBoundary(actionObj, actionDetails, i, remainingQueuedCount, startAt, cutoffAt) {
        segments.push(
            buildSegment({
                actionObj,
                actionDetails,
                queuedIndex: i,
                remainingQueuedCount,
                startAt,
                endAt: cutoffAt,
                certainty: 'trustworthy',
                stopCause: 'drink',
            })
        );
        terminalCause = 'drink';
        terminalAt = cutoffAt;
    }

    for (let i = 0; i < actions.length; i++) {
        const actionObj = actions[i];
        const actionDetails = dataManager.getActionDetails(actionObj.actionHrid);
        const remainingQueuedCount = actions.length - i - 1;

        const uncertainReason = actionDetails ? classifyUncertainty(actionObj, actionDetails) : 'timing-unavailable';
        if (uncertainReason) {
            pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, currentTime, uncertainReason);
            break;
        }

        // The front action already runs on live equipment/drinks (matches Action Time Display's
        // own current-action surfaces). A queued action explicitly tagged with a native
        // characterLoadoutID must use exactly that loadout or fail closed if it's unresolvable -
        // never an unrelated Toolasha predictive default. With no explicit loadout, the
        // predictive default is the only justifiable context for that eventual action.
        let actionContext;
        if (i === 0) {
            actionContext = resolveCurrentActionContext(actionDetails.type);
        } else {
            const nativeLoadout = getNativeQueuedLoadoutIdentity(actionObj);
            if (nativeLoadout.malformed) {
                pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, currentTime, 'loadout-unavailable');
                break;
            }
            if (nativeLoadout.hasExplicitLoadout) {
                const resolved = resolveExplicitQueuedLoadoutContext(nativeLoadout.loadoutId, actionDetails.type);
                if (resolved.unresolvable) {
                    pushUncertain(
                        actionObj,
                        actionDetails,
                        i,
                        remainingQueuedCount,
                        currentTime,
                        'loadout-unavailable'
                    );
                    break;
                }
                actionContext = resolved.context;
            }
        }
        const timing = actionTimeDisplay.calculateSingleQueueActionTime(
            actionObj,
            actionDetails,
            inventoryLookup,
            actionContext
        );

        if (!isTrustworthyTimingResult(timing, actionObj)) {
            pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, currentTime, 'timing-unavailable');
            break;
        }

        if (timing.isTrulyInfinite) {
            const drinkCutoffAt = getDrinkCutoffAt(actionDetails.type, now, drinkCutoffCache);
            if (drinkCutoffAt != null && drinkCutoffAt > currentTime) {
                pushDrinkBoundary(actionObj, actionDetails, i, remainingQueuedCount, currentTime, drinkCutoffAt);
                break;
            }

            segments.push(
                buildSegment({
                    actionObj,
                    actionDetails,
                    queuedIndex: i,
                    remainingQueuedCount,
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

        const stopCause = classifyStopCause(timing.limitType);

        const footprint = getSegmentInventoryFootprint(actionDetails, actionObj);
        if (intersects(footprint.consumed, unknownBalanceHrids)) {
            pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, currentTime, 'inventory-dependency');
            break;
        }

        // A prior random drop is only relevant when the deterministic lower-bound inventory actually
        // binds this segment. If full finite work is already supported by deterministic stock alone,
        // possible extra random inventory must not poison an otherwise deterministic queue.
        const limitingHrid = getLimitHrid(timing.limitType);
        if (limitingHrid && possibleExtraHrids.has(limitingHrid)) {
            pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, currentTime, 'inventory-dependency');
            break;
        }

        const naturalEndAt = currentTime + timing.totalTime * 1000;
        if (!Number.isFinite(naturalEndAt) || naturalEndAt < currentTime) {
            pushUncertain(actionObj, actionDetails, i, remainingQueuedCount, currentTime, 'timing-unavailable');
            break;
        }
        const drinkCutoffAt = getDrinkCutoffAt(actionDetails.type, now, drinkCutoffCache);

        if (drinkCutoffAt != null && drinkCutoffAt > currentTime && drinkCutoffAt < naturalEndAt) {
            pushDrinkBoundary(actionObj, actionDetails, i, remainingQueuedCount, currentTime, drinkCutoffAt);
            break;
        }

        segments.push(
            buildSegment({
                actionObj,
                actionDetails,
                queuedIndex: i,
                remainingQueuedCount,
                startAt: currentTime,
                endAt: naturalEndAt,
                certainty: 'trustworthy',
                stopCause,
            })
        );

        const projected = projectOrdinaryDeterministicInventory(actionDetails, timing, inventoryLookup, actionContext);
        if (projected.supported) {
            inventoryLookup = projected.inventoryLookup;
            for (const hrid of footprint.stochasticProduced) possibleExtraHrids.add(hrid);
        } else {
            // Keep complex/unsupported balance changes local instead of poisoning unrelated queue
            // entries. A later consumer of one of these identities fails closed.
            for (const hrid of footprint.consumed) unknownBalanceHrids.add(hrid);
            for (const hrid of footprint.deterministicProduced) unknownBalanceHrids.add(hrid);
            for (const hrid of footprint.stochasticProduced) unknownBalanceHrids.add(hrid);
        }

        currentTime = naturalEndAt;

        if (i === actions.length - 1) {
            terminalAt = naturalEndAt;
            terminalCause = RESOURCE_STOP_CAUSES.has(stopCause)
                ? stopCause
                : segments.length === 1
                  ? 'action'
                  : 'queue';
        }
    }

    return { segments, terminalCause, terminalAt, certainty };
}

/**
 * Resolve a persisted projection for display now, overlaying the offline-progress cap against a
 * freshly-read `lastOfflineTime` (never a value baked in at observation time). Fails closed to
 * 'unknown' rather than asserting a deadline across an unresolved MooPass-expiry boundary, and
 * still finds a trustworthy deterministic prefix (segments before the first uncertain one) even
 * when the whole chain is 'unknown' - an early uncertain segment must not hide an earlier,
 * perfectly knowable offline-cap deadline.
 */
export function resolveDisplayProjection(stored, freshLastOfflineTime) {
    const { segments, terminalCause, terminalAt } = stored.projection;

    if (terminalCause === 'idle') {
        return { segments, terminalCause, terminalAt };
    }

    const offlineHourCap = stored.offline?.hourCap;
    const mooPassExpireTime = stored.offline?.mooPassExpireTime;
    const hasTrustworthyCap = offlineHourCap > 0 && freshLastOfflineTime != null;
    const offlineLimitAt = hasTrustworthyCap ? freshLastOfflineTime + offlineHourCap * 3600 * 1000 : null;
    const mooPassAmbiguous = hasTrustworthyCap && mooPassExpireTime != null && mooPassExpireTime < offlineLimitAt;

    if (terminalCause === 'unknown') {
        const trustworthySegments = segments.filter((s) => s.certainty === 'trustworthy');
        if (trustworthySegments.length === 0 || !hasTrustworthyCap || mooPassAmbiguous) {
            return { segments, terminalCause, terminalAt };
        }
        const prefixEndAt = trustworthySegments[trustworthySegments.length - 1].endAt;
        if (prefixEndAt != null && offlineLimitAt < prefixEndAt) {
            return { segments, terminalCause: 'offline', terminalAt: offlineLimitAt };
        }
        return { segments, terminalCause, terminalAt };
    }

    if (!hasTrustworthyCap) {
        return terminalCause === 'infinite'
            ? { segments, terminalCause: 'unknown', terminalAt: null }
            : { segments, terminalCause, terminalAt };
    }

    if (mooPassAmbiguous) {
        if (terminalCause === 'infinite') return { segments, terminalCause: 'unknown', terminalAt: null };
        if (terminalAt != null && terminalAt > mooPassExpireTime) {
            return { segments, terminalCause: 'unknown', terminalAt: null };
        }
        return { segments, terminalCause, terminalAt };
    }

    if (terminalCause === 'infinite' || terminalAt === null || offlineLimitAt < terminalAt) {
        return { segments, terminalCause: 'offline', terminalAt: offlineLimitAt };
    }

    return { segments, terminalCause, terminalAt };
}
