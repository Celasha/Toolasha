/**
 * Skill Experience Percentage Display
 * Shows XP progress percentage in the left sidebar skill list
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { formatPercentage } from '../../utils/formatters.js';

class SkillExperiencePercentage {
    constructor() {
        this.isActive = false;
        this.unregisterHandlers = [];
        this.processedBars = new WeakSet();
    }

    /**
     * Initialize the display system
     */
    initialize() {
        if (!config.isFeatureEnabled('skillExperiencePercentage')) {
            return;
        }

        this.isActive = true;
        this.registerObservers();

        // Initial update for existing skills
        this.updateAllSkills();
    }

    /**
     * Register DOM observers
     */
    registerObservers() {
        // Watch for progress bars appearing/changing
        const unregister = domObserver.onClass(
            'SkillExpPercentage',
            'NavigationBar_currentExperience',
            (progressBar) => {
                this.updateSkillPercentage(progressBar);
            }
        );
        this.unregisterHandlers.push(unregister);
    }

    /**
     * Update all existing skills on page
     */
    updateAllSkills() {
        const progressBars = document.querySelectorAll('[class*="NavigationBar_currentExperience"]');
        progressBars.forEach(bar => this.updateSkillPercentage(bar));
    }

    /**
     * Update a single skill's percentage display
     * @param {Element} progressBar - The progress bar element
     */
    updateSkillPercentage(progressBar) {
        // Get the skill container
        const skillContainer = progressBar.parentNode?.parentNode;
        if (!skillContainer) return;

        // Get the level display container (first child of skill container)
        const levelContainer = skillContainer.children[0];
        if (!levelContainer) return;

        // Find the NavigationBar_level span to set its width
        const levelSpan = skillContainer.querySelector('[class*="NavigationBar_level"]');
        if (levelSpan) {
            levelSpan.style.width = 'auto';
        }

        // Extract percentage from progress bar width
        const widthStyle = progressBar.style.width;
        if (!widthStyle) return;

        const percentage = parseFloat(widthStyle.replace('%', ''));
        if (isNaN(percentage)) return;

        // Format with 1 decimal place (convert from percentage to decimal first)
        const formattedPercentage = formatPercentage(percentage / 100, 1);

        // Check if we already have a percentage span
        let percentageSpan = levelContainer.querySelector('.mwi-exp-percentage');

        if (percentageSpan) {
            // Update existing span
            if (percentageSpan.textContent !== formattedPercentage) {
                percentageSpan.textContent = formattedPercentage;
            }
        } else {
            // Create new span
            percentageSpan = document.createElement('span');
            percentageSpan.className = 'mwi-exp-percentage';
            percentageSpan.textContent = formattedPercentage;
            percentageSpan.style.fontSize = '0.875rem';
            percentageSpan.style.color = config.SCRIPT_COLOR_MAIN;

            // Insert percentage before children[1] (same as original)
            levelContainer.insertBefore(percentageSpan, levelContainer.children[1]);
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        // Remove all percentage spans
        document.querySelectorAll('.mwi-exp-percentage').forEach(span => span.remove());

        // Unregister observers
        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];

        this.processedBars.clear();
        this.isActive = false;
    }
}

// Create and export singleton instance
const skillExperiencePercentage = new SkillExperiencePercentage();

export default skillExperiencePercentage;
