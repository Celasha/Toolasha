/**
 * Remaining XP Display
 * Shows remaining XP to next level on skill bars in the left navigation panel
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { numberFormatter } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

class RemainingXP {
    constructor() {
        this.initialized = false;
        this.updateInterval = null;
        this.unregisterObservers = [];
        this.timerRegistry = createTimerRegistry();
        this.progressBarObservers = new Map(); // Track MutationObservers for each progress bar
    }

    /**
     * Initialize the remaining XP display
     */
    initialize() {
        if (this.initialized) return;

        // Watch for skill buttons appearing
        this.watchSkillButtons();

        // Setup observers for any existing progress bars
        const existingProgressBars = document.querySelectorAll('[class*="currentExperience"]');
        existingProgressBars.forEach((progressBar) => {
            this.setupProgressBarObserver(progressBar);
        });

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
            (progressBar) => {
                this.setupProgressBarObserver(progressBar);
            }
        );
        this.unregisterObservers.push(unregisterNav);

        // Wait for character data to be loaded before setting up observers
        const initHandler = () => {
            // Setup observers for all progress bars once character data is ready
            const initialUpdateTimeout = setTimeout(() => {
                const progressBars = document.querySelectorAll('[class*="currentExperience"]');
                progressBars.forEach((progressBar) => {
                    this.setupProgressBarObserver(progressBar);
                });
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
     * Setup MutationObserver for a progress bar to watch for style changes
     * @param {HTMLElement} progressBar - The progress bar element
     */
    setupProgressBarObserver(progressBar) {
        // Skip if we're already observing this progress bar
        if (this.progressBarObservers.has(progressBar)) {
            return;
        }

        // Initial update
        this.addRemainingXP(progressBar);

        // Watch for style attribute changes (width percentage updates)
        const unwatch = createMutationWatcher(
            progressBar,
            () => {
                this.updateSingleSkillBar(progressBar);
            },
            {
                attributes: true,
                attributeFilter: ['style'],
            }
        );

        // Store the observer so we can clean it up later
        this.progressBarObservers.set(progressBar, unwatch);
    }

    /**
     * Update a single skill bar with remaining XP
     * @param {HTMLElement} progressBar - The progress bar element
     */
    updateSingleSkillBar(progressBar) {
        // Remove existing XP display for this progress bar
        const progressContainer = progressBar.parentNode;
        if (progressContainer) {
            const existingDisplay = progressContainer.querySelector('.mwi-remaining-xp');
            if (existingDisplay) {
                existingDisplay.remove();
            }
        }

        // Add updated XP display
        this.addRemainingXP(progressBar);
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

            // Calculate remaining XP for this skill using progress bar width (like XP percentage does)
            const remainingXP = this.calculateRemainingXPFromProgressBar(progressBar, skillName);
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
     * Calculate remaining XP from progress bar width (real-time, like XP percentage)
     * @param {HTMLElement} progressBar - The progress bar element
     * @param {string} skillName - The skill name (e.g., "Milking", "Combat")
     * @returns {number|null} Remaining XP or null if unavailable
     */
    calculateRemainingXPFromProgressBar(progressBar, skillName) {
        // Convert skill name to HRID
        const skillHrid = `/skills/${skillName.toLowerCase()}`;

        // Get character skills data for level info
        const characterData = dataManager.characterData;
        if (!characterData || !characterData.characterSkills) {
            return null;
        }

        // Find the skill to get current level
        const skill = characterData.characterSkills.find((s) => s.skillHrid === skillHrid);
        if (!skill) {
            return null;
        }

        // Get level experience table
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.levelExperienceTable) return null;

        const currentLevel = skill.level;
        const nextLevel = currentLevel + 1;

        // Get XP required for current and next level
        const expForCurrentLevel = gameData.levelExperienceTable[currentLevel] || 0;
        const expForNextLevel = gameData.levelExperienceTable[nextLevel];
        if (expForNextLevel === undefined) return null; // Max level

        // Extract percentage from progress bar width (updated by game in real-time)
        const widthStyle = progressBar.style.width;
        if (!widthStyle) return null;

        const percentage = parseFloat(widthStyle.replace('%', ''));
        if (isNaN(percentage)) return null;

        // Calculate XP needed for this level
        const xpNeededForLevel = expForNextLevel - expForCurrentLevel;

        // Calculate current XP within this level based on progress bar
        const currentXPInLevel = (percentage / 100) * xpNeededForLevel;

        // Calculate remaining XP
        const remainingXP = xpNeededForLevel - currentXPInLevel;

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

        this.timerRegistry.clearAll();

        // Disconnect all progress bar observers
        this.progressBarObservers.forEach((unwatch) => {
            unwatch();
        });
        this.progressBarObservers.clear();

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
