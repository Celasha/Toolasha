/**
 * Character Select Renderer
 * Injects the compact two-line Character Activity Status block into each populated native
 * Character Select slot. Always-on (registered outside the normal character-scoped feature
 * lifecycle, since Character Select can be the very first page shown with no character ever
 * initialized yet) but cheap when idle - the DOM watcher only does work once Character Select
 * actually appears.
 */

import domObserver from '../../core/dom-observer.js';
import assetManifest from '../../utils/asset-manifest.js';
import { formatActivityStatusTime } from '../../utils/formatters.js';
import { resolveCharacterSelectSlots } from './character-select-resolver.js';
import { resolveDisplayProjection } from './character-activity-projection.js';
import { loadCharacterActivity, loadAccountPreferences } from './character-activity-storage.js';

const CHARACTER_SELECT_ROOT_CLASS = 'CharacterSelectPage_characterSelectPage';
const BLOCK_CLASS = 'toolasha-character-activity-status';
const REFRESH_INTERVAL_MS = 60000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_TOLERANCE_MS = 5000;

const FUTURE_LABELS = {
    action: 'Action ends',
    queue: 'Queue ends',
    materials: 'Materials run out',
    offline: 'Offline limit',
};

const PAST_LABELS = {
    action: 'Action ended',
    queue: 'Queue ended',
    materials: 'Materials ran out',
    offline: 'Offline progress stopped',
};

const COLOR_HEX = {
    green: '#51cf66',
    yellow: '#f0a830',
    red: '#ff6b6b',
    neutral: '#888888',
};

/**
 * Find whichever segment covers a given instant (its own `startAt`-`endAt` range covers `time`,
 * or it's still open-ended). Segments are stored in chronological order with contiguous
 * boundaries, so the first match walking forward is always correct.
 * @param {Array} segments
 * @param {number} time - Epoch ms
 * @returns {{segment: Object, index: number}|null} null if every segment already ended by `time`
 */
function findSegmentAtTime(segments, time) {
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.endAt === null || segment.endAt > time) {
            return { segment, index: i };
        }
    }
    return null;
}

function formatActivityLine(segment, isPaused, queuedCount) {
    let text = segment.actionName;
    if (isPaused) text += ' ⏸';
    if (queuedCount > 0) text += ` +${queuedCount} queued`;
    return text;
}

/**
 * Resolve the exact two-line display state for one character from its persisted record and
 * live native data, given the current instant. Pure/testable - no DOM.
 * @param {Object|null} record - `loadCharacterActivity()` result, or null if never observed
 * @param {Object} character - Native character object (id, name, lastOfflineTime, isOnline)
 * @param {Object} prefs - Account-level date/time preferences
 * @param {number} [now]
 * @returns {{firstLineText: string, limiterColor: string, limiterText: string}}
 */
export function computeSlotDisplayState(record, character, prefs, now = Date.now()) {
    if (!record) {
        return {
            firstLineText: 'No activity data yet',
            limiterColor: 'neutral',
            limiterText: 'Open character once to enable status',
        };
    }

    if (character.lastOfflineTime != null && character.lastOfflineTime > record.observedAt + STALE_TOLERANCE_MS) {
        return {
            firstLineText: 'Activity status outdated',
            limiterColor: 'neutral',
            limiterText: 'Open character to refresh',
        };
    }

    const { segments, terminalCause, terminalAt } = resolveDisplayProjection(record, character.lastOfflineTime);

    if (terminalCause === 'idle') {
        return { firstLineText: 'No active action', limiterColor: 'red', limiterText: 'Character is idle' };
    }

    if (terminalCause === 'unknown' || segments.length === 0) {
        const last = segments[segments.length - 1];
        return {
            firstLineText: last ? formatActivityLine(last, false, 0) : 'No active action expected',
            limiterColor: 'neutral',
            limiterText: 'End time unavailable',
        };
    }

    const hasPassed = terminalAt !== null && terminalAt <= now;
    const time = formatActivityStatusTime(terminalAt, prefs, now);

    if (hasPassed) {
        if (terminalCause === 'offline') {
            const found = findSegmentAtTime(segments, terminalAt) || {
                segment: segments[segments.length - 1],
                index: segments.length - 1,
            };
            const queuedCount = segments.length - found.index - 1;
            return {
                firstLineText: formatActivityLine(found.segment, true, queuedCount),
                limiterColor: 'red',
                limiterText: `${PAST_LABELS.offline} · ${time}`,
            };
        }
        return {
            firstLineText: 'No active action expected',
            limiterColor: 'red',
            limiterText: `${PAST_LABELS[terminalCause]} · ${time}`,
        };
    }

    const found = findSegmentAtTime(segments, now);
    const queuedCount = found ? segments.length - found.index - 1 : 0;
    const color = terminalAt - now > ONE_HOUR_MS ? 'green' : 'yellow';

    return {
        firstLineText: found ? formatActivityLine(found.segment, false, queuedCount) : 'No active action expected',
        limiterColor: color,
        limiterText: `${FUTURE_LABELS[terminalCause]} · ${time}`,
    };
}

