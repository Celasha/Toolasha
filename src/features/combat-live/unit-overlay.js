/**
 * Unit overlay
 *
 * Small labels in the empty status row under the ability bar of each character and monster on the game's
 * combat screen: a DPS / HPS badge for the players, and an icon with a countdown for every buff, debuff and status on a unit. Nothing is inserted
 * into the game's own elements: the labels live in one fixed, click-through layer and follow the game's
 * unit elements by their screen position, so the game re-rendering its units cannot break them.
 *
 * Units are found by the substrings of the game's hashed class names. A unit's index is its position in
 * its side's grid, which is also its key in the battle messages; if the DOM and the roster disagree in
 * size (the guild party view shows teammates differently) that side is left alone.
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { getAbilityName } from '../../utils/game-i18n.js';

const LAYER_ID = 'toolasha-combat-live-units';
const TICK_MS = 250;
const ICON_SIZES = { small: 16, medium: 22, large: 28 };
const SIDES = [
    { side: 'p', area: '[class*="BattlePanel_playersArea"]' },
    { side: 'm', area: '[class*="BattlePanel_monstersArea"]' },
];
const UNIT_SELECTOR = '[class*="CombatUnit_combatUnit"]';
const STATUS_SELECTOR = '[class*="CombatUnit_status"]';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUS_ICONS = { stunned: '💫', blinded: '🙈', silenced: '🤐', enraged: '😡' };
// Effects that hurt the unit they are on; the rest are buffs
const HARMFUL_KINDS = new Set(['debuff', 'dot', 'status']);
const KIND_COLORS = { buff: '#4ade80', debuff: '#f87171', dot: '#fb923c', status: '#facc15' };

/**
 * @param {?number} ms
 * @returns {string} "12" for 12 seconds left, "2m" past a minute, nothing for an open-ended status
 */
export function countdownText(ms) {
    if (ms === null || ms === undefined) return '';
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return seconds >= 60 ? `${Math.ceil(seconds / 60)}m` : String(seconds);
}

/**
 * The URL the game uses for its ability icon sheet, read from any ability icon on the page.
 * @returns {?string} Sheet URL without the #name, or null when no ability icon is on screen
 */
export function findAbilitySprite() {
    const href = document.querySelector('use[href*="abilities_sprite"]')?.getAttribute('href');
    return href ? href.split('#')[0] : null;
}

/**
 * Whether an element is scrolled or cut off out of view. The labels live in a fixed layer, so a unit that the
 * game's scroll box has pushed out of sight (the windowed layout) would otherwise leave its labels floating
 * over whatever is on screen in its place.
 * @param {Element} el
 * @param {DOMRect} rect - The element's own box
 * @returns {boolean} True when the box is not fully inside the page and every scroll or clipping ancestor
 */
export function isOutOfView(el, rect) {
    const TOLERANCE = 1;
    if (
        rect.left < -TOLERANCE ||
        rect.top < -TOLERANCE ||
        rect.right > window.innerWidth + TOLERANCE ||
        rect.bottom > window.innerHeight + TOLERANCE
    ) {
        return true;
    }
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (!clipsX && !clipsY) continue;
        const box = node.getBoundingClientRect();
        if (clipsX && (rect.left < box.left - TOLERANCE || rect.right > box.right + TOLERANCE)) return true;
        if (clipsY && (rect.top < box.top - TOLERANCE || rect.bottom > box.bottom + TOLERANCE)) return true;
    }
    return false;
}

/**
 * Whether something else is drawn over a unit's status row (chat, a panel, a window). The labels live in a fixed
 * layer on top of the page and ignore the mouse, so the element found at a point is whatever the game shows there.
 * @param {Element} unit
 * @param {DOMRect} rect - The status row's box
 * @returns {boolean} True when a point of the row shows an element that is not part of the unit
 */
export function isCovered(unit, rect) {
    if (typeof document.elementFromPoint !== 'function') return false;
    const y = rect.top + rect.height / 2;
    for (const x of [rect.left + 4, rect.left + rect.width / 2, rect.right - 4]) {
        const top = document.elementFromPoint(x, y);
        if (top && !unit.contains(top) && !top.contains(unit)) return true;
    }
    return false;
}

