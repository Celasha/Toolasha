/**
 * Remaining XP Display
 * Shows remaining XP to next level on skill bars in the left navigation panel
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { numberFormatter } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class RemainingXP {
    constructor() {
        this.initialized = false;
        this.updateInterval = null;
        this.unregisterObservers = [];
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize the remaining XP display
     */
    initialize() {
        if (this.initialized) return;

        // Watch for skill buttons appearing
        this.watchSkillButtons();

        // Update every second (like MWIT-E does)
        this.updateInterval = setInterval(() => {
            this.updateAllSkillBars();
        }, 1000);
        this.timerRegistry.registerInterval(this.updateInterval);

        this.initialized = true;
    }

    /**
     * Watch for skill buttons in the navigation panel and other skill displays
     */
    watchSkillButtons() {
        // Watch for left navigation bar skills (non-combat skills)
        const unregisterNav = domObserver.onClass('RemainingXP-NavSkillBar', 'NavigationBar_currentExperience', () => {
            this.updateAllSkillBars();
        });
        this.unregisterObservers.push(unregisterNav);

        // Wait for character data to be loaded before first update
        const initHandler = () => {
            // Initial update once character data is ready
            const initialUpdateTimeout = setTimeout(() => {
                this.updateAllSkillBars();
            }, 500);
            this.timerRegistry.registerTimeout(initialUpdateTimeout);
        };

        dataManager.on('character_initialized', initHandler);

        // Check if character data already loaded (in case we missed the event)
        if (dataManager.characterData) {
            initHandler();
        }

        this.unregisterObservers.push(() => {
            dataManager.off('character_initialized', initHandler);
        });
    }

    /**
     * Update all skill bars with remaining XP
     */
    updateAllSkillBars() {
        // Remove any existing XP displays
        document.querySelectorAll('.mwi-remaining-xp').forEach((el) => el.remove());

        // Find all skill progress bars (broader selector to catch combat skills too)
        // Use attribute selector to match any class containing "currentExperience"
        const progressBars = document.querySelectorAll('[class*="currentExperience"]');

        progressBars.forEach((progressBar) => {
            this.addRemainingXP(progressBar);
        });
    }

    /**
     * Add remaining XP display to a skill bar
     * @param {HTMLElement} progressBar - The progress bar element
     */
    addRemainingXP(progressBar) {
        try {
            // Try to find skill name - handle both navigation bar and combat skill displays
            let skillName = null;

            // Check if we're in a sub-skills container (combat skills)
            const subSkillsContainer = progressBar.closest('[class*="NavigationBar_subSkills"]');

            if (subSkillsContainer) {
                // We're in combat sub-skills - look for label in immediate parent structure
                // The label should be in a sibling or nearby element, not in the parent navigationLink
                const navContainer = progressBar.closest('[class*="NavigationBar_nav"]');
                if (navContainer) {
                    const skillNameElement = navContainer.querySelector('[class*="NavigationBar_label"]');
                    if (skillNameElement) {
                        skillName = skillNameElement.textContent.trim();
                    }
                }
            } else {
                // Regular skill (not a sub-skill) - use standard navigation link approach
                const navLink = progressBar.closest('[class*="NavigationBar_navigationLink"]');
                if (navLink) {
                    const skillNameElement = navLink.querySelector('[class*="NavigationBar_label"]');
                    if (skillNameElement) {
                        skillName = skillNameElement.textContent.trim();
                    }
                }
            }

            if (!skillName) return;

            // Calculate remaining XP for this skill
            const remainingXP = this.calculateRemainingXP(skillName);
            if (remainingXP === null) return;

            // Find the progress bar container (parent of the progress bar)
            const progressContainer = progressBar.parentNode;
            if (!progressContainer) return;

            // Check if we already added XP display here (prevent duplicates)
            if (progressContainer.querySelector('.mwi-remaining-xp')) return;

            // Create the remaining XP display
            const xpDisplay = document.createElement('span');
            xpDisplay.className = 'mwi-remaining-xp';
            xpDisplay.textContent = `${numberFormatter(remainingXP)} XP left`;

            // Build style with optional text shadow
            const useBlackBorder = config.getSetting('skillRemainingXP_blackBorder', true);
            const textShadow = useBlackBorder
                ? 'text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;'
                : '';

            xpDisplay.style.cssText = `
                font-size: 11px;
                color: ${config.COLOR_REMAINING_XP};
                display: block;
                margin-top: -8px;
                text-align: center;
                width: 100%;
                font-weight: 600;
                pointer-events: none;
                ${textShadow}
            `;

            // Insert after the progress bar
            progressContainer.insertBefore(xpDisplay, progressBar.nextSibling);
        } catch {
            // Silent fail - don't spam console with errors
        }
    }

    /**
     * Calculate remaining XP to next level for a skill
     * @param {string} skillName - The skill name (e.g., "Milking", "Combat")
     * @returns {number|null} Remaining XP or null if unavailable
     */
    calculateRemainingXP(skillName) {
        // Convert skill name to HRID
        const skillHrid = `/skills/${skillName.toLowerCase()}`;

        // Get character skills data
        const characterData = dataManager.characterData;
        if (!characterData || !characterData.characterSkills) {
            return null;
        }

        // Find the skill
        const skill = characterData.characterSkills.find((s) => s.skillHrid === skillHrid);
        if (!skill) {
            return null;
        }

        // Get level experience table
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.levelExperienceTable) return null;

        const currentExp = skill.experience;
        const currentLevel = skill.level;
        const nextLevel = currentLevel + 1;

        // Get XP required for next level
        const expForNextLevel = gameData.levelExperienceTable[nextLevel];
        if (expForNextLevel === undefined) return null; // Max level

        // Calculate remaining XP
        const remainingXP = expForNextLevel - currentExp;

        return Math.max(0, Math.ceil(remainingXP));
    }

    /**
     * Disable the remaining XP display
     */
    disable() {
        if (this.updateInterval) {
            this.updateInterval = null;
        }

        this.timerRegistry.clearAll();

        // Unregister observers
        this.unregisterObservers.forEach((unregister) => unregister());
        this.unregisterObservers = [];

        // Remove all XP displays
        document.querySelectorAll('.mwi-remaining-xp').forEach((el) => el.remove());

        this.initialized = false;
    }
}

const remainingXP = new RemainingXP();

export default remainingXP;
