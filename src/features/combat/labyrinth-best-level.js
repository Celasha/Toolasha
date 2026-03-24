/**
 * Labyrinth Best Level Display
 * Injects "Best: N" badges into the Labyrinth Automation tab's skip threshold cells
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import labyrinthTracker from './labyrinth-tracker.js';

class LabyrinthBestLevel {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.updateHandler = null;
        this.automationClickHandler = null;
        this.automationButton = null;
    }

    /**
     * Initialize the best level display
     */
    initialize() {
        if (!config.getSetting('labyrinthTracker')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        // Watch for the Labyrinth tab bar to appear, then attach click listener to Automation tab
        const unregister = domObserver.onClass(
            'LabyrinthBestLevel',
            'LabyrinthPanel_tabsComponentContainer',
            (container) => this.attachAutomationClickListener(container)
        );
        this.unregisterHandlers.push(unregister);

        // Watch for skip threshold cells to appear and inject badges
        const unregisterSkip = domObserver.onClass(
            'LabyrinthBestLevel_skipThreshold',
            'LabyrinthPanel_skipThreshold',
            () => this.refreshAll()
        );
        this.unregisterHandlers.push(unregisterSkip);

        // Catch cells that were already in the DOM before observers registered
        this.catchupTimer = setTimeout(() => this.refreshAll(), 500);

        // Re-inject all badges when tracker records a new best
        this.updateHandler = () => this.refreshAll();
        labyrinthTracker.onUpdate(this.updateHandler);

        this.isInitialized = true;
    }

    /**
     * Disable and clean up
     */
    disable() {
        if (this.catchupTimer) {
            clearTimeout(this.catchupTimer);
            this.catchupTimer = null;
        }

        if (this.updateHandler) {
            labyrinthTracker.offUpdate(this.updateHandler);
            this.updateHandler = null;
        }

        if (this.automationButton && this.automationClickHandler) {
            this.automationButton.removeEventListener('click', this.automationClickHandler);
            this.automationClickHandler = null;
            this.automationButton = null;
        }

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        document.querySelectorAll('.mwi-labyrinth-best').forEach((el) => el.remove());

        this.isInitialized = false;
    }

    /**
     * Find the Automation tab button and attach a click listener to it
     * @param {Element} container - The LabyrinthPanel_tabsComponentContainer element
     */
    attachAutomationClickListener(container) {
        const buttons = Array.from(container.querySelectorAll('button[role="tab"]'));
        const automationBtn = buttons.find((btn) => btn.textContent.trim().startsWith('Automation'));

        if (!automationBtn) {
            return;
        }

        // Remove previous listener if we re-attached (e.g. panel re-mounted)
        if (this.automationButton && this.automationClickHandler) {
            this.automationButton.removeEventListener('click', this.automationClickHandler);
        }

        this.automationButton = automationBtn;
        this.automationClickHandler = () => {
            // Small delay to let React render the tab content
            setTimeout(() => this.refreshAll(), 100);
        };

        automationBtn.addEventListener('click', this.automationClickHandler);

        // If the Automation tab is already active, inject badges immediately
        if (automationBtn.getAttribute('aria-selected') === 'true') {
            setTimeout(() => this.refreshAll(), 100);
        }
    }

    /**
     * Extract room HRID from the row containing this cell by reading the SVG use href.
     * Returns /monsters/<slug> for combat rooms or /skills/<slug> for skilling rooms.
     * @param {Element} cell - Skip threshold cell (div inside a <td>)
     * @returns {string|null} Room HRID or null
     */
    extractRoomHrid(cell) {
        try {
            const row = cell.closest('tr');
            if (!row) {
                return null;
            }

            const useEl = row.querySelector('[class*="LabyrinthPanel_roomLabel"] use');
            if (!useEl) {
                return null;
            }

            const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
            if (!href) {
                return null;
            }

            const slug = href.split('#')[1];
            if (!slug) {
                return null;
            }

            const prefix = href.includes('skills_sprite') ? '/skills/' : '/monsters/';
            return `${prefix}${slug}`;
        } catch (error) {
            console.error('[LabyrinthBestLevel] Error extracting room HRID:', error);
            return null;
        }
    }

    /**
     * Inject a "Best: N" badge into the skip threshold cell
     * @param {Element} cell - The LabyrinthPanel_skipThreshold div
     * @param {number} bestLevel - Best level to display
     */
    injectBadge(cell, bestLevel) {
        const existing = cell.querySelector('.mwi-labyrinth-best');
        if (existing) {
            existing.textContent = `Best: ${bestLevel}`;
            return;
        }

        const badge = document.createElement('span');
        badge.className = 'mwi-labyrinth-best';
        badge.textContent = `Best: ${bestLevel}`;
        badge.style.cssText = 'font-size:0.75rem;opacity:0.75;margin-right:6px;';

        cell.insertBefore(badge, cell.firstChild);
    }

    /**
     * Process all visible skipThreshold cells and inject badges where data exists
     */
    refreshAll() {
        document.querySelectorAll('[class*="LabyrinthPanel_skipThreshold"]').forEach((cell) => {
            const monsterHrid = this.extractRoomHrid(cell);
            if (!monsterHrid) {
                return;
            }

            const bestLevel = labyrinthTracker.getBestLevel(monsterHrid);
            if (bestLevel !== null) {
                this.injectBadge(cell, bestLevel);
            }
        });
    }
}

const labyrinthBestLevel = new LabyrinthBestLevel();
export default labyrinthBestLevel;
