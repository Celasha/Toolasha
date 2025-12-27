/**
 * House Upgrade Cost Display
 * UI rendering for house upgrade costs
 */

import houseCostCalculator from './house-cost-calculator.js';
import config from '../../core/config.js';
import { numberFormatter } from '../../utils/formatters.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';

class HouseCostDisplay {
    constructor() {
        this.isActive = false;
        this.currentModalContent = null; // Track current modal to detect room switches
    }

    /**
     * Initialize the display system
     */
    initialize() {
        if (!config.getSetting('houseUpgradeCosts')) {
            return;
        }

        this.isActive = true;
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
            const nextLevel = currentLevel + 1;
            const costData = await houseCostCalculator.calculateLevelCost(houseRoomHrid, nextLevel);

            // Augment each native cost item with market pricing
            await this.augmentNativeCosts(costsSection, costData);

            // Add total cost below native costs
            this.addTotalCost(costsSection, costData);

            // Add compact "To Level" section below
            if (currentLevel < 7) {
                await this.addCompactToLevel(costsSection, houseRoomHrid, currentLevel);
            }

            // Mark this modal as processed
            this.currentModalContent = modalContent;

        } catch (error) {
            console.error('[House Cost Display] Failed to augment costs:', error);
        }
    }

    /**
     * Remove existing augmentations
     * @param {Element} modalContent - The modal content element
     */
    removeExistingColumn(modalContent) {
        // Remove all MWI-added elements
        modalContent.querySelectorAll('.mwi-house-pricing, .mwi-house-total, .mwi-house-to-level').forEach(el => el.remove());
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
            console.warn('[House Cost Display] Could not find item requirements grid');
            return;
        }

        // Find all individual item requirement cells
        const costItems = itemRequirementsGrid.querySelectorAll('[class*="HousePanel_itemRequirementCell"]');
        if (costItems.length === 0) {
            console.warn('[House Cost Display] No item requirement cells found');
            return;
        }

        for (const costItem of costItems) {
            // Find item image to identify the item
            const img = costItem.querySelector('img');
            if (!img || !img.src) continue;

            // Extract item HRID from image src (e.g., /items/lumber)
            const itemHrid = this.extractItemHridFromImage(img.src);
            if (!itemHrid) continue;

            // Find matching material in costData
            let materialData;
            if (itemHrid === '/items/coin') {
                materialData = {
                    itemHrid: '/items/coin',
                    count: costData.coins,
                    marketPrice: 1,
                    totalValue: costData.coins
                };
            } else {
                materialData = costData.materials.find(m => m.itemHrid === itemHrid);
            }

            if (!materialData) continue;

            // Add pricing info to this item
            this.addPricingToItem(costItem, materialData);
        }
    }

    /**
     * Extract item HRID from image source
     * @param {string} imgSrc - Image source URL
     * @returns {string|null} Item HRID
     */
    extractItemHridFromImage(imgSrc) {
        // Image URLs are like: https://cdn.milkywayidle.com/items/lumber.png
        // or: /game_data/items/lumber.png
        const match = imgSrc.match(/\/items\/([^.]+)\.png/);
        if (match) {
            return `/items/${match[1]}`;
        }
        return null;
    }

    /**
     * Add pricing information to a native cost item
     * @param {Element} costItem - Native cost item element
     * @param {Object} materialData - Material data with pricing
     */
    addPricingToItem(costItem, materialData) {
        // Check if already augmented
        if (costItem.querySelector('.mwi-house-pricing')) return;

        const inventoryCount = houseCostCalculator.getInventoryCount(materialData.itemHrid);
        const hasEnough = inventoryCount >= materialData.count;

        // Create pricing info element
        const pricingDiv = document.createElement('div');
        pricingDiv.className = 'mwi-house-pricing';
        pricingDiv.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            display: flex;
            flex-direction: column;
            gap: 2px;
        `;

        // Skip price line for coins
        if (materialData.itemHrid !== '/items/coin') {
            // Price per item line
            const priceLine = document.createElement('div');
            priceLine.style.cssText = `color: ${config.SCRIPT_COLOR_SECONDARY};`;
            priceLine.textContent = `@ ${numberFormatter(materialData.marketPrice)} ea`;
            pricingDiv.appendChild(priceLine);

            // Total cost line
            const totalLine = document.createElement('div');
            totalLine.style.cssText = `color: ${config.SCRIPT_COLOR_MAIN};`;
            totalLine.textContent = `= ${numberFormatter(materialData.totalValue)}`;
            pricingDiv.appendChild(totalLine);

            // Inventory status line
            const inventoryLine = document.createElement('div');
            inventoryLine.style.cssText = `color: ${hasEnough ? '#4ade80' : '#f87171'};`;
            inventoryLine.textContent = hasEnough
                ? `✓ Have ${numberFormatter(inventoryCount)}`
                : `✗ Have ${numberFormatter(inventoryCount)}`;
            pricingDiv.appendChild(inventoryLine);
        }

        costItem.appendChild(pricingDiv);
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
            border-top: 2px solid ${config.SCRIPT_COLOR_MAIN};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.SCRIPT_COLOR_MAIN};
            text-align: center;
        `;
        totalDiv.textContent = `Total Market Value: ${numberFormatter(costData.totalValue)}`;
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
            margin-top: 16px;
            padding: 12px;
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
            color: ${config.SCRIPT_COLOR_MAIN};
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
        for (let level = currentLevel + 2; level <= 8; level++) {
            const option = document.createElement('option');
            option.value = level;
            option.textContent = level;
            dropdown.appendChild(option);
        }

        // Default to level 5 or max available
        const defaultLevel = Math.min(5, 8);
        if (defaultLevel > currentLevel + 1) {
            dropdown.value = defaultLevel;
        }

        headerRow.appendChild(label);
        headerRow.appendChild(dropdown);
        section.appendChild(headerRow);

        // Cost display
        const costContainer = document.createElement('div');
        costContainer.className = 'mwi-cumulative-cost-container';
        costContainer.style.cssText = `
            font-size: 0.8125rem;
        `;
        section.appendChild(costContainer);

        // Initial render
        await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));

        // Update on change
        dropdown.addEventListener('change', async () => {
            await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));
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

        // Compact material list - just names and totals
        const materialsList = document.createElement('div');
        materialsList.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
        `;

        // Coins first
        if (costData.coins > 0) {
            const coinRow = this.createCompactMaterialRow({
                itemHrid: '/items/coin',
                count: costData.coins,
                totalValue: costData.coins
            });
            materialsList.appendChild(coinRow);
        }

        // Materials
        for (const material of costData.materials) {
            const row = this.createCompactMaterialRow(material);
            materialsList.appendChild(row);
        }

        container.appendChild(materialsList);

        // Total
        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = `
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            font-weight: bold;
            color: ${config.SCRIPT_COLOR_MAIN};
            text-align: center;
        `;
        totalDiv.textContent = `Total: ${numberFormatter(costData.totalValue)}`;
        container.appendChild(totalDiv);
    }

    /**
     * Create compact material row
     * @param {Object} material - Material data
     * @returns {HTMLElement} Row element
     */
    createCompactMaterialRow(material) {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
        `;

        const itemName = houseCostCalculator.getItemName(material.itemHrid);
        const inventoryCount = houseCostCalculator.getInventoryCount(material.itemHrid);
        const hasEnough = inventoryCount >= material.count;

        // Left: item name and count
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `color: ${config.SCRIPT_COLOR_MAIN};`;
        nameSpan.textContent = `${numberFormatter(material.count)} ${itemName}`;

        // Right: value and inventory status
        const rightSpan = document.createElement('span');
        rightSpan.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            font-size: 0.75rem;
        `;

        if (material.itemHrid !== '/items/coin') {
            const valueSpan = document.createElement('span');
            valueSpan.style.cssText = `color: ${config.SCRIPT_COLOR_SECONDARY};`;
            valueSpan.textContent = numberFormatter(material.totalValue);
            rightSpan.appendChild(valueSpan);

            const invSpan = document.createElement('span');
            invSpan.style.cssText = `color: ${hasEnough ? '#4ade80' : '#f87171'};`;
            invSpan.textContent = hasEnough ? '✓' : '✗';
            rightSpan.appendChild(invSpan);
        }

        row.appendChild(nameSpan);
        row.appendChild(rightSpan);

        return row;
    }

    /**
     * Disable the feature
     */
    disable() {
        // Remove all MWI-added elements
        document.querySelectorAll('.mwi-house-pricing, .mwi-house-total, .mwi-house-to-level').forEach(el => el.remove());
        this.currentModalContent = null;
        this.isActive = false;
    }
}

// Create and export singleton instance
const houseCostDisplay = new HouseCostDisplay();

export default houseCostDisplay;
