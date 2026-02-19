/**
 * Action Filter Manager
 *
 * Adds a search/filter input box to action panel pages (gathering/production).
 * Filters action panels in real-time based on action name.
 * Works alongside existing sorting and hide negative profit features.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class ActionFilter {
    constructor() {
        this.panels = new Map(); // actionPanel → {actionName, container}
        this.filterValue = ''; // Current filter text
        this.filterInput = null; // Reference to the input element
        this.noResultsMessage = null; // Reference to "No matching actions" message
        this.initialized = false;
        this.timerRegistry = createTimerRegistry();
        this.filterTimeout = null;
        this.unregisterHandlers = [];
        this.currentTitleElement = null; // Track which title we're attached to
    }

    /**
     * Initialize - set up DOM observers
     */
    async initialize() {
        if (this.initialized) return;

        // Observe for skill page title bars
        const unregisterTitleObserver = domObserver.onClass(
            'ActionFilter-Title',
            'GatheringProductionSkillPanel_title__3VihQ',
            (titleElement) => {
                this.injectFilterInput(titleElement);
            }
        );

        this.unregisterHandlers.push(unregisterTitleObserver);
        this.initialized = true;
    }

    /**
     * Inject filter input into the title bar
     * @param {HTMLElement} titleElement - The h1 title element
     */
    injectFilterInput(titleElement) {
        // If this is a different title than we're currently attached to, clean up the old one first
        if (this.currentTitleElement && this.currentTitleElement !== titleElement) {
            this.clearFilter();
        }

        // Check if we already injected into THIS specific title
        if (titleElement.querySelector('#mwi-action-filter')) {
            return;
        }

        // Track the new title element
        this.currentTitleElement = titleElement;

        // Reset filter state for new page
        this.filterValue = '';
        this.panels.clear();
        this.filterInput = null;
        this.noResultsMessage = null;

        // The h1 has display: block from game CSS, need to override it
        titleElement.style.setProperty('display', 'flex', 'important');
        titleElement.style.alignItems = 'center';
        titleElement.style.gap = '15px';
        titleElement.style.flexWrap = 'wrap';

        // Create input element (match game's input style)
        const input = document.createElement('input');
        input.id = 'mwi-action-filter';
        input.type = 'text';
        input.placeholder = 'Filter actions...';
        input.className = 'MuiInputBase-input'; // Use game's input class
        input.style.padding = '8px 12px';
        input.style.fontSize = '14px';
        input.style.border = '1px solid rgba(255, 255, 255, 0.23)';
        input.style.borderRadius = '4px';
        input.style.backgroundColor = 'transparent';
        input.style.color = 'inherit';
        input.style.width = '200px';
        input.style.fontFamily = 'inherit';
        input.style.flexShrink = '0'; // Don't shrink the input

        // Add focus styles
        input.addEventListener('focus', () => {
            input.style.borderColor = config.COLOR_ACCENT;
            input.style.outline = 'none';
        });

        input.addEventListener('blur', () => {
            input.style.borderColor = 'rgba(255, 255, 255, 0.23)';
        });

        // Add input listener with debouncing
        input.addEventListener('input', (e) => {
            this.handleFilterInput(e.target.value);
        });

        // Insert at the beginning of the title element (before the skill name div)
        titleElement.insertBefore(input, titleElement.firstChild);

        // Store reference
        this.filterInput = input;

        // Find the container for action panels to inject "No results" message
        this.setupNoResultsMessage(titleElement);
    }

    /**
     * Set up "No matching actions" message container
     * @param {HTMLElement} titleElement - The h1 title element
     */
    setupNoResultsMessage(titleElement) {
        // Walk up the DOM to find the skill panel container
        let container = titleElement.parentElement;
        let depth = 0;
        const maxDepth = 3;

        while (container && depth < maxDepth) {
            // Look for the container that holds action panels
            const actionPanels = container.querySelectorAll('.SkillActionDetail_regularComponent__3oCgr');
            if (actionPanels.length > 0) {
                // Found the container, create message element
                const message = document.createElement('div');
                message.id = 'mwi-action-filter-no-results';
                message.style.display = 'none';
                message.style.textAlign = 'center';
                message.style.padding = '40px 20px';
                message.style.color = 'rgba(255, 255, 255, 0.6)';
                message.style.fontSize = '16px';
                message.textContent = 'No matching actions';

                // Insert after the title
                titleElement.parentElement.insertBefore(message, titleElement.nextSibling);
                this.noResultsMessage = message;
                break;
            }

            container = container.parentElement;
            depth++;
        }
    }

    /**
     * Handle filter input with debouncing
     * @param {string} value - Filter text
     */
    handleFilterInput(value) {
        // Clear existing timeout
        if (this.filterTimeout) {
            clearTimeout(this.filterTimeout);
        }

        // Schedule filter update after 300ms of inactivity
        this.filterTimeout = setTimeout(() => {
            this.filterValue = value.toLowerCase().trim();
            this.applyFilter();
            this.filterTimeout = null;
        }, 300);

        this.timerRegistry.registerTimeout(this.filterTimeout);
    }

    /**
     * Register a panel for filtering
     * @param {HTMLElement} actionPanel - The action panel element
     * @param {string} actionName - The action/item name
     */
    registerPanel(actionPanel, actionName) {
        // Store the container for later "no results" check
        const container = actionPanel.parentElement;

        this.panels.set(actionPanel, {
            actionName: actionName.toLowerCase(),
            container: container,
        });

        // Apply current filter if one is active
        if (this.filterValue) {
            this.applyFilterToPanel(actionPanel);
        }
    }

    /**
     * Unregister a panel (cleanup when panel removed from DOM)
     * @param {HTMLElement} actionPanel - The action panel element
     */
    unregisterPanel(actionPanel) {
        this.panels.delete(actionPanel);
    }

    /**
     * Apply filter to a specific panel
     * @param {HTMLElement} actionPanel - The action panel element
     */
    applyFilterToPanel(actionPanel) {
        const data = this.panels.get(actionPanel);
        if (!data) return;

        // If no filter, show the panel
        if (!this.filterValue) {
            actionPanel.dataset.mwiFilterHidden = 'false';
            return;
        }

        // Check if action name matches filter
        const matches = data.actionName.includes(this.filterValue);

        // Mark panel as hidden by filter (but don't actually hide it here)
        // The actual hiding is done in applyFilter() to respect other hiding mechanisms
        actionPanel.dataset.mwiFilterHidden = matches ? 'false' : 'true';
    }

    /**
     * Apply filter to all registered panels
     */
    applyFilter() {
        let totalPanels = 0;
        let visiblePanels = 0;
        const containerMap = new Map(); // Track panels per container

        // Apply filter to each panel
        for (const [actionPanel, data] of this.panels.entries()) {
            // Clean up detached panels
            if (!actionPanel.parentElement) {
                this.panels.delete(actionPanel);
                continue;
            }

            totalPanels++;

            // Track container
            if (!containerMap.has(data.container)) {
                containerMap.set(data.container, { total: 0, visible: 0 });
            }
            const containerStats = containerMap.get(data.container);
            containerStats.total++;

            // Apply filter
            this.applyFilterToPanel(actionPanel);

            // Check if panel should be visible
            const isFilterHidden = actionPanel.dataset.mwiFilterHidden === 'true';

            if (!isFilterHidden) {
                visiblePanels++;
                containerStats.visible++;
            }
        }

        // Show/hide "No matching actions" message
        if (this.noResultsMessage) {
            if (this.filterValue && visiblePanels === 0 && totalPanels > 0) {
                this.noResultsMessage.style.display = 'block';
            } else {
                this.noResultsMessage.style.display = 'none';
            }
        }
    }

    /**
     * Check if a panel is hidden by the filter
     * @param {HTMLElement} actionPanel - The action panel element
     * @returns {boolean} True if panel is hidden by filter
     */
    isFilterHidden(actionPanel) {
        return actionPanel.dataset.mwiFilterHidden === 'true';
    }

    /**
     * Clear filter and reset state
     */
    clearFilter() {
        // Clear input value
        if (this.filterInput) {
            this.filterInput.value = '';
        }

        // Reset filter value
        this.filterValue = '';

        // Clear all panel filter states
        for (const actionPanel of this.panels.keys()) {
            actionPanel.dataset.mwiFilterHidden = 'false';
        }

        // Hide "No results" message
        if (this.noResultsMessage) {
            this.noResultsMessage.style.display = 'none';
        }

        // Clear panels registry
        this.panels.clear();

        // Remove injected input
        if (this.filterInput && this.filterInput.parentElement) {
            this.filterInput.remove();
            this.filterInput = null;
        }

        if (this.noResultsMessage && this.noResultsMessage.parentElement) {
            this.noResultsMessage.remove();
            this.noResultsMessage = null;
        }
    }

    /**
     * Get the current skill name from the tracked title element
     * @returns {string|null} Skill name (e.g., "Foraging", "Woodcutting", "Cooking") or null
     */
    getCurrentSkillName() {
        if (!this.currentTitleElement) {
            return null;
        }

        // The title element contains multiple children:
        // - Our injected filter input
        // - A div with the skill name text
        // Find the div that contains the skill name (not our input)
        for (const child of this.currentTitleElement.children) {
            if (child.id === 'mwi-action-filter') continue;
            if (child.tagName === 'DIV' && child.textContent) {
                return child.textContent.trim();
            }
        }

        // Fallback: try to get text content minus input value
        const text = this.currentTitleElement.textContent.trim();
        if (this.filterInput && this.filterInput.value) {
            return text.replace(this.filterInput.value, '').trim();
        }

        return text || null;
    }

    /**
     * Cleanup function for disabling filter
     */
    cleanup() {
        // Clear timeout
        if (this.filterTimeout) {
            clearTimeout(this.filterTimeout);
            this.filterTimeout = null;
        }

        this.timerRegistry.clearAll();

        // Unregister observers
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        // Clear filter
        this.clearFilter();

        this.initialized = false;
    }
}

const actionFilter = new ActionFilter();

export default actionFilter;
