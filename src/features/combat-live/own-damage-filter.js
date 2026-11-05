/**
 * Own damage filter
 *
 * Hides the damage numbers on the game's monster cards that are not the viewer's. The game draws a number
 * for every hit and says nothing about who landed it, so each monster hit is credited the way Combat Live
 * credits damage (to the one player who acted in the same combat message) and the number the game draws
 * for it is matched by its kind (damage, critical, miss) and its value, then hidden with `visibility`.
 * Nothing is removed from the game's elements, and the hiding is undone when the game reuses the slot.
 *
 * Only active in a party, with the viewer known. A hit with no known owner (damage over time, reflected
 * damage, several players acting in one message) is not the viewer's, so it is hidden too.
 */

import config from '../../core/config.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const AREA_SELECTOR = '[class*="BattlePanel_monstersArea"]';
const UNIT_SELECTOR = '[class*="CombatUnit_combatUnit"]';
const SPLATS_SELECTOR = '[class*="CombatUnit_splatsContainer"]';
const CHECK_MS = 250;
// The game shows a number for under two seconds; an event that never found its number is dropped after this
const PENDING_MAX_MS = 4000;

/**
 * @param {Element} splat - One slot of a monster's splat list
 * @returns {?string} 'damage' | 'criticalDamage' | 'miss' for a number worth judging, else null (empty slot,
 *     heals and mana)
 */
function splatKind(splat) {
    const cls = splat.className || '';
    if (typeof cls !== 'string' || !cls.includes('CombatUnit_splat')) return null;
    if (cls.includes('CombatUnit_criticalDamage')) return 'criticalDamage';
    if (cls.includes('CombatUnit_damage')) return 'damage';
    if (cls.includes('CombatUnit_miss')) return 'miss';
    return null;
}

/**
 * @param {{crit: boolean, miss: boolean}} hit
 * @returns {string} The kind of number the game draws for this hit
 */
function hitKind(hit) {
    if (hit.miss) return 'miss';
    return hit.crit ? 'criticalDamage' : 'damage';
}

class OwnDamageFilter {
    constructor() {
        this.timerRegistry = createTimerRegistry();
        this.deps = null;
        this.observer = null;
        this.observed = null;
        // monster index -> [{kind, text, at, foreign}], oldest first
        this.pending = new Map();
        // splat element -> {signature, resolved}
        this.seen = new WeakMap();
        this.hidden = new Set();
    }

    /**
     * @param {{getSelf: function(): ?string, getPartySize: function(): number, rosterSize: function(): number}} deps
     */
    initialize(deps) {
        if (this.deps) return;
        this.deps = deps;
        this.timerRegistry.registerInterval(setInterval(() => this.reconcile(), CHECK_MS));
    }

    /**
     * @returns {boolean} Whether numbers should be hidden right now
     */
    isFiltering() {
        return Boolean(
            this.deps &&
            config.getSetting('combatLive_ownDamageOnly') &&
            this.deps.getSelf() &&
            this.deps.getPartySize() > 1
        );
    }

    /**
     * Remember the owner of each monster hit of one combat message, then look for the numbers.
     * @param {Array<{index: number, amount: number, crit: boolean, miss: boolean, player: ?string}>} hits
     * @param {number} [now]
     */
    noteHits(hits, now = Date.now()) {
        if (!this.isFiltering() || !hits?.length) return;
        const self = this.deps.getSelf();
        for (const hit of hits) {
            const list = this.pending.get(hit.index) || [];
            list.push({ kind: hitKind(hit), text: String(hit.amount), at: now, foreign: hit.player !== self });
            this.pending.set(hit.index, list);
        }
        this.reconcile(now);
    }

    /**
     * A new wave has fresh monsters; nothing from before applies.
     */
    beginWave() {
        this.pending.clear();
    }

    /**
     * Judge every number currently on the monster cards.
     * @param {number} [now]
     */
    reconcile(now = Date.now()) {
        if (!this.deps) return;
        if (!this.isFiltering()) {
            this.pending.clear();
            this.showAll();
            this.stopObserving();
            return;
        }

        const area = document.querySelector(AREA_SELECTOR);
        this.observe(area);
        for (const [index, list] of this.pending) {
            const fresh = list.filter((entry) => now - entry.at <= PENDING_MAX_MS);
            if (fresh.length) this.pending.set(index, fresh);
            else this.pending.delete(index);
        }
        if (!area) return;

        const units = [...area.querySelectorAll(UNIT_SELECTOR)];
        // The DOM and the roster disagree in size (a different view of the party): leave the cards alone
        if (units.length !== this.deps.rosterSize()) return;
        units.forEach((unit, index) => {
            const slots = unit.querySelector(SPLATS_SELECTOR)?.children ?? [];
            for (const splat of slots) this.judge(splat, index);
        });
    }

    judge(splat, index) {
        const kind = splatKind(splat);
        if (!kind) {
            this.release(splat);
            return;
        }
        const signature = `${kind}:${splat.textContent}`;
        const known = this.seen.get(splat);
        if (known?.signature === signature && known.resolved) return;
        if (known && known.signature !== signature) this.release(splat);

        const list = this.pending.get(index) || [];
        const at = list.findIndex((entry) => entry.kind === kind && entry.text === splat.textContent);
        if (at === -1) {
            // Not heard of (yet): leave it as it is and look again next time
            this.seen.set(splat, { signature, resolved: false });
            return;
        }
        const [entry] = list.splice(at, 1);
        this.seen.set(splat, { signature, resolved: true });
        if (entry.foreign) {
            splat.style.visibility = 'hidden';
            this.hidden.add(splat);
        }
    }

    /**
     * Forget a number the game has cleared or reused, and show it again.
     * @param {Element} splat
     */
    release(splat) {
        this.seen.delete(splat);
        if (this.hidden.delete(splat)) splat.style.visibility = '';
    }

    showAll() {
        for (const splat of this.hidden) splat.style.visibility = '';
        this.hidden.clear();
    }

    /**
     * React as soon as the game changes a number rather than waiting for the next check.
     * @param {?Element} area
     */
    observe(area) {
        if (area === this.observed) return;
        this.stopObserving();
        if (!area) return;
        this.observer = new MutationObserver(() => this.reconcile());
        this.observer.observe(area, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        this.observed = area;
    }

    stopObserving() {
        this.observer?.disconnect();
        this.observer = null;
        this.observed = null;
    }

    cleanup() {
        this.timerRegistry.clearAll();
        this.stopObserving();
        this.showAll();
        this.pending.clear();
        this.deps = null;
    }
}

const ownDamageFilter = new OwnDamageFilter();
export default ownDamageFilter;
export { OwnDamageFilter, splatKind };
