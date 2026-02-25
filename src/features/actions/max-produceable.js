/**
 * Max Produceable Display Module
 *
 * Shows maximum craftable quantity on action panels based on current inventory.
 *
 * Example:
 * - Cheesy Sword requires: 10 Cheese, 5 Iron Bar
 * - Inventory: 120 Cheese, 65 Iron Bar
 * - Display: "Can produce: 12" (limited by 120/10 = 12)
 */

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import actionPanelSort from './action-panel-sort.js';
import actionFilter from './action-filter.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { calculateProductionProfit } from './production-profit.js';
import { formatKMB } from '../../utils/formatters.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';
import { getDrinkConcentration, parseArtisanBonus } from '../../utils/tea-parser.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * Action type constants for classification
 */
const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];
const PRODUCTION_TYPES = [
    '/action_types/brewing',
    '/action_types/cooking',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
];

/**
 * Build inventory index map for O(1) lookups
 * @param {Array} inventory - Inventory array from dataManager
 * @returns {Map} Map of itemHrid → inventory item
 */
function buildInventoryIndex(inventory) {
    const index = new Map();
    for (const item of inventory) {
        if (item.itemLocationHrid === '/item_locations/inventory') {
            index.set(item.itemHrid, item);
        }
    }
    return index;
}

class MaxProduceable {
    constructor() {
        this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement, pinElement}
        this.unregisterObserver = null;
        this.lastCrimsonMilkCount = null; // For debugging inventory updates
        this.itemsUpdatedHandler = null;
        this.actionCompletedHandler = null;
        this.characterSwitchingHandler = null; // Handler for character switch cleanup
        this.profitCalcTimeout = null; // Debounce timer for deferred profit calculations
        this.actionNameToHridCache = null; // Cached reverse lookup map (name → hrid)
        this.isInitialized = false;
        this.itemsUpdatedDebounceTimer = null; // Debounce timer for items_updated events
        this.DEBOUNCE_DELAY = 300; // 300ms debounce for event handlers
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize the max produceable display
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('actionPanel_maxProduceable')) {
            return;
        }

        this.isInitialized = true;

        // Initialize shared sort manager
        await actionPanelSort.initialize();

        this.setupObserver();

        // Store handler references for cleanup with debouncing
        this.itemsUpdatedHandler = () => {
            clearTimeout(this.itemsUpdatedDebounceTimer);
            this.itemsUpdatedDebounceTimer = setTimeout(() => {
                this.updateAllCounts();
            }, this.DEBOUNCE_DELAY);
        };
        this.characterSwitchingHandler = () => {
            this.clearAllReferences();
        };

        // Event-driven updates (no polling needed)
        dataManager.on('items_updated', this.itemsUpdatedHandler);
        dataManager.on('character_switching', this.characterSwitchingHandler);
    }

    /**
     * Setup DOM observer to watch for action panels
     */
    setupObserver() {
        // Watch for skill action panels (in skill screen, not detail modal)
        this.unregisterObserver = domObserver.onClass('MaxProduceable', 'SkillAction_skillAction', (actionPanel) => {
            this.injectMaxProduceable(actionPanel);

            // Schedule profit calculation after panels settle
            // This prevents 20-50 simultaneous API calls during character switch
            clearTimeout(this.profitCalcTimeout);
            this.profitCalcTimeout = setTimeout(() => {
                this.updateAllCounts();
            }, 50); // Wait 50ms after last panel appears for better responsiveness
            this.timerRegistry.registerTimeout(this.profitCalcTimeout);
        });

        // Check for existing action panels that may already be open
        const existingPanels = document.querySelectorAll('[class*="SkillAction_skillAction"]');
        existingPanels.forEach((panel) => {
            this.injectMaxProduceable(panel);
        });

        // Calculate profits for existing panels after initial load
        if (existingPanels.length > 0) {
            clearTimeout(this.profitCalcTimeout);
            this.profitCalcTimeout = setTimeout(() => {
                this.updateAllCounts();
            }, 50); // Fast initial load for better responsiveness
            this.timerRegistry.registerTimeout(this.profitCalcTimeout);
        }
    }

    /**
     * Inject max produceable display and pin icon into an action panel
     * @param {HTMLElement} actionPanel - The action panel element
     */
    injectMaxProduceable(actionPanel) {
        // Extract action HRID from panel
        const actionHrid = this.getActionHridFromPanel(actionPanel);

        if (!actionHrid) {
            return;
        }

        const actionDetails = dataManager.getActionDetails(actionHrid);
        if (!actionDetails) {
            return;
        }

        // Check if production action with inputs (for max produceable display)
        const isProductionAction = actionDetails.inputItems && actionDetails.inputItems.length > 0;

        // Check if already injected
        const existingDisplay = actionPanel.querySelector('.mwi-max-produceable');
        const existingPin = actionPanel.querySelector('.mwi-action-pin');
        if (existingPin) {
            // Re-register existing elements
            this.actionElements.set(actionPanel, {
                actionHrid: actionHrid,
                displayElement: existingDisplay || null,
                pinElement: existingPin,
            });
            // Update pin state
            this.updatePinIcon(existingPin, actionHrid);
            // Note: Profit update is deferred to updateAllCounts() in setupObserver()
            return;
        }

        // Make sure the action panel has relative positioning
        if (actionPanel.style.position !== 'relative' && actionPanel.style.position !== 'absolute') {
            actionPanel.style.position = 'relative';
        }

        let display = null;

        // Only create max produceable display for production actions
        if (isProductionAction) {
            actionPanel.style.alignSelf = 'flex-start';
            actionPanel.style.overflow = 'visible';

            display = document.createElement('div');
            display.className = 'mwi-max-produceable';
            display.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                font-size: 0.55em;
                padding: 4px 8px;
                text-align: center;
                background: rgba(0, 0, 0, 0.7);
                border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
                z-index: 10;
                line-height: 1.3;
                overflow: hidden;
            `;

            actionPanel.appendChild(display);

            // Set marginBottom to the bar's actual rendered height so the grid row
            // reserves exactly the right amount of space below the tile.
            requestAnimationFrame(() => {
                const h = display.offsetHeight;
                if (h > 0) actionPanel.style.marginBottom = `${h}px`;
            });
        }

        // Create pin icon (for ALL actions - gathering and production)
        const pinIcon = document.createElement('div');
        pinIcon.className = 'mwi-action-pin';
        pinIcon.innerHTML = '📌'; // Pin emoji
        pinIcon.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            font-size: 1.5em;
            cursor: pointer;
            transition: all 0.2s;
            z-index: 11;
            user-select: none;
            filter: grayscale(100%) brightness(0.7);
        `;
        pinIcon.title = 'Pin this action to keep it visible';

        // Pin hover effect
        pinIcon.addEventListener('mouseenter', () => {
            if (!actionPanelSort.isPinned(actionHrid)) {
                pinIcon.style.filter = 'grayscale(50%) brightness(1)';
            }
        });
        pinIcon.addEventListener('mouseleave', () => {
            this.updatePinIcon(pinIcon, actionHrid);
        });

        // Pin click handler
        pinIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePin(actionHrid, pinIcon);
        });

        // Set initial pin state
        this.updatePinIcon(pinIcon, actionHrid);

        actionPanel.appendChild(pinIcon);

        // Store reference
        this.actionElements.set(actionPanel, {
            actionHrid: actionHrid,
            displayElement: display,
            pinElement: pinIcon,
        });

        // Register panel with shared sort manager
        actionPanelSort.registerPanel(actionPanel, actionHrid);

        // Note: Profit calculation is deferred to updateAllCounts() in setupObserver()
        // This prevents 20-50 simultaneous API calls during character switch

        // Trigger debounced sort after panels are loaded
        actionPanelSort.triggerSort();
    }

    /**
     * Extract action HRID from action panel
     * @param {HTMLElement} actionPanel - The action panel element
     * @returns {string|null} Action HRID or null
     */
    getActionHridFromPanel(actionPanel) {
        // Try to find action name from panel
        const nameElement = actionPanel.querySelector('div[class*="SkillAction_name"]');

        if (!nameElement) {
            return null;
        }

        const actionName = Array.from(nameElement.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join('')
            .trim();

        // Build reverse lookup cache on first use (name → hrid)
        if (!this.actionNameToHridCache) {
            const initData = dataManager.getInitClientData();
            if (!initData) {
                return null;
            }

            this.actionNameToHridCache = new Map();
            for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
                this.actionNameToHridCache.set(action.name, hrid);
            }
        }

        // O(1) lookup instead of O(n) iteration
        return this.actionNameToHridCache.get(actionName) || null;
    }

    /**
     * Calculate max produceable count for an action
     * @param {string} actionHrid - The action HRID
     * @param {Map} inventoryIndex - Inventory index map (itemHrid → item)
     * @param {Object} gameData - Game data (optional, will fetch if not provided)
     * @returns {number|null} Max produceable count or null
     */
    calculateMaxProduceable(actionHrid, inventoryIndex = null, gameData = null) {
        const actionDetails = dataManager.getActionDetails(actionHrid);

        // Get inventory index if not provided
        if (!inventoryIndex) {
            const inventory = dataManager.getInventory();
            inventoryIndex = buildInventoryIndex(inventory);
        }

        if (!actionDetails || !inventoryIndex) {
            return null;
        }

        // Get Artisan Tea reduction if active (applies to input materials only, not upgrade items)
        const equipment = dataManager.getEquipment();
        const itemDetailMap = gameData?.itemDetailMap || dataManager.getInitClientData()?.itemDetailMap || {};
        const drinkConcentration = getDrinkConcentration(equipment, itemDetailMap);
        const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);
        const artisanBonus = parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

        // Calculate max crafts per input (using O(1) Map lookup instead of O(n) array find)
        const maxCraftsPerInput = actionDetails.inputItems.map((input) => {
            const invItem = inventoryIndex.get(input.itemHrid);
            const invCount = invItem?.count || 0;

            // Apply Artisan reduction (10% base, scaled by Drink Concentration)
            // Materials consumed per action = base requirement × (1 - artisan bonus)
            const materialsPerAction = input.count * (1 - artisanBonus);
            const maxCrafts = Math.floor(invCount / materialsPerAction);

            return maxCrafts;
        });

        let minCrafts = Math.min(...maxCraftsPerInput);

        // Check upgrade item (e.g., Enhancement Stones)
        // NOTE: Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
        if (actionDetails.upgradeItemHrid) {
            const upgradeItem = inventoryIndex.get(actionDetails.upgradeItemHrid);
            const upgradeCount = upgradeItem?.count || 0;
            minCrafts = Math.min(minCrafts, upgradeCount);
        }

        return minCrafts;
    }

    /**
     * Update display count for a single action panel
     * @param {HTMLElement} actionPanel - The action panel element
     * @param {Map} inventoryIndex - Inventory index map (optional)
     */
    async updateCount(actionPanel, inventoryIndex = null) {
        const data = this.actionElements.get(actionPanel);

        if (!data) {
            return;
        }

        // Only calculate max crafts for production actions with display element
        let maxCrafts = null;
        if (data.displayElement) {
            maxCrafts = this.calculateMaxProduceable(data.actionHrid, inventoryIndex, dataManager.getInitClientData());

            if (maxCrafts === null) {
                data.displayElement.style.display = 'none';
                return;
            }
        }

        // Calculate profit/hr (for both gathering and production)
        let profitPerHour = null;
        let hasMissingPrices = false;
        const actionDetails = dataManager.getActionDetails(data.actionHrid);

        if (actionDetails) {
            if (GATHERING_TYPES.includes(actionDetails.type)) {
                const profitData = await calculateGatheringProfit(data.actionHrid);
                profitPerHour = profitData?.profitPerHour || null;
                hasMissingPrices = profitData?.hasMissingPrices || false;
            } else if (PRODUCTION_TYPES.includes(actionDetails.type)) {
                const profitData = await calculateProductionProfit(data.actionHrid);
                profitPerHour = profitData?.profitPerHour || null;
                hasMissingPrices = profitData?.hasMissingPrices || false;
            }
        }

        // Store profit value for sorting and update shared sort manager
        const resolvedProfitPerHour = hasMissingPrices ? null : profitPerHour;
        data.profitPerHour = resolvedProfitPerHour;
        actionPanelSort.updateProfit(actionPanel, resolvedProfitPerHour);

        // Check if we should hide actions with negative profit (unless pinned)
        const hideNegativeProfit = config.getSetting('actionPanel_hideNegativeProfit');
        const isPinned = actionPanelSort.isPinned(data.actionHrid);
        const isFilterHidden = actionFilter.isFilterHidden(actionPanel);

        if (hideNegativeProfit && resolvedProfitPerHour !== null && resolvedProfitPerHour < 0 && !isPinned) {
            // Hide the entire action panel (unless it's pinned)
            actionPanel.style.display = 'none';
            return;
        } else if (isFilterHidden) {
            // Hide the panel if filter doesn't match
            actionPanel.style.display = 'none';
            return;
        } else {
            // Show the action panel (in case it was previously hidden)
            actionPanel.style.display = '';
        }

        // Only update display element if it exists (production actions only)
        if (!data.displayElement) {
            return;
        }

        // Calculate exp/hr using shared utility
        const expData = calculateExpPerHour(data.actionHrid);
        const expPerHour = expData?.expPerHour || null;

        // Color coding for "Can produce"
        let canProduceColor;
        if (maxCrafts === 0) {
            canProduceColor = config.COLOR_LOSS; // Red - can't craft
        } else if (maxCrafts < 5) {
            canProduceColor = config.COLOR_WARNING; // Orange/yellow - low materials
        } else {
            canProduceColor = config.COLOR_PROFIT; // Green - plenty of materials
        }

        // Store metrics for best action comparison
        data.maxCrafts = maxCrafts;
        data.profitPerHour = resolvedProfitPerHour;
        data.expPerHour = expPerHour;
        data.hasMissingPrices = hasMissingPrices;

        // Build display HTML using .mwi-action-stat-line divs so fitLineFontSizes
        // can size each line immediately — avoids the multi-second flash of tiny
        // unsized text that occurred when sizing was deferred to addBestActionIndicators.
        let html = `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
        html += `<span style="color: ${canProduceColor};">Can produce: ${maxCrafts.toLocaleString()}</span></div>`;

        if (hasMissingPrices) {
            html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
            html += `<span data-stat="profit" style="color: ${config.SCRIPT_COLOR_ALERT};">Profit/hr: -- ⚠</span></div>`;
        } else if (resolvedProfitPerHour !== null) {
            const profitColor = resolvedProfitPerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
            const profitSign = resolvedProfitPerHour >= 0 ? '' : '-';
            html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
            html += `<span data-stat="profit" style="color: ${profitColor};">Profit/hr: ${profitSign}${formatKMB(Math.abs(resolvedProfitPerHour))}</span></div>`;
        }

        if (expPerHour !== null && expPerHour > 0) {
            html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
            html += `<span data-stat="exp" style="color: #fff;">Exp/hr: ${formatKMB(expPerHour)}</span></div>`;
        }

        if (!hasMissingPrices && resolvedProfitPerHour !== null && expPerHour !== null && expPerHour > 0) {
            const coinsPerXp = resolvedProfitPerHour / expPerHour;
            const efficiencyColor = coinsPerXp >= 0 ? config.COLOR_INFO : config.COLOR_WARNING;
            const efficiencySign = coinsPerXp >= 0 ? '' : '-';
            html += `<div class="mwi-action-stat-line" style="white-space: nowrap;">`;
            html += `<span data-stat="overall" style="color: ${efficiencyColor};">Coins/XP: ${efficiencySign}${formatKMB(Math.abs(coinsPerXp))}</span></div>`;
        }

        data.displayElement.style.display = 'block';
        data.displayElement.style.visibility = 'hidden';
        data.displayElement.innerHTML = html;
        this.fitLineFontSizes(actionPanel, data.displayElement);
    }

    /**
     * Update all counts
     */
    async updateAllCounts() {
        // Pre-load market API ONCE before all profit calculations
        // This prevents all 20+ calculations from triggering simultaneous fetches
        if (!marketAPI.isLoaded()) {
            await marketAPI.fetch();
        }

        // Get inventory once and build index for O(1) lookups
        const inventory = dataManager.getInventory();

        if (!inventory) {
            return;
        }

        // Build inventory index once (O(n) cost, but amortized across all panels)
        const inventoryIndex = buildInventoryIndex(inventory);

        // Clean up stale references and update valid ones
        const updatePromises = [];
        for (const actionPanel of [...this.actionElements.keys()]) {
            if (document.body.contains(actionPanel)) {
                updatePromises.push(this.updateCount(actionPanel, inventoryIndex));
            } else {
                // Panel no longer in DOM - remove injected elements BEFORE deleting from Map
                const data = this.actionElements.get(actionPanel);
                if (data) {
                    if (data.displayElement) {
                        data.displayElement.innerHTML = ''; // Clear innerHTML to break references
                        data.displayElement.remove();
                        data.displayElement = null; // Null out reference for GC
                    }
                    if (data.pinElement) {
                        data.pinElement.innerHTML = ''; // Clear innerHTML to break references
                        data.pinElement.remove();
                        data.pinElement = null; // Null out reference for GC
                    }
                }
                this.actionElements.delete(actionPanel);
                actionPanelSort.unregisterPanel(actionPanel);
            }
        }

        // Wait for all updates to complete
        await Promise.all(updatePromises);

        // Find best actions and add indicators
        this.addBestActionIndicators();

        // Trigger sort via shared manager
        actionPanelSort.triggerSort();
    }

    /**
     * Find best actions and add visual indicators
     */
    addBestActionIndicators() {
        let bestProfit = null;
        let bestExp = null;
        let bestOverall = null;
        let bestProfitPanels = [];
        let bestExpPanels = [];
        let bestOverallPanels = [];

        // First pass: find the best values
        for (const [actionPanel, data] of this.actionElements.entries()) {
            if (!document.body.contains(actionPanel) || !data.displayElement) {
                continue;
            }

            const { profitPerHour, expPerHour, hasMissingPrices } = data;

            // Skip actions with missing prices for profit comparison
            if (!hasMissingPrices && profitPerHour !== null && profitPerHour > 0) {
                if (bestProfit === null || profitPerHour > bestProfit) {
                    bestProfit = profitPerHour;
                    bestProfitPanels = [actionPanel];
                } else if (profitPerHour === bestProfit) {
                    bestProfitPanels.push(actionPanel);
                }
            }

            // Find best exp/hr
            if (expPerHour !== null && expPerHour > 0) {
                if (bestExp === null || expPerHour > bestExp) {
                    bestExp = expPerHour;
                    bestExpPanels = [actionPanel];
                } else if (expPerHour === bestExp) {
                    bestExpPanels.push(actionPanel);
                }
            }

            // Find best overall (profit × exp product)
            if (
                !hasMissingPrices &&
                profitPerHour !== null &&
                profitPerHour > 0 &&
                expPerHour !== null &&
                expPerHour > 0
            ) {
                const overallValue = profitPerHour * expPerHour;
                if (bestOverall === null || overallValue > bestOverall) {
                    bestOverall = overallValue;
                    bestOverallPanels = [actionPanel];
                } else if (overallValue === bestOverall) {
                    bestOverallPanels.push(actionPanel);
                }
            }
        }

        // Second pass: update emoji indicators in-place on existing spans.
        // Avoids rewriting innerHTML (which would cause a flash + re-size).
        const EMOJIS = [' 💰', ' 🧠', ' 🏆'];
        const stripEmoji = (text) => {
            let t = text;
            for (const e of EMOJIS) t = t.replace(e, '');
            return t;
        };

        for (const [actionPanel, data] of this.actionElements.entries()) {
            if (!document.body.contains(actionPanel) || !data.displayElement) {
                continue;
            }

            const isBestProfit = bestProfitPanels.includes(actionPanel);
            const isBestExp = bestExpPanels.includes(actionPanel);
            const isBestOverall = bestOverallPanels.includes(actionPanel);

            const profitSpan = data.displayElement.querySelector('[data-stat="profit"]');
            if (profitSpan) {
                profitSpan.textContent = stripEmoji(profitSpan.textContent) + (isBestProfit ? ' 💰' : '');
            }

            const expSpan = data.displayElement.querySelector('[data-stat="exp"]');
            if (expSpan) {
                expSpan.textContent = stripEmoji(expSpan.textContent) + (isBestExp ? ' 🧠' : '');
            }

            const overallSpan = data.displayElement.querySelector('[data-stat="overall"]');
            if (overallSpan) {
                overallSpan.textContent = stripEmoji(overallSpan.textContent) + (isBestOverall ? ' 🏆' : '');
            }

            // Re-fit font sizes now that emoji may have changed span widths.
            this.fitLineFontSizes(actionPanel, data.displayElement);
        }
    }

    /**
     * Fit each stat line to the action panel width
     * @param {HTMLElement} actionPanel - Action panel container
     * @param {HTMLElement} displayElement - Stats container
     */
    fitLineFontSizes(actionPanel, displayElement, retries = 4) {
        requestAnimationFrame(() => {
            const panelWidth = actionPanel.getBoundingClientRect().width;
            const fallbackWidth = displayElement.getBoundingClientRect().width;
            const rawWidth = panelWidth || fallbackWidth;
            const availableWidth = Math.max(0, rawWidth - 16);
            if (!availableWidth) {
                if (retries > 0) {
                    setTimeout(() => this.fitLineFontSizes(actionPanel, displayElement, retries - 1), 60);
                } else {
                    // Out of retries — reveal anyway so it's never permanently hidden.
                    displayElement.style.visibility = '';
                }
                return;
            }

            const baseFontSize = 11;
            const minFontSize = 5;
            const lines = displayElement.querySelectorAll('.mwi-action-stat-line');

            lines.forEach((line) => {
                const textSpan = line.querySelector('span');
                if (!textSpan) {
                    return;
                }

                textSpan.style.setProperty('display', 'inline-block');
                textSpan.style.setProperty('transform-origin', 'left center');
                textSpan.style.setProperty('transform', 'scaleX(1)');

                let fontSize = baseFontSize;
                textSpan.style.setProperty('font-size', `${fontSize}px`, 'important');
                let textWidth = textSpan.getBoundingClientRect().width;
                let iterations = 0;

                while (textWidth > availableWidth && fontSize > minFontSize && iterations < 20) {
                    fontSize -= 1;
                    textSpan.style.setProperty('font-size', `${fontSize}px`, 'important');
                    textWidth = textSpan.getBoundingClientRect().width;
                    iterations += 1;
                }

                if (textWidth > availableWidth) {
                    const scaleX = Math.max(0.6, availableWidth / textWidth);
                    textSpan.style.setProperty('transform', `scaleX(${scaleX})`);
                }
            });

            // Reveal now that sizing is complete.
            displayElement.style.visibility = '';

            // Keep marginBottom in sync with the bar's actual rendered height.
            const h = displayElement.offsetHeight;
            if (h > 0) actionPanel.style.marginBottom = `${h}px`;
        });
    }

    /**
     * Toggle pin state for an action
     * @param {string} actionHrid - Action HRID to toggle
     * @param {HTMLElement} pinIcon - Pin icon element
     */
    async togglePin(actionHrid, pinIcon) {
        await actionPanelSort.togglePin(actionHrid);

        // Update icon appearance
        this.updatePinIcon(pinIcon, actionHrid);

        // Re-sort and re-filter panels
        await this.updateAllCounts();
    }

    /**
     * Update pin icon appearance based on pinned state
     * @param {HTMLElement} pinIcon - Pin icon element
     * @param {string} actionHrid - Action HRID
     */
    updatePinIcon(pinIcon, actionHrid) {
        const isPinned = actionPanelSort.isPinned(actionHrid);
        if (isPinned) {
            // Pinned: Full color, bright, larger
            pinIcon.style.filter = 'grayscale(0%) brightness(1.2) drop-shadow(0 0 3px rgba(255, 100, 0, 0.8))';
            pinIcon.style.transform = 'scale(1.1)';
        } else {
            // Unpinned: Grayscale, dimmed, normal size
            pinIcon.style.filter = 'grayscale(100%) brightness(0.7)';
            pinIcon.style.transform = 'scale(1)';
        }
        pinIcon.title = isPinned ? 'Unpin this action' : 'Pin this action to keep it visible';
    }

    /**
     * Clear all DOM references to prevent memory leaks during character switch
     */
    clearAllReferences() {
        // Clear profit calculation timeout
        if (this.profitCalcTimeout) {
            clearTimeout(this.profitCalcTimeout);
            this.profitCalcTimeout = null;
        }

        this.timerRegistry.clearAll();

        // CRITICAL: Remove injected DOM elements BEFORE clearing Maps
        // This prevents detached SVG elements from accumulating
        // Note: .remove() is safe to call even if element is already detached
        for (const [actionPanel, data] of this.actionElements.entries()) {
            if (data.displayElement) {
                data.displayElement.innerHTML = ''; // Clear innerHTML to break event listener references
                data.displayElement.remove();
                data.displayElement = null; // Null out reference for GC
            }
            if (data.pinElement) {
                data.pinElement.innerHTML = ''; // Clear innerHTML to break event listener references
                data.pinElement.remove();
                data.pinElement = null; // Null out reference for GC
            }
            actionPanel.style.marginBottom = '';
            actionPanel.style.overflow = '';
        }

        // Clear all action element references (prevents detached DOM memory leak)
        this.actionElements.clear();

        // Clear action name cache
        if (this.actionNameToHridCache) {
            this.actionNameToHridCache.clear();
            this.actionNameToHridCache = null;
        }

        // Clear shared sort manager's panel references
        actionPanelSort.clearAllPanels();
    }

    /**
     * Disable the max produceable display
     */
    disable() {
        // Clear debounce timers
        clearTimeout(this.itemsUpdatedDebounceTimer);
        clearTimeout(this.actionCompletedDebounceTimer);
        this.itemsUpdatedDebounceTimer = null;
        this.actionCompletedDebounceTimer = null;

        if (this.itemsUpdatedHandler) {
            dataManager.off('items_updated', this.itemsUpdatedHandler);
            this.itemsUpdatedHandler = null;
        }

        if (this.characterSwitchingHandler) {
            dataManager.off('character_switching', this.characterSwitchingHandler);
            this.characterSwitchingHandler = null;
        }

        // Clear all DOM references
        this.clearAllReferences();

        // Remove DOM observer
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }

        // Remove all injected elements
        document.querySelectorAll('.mwi-max-produceable').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-action-pin').forEach((el) => el.remove());
        this.actionElements.clear();

        this.isInitialized = false;
    }
}

const maxProduceable = new MaxProduceable();

export default maxProduceable;
