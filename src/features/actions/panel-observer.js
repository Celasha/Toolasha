/**
 * Action Panel Observer
 *
 * Detects when action panels appear and enhances them with:
 * - Gathering profit calculations (Foraging, Woodcutting, Milking)
 * - Other action panel enhancements (future)
 *
 * Automatically filters out combat action panels.
 */

import dataManager from '../../core/data-manager.js';
import { calculateGatheringProfit, formatProfitDisplay } from './gathering-profit.js';

/**
 * Action types for gathering skills (3 skills)
 */
const GATHERING_TYPES = [
    '/action_types/foraging',
    '/action_types/woodcutting',
    '/action_types/milking'
];

/**
 * CSS selectors for action panel detection
 */
const SELECTORS = {
    MODAL_CONTAINER: '.Modal_modalContainer__3B80m',
    PANEL: 'div.SkillActionDetail_regularComponent__3oCgr',
    EXP_GAIN: 'div.SkillActionDetail_expGain__F5xHu',
    ACTION_NAME: 'div.SkillActionDetail_name__3erHV',
    DROP_TABLE: 'div.SkillActionDetail_dropTable__3ViVp'
};

/**
 * Initialize action panel observer
 * Sets up MutationObserver on document.body to watch for action panels
 */
export function initActionPanelObserver() {
    setupMutationObserver();
}

/**
 * Set up MutationObserver to detect action panels
 */
function setupMutationObserver() {
    const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
            for (const addedNode of mutation.addedNodes) {
                // Check if this is a modal container with an action panel
                if (
                    addedNode.nodeType === Node.ELEMENT_NODE &&
                    addedNode.classList?.contains('Modal_modalContainer__3B80m') &&
                    addedNode.querySelector(SELECTORS.PANEL)
                ) {
                    const panel = addedNode.querySelector(SELECTORS.PANEL);
                    await handleActionPanel(panel);
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true  // Watch entire tree, not just direct children
    });

    console.log('[MWI Tools] Action panel observer initialized');
}

/**
 * Handle action panel appearance
 * @param {HTMLElement} panel - Action panel element
 */
async function handleActionPanel(panel) {
    if (!panel) return;

    // Filter out combat action panels (they don't have XP gain display)
    const expGainElement = panel.querySelector(SELECTORS.EXP_GAIN);
    if (!expGainElement) return; // Combat panel, skip

    // Check if this is a gathering action (Foraging/Woodcutting/Milking) with drop table
    const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
    if (!dropTableElement) return; // No drop table, skip

    // Get action name
    const actionNameElement = panel.querySelector(SELECTORS.ACTION_NAME);
    if (!actionNameElement) return;

    const actionName = getOriginalText(actionNameElement);
    const actionHrid = getActionHridFromName(actionName);
    if (!actionHrid) return;

    // Check if action is a gathering skill (Foraging, Woodcutting, Milking)
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];

    if (!actionDetail || !GATHERING_TYPES.includes(actionDetail.type)) return; // Not gathering, skip

    // Calculate and display profit
    await displayGatheringProfit(panel, actionHrid);
}

/**
 * Display gathering profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 */
async function displayGatheringProfit(panel, actionHrid) {
    // Calculate profit
    const profitData = await calculateGatheringProfit(actionHrid);
    if (!profitData) {
        console.error('❌ Gathering profit calculation failed for:', actionHrid);
        return;
    }

    // Format and inject HTML
    const profitHTML = formatProfitDisplay(profitData);
    if (!profitHTML) {
        console.error('❌ Profit display generation failed');
        return;
    }

    // Find insertion point (after drop table)
    const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
    if (!dropTableElement) return;

    // Check if we already added profit display
    const existingProfit = panel.querySelector('#mwi-foraging-profit');
    if (existingProfit) {
        existingProfit.remove();
    }

    // Create profit display container
    const profitContainer = document.createElement('div');
    profitContainer.id = 'mwi-foraging-profit';
    profitContainer.innerHTML = profitHTML;

    // Insert after drop table
    dropTableElement.parentNode.insertBefore(
        profitContainer,
        dropTableElement.nextSibling
    );
}

/**
 * Get original text from element (strips injected content)
 * @param {HTMLElement} element - Element to extract text from
 * @returns {string} Original text content
 */
function getOriginalText(element) {
    // Clone element to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove any injected elements
    const injected = clone.querySelectorAll('[id^="mwi-"]');
    injected.forEach(el => el.remove());

    return clone.textContent.trim();
}

/**
 * Convert action name to HRID
 * @param {string} actionName - Display name of action
 * @returns {string|null} Action HRID or null if not found
 */
function getActionHridFromName(actionName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) {
        return null;
    }

    // Search for action by name
    for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
        if (detail.name === actionName) {
            return hrid;
        }
    }

    return null;
}