/**
 * @param {Object[]} buffs
 * @param {string} mode - 'all' | 'debuffs' | 'none'
 * @returns {Object[]} The effects the setting lets through
 */
export function filterEffects(buffs, mode) {
    if (mode === 'none') return [];
    if (mode === 'debuffs') return buffs.filter((buff) => HARMFUL_KINDS.has(buff.kind));
    return buffs;
}

class UnitOverlay {
    constructor() {
        this.timerRegistry = createTimerRegistry();
        this.layer = null;
        this.deps = null;
        // `${side}:${index}` -> {row, badge, icons: Map<id, {wrap, label}>}
        this.rows = new Map();
    }

    /**
     * @param {{getBuffs: function(string, number, number): Object[], getBadge: function(number): ?{text: string, color: string, healText: string}, isActive: function(): boolean, rosterSize: function(string): number}} deps
     */
    initialize(deps) {
        if (this.layer) return;
        this.deps = deps;
        this.layer = document.createElement('div');
        this.layer.id = LAYER_ID;
        this.layer.style.cssText = `position:fixed; top:0; left:0; width:0; height:0; pointer-events:none; z-index:${config.Z_HUD};`;
        document.body.appendChild(this.layer);
        this.timerRegistry.registerInterval(setInterval(() => this.update(), TICK_MS));
    }

    /**
     * Place and refresh every label.
     * @param {number} [now]
     */
    update(now = Date.now()) {
        if (!this.layer || !this.deps) return;
        const show = this.deps.isActive() && !document.hidden;
        this.layer.style.display = show ? 'block' : 'none';
        if (!show) return;

        const seen = new Set();
        const sprite = findAbilitySprite();
        for (const { side, area } of SIDES) {
            const units = [...document.querySelectorAll(`${area} ${UNIT_SELECTOR}`)];
            if (units.length !== this.deps.rosterSize(side)) continue;
            units.forEach((unit, index) => {
                const key = `${side}:${index}`;
                seen.add(key);
                this.updateRow(key, side, index, unit, sprite, now);
            });
        }
        for (const [key, entry] of this.rows) {
            if (!seen.has(key)) {
                entry.row.remove();
                this.rows.delete(key);
            }
        }
    }

    updateRow(key, side, index, unit, sprite, now) {
        const anchor = unit.querySelector(STATUS_SELECTOR) || unit;
        const rect = anchor.getBoundingClientRect();
        let entry = this.rows.get(key);
        if (!entry) {
            const row = document.createElement('div');
            row.style.cssText = 'position:absolute; display:flex; flex-direction:column; align-items:stretch; gap:2px;';
            const badge = document.createElement('div');
            badge.style.cssText =
                'font-size:11px; font-weight:700; line-height:1.3; padding:2px 4px; box-sizing:border-box; width:100%; min-width:0; border-radius:0 0 3px 3px; white-space:nowrap; text-align:center; overflow:hidden; color:#000;';
            const icons = document.createElement('div');
            icons.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:2px;';
            row.append(badge, icons);
            this.layer.appendChild(row);
            entry = { row, badge, iconBox: icons, icons: new Map() };
            this.rows.set(key, entry);
        }

        if (!(rect.width > 0 && rect.height > 0) || isOutOfView(anchor, rect) || isCovered(unit, rect)) {
            entry.row.style.display = 'none';
            return;
        }
        entry.row.style.display = 'flex';
        entry.row.style.left = `${rect.left}px`;
        // The game leaves this row empty, so the labels start inside it rather than below it
        entry.row.style.top = `${rect.top}px`;
        entry.row.style.width = `${rect.width}px`;

        const badge = side === 'p' && config.getSetting('combatLive_unitBadges') ? this.deps.getBadge(index) : null;
        entry.badge.style.display = badge ? 'block' : 'none';
        if (badge) {
            entry.badge.textContent = badge.healText ? `${badge.text} · ${badge.healText}` : badge.text;
            entry.badge.style.background = badge.color;
        }

        const mode = config.getSettingValue(
            side === 'p' ? 'combatLive_playerEffects' : 'combatLive_monsterEffects',
            'all'
        );
        const buffs = config.getSetting('combatLive_buffIcons')
            ? filterEffects(this.deps.getBuffs(side, index, now), mode)
            : [];
        this.syncIcons(entry, buffs, sprite);
    }

