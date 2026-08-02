/**
 * Ability Book Calculator
 * Shows number of books needed to reach target ability level
 * Appears in Item Dictionary when viewing ability books
 */

import marketAPI from '../../api/marketplace.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import dom from '../../utils/dom.js';
import { numberFormatter, formatKMB } from '../../utils/formatters.js';
import {
    navigateToMarketplace,
    getVisibleMarketplaceTabContainer,
    watchNativeTabExit,
} from '../../utils/marketplace-tabs.js';
import { createAutofillManager, readMarketplaceRuntimeState } from '../../utils/marketplace-autofill.js';

/**
 * AbilityBookCalculator class handles ability book calculations in Item Dictionary
 */
export class AbilityBookCalculator {
    constructor() {
        this.unregisterObserver = null; // Unregister function from centralized observer
        this.isActive = false;
        this.isInitialized = false;
        this.autofillManager = createAutofillManager('AbilityBookCalculator');
        this._abilityBookSessionId = null;
        this._abilityBookExpiryTimer = null;
        this._abilityBookNativeTabListener = null;
        this._abilityBookVisibilityInterval = null;
    }

    /**
     * Idempotent teardown of the ability book marketplace session
     */
    teardownAbilityBookSession() {
        if (this._abilityBookExpiryTimer) {
            clearTimeout(this._abilityBookExpiryTimer);
            this._abilityBookExpiryTimer = null;
        }
        if (this._abilityBookNativeTabListener) {
            this._abilityBookNativeTabListener();
            this._abilityBookNativeTabListener = null;
        }
        if (this._abilityBookVisibilityInterval) {
            clearInterval(this._abilityBookVisibilityInterval);
            this._abilityBookVisibilityInterval = null;
        }
        const sessionId = this._abilityBookSessionId;
        this._abilityBookSessionId = null;
        this.autofillManager.exitSession(sessionId);
    }

    /**
     * Navigate the marketplace to the given item, polling until it resolves
     * @param {string} itemHrid - Item HRID to navigate to
     * @param {number} sessionId - Captured one-shot session token
     * @returns {Promise<boolean>} True if navigation succeeded within deadline
     */
    async navigateAbilityBookToItem(itemHrid, sessionId) {
        // Use the fiber game object to navigate
        if (!navigateToMarketplace(itemHrid, 0)) return false;

        const deadline = 3000;
        const interval = 100;
        let elapsed = 0;
        while (elapsed < deadline) {
            await new Promise((r) => setTimeout(r, interval));
            elapsed += interval;
            if (!marketplaceSession.isActive(sessionId) || this._abilityBookSessionId !== sessionId) return false;

            // Install native-tab cancellation as soon as the live Marketplace tablist exists,
            // not only after item identity converges. This closes the brief pre-identity race
            // where the user could leave the workflow before the exact order book was detected.
            const tabsContainer = getVisibleMarketplaceTabContainer();
            if (tabsContainer && !this._abilityBookNativeTabListener) {
                this._abilityBookNativeTabListener = watchNativeTabExit(tabsContainer, () => {
                    marketplaceSession.end(sessionId);
                });
            }

            const state = readMarketplaceRuntimeState();
            if (
                tabsContainer &&
                state?.marketTabKey === 'MarketListings' &&
                state?.marketListingsView === 'OrderBook' &&
                state?.itemHrid === itemHrid &&
                state?.enhancementLevel === 0 &&
                state?.isSell === false
            ) {
                this.startAbilityBookVisibilityMonitor(sessionId, itemHrid);
                return true;
            }
        }
        return false;
    }

