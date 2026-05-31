/**
 * Labyrinth Best Level Display
 * Injects "Best: N" badges into the Labyrinth Automation tab's skip threshold cells
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import labyrinthTracker from './labyrinth-tracker.js';
import { t } from '../../core/i18n.js';

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

        // Widen the labyrinth automation section to accommodate badge text
        this.styleEl = document.createElement('style');
        this.styleEl.id = 'mwi-labyrinth-best-style';
        this.styleEl.textContent = `
            [class*="LabyrinthPanel_automationContent"] { max-width: 36rem !important; }
            [class*="LabyrinthPanel_skipThreshold"] { display: flex; align-items: center; }
            .mwi-labyrinth-best { order: 99; }
        `;
        document.head.appendChild(this.styleEl);

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

        if (this.styleEl) {
            this.styleEl.remove();
            this.styleEl = null;
        }

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
     * Get the character's current level for a skill HRID.
     * @param {string} skillHrid - e.g. "/skills/milking"
     * @returns {number|null}
     */
    _getCharSkillLevel(skillHrid) {
        const skills = dataManager.getSkills();
        if (!skills) return null;
        const skill = skills.find((s) => s.skillHrid === skillHrid);
        return skill?.level ?? null;
    }

    /**
     * Inject a "Best: N" badge into the skip threshold cell.
     * For skilling rows, also shows "(+offset)" where offset = bestLevel - charLevel - 15
     * (the 15 accounts for the Expert Tea Crate +15 skilling level bonus on Labyrinth entry).
     * @param {Element} cell - The LabyrinthPanel_skipThreshold div
     * @param {number} bestLevel - Best level to display
     * @param {string|null} roomHrid - Room HRID (e.g. "/skills/milking" or "/monsters/...")
     */
    injectBadge(cell, bestLevel, roomHrid) {
        let text = t('Best: {0}', bestLevel);
        let tooltip = null;

        if (roomHrid && roomHrid.startsWith('/skills/')) {
            const charLevel = this._getCharSkillLevel(roomHrid);
            if (charLevel !== null) {
                const EXPERT_TEA_CRATE_BONUS = 15;
                const effectiveLevel = charLevel + EXPERT_TEA_CRATE_BONUS;
                const offset = bestLevel - effectiveLevel;
                if (offset > 0) {
                    text += ` (+${offset})`;
                    tooltip =
                        t('Your level: {0}', charLevel) +
                        '\n' +
                        t('Expert Tea Crate: +{0}', EXPERT_TEA_CRATE_BONUS) +
                        '\n' +
                        t('Effective: {0}', effectiveLevel) +
                        '\n' +
                        '\n' +
                        t('Best: {0}', bestLevel) +
                        '\n' +
                        t('Gap: +{0}', offset);
                }
            }
        }

        const existing = cell.querySelector('.mwi-labyrinth-best');
        if (existing) {
            existing.textContent = text;
            if (tooltip) {
                existing.title = tooltip;
                existing.style.cursor = 'help';
            } else {
                existing.removeAttribute('title');
                existing.style.cursor = '';
            }
            return;
        }

        const badge = document.createElement('span');
        badge.className = 'mwi-labyrinth-best';
        badge.textContent = text;
        badge.style.cssText = 'font-size:0.75rem;opacity:0.75;margin-left:6px;';
        if (tooltip) {
            badge.title = tooltip;
            badge.style.cursor = 'help';
        }

        cell.appendChild(badge);
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
                this.injectBadge(cell, bestLevel, monsterHrid);
            }
        });
    }
}

const labyrinthBestLevel = new LabyrinthBestLevel();
export default labyrinthBestLevel;
