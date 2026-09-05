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
const CHARACTER_SLOTS_CLASS = 'CharacterSelectPage_characterSlots';
const BLOCK_CLASS = 'toolasha-character-activity-status';
const REFRESH_INTERVAL_MS = 60000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_TOLERANCE_MS = 5000;

const FUTURE_LABELS = {
    action: 'Action ends',
    queue: 'Queue ends',
    materials: 'Materials run out',
    coins: 'Coins run out',
    'upgrade-materials': 'Upgrade materials run out',
    drink: 'Buff expiring',
    offline: 'Offline limit',
};

const PAST_LABELS = {
    action: 'Action ended',
    queue: 'Queue ended',
    materials: 'Materials ran out',
    coins: 'Coins ran out',
    'upgrade-materials': 'Upgrade materials ran out',
    drink: 'Buff expired',
    offline: 'Offline progress stopped',
};

// Per-cause text for the neutral "unknown" branch, keyed by the active uncertain segment's own
// `stopCause`. Locked copy per the approved UX contract - do not abbreviate the suffix.
const UNCERTAIN_REASON_TEXT = {
    combat: 'Variable duration · ETA unavailable',
    labyrinth: 'Variable duration · ETA unavailable',
    enhancing: 'Stochastic outcome · ETA unavailable',
    special: 'Waiting for party · ETA unavailable',
    'loadout-unavailable': 'Configured loadout unavailable · ETA unavailable',
};
// Current segment is still a trustworthy earlier one, but a later segment in the same queue is
// uncertain - the deadline itself (not the current action) is what's unknowable.
const QUEUE_UNCERTAIN_TEXT = 'Queue duration uncertain · ETA unavailable';
const DEFAULT_UNCERTAIN_TEXT = 'End time unavailable';

const COLOR_HEX = {
    green: '#51cf66',
    yellow: '#f0a830',
    red: '#ff6b6b',
    neutral: '#888888',
};

// Native ActionTypeIcons: the 10 skilling types live in skills_sprite, Combat/Labyrinth live in
// misc_sprite, and Special (Party Ready) has no native type icon at all.
const MISC_SPRITE_TYPES = new Set(['/action_types/combat', '/action_types/labyrinth']);
const NO_ICON_TYPES = new Set(['/action_types/special']);

/** Sprite sheet for a segment's icon, or null for action types with no native icon (Special). */
function spriteFamilyForType(actionTypeHrid) {
    if (!actionTypeHrid || NO_ICON_TYPES.has(actionTypeHrid)) return null;
    return MISC_SPRITE_TYPES.has(actionTypeHrid) ? 'misc' : 'skills';
}

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
    let text = segment.displayName || segment.actionName;
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
 * @returns {{firstLineText: string, limiterColor: string, limiterText: string, activeSegment: Object|null}}
 */
