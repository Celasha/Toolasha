/**
 * Remaining XP Display
 * Shows remaining XP to next level on skill bars in the left navigation panel
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { numberFormatter } from '../../utils/formatters.js';

class RemainingXP {
    constructor() {
        this.initialized = false;
        this.updateInterval = null;
        this.unregisterObservers = [];
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

        this.initialized = true;
    }

    /**
     * Watch for skill buttons in the navigation panel and other skill displays
     */
    watchSkillButtons() {
        // Watch for left navigation bar skills (non-combat skills)
        const unregisterNav = domObserver.onClass(
            'RemainingXP-NavSkillBar',
            'NavigationBar_currentExperience',
            () => {
                this.updateAllSkillBars();
            }
        );
        this.unregisterObservers.push(unregisterNav);

        // Wait for character data to be loaded before first update
        const initHandler = () => {
            // Initial update once character data is ready
            setTimeout(() => {
                this.updateAllSkillBars();
            }, 500);
        };

        dataManager.on('character_initialized', initHandler);

        // Check if character data already loaded (in case we missed the event)
        if (dataManager.characterData) {
            initHandler();
        }

        // Store handler for cleanup
        this.unregisterObservers.push(() => {
            dataManager.off('character_initialized', initHandler);
        });
    }

    /**
     * Update all skill bars with remaining XP
     */
    updateAllSkillBars() {
        // Remove any existing XP displays
        document.querySelectorAll('.mwi-remaining-xp').forEach(el => el.remove());

        // Find all skill progress bars (broader selector to catch combat skills too)
        // Use attribute selector to match any class containing "currentExperience"
        const progressBars = document.querySelectorAll('[class*="currentExperience"]');

        progressBars.forEach(progressBar => {
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

            // Method 1: Navigation bar structure (left nav)
            const navLink = progressBar.closest('[class*="NavigationBar_navigationLink"]');
            if (navLink) {
                const skillNameElement = navLink.querySelector('[class*="NavigationBar_label"]');
                if (skillNameElement) {
                    skillName = skillNameElement.textContent.trim();
                }
            }

            // Method 2: Check for combat skills by looking at surrounding text
            // Combat skills might be displayed differently, search parent structure
            if (!skillName) {
                // Look for skill name in parent elements or siblings
                const parent = progressBar.closest('div');
                if (parent) {
                    // Search for common combat skill names in the DOM tree
                    const combatSkills = ['Attack', 'Defense', 'Stamina', 'Intelligence', 'Melee', 'Ranged', 'Magic'];
                    const textContent = parent.textContent;

                    for (const skill of combatSkills) {
                        if (textContent.includes(skill)) {
                            skillName = skill;
                            break;
                        }
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
            xpDisplay.style.cssText = `
                font-size: 11px;
                color: ${config.COLOR_REMAINING_XP};
                display: block;
                margin-top: -8px;
                text-align: center;
                width: 100%;
                font-weight: 600;
                pointer-events: none;
            `;

            // Insert after the progress bar
            progressContainer.insertBefore(xpDisplay, progressBar.nextSibling);

        } catch (error) {
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
        if (!characterData || !characterData.characterSkills) return null;

        // Find the skill
        const skill = characterData.characterSkills.find(s => s.skillHrid === skillHrid);
        if (!skill) return null;

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
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Unregister observers
        this.unregisterObservers.forEach(unregister => unregister());
        this.unregisterObservers = [];

        // Remove all XP displays
        document.querySelectorAll('.mwi-remaining-xp').forEach(el => el.remove());

        this.initialized = false;
    }
}

// Create and export singleton instance
const remainingXP = new RemainingXP();

export default remainingXP;
