/**
 * XP/hr Tracker
 * Shows live XP/hr rates on skill bars and time-to-level-up in skill tooltips
 */

import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { formatKMB } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const STORE_NAME = 'xpHistory';
const WINDOW_10M = 10 * 60 * 1000;
const WINDOW_1H = 60 * 60 * 1000;
const WINDOW_1W = 7 * 24 * 60 * 60 * 1000;

/**
 * Skill definitions matching game skill HRIDs
 */
const SKILLS = [
    { id: 'total_level', hrid: '/skills/total_level', name: 'Total Level' },
    { id: 'milking', hrid: '/skills/milking', name: 'Milking' },
    { id: 'foraging', hrid: '/skills/foraging', name: 'Foraging' },
    { id: 'woodcutting', hrid: '/skills/woodcutting', name: 'Woodcutting' },
    { id: 'cheesesmithing', hrid: '/skills/cheesesmithing', name: 'Cheesesmithing' },
    { id: 'crafting', hrid: '/skills/crafting', name: 'Crafting' },
    { id: 'tailoring', hrid: '/skills/tailoring', name: 'Tailoring' },
    { id: 'cooking', hrid: '/skills/cooking', name: 'Cooking' },
    { id: 'brewing', hrid: '/skills/brewing', name: 'Brewing' },
    { id: 'alchemy', hrid: '/skills/alchemy', name: 'Alchemy' },
    { id: 'enhancing', hrid: '/skills/enhancing', name: 'Enhancing' },
    { id: 'stamina', hrid: '/skills/stamina', name: 'Stamina' },
    { id: 'intelligence', hrid: '/skills/intelligence', name: 'Intelligence' },
    { id: 'attack', hrid: '/skills/attack', name: 'Attack' },
    { id: 'melee', hrid: '/skills/melee', name: 'Melee' },
    { id: 'defense', hrid: '/skills/defense', name: 'Defense' },
    { id: 'ranged', hrid: '/skills/ranged', name: 'Ranged' },
    { id: 'magic', hrid: '/skills/magic', name: 'Magic' },
];

const SKILL_NAME_TO_ID = {};
SKILLS.forEach((s) => (SKILL_NAME_TO_ID[s.name.toLowerCase()] = s.id));

// Also map hrid → skill for reverse lookups
const SKILL_HRID_TO_ID = {};
SKILLS.forEach((s) => (SKILL_HRID_TO_ID[s.hrid] = s.id));

/**
 * Append an XP data point to a skill's history array, compacting as needed.
 * Ported from XP-Per-Hr.txt pushXP() with identical compaction rules.
 * @param {Array} arr - Existing history array (mutated in place)
 * @param {{t: number, xp: number}} d - New data point
 */
function pushXP(arr, d) {
    if (arr.length === 0 || d.xp >= arr[arr.length - 1].xp) {
        arr.push(d);
    } else {
        // XP should never decrease within the same character session
        return;
    }

    if (arr.length <= 2) return;

    // Rule 1: within the last 10 minutes, keep only first + last
    let recentLength = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (d.t - arr[i].t <= WINDOW_10M) {
            recentLength++;
        } else {
            break;
        }
    }
    if (recentLength > 2) {
        arr.splice(arr.length - recentLength + 1, recentLength - 2);
    }

    // Rule 2: collapse consecutive same-XP entries that are within 1 hour apart
    let sameLength = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].xp === d.xp && d.t - arr[i].t <= WINDOW_1H) {
            sameLength++;
        } else {
            break;
        }
    }
    if (sameLength > 1) {
        arr.splice(arr.length - sameLength, sameLength - 1);
    }

    // Rule 3: drop entries older than 1 week
    let oldLength = 0;
    for (let i = 0; i < arr.length; i++) {
        if (d.t - arr[i].t > WINDOW_1W) {
            oldLength++;
        } else {
            break;
        }
    }
    if (oldLength > 0) {
        arr.splice(0, oldLength);
    }
}

/**
 * Filter history to only entries within the given interval from now.
 * @param {Array} arr
 * @param {number} interval - ms
 * @returns {Array}
 */
function inLastInterval(arr, interval) {
    const now = Date.now();
    const result = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        if (now - arr[i].t <= interval) {
            result.unshift(arr[i]);
        } else {
            break;
        }
    }
    return result;
}

/**
 * Calculate XP/hr between two data points.
 * @param {{t: number, xp: number}} prev
 * @param {{t: number, xp: number}} cur
 * @returns {number} XP per hour
 */
function calcXPH(prev, cur) {
    const xpDelta = cur.xp - prev.xp;
    const tDeltaMs = cur.t - prev.t;
    return (xpDelta / tDeltaMs) * 3600000;
}