export function computeSlotDisplayState(record, character, prefs, now = Date.now()) {
    if (!record) {
        return {
            firstLineText: 'No activity data yet',
            limiterColor: 'neutral',
            limiterText: 'Open character once to enable status',
            activeSegment: null,
        };
    }

    if (character.lastOfflineTime != null && character.lastOfflineTime > record.observedAt + STALE_TOLERANCE_MS) {
        return {
            firstLineText: 'Activity status outdated',
            limiterColor: 'neutral',
            limiterText: 'Open character to refresh',
            activeSegment: null,
        };
    }

    // A currently-online character must never get an offline deadline from a stale lastOfflineTime.
    const effectiveLastOfflineTime = character.isOnline ? null : character.lastOfflineTime;
    const { segments, terminalCause, terminalAt } = resolveDisplayProjection(record, effectiveLastOfflineTime);

    if (terminalCause === 'idle') {
        return {
            firstLineText: 'No active action',
            limiterColor: 'red',
            limiterText: 'Character is idle',
            activeSegment: null,
        };
    }

    if (terminalCause === 'unknown' || segments.length === 0) {
        const found = findSegmentAtTime(segments, now);
        const activeSegment = found ? found.segment : null;

        if (!activeSegment) {
            return {
                firstLineText: 'No active action expected',
                limiterColor: 'neutral',
                limiterText: DEFAULT_UNCERTAIN_TEXT,
                activeSegment: null,
            };
        }

        // The currently active segment may still be an earlier trustworthy one - the queue only
        // becomes uncertain at a LATER segment. Line 1 must keep showing what's actually running
        // now, not the future segment that made the total deadline unknowable.
        const limiterText =
            activeSegment.certainty === 'uncertain'
                ? UNCERTAIN_REASON_TEXT[activeSegment.stopCause] || DEFAULT_UNCERTAIN_TEXT
                : QUEUE_UNCERTAIN_TEXT;

        return {
            firstLineText: formatActivityLine(activeSegment, false, activeSegment.remainingQueuedCount ?? 0),
            limiterColor: 'neutral',
            limiterText,
            activeSegment,
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
            return {
                firstLineText: formatActivityLine(found.segment, true, found.segment.remainingQueuedCount ?? 0),
                limiterColor: 'red',
                limiterText: `${PAST_LABELS.offline} · ${time}`,
                activeSegment: found.segment,
            };
        }
        return {
            firstLineText: 'No active action expected',
            limiterColor: 'red',
            limiterText: `${PAST_LABELS[terminalCause]} · ${time}`,
            activeSegment: null,
        };
    }

    const found = findSegmentAtTime(segments, now);
    const color = terminalAt - now > ONE_HOUR_MS ? 'green' : 'yellow';

    return {
        firstLineText: found
            ? formatActivityLine(found.segment, false, found.segment.remainingQueuedCount ?? 0)
            : 'No active action expected',
        limiterColor: color,
        limiterText: `${FUTURE_LABELS[terminalCause]} · ${time}`,
        activeSegment: found ? found.segment : null,
    };
}

class CharacterSelectRenderer {
    constructor() {
        this.isWatching = false;
        this.unregisterObserver = null;
        this.unregisterReady = null;
        this.refreshTimer = null;
        this.trackedSlots = new Map(); // characterId -> {slotElement, character}
        this.renderGeneration = 0;
    }

    /**
     * Start watching for Character Select. Safe to call unconditionally on every page load,
     * before any character has ever initialized - does nothing until Character Select actually
     * appears in the DOM.
     */
    startWatching() {
        if (this.isWatching) return;
        this.isWatching = true;

        // Native Character Select mounts its root with isLoading=true/characters=[] first, then
        // inserts the actual character-slots container inside that same root once the async
        // loadCharacters() call resolves. Watch for both signals on the shared observer so a
        // slots-container insertion under an already-mounted root triggers a rescan.
        this.unregisterObserver = domObserver.onClass(
            'characterActivityStatus',
            [CHARACTER_SELECT_ROOT_CLASS, CHARACTER_SLOTS_CLASS],
            (node) => this.onCharacterSelectDomReady(node)
        );

        // @run-at document-start means domObserver.start() can return before document.body exists.
        // If native Character Select fully mounts during that readiness gap, neither its root nor
        // slots insertion can be observed. Subscribe to the centralized observer's actual-ready
        // lifecycle and perform the bounded catch-up only after it is attached to the current body.
        // If it is already observing, onReady() invokes this immediately.
        this.unregisterReady = domObserver.onReady('characterActivityStatusCatchUp', () => this.catchUpExistingRoot());
    }

    /**
     * Bounded catch-up after the shared DOM observer is actually ready.
     */
    async catchUpExistingRoot() {
        if (!this.isWatching) return;
        const existingRoot = document.querySelector(`[class*="${CHARACTER_SELECT_ROOT_CLASS}"]`);
        if (existingRoot) return this.onCharacterSelectMounted(existingRoot);
    }

