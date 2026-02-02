/**
 * House Upgrade Cost Display
 * UI rendering for house upgrade costs
 */

import houseCostCalculator from './house-cost-calculator.js';
import config from '../../core/config.js';
import { coinFormatter, formatWithSeparator } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class HouseCostDisplay {
    constructor() {
        this.isActive = false;
        this.currentModalContent = null; // Track current modal to detect room switches
        this.isInitialized = false;
        this.currentMaterialsTabs = []; // Track marketplace tabs
        this.cleanupObserver = null; // Marketplace cleanup observer
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('houseUpgradeCosts', (value) => {
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
     * Initialize the display system
     */
    initialize() {
        if (!config.getSetting('houseUpgradeCosts')) {
            return;
        }

        this.isActive = true;
        this.isInitialized = true;
    }

    /**
     * Augment native costs section with market pricing
     * @param {Element} costsSection - The native HousePanel_costs element
     * @param {string} houseRoomHrid - House room HRID
     * @param {Element} modalContent - The modal content element
     */
    async addCostColumn(costsSection, houseRoomHrid, modalContent) {
        // Remove any existing augmentation first
        this.removeExistingColumn(modalContent);

        const currentLevel = houseCostCalculator.getCurrentRoomLevel(houseRoomHrid);

        // Don't show if already max level
        if (currentLevel >= 8) {
            return;
        }

        try {
            // Add "Cumulative to Level" section
            await this.addCompactToLevel(costsSection, houseRoomHrid, currentLevel);

            // Mark this modal as processed
            this.currentModalContent = modalContent;
        } catch {
            // Silently fail - augmentation is optional
        }
    }

    /**
     * Remove existing augmentations
     * @param {Element} modalContent - The modal content element
     */
    removeExistingColumn(modalContent) {
        // Remove all MWI-added elements
        modalContent
            .querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level')
            .forEach((el) => el.remove());

        // Restore original grid columns
        const itemRequirementsGrid = modalContent.querySelector('[class*="HousePanel_itemRequirements"]');
        if (itemRequirementsGrid) {
            itemRequirementsGrid.style.gridTemplateColumns = '';
        }
    }

    /**
     * Augment native cost items with market pricing
     * @param {Element} costsSection - Native costs section
     * @param {Object} costData - Cost data from calculator
     */
    async augmentNativeCosts(costsSection, costData) {
        // Find the item requirements grid container
        const itemRequirementsGrid = costsSection.querySelector('[class*="HousePanel_itemRequirements"]');
        if (!itemRequirementsGrid) {
            return;
        }

        // Modify the grid to accept 4 columns instead of 3
        // Native grid is: icon | inventory count | input count
        // We want: icon | inventory count | input count | pricing
        const currentGridStyle = window.getComputedStyle(itemRequirementsGrid).gridTemplateColumns;

        // Add a 4th column for pricing (auto width)
        itemRequirementsGrid.style.gridTemplateColumns = currentGridStyle + ' auto';

        // Find all item containers (these have the icons)
        const itemContainers = itemRequirementsGrid.querySelectorAll('[class*="Item_itemContainer"]');
        if (itemContainers.length === 0) {
            return;
        }

        for (const itemContainer of itemContainers) {
            // Game uses SVG sprites, not img tags
            const svg = itemContainer.querySelector('svg');
            if (!svg) continue;

            // Extract item name from href (e.g., #lumber -> lumber)
            const useElement = svg.querySelector('use');
            const hrefValue = useElement?.getAttribute('href') || '';
            const itemName = hrefValue.split('#')[1];
            if (!itemName) continue;

            // Convert to item HRID
            const itemHrid = `/items/${itemName}`;

            // Find matching material in costData
            let materialData;
            if (itemHrid === '/items/coin') {
                materialData = {
                    itemHrid: '/items/coin',
                    count: costData.coins,
                    marketPrice: 1,
                    totalValue: costData.coins,
                };
            } else {
                materialData = costData.materials.find((m) => m.itemHrid === itemHrid);
            }

            if (!materialData) continue;

            // Skip coins (no pricing needed)
            if (materialData.itemHrid === '/items/coin') {
                // Add empty cell to maintain grid structure
                this.addEmptyCell(itemRequirementsGrid, itemContainer);
                continue;
            }

            // Add pricing as a new grid cell to the right
            this.addPricingCell(itemRequirementsGrid, itemContainer, materialData);
        }
    }

    /**
     * Add empty cell for coins to maintain grid structure
     * @param {Element} grid - The requirements grid
     * @param {Element} itemContainer - The item icon container (badge)
     */
    addEmptyCell(grid, itemContainer) {
        const emptyCell = document.createElement('span');
        emptyCell.className = 'mwi-house-pricing-empty HousePanel_itemRequirementCell__3hSBN';

        // Insert immediately after the item badge
        itemContainer.after(emptyCell);
    }

    /**
     * Add pricing as a new grid cell to the right of the item
     * @param {Element} grid - The requirements grid
     * @param {Element} itemContainer - The item icon container (badge)
     * @param {Object} materialData - Material data with pricing
     */
    addPricingCell(grid, itemContainer, materialData) {
        // Check if already augmented
        const nextSibling = itemContainer.nextElementSibling;
        if (nextSibling?.classList.contains('mwi-house-pricing')) {
            return;
        }

        const inventoryCount = houseCostCalculator.getInventoryCount(materialData.itemHrid);
        const hasEnough = inventoryCount >= materialData.count;
        const amountNeeded = Math.max(0, materialData.count - inventoryCount);

        // Create pricing cell
        const pricingCell = document.createElement('span');
        pricingCell.className = 'mwi-house-pricing HousePanel_itemRequirementCell__3hSBN';
        pricingCell.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            font-size: 0.75rem;
            color: ${config.COLOR_ACCENT};
            padding-left: 8px;
            white-space: nowrap;
        `;

        pricingCell.innerHTML = `
            <span style="color: ${config.SCRIPT_COLOR_SECONDARY};">@ ${coinFormatter(materialData.marketPrice)}</span>
            <span style="color: ${config.COLOR_ACCENT}; font-weight: bold;">= ${coinFormatter(materialData.totalValue)}</span>
            <span style="color: ${hasEnough ? '#4ade80' : '#f87171'}; margin-left: auto; text-align: right;">${coinFormatter(amountNeeded)}</span>
        `;

        // Insert immediately after the item badge
        itemContainer.after(pricingCell);
    }

    /**
     * Add total cost below native costs section
     * @param {Element} costsSection - Native costs section
     * @param {Object} costData - Cost data
     */
    addTotalCost(costsSection, costData) {
        const totalDiv = document.createElement('div');
        totalDiv.className = 'mwi-house-total';
        totalDiv.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 2px solid ${config.COLOR_ACCENT};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.COLOR_ACCENT};
            text-align: center;
        `;
        totalDiv.textContent = `Total Market Value: ${coinFormatter(costData.totalValue)}`;
        costsSection.appendChild(totalDiv);
    }

    /**
     * Add compact "To Level" section
     * @param {Element} costsSection - Native costs section
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current level
     */
    async addCompactToLevel(costsSection, houseRoomHrid, currentLevel) {
        const section = document.createElement('div');
        section.className = 'mwi-house-to-level';
        section.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
        `;

        // Compact header with inline dropdown
        const headerRow = document.createElement('div');
        headerRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 8px;
        `;

        const label = document.createElement('span');
        label.style.cssText = `
            color: ${config.COLOR_ACCENT};
            font-weight: bold;
            font-size: 0.875rem;
        `;
        label.textContent = 'Cumulative to Level:';

        const dropdown = document.createElement('select');
        dropdown.style.cssText = `
            padding: 4px 8px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
            color: ${config.SCRIPT_COLOR_MAIN};
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.875rem;
        `;

        // Add options
        for (let level = currentLevel + 1; level <= 8; level++) {
            const option = document.createElement('option');
            option.value = level;
            option.textContent = level;
            dropdown.appendChild(option);
        }

        // Default to next level (currentLevel + 1)
        const defaultLevel = currentLevel + 1;
        dropdown.value = defaultLevel;

        headerRow.appendChild(label);
        headerRow.appendChild(dropdown);
        section.appendChild(headerRow);

        // Cost display container
        const costContainer = document.createElement('div');
        costContainer.className = 'mwi-cumulative-cost-container';
        costContainer.style.cssText = `
            font-size: 0.875rem;
            margin-top: 8px;
            text-align: left;
        `;
        section.appendChild(costContainer);

        // Initial render
        await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));

        // Update on change
        dropdown.addEventListener('change', async () => {
            await this.updateCompactCumulativeDisplay(
                costContainer,
                houseRoomHrid,
                currentLevel,
                parseInt(dropdown.value)
            );
        });

        costsSection.parentElement.appendChild(section);
    }

    /**
     * Update compact cumulative display
     * @param {Element} container - Container element
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current level
     * @param {number} targetLevel - Target level
     */
    async updateCompactCumulativeDisplay(container, houseRoomHrid, currentLevel, targetLevel) {
        container.innerHTML = '';

        const costData = await houseCostCalculator.calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel);

        // Materials list as vertical stack of single-line rows
        const materialsList = document.createElement('div');
        materialsList.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

        // Coins first
        if (costData.coins > 0) {
            this.appendMaterialRow(materialsList, {
                itemHrid: '/items/coin',
                count: costData.coins,
                totalValue: costData.coins,
            });
        }

        // Materials
        for (const material of costData.materials) {
            this.appendMaterialRow(materialsList, material);
        }

        container.appendChild(materialsList);

        // Total
        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 2px solid ${config.COLOR_ACCENT};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.COLOR_ACCENT};
            text-align: center;
        `;
        totalDiv.textContent = `Total Market Value: ${coinFormatter(costData.totalValue)}`;
        container.appendChild(totalDiv);

        // Add Missing Mats Marketplace button if any materials are missing
        const missingMaterials = this.getMissingMaterials(costData);
        if (missingMaterials.length > 0) {
            const button = this.createMissingMaterialsButton(missingMaterials);
            container.appendChild(button);
        }
    }

    /**
     * Append material row as single-line compact format
     * @param {Element} container - The container element
     * @param {Object} material - Material data
     */
    appendMaterialRow(container, material) {
        const itemName = houseCostCalculator.getItemName(material.itemHrid);
        const inventoryCount = houseCostCalculator.getInventoryCount(material.itemHrid);
        const hasEnough = inventoryCount >= material.count;
        const amountNeeded = Math.max(0, material.count - inventoryCount);
        const isCoin = material.itemHrid === '/items/coin';

        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.875rem;
            line-height: 1.4;
        `;

        // [inv / req] - left side
        const inventorySpan = document.createElement('span');
        inventorySpan.style.cssText = `
            color: ${hasEnough ? 'white' : '#f87171'};
            min-width: 120px;
            text-align: right;
        `;
        inventorySpan.textContent = `${coinFormatter(inventoryCount)} / ${coinFormatter(material.count)}`;
        row.appendChild(inventorySpan);

        // [Badge] Material Name
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `
            color: white;
            min-width: 140px;
        `;
        nameSpan.textContent = itemName;
        row.appendChild(nameSpan);

        // @ price = total (skip for coins)
        if (!isCoin) {
            const pricingSpan = document.createElement('span');
            pricingSpan.style.cssText = `
                color: ${config.COLOR_ACCENT};
                min-width: 180px;
            `;
            pricingSpan.textContent = `@ ${coinFormatter(material.marketPrice)} = ${coinFormatter(material.totalValue)}`;
            row.appendChild(pricingSpan);
        } else {
            // Empty spacer for coins
            const spacer = document.createElement('span');
            spacer.style.minWidth = '180px';
            row.appendChild(spacer);
        }

        // Missing: X - right side
        const missingSpan = document.createElement('span');
        missingSpan.style.cssText = `
            color: ${hasEnough ? '#4ade80' : '#f87171'};
            margin-left: auto;
            text-align: right;
        `;
        missingSpan.textContent = `Missing: ${coinFormatter(amountNeeded)}`;
        row.appendChild(missingSpan);

        container.appendChild(row);
    }

    /**
     * Get missing materials from cost data
     * @param {Object} costData - Cost data from calculator
     * @returns {Array} Array of missing materials in marketplace format
     */
    getMissingMaterials(costData) {
        const gameData = dataManager.getInitClientData();
        const inventory = dataManager.getInventory();
        const missing = [];

        // Process all materials (skip coins)
        for (const material of costData.materials) {
            const inventoryItem = inventory.find((i) => i.itemHrid === material.itemHrid);
            const have = inventoryItem?.count || 0;
            const missingAmount = Math.max(0, material.count - have);

            // Only include if missing > 0
            if (missingAmount > 0) {
                const itemDetails = gameData.itemDetailMap[material.itemHrid];
                if (itemDetails) {
                    missing.push({
                        itemHrid: material.itemHrid,
                        itemName: itemDetails.name,
                        missing: missingAmount,
                        isTradeable: itemDetails.isTradable === true,
                    });
                }
            }
        }

        return missing;
    }

    /**
     * Create missing materials marketplace button
     * @param {Array} missingMaterials - Array of missing material objects
     * @returns {HTMLElement} Button element
     */
    createMissingMaterialsButton(missingMaterials) {
        const button = document.createElement('button');
        button.style.cssText = `
            width: 100%;
            padding: 10px 16px;
            margin-top: 12px;
            background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
            color: #ffffff;
            border: 1px solid rgba(91, 141, 239, 0.4);
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        `;
        button.textContent = 'Missing Mats Marketplace';

        // Hover effects
        button.addEventListener('mouseenter', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
            button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
            button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        // Click handler
        button.addEventListener('click', async () => {
            await this.handleMissingMaterialsClick(missingMaterials);
        });

        return button;
    }

    /**
     * Handle missing materials button click
     * @param {Array} missingMaterials - Array of missing material objects
     */
    async handleMissingMaterialsClick(missingMaterials) {
        // Navigate to marketplace
        const success = await this.navigateToMarketplace();
        if (!success) {
            console.error('[HouseCostDisplay] Failed to navigate to marketplace');
            return;
        }

        // Wait for marketplace to settle
        await new Promise((resolve) => {
            const delayTimeout = setTimeout(resolve, 200);
            this.timerRegistry.registerTimeout(delayTimeout);
        });

        // Create custom tabs
        this.createMissingMaterialTabs(missingMaterials);

        // Setup cleanup observer if not already setup
        if (!this.cleanupObserver) {
            this.setupMarketplaceCleanupObserver();
        }
    }

    /**
     * Get game object via React fiber
     * @returns {Object|null} Game component instance
     */
    getGameObject() {
        const gamePageEl = document.querySelector('[class^="GamePage"]');
        if (!gamePageEl) return null;

        const fiberKey = Object.keys(gamePageEl).find((k) => k.startsWith('__reactFiber$'));
        if (!fiberKey) return null;

        return gamePageEl[fiberKey]?.return?.stateNode;
    }

    /**
     * Navigate to marketplace for a specific item
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level
     */
    goToMarketplace(itemHrid, enhancementLevel = 0) {
        const game = this.getGameObject();
        if (game?.handleGoToMarketplace) {
            game.handleGoToMarketplace(itemHrid, enhancementLevel);
        }
    }

    /**
     * Navigate to marketplace by clicking navbar
     * @returns {Promise<boolean>} True if successful
     */
    async navigateToMarketplace() {
        // Find marketplace navbar button
        const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
        const marketplaceButton = Array.from(navButtons).find((nav) => {
            const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
            return svg !== null;
        });

        if (!marketplaceButton) {
            console.error('[HouseCostDisplay] Marketplace navbar button not found');
            return false;
        }

        // Click button
        marketplaceButton.click();

        // Wait for marketplace to appear
        return await this.waitForMarketplace();
    }

    /**
     * Wait for marketplace panel to appear
     * @returns {Promise<boolean>} True if marketplace appeared
     */
    async waitForMarketplace() {
        const maxAttempts = 50;
        const delayMs = 100;

        for (let i = 0; i < maxAttempts; i++) {
            const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
            if (tabsContainer) {
                const hasMarketListings = Array.from(tabsContainer.children).some((btn) =>
                    btn.textContent.includes('Market Listings')
                );
                if (hasMarketListings) {
                    return true;
                }
            }

            await new Promise((resolve) => {
                const delayTimeout = setTimeout(resolve, delayMs);
                this.timerRegistry.registerTimeout(delayTimeout);
            });
        }

        console.error('[HouseCostDisplay] Marketplace did not open within timeout');
        return false;
    }

    /**
     * Create custom tabs for missing materials
     * @param {Array} missingMaterials - Array of missing material objects
     */
    createMissingMaterialTabs(missingMaterials) {
        const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
        if (!tabsContainer) {
            console.error('[HouseCostDisplay] Tabs container not found');
            return;
        }

        // Remove existing custom tabs
        this.removeMissingMaterialTabs();

        // Get reference tab
        const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));
        if (!referenceTab) {
            console.error('[HouseCostDisplay] Reference tab not found');
            return;
        }

        // Enable flex wrapping
        tabsContainer.style.flexWrap = 'wrap';

        // Create tab for each missing material
        this.currentMaterialsTabs = [];
        for (const material of missingMaterials) {
            const tab = this.createCustomTab(material, referenceTab);
            tabsContainer.appendChild(tab);
            this.currentMaterialsTabs.push(tab);
        }
    }

    /**
     * Create custom tab for a material
     * @param {Object} material - Material object
     * @param {HTMLElement} referenceTab - Reference tab to clone
     * @returns {HTMLElement} Custom tab element
     */
    createCustomTab(material, referenceTab) {
        const tab = referenceTab.cloneNode(true);

        // Mark as custom tab
        tab.setAttribute('data-mwi-custom-tab', 'true');
        tab.setAttribute('data-item-hrid', material.itemHrid);

        // Color coding
        const statusColor = material.isTradeable ? '#ef4444' : '#888888';
        const statusText = material.isTradeable ? `Missing: ${formatWithSeparator(material.missing)}` : 'Not Tradeable';

        // Update badge
        const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
        if (badgeSpan) {
            const titleCaseName = material.itemName
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            badgeSpan.innerHTML = `
                <div style="text-align: center;">
                    <div>${titleCaseName}</div>
                    <div style="font-size: 0.75em; color: ${statusColor};">
                        ${statusText}
                    </div>
                </div>
            `;
        }

        // Gray out if not tradeable
        if (!material.isTradeable) {
            tab.style.opacity = '0.5';
            tab.style.cursor = 'not-allowed';
        }

        // Remove selected state
        tab.classList.remove('Mui-selected');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');

        // Click handler
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!material.isTradeable) {
                return;
            }

            this.goToMarketplace(material.itemHrid, 0);
        });

        return tab;
    }

    /**
     * Remove all missing material tabs
     */
    removeMissingMaterialTabs() {
        const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
        customTabs.forEach((tab) => tab.remove());
        this.currentMaterialsTabs = [];
    }

    /**
     * Setup marketplace cleanup observer
     */
    setupMarketplaceCleanupObserver() {
        if (!document.body) {
            return;
        }

        this.cleanupObserver = createMutationWatcher(
            document.body,
            (mutations) => {
                for (const mutation of mutations) {
                    for (const removedNode of mutation.removedNodes) {
                        if (removedNode.nodeType === Node.ELEMENT_NODE) {
                            const hadTabsContainer = removedNode.querySelector(
                                '.MuiTabs-flexContainer[role="tablist"]'
                            );
                            if (hadTabsContainer) {
                                this.removeMissingMaterialTabs();
                                console.log('[HouseCostDisplay] Marketplace closed, cleaned up tabs');
                            }
                        }
                    }
                }
            },
            {
                childList: true,
                subtree: true,
            }
        );
    }

    /**
     * Refresh colors on existing displays
     */
    refresh() {
        // Update pricing cell colors
        document.querySelectorAll('.mwi-house-pricing').forEach((cell) => {
            cell.style.color = config.COLOR_ACCENT;
            const boldSpan = cell.querySelector('span[style*="font-weight: bold"]');
            if (boldSpan) {
                boldSpan.style.color = config.COLOR_ACCENT;
            }
        });

        // Update total cost colors
        document.querySelectorAll('.mwi-house-total').forEach((total) => {
            total.style.borderTopColor = config.COLOR_ACCENT;
            total.style.color = config.COLOR_ACCENT;
        });

        // Update "To Level" label colors
        document.querySelectorAll('.mwi-house-to-level span[style*="font-weight: bold"]').forEach((label) => {
            label.style.color = config.COLOR_ACCENT;
        });

        // Update cumulative total colors
        document.querySelectorAll('.mwi-cumulative-cost-container span[style*="font-weight: bold"]').forEach((span) => {
            span.style.color = config.COLOR_ACCENT;
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        // Remove all MWI-added elements
        document
            .querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level')
            .forEach((el) => el.remove());

        // Restore all grid columns
        document.querySelectorAll('[class*="HousePanel_itemRequirements"]').forEach((grid) => {
            grid.style.gridTemplateColumns = '';
        });

        // Clean up marketplace tabs and observer
        this.removeMissingMaterialTabs();
        if (this.cleanupObserver) {
            this.cleanupObserver();
            this.cleanupObserver = null;
        }

        this.timerRegistry.clearAll();

        this.currentModalContent = null;
        this.isActive = false;
        this.isInitialized = false;
    }
}

const houseCostDisplay = new HouseCostDisplay();
houseCostDisplay.setupSettingListener();

export default houseCostDisplay;