/**
 * Compute lastXPH (10-min window) and lastHourXPH (1-hr window) for a skill.
 * @param {Array} arr - History array for one skill
 * @returns {{lastXPH: number, lastHourXPH: number}}
 */
function calcStats(arr) {
    if (arr.length < 2) return { lastXPH: 0, lastHourXPH: 0 };

    const last10m = inLastInterval(arr, WINDOW_10M);
    const lastXPH = last10m.length >= 2 ? calcXPH(last10m[0], last10m[last10m.length - 1]) : 0;

    const last1h = inLastInterval(arr, WINDOW_1H);
    const lastHourXPH = last1h.length >= 2 ? calcXPH(last1h[0], last1h[last1h.length - 1]) : 0;

    return { lastXPH, lastHourXPH };
}

/**
 * Format a time-to-level duration in ms to a human-readable string.
 * @param {number} ms
 * @returns {string}
 */
function formatTimeLeft(ms) {
    const m1 = 60 * 1000;
    const h1 = 60 * 60 * 1000;
    const d1 = 24 * 60 * 60 * 1000;
    const w1 = 7 * 24 * 60 * 60 * 1000;

    const w = Math.floor(ms / w1);
    const d = Math.floor((ms % w1) / d1);
    const h = Math.floor((ms % d1) / h1);
    const m = Math.ceil((ms % h1) / m1);

    const s = (n) => (n === 1 ? '' : 's');
    const parts = [];

    if (w >= 1) parts.push(`${w} week${s(w)}`);
    if (d >= 1) parts.push(`${d} day${s(d)}`);
    if (ms < w1 && h >= 1) parts.push(`${h} hour${s(h)}`);
    if (ms < 6 * h1 && m >= 1) parts.push(`${m} minute${s(m)}`);

    return parts.join(' ') || '< 1 minute';
}

class XPTracker {
    constructor() {
        this.initialized = false;
        this.characterId = null;
        this.xpHistory = {}; // skillId → [{t, xp}]
        this.timerRegistry = createTimerRegistry();
        this.unregisterObservers = [];
        this.tooltipObserver = null;
    }

    async initialize() {
        if (this.initialized) return;
        if (!config.getSetting('xpTracker', true)) return;

        const characterInitHandler = async (data) => {
            await this._onCharacterInit(data);
        };

        const actionCompletedHandler = (data) => {
            this._onActionCompleted(data);
        };

        dataManager.on('character_initialized', characterInitHandler);
        dataManager.on('action_completed', actionCompletedHandler);

        this.unregisterObservers.push(() => {
            dataManager.off('character_initialized', characterInitHandler);
            dataManager.off('action_completed', actionCompletedHandler);
        });

        // If character data is already loaded, initialize immediately
        if (dataManager.characterData) {
            await this._onCharacterInit(dataManager.characterData);
        }

        // Watch for skill tooltip appearing
        this._watchSkillTooltip();

        this.initialized = true;
    }

    /**
     * Handle init_character_data — record starting XP snapshot.
     */
    async _onCharacterInit(data) {
        const charId = data?.character?.id;
        if (!charId) return;

        this.characterId = charId;

        // Load persisted history for this character
        const stored = await storage.get(`xpHistory_${charId}`, STORE_NAME, {});
        this.xpHistory = stored;

        const t = data.currentTimestamp ? +new Date(data.currentTimestamp) : Date.now();

        const characterSkills = data.characterSkills || [];
        characterSkills.forEach((skillEntry) => {
            const skillId = SKILL_HRID_TO_ID[skillEntry.skillHrid];
            if (!skillId) return;

            if (!this.xpHistory[skillId]) {
                this.xpHistory[skillId] = [];
            }

            pushXP(this.xpHistory[skillId], { t, xp: skillEntry.experience });
        });

        await storage.set(`xpHistory_${charId}`, this.xpHistory, STORE_NAME);

        this._updateNavBars();
    }

    /**
     * Handle action_completed — record updated XP for each changed skill.
     */
    _onActionCompleted(data) {
        if (!this.characterId) return;

        const skills = data.endCharacterSkills || [];
        if (skills.length === 0) return;

        const t = skills[0].updatedAt ? +new Date(skills[0].updatedAt) : Date.now();

        skills.forEach((skillEntry) => {
            const skillId = SKILL_HRID_TO_ID[skillEntry.skillHrid];
            if (!skillId) return;

            if (!this.xpHistory[skillId]) {
                this.xpHistory[skillId] = [];
            }

            pushXP(this.xpHistory[skillId], { t, xp: skillEntry.experience });
        });

        storage.set(`xpHistory_${this.characterId}`, this.xpHistory, STORE_NAME);

        this._updateNavBars();
    }