    /**
     * Resolve whichever Character Select root owns a newly-observed node (the root itself, or the
     * later-inserted slots container nested inside it) and (re)run discovery against that root.
     * @param {Element} node
     */
    async onCharacterSelectDomReady(node) {
        if (!node?.isConnected) return;

        const rootElement =
            (typeof node.className === 'string' && node.className.includes(CHARACTER_SELECT_ROOT_CLASS) && node) ||
            node.closest?.(`[class*="${CHARACTER_SELECT_ROOT_CLASS}"]`);
        if (!rootElement) return;

        return this.onCharacterSelectMounted(rootElement);
    }

    async onCharacterSelectMounted(rootElement) {
        // Bumped before any await - every in-flight continuation below checks it before touching
        // the DOM, so a stale render from this mount can never overwrite a newer one.
        const generation = ++this.renderGeneration;

        const resolved = resolveCharacterSelectSlots(rootElement);
        if (!resolved) return;
        if (generation !== this.renderGeneration) return;

        this.trackedSlots.clear();
        for (const { slotElement, character } of resolved) {
            this.trackedSlots.set(character.id, { slotElement, character });
        }

        await this.renderAllTrackedSlots(generation);
        this.startRefreshTimer();
    }

    async renderAllTrackedSlots(generation = this.renderGeneration) {
        const prefs = await loadAccountPreferences();
        if (generation !== this.renderGeneration) return;

        if (!prefs.enabled) {
            this.clearAllInjectedBlocks();
            return;
        }

        // Sprite resolution can hit the network (asset-manifest.json) - kick it off without
        // blocking the text render below. Text must never wait on, or be suppressed by, icons.
        const spriteUrlsPromise = Promise.all([
            assetManifest.getSpriteUrl('skills'),
            assetManifest.getSpriteUrl('misc'),
        ]).then(([skills, misc]) => ({ skills, misc }));

        const rendered = [];
        for (const { slotElement, character } of this.trackedSlots.values()) {
            if (generation !== this.renderGeneration) return;
            if (!slotElement.isConnected) continue;
            const record = await loadCharacterActivity(character.id);
            if (generation !== this.renderGeneration) return;
            const state = computeSlotDisplayState(record, character, prefs);
            this.renderSlotBlock(slotElement, state, null);
            rendered.push({ slotElement, state });
        }

        const spriteUrls = await spriteUrlsPromise;
        if (generation !== this.renderGeneration) return;
        for (const { slotElement, state } of rendered) {
            if (!slotElement.isConnected) continue;
            this.renderSlotBlock(slotElement, state, spriteUrls);
        }
    }

    renderSlotBlock(slotElement, state, spriteUrls) {
        let block = slotElement.querySelector(`.${BLOCK_CLASS}`);
        if (!block) {
            block = document.createElement('div');
            block.className = BLOCK_CLASS;
            block.style.cssText = 'font-size:11px; line-height:1.3; margin-top:2px;';
            slotElement.appendChild(block);
        }

        const family = spriteFamilyForType(state.activeSegment?.actionTypeHrid);
        const spriteUrl = family && spriteUrls ? spriteUrls[family] : null;
        const iconHtml = spriteUrl
            ? `<svg width="16" height="16" style="vertical-align:middle;margin-right:3px;"><use href="${spriteUrl}#${skillSlugFromSegment(state.activeSegment)}"></use></svg>`
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
            this.renderAllTrackedSlots(this.renderGeneration);
        }, REFRESH_INTERVAL_MS);
    }

    /**
     * Explicitly invalidate any in-flight render and immediately re-read the account preference
     * mirror. Used only for rare presentation-setting changes, so their effect (enabled toggle,
     * date/time format) is visible on an already-mounted Character Select without waiting for the
     * periodic refresh timer or an unrelated action event.
     */
    async refreshNow() {
        if (!this.isWatching) return;

        const generation = ++this.renderGeneration;

        if (this.trackedSlots.size === 0 || !this.anySlotStillConnected()) {
            return;
        }

        await this.renderAllTrackedSlots(generation);
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
        if (this.unregisterReady) {
            this.unregisterReady();
            this.unregisterReady = null;
        }
        this.stopRefreshTimer();
        this.clearAllInjectedBlocks();
        this.trackedSlots.clear();
        this.renderGeneration += 1;
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
