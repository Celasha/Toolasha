/**
 * Decimal Combat Level Display
 * Shows the unfloored Combat Level formula value, computed from current whole skill levels,
 * next to the persistent Combat entry in the left sidebar (e.g. 133.2 next to the native 133).
 *
 * Display-only: it never overwrites the native integer node, never feeds Level Malus (which
 * uses the same floored Combat Level the game displays - see calculateLevelGapDebuff()'s doc
 * comment), and must never be XP-interpolated (no fractional skill levels from XP progress).
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { calculateCombatLevelFromSkills } from '../../utils/combat-level-progress-calculator.js';

const CSS_CLASS = 'mwi-combat-level-precise';

class CombatLevelProgress {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
        this.boundUpdate = null;
    }

    /**
     * Setup settings listener (always active, even when the feature is disabled)
     */
    setupSettingListener() {
        config.onSettingChange('combatLevelProgress', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });
    }

    /**
     * Initialize the display
     */
    initialize() {
        if (!config.isFeatureEnabled('combatLevelProgress')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        this.boundUpdate = () => this.update();
        dataManager.on('character_initialized', this.boundUpdate);
        dataManager.on('action_completed', this.boundUpdate);
        dataManager.on('skills_updated', this.boundUpdate);

        const unregister = domObserver.onClass('CombatLevelProgress', 'NavigationBar_navigationBar__', () =>
            this.update()
        );
        this.unregisterHandlers.push(unregister);

        this.update();
    }

    /**
     * Find the persistent Combat nav row via its icon's stable aria-label - never by
     * position/index, which would break if the sidebar's item order ever changes.
     * @returns {Element|null}
     */
    findCombatNavRow() {
        const icon = document.querySelector('svg[aria-label="navigationBar.combat"]');
        return icon?.closest('[class*="NavigationBar_nav__"]') || null;
    }

    /**
     * Recompute and render (or clear) the decimal Combat Level companion span
     */
    update() {
        const navRow = this.findCombatNavRow();
        if (!navRow) {
            return;
        }

        const textContainer = navRow.querySelector('[class*="NavigationBar_textContainer"]');
        if (!textContainer) {
            return;
        }

        const skills = dataManager.getSkills();
        const rawCombatLevel = calculateCombatLevelFromSkills(skills);

        if (rawCombatLevel === null) {
            textContainer.querySelector(`.${CSS_CLASS}`)?.remove();
            return;
        }

        const levelSpan = textContainer.querySelector('[class*="NavigationBar_level"]');
        if (!levelSpan) {
            return;
        }

        // Appended as a child of the native level span (never overwriting its own "150" text
        // node) rather than a flex sibling, so it reads flush as one number ("150.2") instead
        // of picking up the textContainer's flex gap between label/level as visible whitespace.
        let span = levelSpan.querySelector(`.${CSS_CLASS}`);
        if (!span) {
            span = document.createElement('span');
            span.className = CSS_CLASS;
            levelSpan.appendChild(span);
        }

        const decimalText = rawCombatLevel.toFixed(1).split('.')[1];
        span.textContent = `.${decimalText}`;
        span.title = `Combat Level from current whole skill levels · native display: ${Math.floor(rawCombatLevel)}`;
    }

    /**
     * Disable the feature
     */
    disable() {
        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];

        if (this.boundUpdate) {
            dataManager.off('character_initialized', this.boundUpdate);
            dataManager.off('action_completed', this.boundUpdate);
            dataManager.off('skills_updated', this.boundUpdate);
            this.boundUpdate = null;
        }

        document.querySelectorAll(`.${CSS_CLASS}`).forEach((el) => el.remove());
        this.isInitialized = false;
    }
}

const combatLevelProgress = new CombatLevelProgress();

combatLevelProgress.setupSettingListener();

export default combatLevelProgress;
export { CombatLevelProgress };