    /**
     * End the one-shot workflow promptly if Marketplace is closed before autofill.
     * Allows brief React remount gaps but does not leave ownership armed for 30 seconds.
     * @param {number|null} sessionId
     * @param {string} itemHrid
     */
    startAbilityBookVisibilityMonitor(sessionId, itemHrid) {
        if (sessionId === null || this._abilityBookVisibilityInterval) return;

        let consecutiveMisses = 0;
        this._abilityBookVisibilityInterval = setInterval(() => {
            if (!marketplaceSession.isActive(sessionId)) {
                clearInterval(this._abilityBookVisibilityInterval);
                this._abilityBookVisibilityInterval = null;
                return;
            }

            const state = readMarketplaceRuntimeState();
            const stillOnTarget =
                getVisibleMarketplaceTabContainer() &&
                state?.marketTabKey === 'MarketListings' &&
                state?.marketListingsView === 'OrderBook' &&
                state?.itemHrid === itemHrid &&
                state?.enhancementLevel === 0 &&
                state?.isSell === false;
            if (stillOnTarget) {
                consecutiveMisses = 0;
                return;
            }

            consecutiveMisses++;
            if (consecutiveMisses >= 3) marketplaceSession.end(sessionId);
        }, 200);
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('skillbook', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize the ability book calculator
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('skillbook')) {
            return;
        }

        this.isInitialized = true;

        this.autofillManager.initialize();

        // Register with centralized observer to watch for Item Dictionary modal
        this.unregisterObserver = domObserver.onClass(
            'AbilityBookCalculator',
            'ItemDictionary_modalContent__WvEBY',
            (dictContent) => {
                this.handleItemDictionary(dictContent);
            }
        );

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
        const itemName = titleElement.textContent.trim().toLowerCase().replaceAll(' ', '_').replaceAll("'", '');

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
        // Get character abilities from live character data (NOT static game data)
        const characterData = dataManager.characterData;
        if (!characterData?.characterAbilities) {
            return { level: 0, xp: 0 };
        }

        // characterAbilities is an ARRAY of ability objects
        const ability = characterData.characterAbilities.find((a) => a.abilityHrid === abilityHrid);
        if (ability) {
            return {
                level: ability.level || 0,
                xp: ability.experience || 0,
            };
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
        let booksNeeded = Math.ceil(xpNeeded / xpPerBook);

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
        if (panel.querySelector('.tillLevel')) {
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
                color: config.COLOR_ACCENT,
                textAlign: 'left',
                marginTop: '16px',
                padding: '12px',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '4px',
            },
            '',
            'tillLevel'
        );

        calculatorDiv.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 0.95em;">
                <strong>Current level:</strong> ${currentLevel}
            </div>
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
                Cost: ${formatKMB(Math.ceil(booksNeeded * ask))} / ${formatKMB(Math.ceil(booksNeeded * bid))} (ask / bid)
            </div>
            <div style="font-size: 0.85em; color: #999; margin-top: 8px; font-style: italic;">
                Refresh page to update current level
            </div>
        `;

        // Add event listeners for input changes
        const input = calculatorDiv.querySelector('#tillLevelInput');
        const display = calculatorDiv.querySelector('#tillLevelNumber');

        let currentBooks = booksNeeded;

        const updateDisplay = () => {
            const target = parseInt(input.value);

            if (target > currentLevel && target <= 200) {
                const books = this.calculateBooksNeeded(currentLevel, currentXp, target, xpPerBook);
                currentBooks = books;
                display.innerHTML = `
                    Books needed: <strong>${numberFormatter(books)}</strong>
                    <br>
                    Cost: ${formatKMB(Math.ceil(books * ask))} / ${formatKMB(Math.ceil(books * bid))} (ask / bid)
                `;
            } else {
                currentBooks = 0;
                display.innerHTML = `<span style="color: ${config.COLOR_LOSS};">Invalid target level</span>`;
            }
        };

        input.addEventListener('change', updateDisplay);
        input.addEventListener('keyup', updateDisplay);

        // Buy on Marketplace button
        const buyButton = document.createElement('button');
        buyButton.type = 'button';
        buyButton.textContent = 'Buy on Marketplace';
        buyButton.style.cssText = `
            margin-top: 8px;
            padding: 4px 10px;
            font-size: 0.85em;
            background: #2a2a2a;
            color: white;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
        `;
        buyButton.addEventListener('click', async () => {
            if (currentBooks <= 0) return;

            let sessionId = null;
            try {
                const quantity = Math.ceil(currentBooks);
                sessionId = marketplaceSession.start({
                    owner: MARKETPLACE_OWNER.ABILITY_BOOK,
                    consumeOnFill: true,
                    onEnd: () => this.teardownAbilityBookSession(),
                });
                this._abilityBookSessionId = sessionId;
                this.autofillManager.startSession({ sessionId });
                const armed = this.autofillManager.arm({
                    sessionId,
                    itemHrid,
                    enhancementLevel: 0,
                    modalMode: 'buy',
                    quantityProvider: () => quantity,
                });
                if (!armed) {
                    marketplaceSession.end(sessionId);
                    return;
                }

                this._abilityBookExpiryTimer = setTimeout(() => {
                    this._abilityBookExpiryTimer = null;
                    if (marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
                }, 30000);

                const success = await this.navigateAbilityBookToItem(itemHrid, sessionId);
                if (!success && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
            } catch (error) {
                console.error('[AbilityBookCalculator] Marketplace workflow failed:', error);
                if (sessionId !== null && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
            }
        });
        calculatorDiv.appendChild(buyButton);

        // Try to find the left column by looking for the modal's main content structure
        // The Item Dictionary modal typically has its content in direct children of the panel
        const directChildren = Array.from(panel.children);

        // Look for a container that has exactly 2 children (two-column layout)
        for (const child of directChildren) {
            const grandchildren = Array.from(child.children).filter((c) => {
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
     * Refresh colors on existing calculator displays
     */
    refresh() {
        // Update all .tillLevel elements
        document.querySelectorAll('.tillLevel').forEach((calc) => {
            calc.style.color = config.COLOR_ACCENT;
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        const sessionId = this._abilityBookSessionId;
        if (sessionId !== null && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
        else this.teardownAbilityBookSession();
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        this.autofillManager.cleanup();
        this.isActive = false;
        this.isInitialized = false;
    }
}

const abilityBookCalculator = new AbilityBookCalculator();
abilityBookCalculator.setupSettingListener();

export default abilityBookCalculator;