class CharacterSelectRenderer {
    constructor() {
        this.isWatching = false;
        this.unregisterObserver = null;
        this.refreshTimer = null;
        this.trackedSlots = new Map(); // characterId -> {slotElement, character}
    }

    /**
     * Start watching for Character Select. Safe to call unconditionally on every page load,
     * before any character has ever initialized - does nothing until Character Select actually
     * appears in the DOM.
     */
    startWatching() {
        if (this.isWatching) return;
        this.isWatching = true;

        this.unregisterObserver = domObserver.onClass('characterActivityStatus', CHARACTER_SELECT_ROOT_CLASS, (node) =>
            this.onCharacterSelectMounted(node)
        );
    }

    async onCharacterSelectMounted(rootElement) {
        const resolved = resolveCharacterSelectSlots(rootElement);
        if (!resolved) return;

        this.trackedSlots.clear();
        for (const { slotElement, character } of resolved) {
            this.trackedSlots.set(character.id, { slotElement, character });
        }

        await this.renderAllTrackedSlots();
        this.startRefreshTimer();
    }

    async renderAllTrackedSlots() {
        const prefs = await loadAccountPreferences();
        if (!prefs.enabled) {
            this.clearAllInjectedBlocks();
            return;
        }

        const spriteUrl = await assetManifest.getSpriteUrl('skills');

        for (const { slotElement, character } of this.trackedSlots.values()) {
            if (!slotElement.isConnected) continue;
            const record = await loadCharacterActivity(character.id);
            const state = computeSlotDisplayState(record, character, prefs);
            this.renderSlotBlock(slotElement, state, record, spriteUrl);
        }
    }

    renderSlotBlock(slotElement, state, record, spriteUrl) {
        let block = slotElement.querySelector(`.${BLOCK_CLASS}`);
        if (!block) {
            block = document.createElement('div');
            block.className = BLOCK_CLASS;
            block.style.cssText = 'font-size:11px; line-height:1.3; margin-top:2px;';
            slotElement.appendChild(block);
        }

        const iconHtml =
            spriteUrl && record?.projection?.segments?.length
                ? `<svg width="16" height="16" style="vertical-align:middle;margin-right:3px;"><use href="${spriteUrl}#${skillSlugFromSegment(record.projection.segments[0])}"></use></svg>`
                : '';

        block.innerHTML = `
            <div style="display:flex;align-items:center;overflow:hidden;">
                ${iconHtml}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(state.firstLineText)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;opacity:0.85;">
                <span style="width:6px;height:6px;border-radius:50%;background:${COLOR_HEX[state.limiterColor]};flex-shrink:0;"></span>
                <span style="white-space:nowrap;">${escapeHtml(state.limiterText)}</span>
            </div>
        `;
    }

    startRefreshTimer() {
        if (this.refreshTimer) return;
        this.refreshTimer = setInterval(() => {
            if (this.trackedSlots.size === 0 || !this.anySlotStillConnected()) {
                this.stopRefreshTimer();
                return;
            }
            this.renderAllTrackedSlots();
        }, REFRESH_INTERVAL_MS);
    }

    anySlotStillConnected() {
        for (const { slotElement } of this.trackedSlots.values()) {
            if (slotElement.isConnected) return true;
        }
        return false;
    }

    stopRefreshTimer() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    clearAllInjectedBlocks() {
        for (const { slotElement } of this.trackedSlots.values()) {
            slotElement.querySelector(`.${BLOCK_CLASS}`)?.remove();
        }
    }

    /**
     * Stop watching and remove everything this feature owns - observers, timers, injected nodes.
     */
    stopWatching() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        this.stopRefreshTimer();
        this.clearAllInjectedBlocks();
        this.trackedSlots.clear();
        this.isWatching = false;
    }
}

function skillSlugFromSegment(segment) {
    return segment?.actionTypeHrid?.replace('/action_types/', '') || '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const characterSelectRenderer = new CharacterSelectRenderer();

export default characterSelectRenderer;
export { findSegmentAtTime, formatActivityLine };
