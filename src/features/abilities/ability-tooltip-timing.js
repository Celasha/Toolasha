/**
 * Ability Tooltip Timing
 * Injects the character's LIVE effective cooldown/cast time into the native ability tooltip.
 * The game's own tooltip only ever shows static base values (abilityDetailMap.cooldownDuration/
 * castDuration), never adjusted for Ability Haste, Cast Speed, or Attack level.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import tooltipObserver from '../../core/tooltip-observer.js';
import dom from '../../utils/dom.js';
import { getAbilityName, translateGameName } from '../../utils/game-i18n.js';
import {
    getCurrentAbilityTimingStats,
    calculateEffectiveAbilityTiming,
} from '../combat-sim/ability-timing-calculator.js';

const INJECTED_CLASS = 'mwi-ability-timing-injected';
const SUBSCRIBER_NAME = 'AbilityTooltipTiming';

/**
 * Build the line prefixes that identify a native tooltip line: the English prefix
 * plus the game-localized one. The game renders these labels from the i18next
 * `abilityTooltipText` namespace (verified against the client bundle, e.g.
 * cooldown: "Cooldown: {{duration}}", zh-Hans: "冷却: {{duration}}"), so strip the
 * interpolation placeholder and the trailing colon (half- or full-width) from the
 * template to get a prefix that also matches before the localized colon variant.
 * @param {string} key - abilityTooltipText key (e.g. 'cooldown')
 * @param {string} english - English line prefix (e.g. 'Cooldown:')
 * @returns {string[]} Distinct prefixes to try
 */
function getLocalizedLinePrefixes(key, english) {
    const strip = (text) =>
        text
            .replace(/\{\{.*$/, '')
            .replace(/[:：]\s*$/, '')
            .trim();
    const englishPrefix = strip(english);
    const localizedPrefix = strip(translateGameName('abilityTooltipText', key, english));
    return [...new Set([englishPrefix, localizedPrefix])];
}

class AbilityTooltipTiming {
    constructor() {
        this.isInitialized = false;
        this.abilityNameToHridCache = null;
        this.abilityNameToHridCacheSource = null;
    }

    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('abilityTooltip_effectiveTiming')) {
            return;
        }

        this.isInitialized = true;

        tooltipObserver.subscribe(SUBSCRIBER_NAME, (element, eventType) => {
            if (eventType !== 'opened') return;
            this.handleTooltip(element);
        });
    }

    /**
     * Handle a tooltip element appearing
     * @param {Element} tooltipElement - The tooltip popper element
     */
    handleTooltip(tooltipElement) {
        if (!config.getSetting('abilityTooltip_effectiveTiming')) {
            return;
        }

        const abilityTooltip = tooltipElement.querySelector('[class*="Ability_abilityTooltip"]');
        if (!abilityTooltip) {
            return;
        }

        const nameElement = abilityTooltip.querySelector('[class*="Ability_name"]');
        if (!nameElement) {
            return;
        }

        const abilityHrid = this.extractAbilityHridFromName(nameElement.textContent.trim());
        if (!abilityHrid) {
            return;
        }

        const gameData = dataManager.getInitClientData();
        const abilityDetails = gameData?.abilityDetailMap?.[abilityHrid];
        if (!abilityDetails) {
            return;
        }

        const stats = getCurrentAbilityTimingStats();
        if (!stats) {
            return;
        }

        const { baseCooldown, effectiveCooldown, baseCastTime, effectiveCastTime } = calculateEffectiveAbilityTiming(
            abilityDetails.cooldownDuration,
            abilityDetails.castDuration,
            stats
        );

        this.injectInline(
            abilityTooltip,
            getLocalizedLinePrefixes('cooldown', 'Cooldown:'),
            this.roundIfDifferent(baseCooldown, effectiveCooldown)
        );
        this.injectInline(
            abilityTooltip,
            getLocalizedLinePrefixes('castTime', 'Cast Time:'),
            this.roundIfDifferent(baseCastTime, effectiveCastTime)
        );
    }

    /**
     * Round an effective value to 2 decimals and return it only if it differs from base.
     * @param {number} base - Base value in seconds
     * @param {number} effective - Effective value in seconds
     * @returns {number|null} Rounded effective value, or null if unchanged from base
     */
    roundIfDifferent(base, effective) {
        const rounded = Math.round(effective * 100) / 100;
        return rounded !== base ? rounded : null;
    }

    /**
     * Append the effective value in parentheses right after the native "Cooldown:"/"Cast Time:"
     * line. The native tooltip renders each line as a plain, class-less div, so the target line
     * is located by matching its own leaf text rather than a CSS selector. The line's label is
     * game-localized, so any of the given prefixes (English or translated) may identify it.
     * Once a line has been annotated it gains a child span, so it naturally stops matching on a
     * later call for the same tooltip element - no separate "already injected" bookkeeping is
     * needed.
     * @param {Element} abilityTooltip - The `.Ability_abilityTooltip` container
     * @param {string[]} linePrefixes - Text prefixes identifying the native line (localized + English)
     * @param {number|null} effectiveValue - Effective value in seconds, or null if unchanged from base
     */
    injectInline(abilityTooltip, linePrefixes, effectiveValue) {
        if (effectiveValue === null) {
            return;
        }

        const lineElement = Array.from(abilityTooltip.querySelectorAll('div')).find(
            (el) => el.children.length === 0 && linePrefixes.some((p) => el.textContent.trim().startsWith(p))
        );
        if (!lineElement) {
            return;
        }

        const span = dom.createStyledSpan(
            { color: config.COLOR_TOOLTIP_INFO },
            ` (${effectiveValue}s)`,
            INJECTED_CLASS
        );
        lineElement.appendChild(span);
    }

    /**
     * Extract ability HRID from its displayed name
     * @param {string} abilityName - Ability display name
     * @returns {string|null} Ability HRID or null
     */
    extractAbilityHridFromName(abilityName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.abilityDetailMap) {
            return null;
        }

        if (this.abilityNameToHridCache && this.abilityNameToHridCacheSource === gameData.abilityDetailMap) {
            return this.abilityNameToHridCache.get(abilityName) || null;
        }

        const map = new Map();
        for (const [hrid, ability] of Object.entries(gameData.abilityDetailMap)) {
            map.set(ability.name, hrid);
            // Also register the localized name so tooltips rendered in the
            // game's non-English locale (e.g. Chinese) can resolve the HRID.
            const localizedName = getAbilityName(hrid, ability.name);
            if (localizedName && localizedName !== ability.name) {
                map.set(localizedName, hrid);
            }
        }

        if (map.size > 0) {
            this.abilityNameToHridCache = map;
            this.abilityNameToHridCacheSource = gameData.abilityDetailMap;
        }

        return map.get(abilityName) || null;
    }

    disable() {
        tooltipObserver.unsubscribe(SUBSCRIBER_NAME);
        this.isInitialized = false;
    }
}

export const abilityTooltipTiming = new AbilityTooltipTiming();

export default {
    name: 'Ability Tooltip Timing',
    initialize: () => {
        abilityTooltipTiming.initialize();
    },
    disable: () => {
        abilityTooltipTiming.disable();
    },
};
