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
     * Add upgrade cost column next to native costs section
     * @param {Element} costsSection - The native HousePanel_costs element
     * @param {string} houseRoomHrid - House room HRID
     * @param {Element} modalContent - The modal content element
     */
    async addCostColumn(costsSection, houseRoomHrid, modalContent) {
        // Remove any existing wrapper first
        this.removeExistingColumn(modalContent);

        const currentLevel = houseCostCalculator.getCurrentRoomLevel(houseRoomHrid);

        // Don't show if already max level
        if (currentLevel >= 8) {
            return;
        }

        try {
            // Create a wrapper container for side-by-side layout
            const wrapper = document.createElement('div');
            wrapper.className = 'mwi-house-costs-wrapper';
            wrapper.style.cssText = `
                display: flex;
                flex-direction: row;
                gap: 20px;
                align-items: flex-start;
                width: 100%;
            `;

            // Replace the native costs section with our wrapper
            const parent = costsSection.parentElement;
            parent.replaceChild(wrapper, costsSection);

            // Add native costs section to wrapper (left side)
            wrapper.appendChild(costsSection);

            // Create and add our column (right side)
            const column = await this.createCostColumn(houseRoomHrid, currentLevel);
            wrapper.appendChild(column);

            // Mark this modal as processed
            this.currentModalContent = modalContent;

        } catch (error) {
            console.error('[House Cost Display] Failed to add cost column:', error);
        }
    }

    /**
     * Remove existing wrapper and restore native costs section
     * @param {Element} modalContent - The modal content element
     */
    removeExistingColumn(modalContent) {
        const existingWrapper = modalContent.querySelector('.mwi-house-costs-wrapper');
        if (existingWrapper) {
            // Find the native costs section inside the wrapper
            const nativeCosts = existingWrapper.querySelector('[class*="HousePanel_costs"]');

            if (nativeCosts) {
                // Move native costs back to where wrapper is
                existingWrapper.parentElement.replaceChild(nativeCosts, existingWrapper);
            } else {
                // Just remove the wrapper if we can't find native costs
                existingWrapper.remove();
            }
        }
    }

    /**
     * Create the cost column element
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current room level
     * @returns {Promise<HTMLElement>} Column element
     */
    async createCostColumn(houseRoomHrid, currentLevel) {
        const column = document.createElement('div');
        column.className = 'mwi-house-cost-column';
        column.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            font-weight: bold;
            font-size: 1rem;
            text-align: center;
            margin-bottom: 4px;
        `;
        header.textContent = 'Upgrade Cost';
        column.appendChild(header);

        // Current upgrade costs
        const currentSection = await this.createCurrentCostsList(houseRoomHrid, currentLevel);
        column.appendChild(currentSection);

        // Cumulative costs (if not upgrading to max)
        if (currentLevel < 7) {
            const separator = document.createElement('div');
            separator.style.cssText = `
                border-top: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
                margin: 8px 0;
                opacity: 0.3;
            `;
            column.appendChild(separator);

            const cumulativeSection = await this.createCumulativeSection(houseRoomHrid, currentLevel);
            column.appendChild(cumulativeSection);
        }

        return column;
    }

    /**
     * Create current upgrade costs list
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current room level
     * @returns {Promise<HTMLElement>} Section element
     */
    async createCurrentCostsList(houseRoomHrid, currentLevel) {
        const section = document.createElement('div');
        section.style.cssText = `
            font-size: 0.875rem;
        `;

        const nextLevel = currentLevel + 1;
        const costData = await houseCostCalculator.calculateLevelCost(houseRoomHrid, nextLevel);

        // Materials list
        const materialsList = this.createSimpleMaterialsList(costData);
        section.appendChild(materialsList);

        // Total value
        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = `
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            font-weight: bold;
            color: ${config.SCRIPT_COLOR_MAIN};
            text-align: center;
        `;
        totalDiv.textContent = `Total: ${numberFormatter(costData.totalValue)}`;
        section.appendChild(totalDiv);

        return section;
    }

    /**
     * Create cumulative cost section with dropdown
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current room level
     * @returns {Promise<HTMLElement>} Section element
     */
    async createCumulativeSection(houseRoomHrid, currentLevel) {
        const section = document.createElement('div');
        section.style.cssText = `
            font-size: 0.875rem;
        `;

        // Header with dropdown
        const headerContainer = document.createElement('div');
        headerContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 8px;
        `;

        const headerLabel = document.createElement('span');
        headerLabel.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
            font-weight: bold;
        `;
        headerLabel.textContent = 'To Level:';

        const dropdown = document.createElement('select');
        dropdown.style.cssText = `
            padding: 4px 8px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
            color: ${config.SCRIPT_COLOR_MAIN};
            border-radius: 4px;
            cursor: pointer;
        `;

        // Add options for levels current+2 to 8
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

        headerContainer.appendChild(headerLabel);
        headerContainer.appendChild(dropdown);
        section.appendChild(headerContainer);

        // Cost display container
        const costContainer = document.createElement('div');
        costContainer.className = 'mwi-cumulative-cost-container';
        section.appendChild(costContainer);

        // Initial render
        await this.updateCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));

        // Update on dropdown change
        dropdown.addEventListener('change', async () => {
            await this.updateCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));
        });

        return section;
    }

    /**
     * Update cumulative cost display
     * @param {Element} container - Container element
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current room level
     * @param {number} targetLevel - Target room level
     */
    async updateCumulativeDisplay(container, houseRoomHrid, currentLevel, targetLevel) {
        container.innerHTML = ''; // Clear previous content

        const costData = await houseCostCalculator.calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel);

        // Materials list
        const materialsList = this.createSimpleMaterialsList(costData);
        container.appendChild(materialsList);

        // Total value
        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = `
            margin-top: 8px;
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
     * Create simple materials list (compact format for column)
     * @param {Object} costData - Cost data object
     * @returns {HTMLElement} Materials list element
     */
    createSimpleMaterialsList(costData) {
        const list = document.createElement('div');
        list.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // Add coins first
        if (costData.coins > 0) {
            const coinItem = this.createSimpleMaterialItem({
                itemHrid: '/items/coin',
                count: costData.coins,
                marketPrice: 1,
                totalValue: costData.coins
            });
            list.appendChild(coinItem);
        }

        // Add all materials
        for (const material of costData.materials) {
            const materialItem = this.createSimpleMaterialItem(material);
            list.appendChild(materialItem);
        }

        return list;
    }

    /**
     * Create a simple material item row (compact for column)
     * @param {Object} material - Material data
     * @returns {HTMLElement} Material row element
     */
    createSimpleMaterialItem(material) {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 4px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.8125rem;
        `;

        const itemName = houseCostCalculator.getItemName(material.itemHrid);
        const inventoryCount = houseCostCalculator.getInventoryCount(material.itemHrid);
        const hasEnough = inventoryCount >= material.count;

        // First line: item name and count
        const nameRow = document.createElement('div');
        nameRow.style.cssText = `
            color: ${config.SCRIPT_COLOR_MAIN};
        `;
        nameRow.textContent = `${numberFormatter(material.count)} ${itemName}`;
        row.appendChild(nameRow);

        // Second line: market value and inventory
        const detailRow = document.createElement('div');
        detailRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
        `;

        // Market value (skip for coins)
        if (material.itemHrid !== '/items/coin') {
            const valueSpan = document.createElement('span');
            valueSpan.style.cssText = `
                color: ${config.SCRIPT_COLOR_SECONDARY};
            `;
            valueSpan.textContent = numberFormatter(material.totalValue);
            detailRow.appendChild(valueSpan);

            // Inventory status
            const inventorySpan = document.createElement('span');
            inventorySpan.style.cssText = `
                color: ${hasEnough ? '#4ade80' : '#f87171'};
            `;
            inventorySpan.textContent = hasEnough ? `✓ ${numberFormatter(inventoryCount)}` : `✗ ${numberFormatter(inventoryCount)}`;
            detailRow.appendChild(inventorySpan);

            row.appendChild(detailRow);
        }

        return row;
    }

    /**
     * Disable the feature
     */
    disable() {
        // Remove all wrappers and restore native sections
        document.querySelectorAll('.mwi-house-costs-wrapper').forEach(wrapper => {
            const nativeCosts = wrapper.querySelector('[class*="HousePanel_costs"]');
            if (nativeCosts && wrapper.parentElement) {
                wrapper.parentElement.replaceChild(nativeCosts, wrapper);
            } else {
                wrapper.remove();
            }
        });
        this.currentModalContent = null;
        this.isActive = false;
    }
}

// Create and export singleton instance
const houseCostDisplay = new HouseCostDisplay();

export default houseCostDisplay;
