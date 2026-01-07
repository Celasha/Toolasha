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
     * Watch for skill buttons in the navigation panel
     */
    watchSkillButtons() {
        const unregister = domObserver.onClass(
            'RemainingXP-SkillBar',
            'NavigationBar_currentExperience',
            () => {
                this.updateAllSkillBars();
            }
        );
        this.unregisterObservers.push(unregister);

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

        // Find all skill progress bars
        const progressBars = document.querySelectorAll('[class*="NavigationBar_currentExperience"]');

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
            // Get the navigation link container (skill button)
            const navLink = progressBar.closest('[class*="NavigationBar_navigationLink"]');
            if (!navLink) return;

            // Find the skill name element (label)
            const skillNameElement = navLink.querySelector('[class*="NavigationBar_label"]');
            if (!skillNameElement) return;

            const skillName = skillNameElement.textContent.trim();

            // Calculate remaining XP for this skill
            const remainingXP = this.calculateRemainingXP(skillName);
            if (remainingXP === null) return;

            // Find the progress bar container (parent of the progress bar)
            const progressContainer = progressBar.parentNode;
            if (!progressContainer) return;

            // Create the remaining XP display
            const xpDisplay = document.createElement('span');
            xpDisplay.className = 'mwi-remaining-xp';
            xpDisplay.textContent = `${numberFormatter(remainingXP)} XP left`;
            xpDisplay.style.cssText = `
                font-size: 11px;
                color: #FFFFFF;
                display: block;
                margin-top: -8px;
                text-align: center;
                width: 100%;
                font-weight: 600;
                text-shadow:
                    0 0 4px rgba(0, 0, 0, 1),
                    0 0 8px rgba(0, 0, 0, 1),
                    2px 2px 0 rgba(0, 0, 0, 1),
                    -2px -2px 0 rgba(0, 0, 0, 1),
                    2px -2px 0 rgba(0, 0, 0, 1),
                    -2px 2px 0 rgba(0, 0, 0, 1),
                    0 0 12px rgba(138, 43, 226, 0.8);
                font-family: 'Arial', sans-serif;
                background: linear-gradient(90deg,
                    transparent,
                    rgba(75, 0, 130, 0.18),
                    transparent);
                padding: 1px 0;
                letter-spacing: 0.3px;
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