    /**
     * Bring a unit's icons in line with what is on it, keeping the icons that are still there.
     * @param {Object} entry
     * @param {Object[]} buffs
     * @param {?string} sprite
     */
    syncIcons(entry, buffs, sprite) {
        const size = ICON_SIZES[config.getSettingValue('combatLive_iconSize', 'small')] || ICON_SIZES.small;
        // A new size means new icons
        if (entry.iconSize !== size) {
            for (const icon of entry.icons.values()) icon.wrap.remove();
            entry.icons.clear();
            entry.iconSize = size;
        }
        const wanted = new Set(buffs.map((buff) => buff.id));
        for (const [id, icon] of entry.icons) {
            if (!wanted.has(id)) {
                icon.wrap.remove();
                entry.icons.delete(id);
            }
        }
        for (const buff of buffs) {
            let icon = entry.icons.get(buff.id);
            if (!icon) {
                icon = this.buildIcon(buff, sprite, size);
                entry.icons.set(buff.id, icon);
            }
            // Curse is judged by its stacks, which matter more than a timer that every hit resets
            icon.label.textContent = buff.stacks ? String(buff.stacks) : countdownText(buff.remainingMs);
            if (buff.stacks) {
                const title = t('combatLive.curseTooltip', {
                    stacks: buff.stacks,
                    percent: Number((buff.value * 100).toFixed(1)),
                });
                if (icon.wrap.title !== title) icon.wrap.title = title;
            }
            // Appending an element that is already there moves it, which keeps the DOM in the sorted order
            entry.iconBox.appendChild(icon.wrap);
        }
    }

    buildIcon(buff, sprite, size = ICON_SIZES.small) {
        const wrap = document.createElement('span');
        wrap.style.cssText = `position:relative; width:${size}px; height:${size}px; box-sizing:border-box; border:2px solid ${
            KIND_COLORS[buff.kind] || '#999'
        }; border-radius:4px; background:rgba(0,0,0,0.65); display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:${Math.round(size * 0.6)}px; overflow:visible;`;
        // The tooltip is set once, so it does not flicker while a countdown ticks
        wrap.title = buff.symbol
            ? t('combatLive.curse')
            : buff.kind === 'status' && !buff.abilityHrid
              ? t(`combatLive.status_${buff.status}`)
              : getAbilityName(buff.abilityHrid, buff.abilityHrid.split('/').pop());

        if (buff.symbol) {
            const symbol = document.createElement('span');
            symbol.textContent = buff.symbol;
            symbol.style.cssText = `font-size:${Math.round(size * 0.75)}px; line-height:1;`;
            wrap.appendChild(symbol);
        } else if (buff.kind === 'status') {
            wrap.append(STATUS_ICONS[buff.status] || '•');
        } else if (sprite) {
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('width', String(size - 4));
            svg.setAttribute('height', String(size - 4));
            const use = document.createElementNS(SVG_NS, 'use');
            use.setAttribute('href', `${sprite}#${buff.abilityHrid.split('/').pop()}`);
            svg.appendChild(use);
            wrap.appendChild(svg);
        } else {
            wrap.append(buff.abilityHrid.split('/').pop().charAt(0).toUpperCase());
        }

        const label = document.createElement('span');
        label.style.cssText = `position:absolute; right:-2px; bottom:-3px; font-size:${Math.round(size * 0.4) + 3}px; font-weight:700; color:#fff; text-shadow:0 0 2px #000, 0 0 2px #000;`;
        wrap.appendChild(label);
        return { wrap, label };
    }

    cleanup() {
        this.timerRegistry.clearAll();
        this.layer?.remove();
        this.layer = null;
        this.deps = null;
        this.rows = new Map();
    }
}

const unitOverlay = new UnitOverlay();
export default unitOverlay;
export { UnitOverlay };
