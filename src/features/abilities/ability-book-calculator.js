/**
 * Ability Book Calculator
 * Shows number of books needed to reach target ability level
 * Appears in Item Dictionary when viewing ability books
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { numberFormatter } from '../../utils/formatters.js';
import dom from '../../utils/dom.js';

/**
 * AbilityBookCalculator class handles ability book calculations in Item Dictionary
 */
class AbilityBookCalculator {
    constructor() {
        this.observer = null;
        this.isActive = false;
    }

    /**
     * Initialize the ability book calculator
     */
    initialize() {
        // Check if feature is enabled
        if (!config.getSetting('skillbook')) {
            return;
        }

        // Wait for game page to load
        this.waitForGamePage();
    }

    /**
     * Wait for game page element
     */
    waitForGamePage() {
        const targetNode = document.querySelector('div.GamePage_gamePage__ixiPl');

        if (targetNode) {
            this.setupObserver(targetNode);
        } else {
            setTimeout(() => this.waitForGamePage(), 200);
        }
    }

    /**
     * Set up MutationObserver to watch for Item Dictionary modal
     * @param {Element} targetNode - Game page element to observe
     */
    setupObserver(targetNode) {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const added of mutation.addedNodes) {
                    // Check if it's a modal with Item Dictionary content
                    if (added?.classList?.contains('Modal_modalContainer__3B80m')) {
                        const dictContent = added.querySelector('div.ItemDictionary_modalContent__WvEBY');
                        if (dictContent) {
                            this.handleItemDictionary(dictContent);
                        }
                    }
                }
            }
        });

        this.observer.observe(targetNode, {
            attributes: false,
            childList: true,
            subtree: true
        });

        this.isActive = true;
    }

    /**
     * Handle Item Dictionary modal
     * @param {Element} panel - Item Dictionary content element
     */
    async handleItemDictionary(panel) {
        try {
            // Extract ability HRID from modal title
            const abilityHrid = this.extractAbilityHrid(panel);
            if (!abilityHrid) {
                return; // Not an ability book
            }

            // Get ability book data
            const itemHrid = abilityHrid.replace('/abilities/', '/items/');
            const gameData = dataManager.getInitClientData();
            if (!gameData) return;

            const itemDetails = gameData.itemDetailMap[itemHrid];
            if (!itemDetails?.abilityBookDetail) {
                return; // Not an ability book
            }

            const xpPerBook = itemDetails.abilityBookDetail.experienceGain;

            // Get current ability level and XP
            const abilityData = this.getCurrentAbilityData(abilityHrid);

            // Inject calculator UI
            this.injectCalculator(panel, abilityData, xpPerBook, itemHrid);

        } catch (error) {
            console.error('[AbilityBookCalculator] Error handling dictionary:', error);
        }
    }

    /**
     * Extract ability HRID from modal title
     * @param {Element} panel - Item Dictionary content element
     * @returns {string|null} Ability HRID or null
     */
    extractAbilityHrid(panel) {
        const titleElement = panel.querySelector('h1.ItemDictionary_title__27cTd');
        if (!titleElement) return null;

        // Get the item name from title
        const itemName = titleElement.textContent.trim()
            .toLowerCase()
            .replaceAll(' ', '_')
            .replaceAll("'", '');

        // Look up ability HRID from name
        const gameData = dataManager.getInitClientData();
        if (!gameData) return null;

        for (const abilityHrid of Object.keys(gameData.abilityDetailMap)) {
            if (abilityHrid.includes('/' + itemName)) {
                return abilityHrid;
            }
        }

        return null;
    }

    /**
     * Get current ability level and XP from character data
     * @param {string} abilityHrid - Ability HRID
     * @returns {Object} {level, xp}
     */
    getCurrentAbilityData(abilityHrid) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return { level: 0, xp: 0 };

        // Get character abilities from game data
        const characterAbilities = gameData.characterAbilities || {};

        for (const ability of Object.values(characterAbilities)) {
            if (ability.abilityHrid === abilityHrid) {
                return {
                    level: ability.level || 0,
                    xp: ability.experience || 0
                };
            }
        }

        return { level: 0, xp: 0 };
    }

    /**
     * Calculate books needed to reach target level
     * @param {number} currentLevel - Current ability level
     * @param {number} currentXp - Current ability XP
     * @param {number} targetLevel - Target ability level
     * @param {number} xpPerBook - XP gained per book
     * @returns {number} Number of books needed
     */
    calculateBooksNeeded(currentLevel, currentXp, targetLevel, xpPerBook) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) return 0;

        const levelXpTable = gameData.levelExperienceTable;
        if (!levelXpTable) return 0;

        // Calculate XP needed to reach target level
        const targetXp = levelXpTable[targetLevel];
        const xpNeeded = targetXp - currentXp;

        // Calculate books needed
        let booksNeeded = xpNeeded / xpPerBook;

        // If starting from level 0, need +1 book to learn the ability initially
        if (currentLevel === 0) {
            booksNeeded += 1;
        }

        return booksNeeded;
    }

    /**
     * Inject calculator UI into Item Dictionary modal
     * @param {Element} panel - Item Dictionary content element
     * @param {Object} abilityData - {level, xp}
     * @param {number} xpPerBook - XP per book
     * @param {string} itemHrid - Item HRID for market prices
     */
    async injectCalculator(panel, abilityData, xpPerBook, itemHrid) {
        // Check if already injected
        if (panel.querySelector('#tillLevel')) {
            return;
        }

        const { level: currentLevel, xp: currentXp } = abilityData;
        const targetLevel = currentLevel + 1;

        // Calculate initial books needed
        const booksNeeded = this.calculateBooksNeeded(currentLevel, currentXp, targetLevel, xpPerBook);

        // Get market prices
        const prices = marketAPI.getPrice(itemHrid, 0);
        const ask = prices?.ask || 0;
        const bid = prices?.bid || 0;

        // Create calculator HTML
        const calculatorDiv = dom.createStyledDiv(
            {
                color: config.SCRIPT_COLOR_MAIN,
                textAlign: 'left',
                marginTop: '16px',
                padding: '12px',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '4px'
            },
            '',
            'tillLevel'
        );

        calculatorDiv.innerHTML = `
            <div style="margin-bottom: 8px;">
                <label for="tillLevelInput">To level: </label>
                <input
                    id="tillLevelInput"
                    type="number"
                    value="${targetLevel}"
                    min="${currentLevel + 1}"
                    max="200"
                    style="width: 60px; padding: 4px; background: #2a2a2a; color: white; border: 1px solid #555; border-radius: 3px;"
                >
            </div>
            <div id="tillLevelNumber" style="font-size: 0.95em;">
                Books needed: <strong>${numberFormatter(booksNeeded)}</strong>
                <br>
                Cost: ${numberFormatter(Math.ceil(booksNeeded * ask))} / ${numberFormatter(Math.ceil(booksNeeded * bid))} (ask / bid)
            </div>
            <div style="font-size: 0.85em; color: #999; margin-top: 8px; font-style: italic;">
                Refresh page to update current level
            </div>
        `;

        // Add event listeners for input changes
        const input = calculatorDiv.querySelector('#tillLevelInput');
        const display = calculatorDiv.querySelector('#tillLevelNumber');

        const updateDisplay = () => {
            const target = parseInt(input.value);

            if (target > currentLevel && target <= 200) {
                const books = this.calculateBooksNeeded(currentLevel, currentXp, target, xpPerBook);
                display.innerHTML = `
                    Books needed: <strong>${numberFormatter(books)}</strong>
                    <br>
                    Cost: ${numberFormatter(Math.ceil(books * ask))} / ${numberFormatter(Math.ceil(books * bid))} (ask / bid)
                `;
            } else {
                display.innerHTML = '<span style="color: #f87171;">Invalid target level</span>';
            }
        };

        input.addEventListener('change', updateDisplay);
        input.addEventListener('keyup', updateDisplay);

        // Try to find the left column by looking for the modal's main content structure
        // The Item Dictionary modal typically has its content in direct children of the panel
        const directChildren = Array.from(panel.children);

        // Look for a container that has exactly 2 children (two-column layout)
        for (const child of directChildren) {
            const grandchildren = Array.from(child.children).filter(c => {
                // Filter for visible elements that look like content columns
                const style = window.getComputedStyle(c);
                return style.display !== 'none' && c.offsetHeight > 50; // At least 50px tall
            });

            if (grandchildren.length === 2) {
                // Found the two-column container! Use the left column (first child)
                const leftColumn = grandchildren[0];
                leftColumn.appendChild(calculatorDiv);
                return;
            }
        }

        // Fallback: append to panel bottom (original behavior)
        panel.appendChild(calculatorDiv);
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.isActive = false;
    }
}

// Create and export singleton instance
const abilityBookCalculator = new AbilityBookCalculator();

export default abilityBookCalculator;