    /**
     * Inject or refresh XP/hr spans on all visible nav bar skill entries.
     */
    _updateNavBars() {
        if (!config.getSetting('xpTracker', true)) return;

        const navEls = document.querySelectorAll('[class*="NavigationBar_nav"]');
        navEls.forEach((navEl) => {
            // Only process nav entries that have an XP bar
            if (!navEl.querySelector('[class*="NavigationBar_currentExperience"]')) return;

            const labelEl = navEl.querySelector('[class*="NavigationBar_label"]');
            if (!labelEl) return;

            const skillName = labelEl.textContent.trim().toLowerCase();
            const skillId = SKILL_NAME_TO_ID[skillName];
            if (!skillId) return;

            const history = this.xpHistory[skillId];
            if (!history) return;

            const stats = calcStats(history);
            const rate = stats.lastXPH;

            // Remove existing rate span (may be inline or standalone)
            navEl.querySelector('.mwi-xp-rate')?.remove();

            if (rate <= 0) return;

            const rateText = `${formatKMB(rate)} xp/h`;
            const rateSpan = document.createElement('span');
            rateSpan.className = 'mwi-xp-rate';
            rateSpan.textContent = rateText;
            rateSpan.style.cssText = `
                font-size: 11px;
                color: ${config.COLOR_XP_RATE};
                font-weight: 600;
                pointer-events: none;
                white-space: nowrap;
            `;

            // Prefer placing inline with the "XP left" span if it exists
            const remainingXPEl = navEl.querySelector('.mwi-remaining-xp');
            if (remainingXPEl) {
                remainingXPEl.style.display = 'flex';
                remainingXPEl.style.justifyContent = 'center';
                remainingXPEl.style.gap = '6px';
                remainingXPEl.appendChild(rateSpan);
            } else {
                // Fallback: inject as its own block line after the label
                rateSpan.style.display = 'block';
                rateSpan.style.textAlign = 'center';
                rateSpan.style.width = '100%';
                rateSpan.style.marginTop = '-4px';
                labelEl.insertAdjacentElement('afterend', rateSpan);
            }
        });
    }

    /**
     * Watch for skill tooltip popup and inject time-to-level.
     */
    _watchSkillTooltip() {
        const unregister = domObserver.onClass(
            'XPTracker-SkillTooltip',
            'NavigationBar_navigationSkillTooltip',
            (tooltipEl) => {
                this._addTimeTillLevelUp(tooltipEl);
            }
        );
        this.unregisterObservers.push(unregister);
    }

    /**
     * Inject time-to-level into a skill tooltip element.
     * @param {HTMLElement} tooltipEl
     */
    _addTimeTillLevelUp(tooltipEl) {
        if (!config.getSetting('xpTracker', true)) return;
        if (!config.getSetting('xpTracker_timeTillLevel', true)) return;

        // Tooltip structure: div[0]=name, div[1]=level, div[2]=xp progress, div[3]="XP to next level: N"
        const divs = tooltipEl.querySelectorAll(':scope > div');
        if (divs.length < 4) return;

        const skillName = divs[0].textContent.trim().toLowerCase();
        const skillId = SKILL_NAME_TO_ID[skillName];
        if (!skillId) return;

        const history = this.xpHistory[skillId];
        if (!history) return;

        const stats = calcStats(history);
        if (stats.lastXPH <= 0) return;

        // Parse "XP to next level: 12,345"
        const xpText = divs[3].textContent;
        const match = xpText.match(/[\d,]+$/);
        if (!match) return;

        const xpTillLevel = parseInt(match[0].replace(/,/g, ''), 10);
        if (isNaN(xpTillLevel) || xpTillLevel <= 0) return;

        // Remove any previously injected element
        tooltipEl.querySelector('.mwi-xp-time-left')?.remove();

        const msLeft = (xpTillLevel / stats.lastXPH) * 3600000;
        const timeStr = formatTimeLeft(msLeft);

        const div = document.createElement('div');
        div.className = 'mwi-xp-time-left';
        div.style.cssText = `font-size: 12px; color: ${config.COLOR_XP_RATE}; margin-top: 4px;`;
        div.innerHTML = `<span style="font-weight:700">${timeStr}</span> till next level`;

        divs[3].insertAdjacentElement('afterend', div);
    }

    disable() {
        this.timerRegistry.clearAll();

        this.unregisterObservers.forEach((fn) => fn());
        this.unregisterObservers = [];

        document.querySelectorAll('.mwi-xp-rate').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-xp-time-left').forEach((el) => el.remove());

        this.initialized = false;
    }
}

const xpTracker = new XPTracker();

export default {
    name: 'XP/hr Tracker',
    initialize: () => xpTracker.initialize(),
    cleanup: () => xpTracker.disable(),
};
