/**
 * House Upgrade Cost Calculator
 * Calculates material and coin costs for house room upgrades
 */

import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { getItemPrice } from '../../utils/market-data.js';

class HouseCostCalculator {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize the calculator
     */
    async initialize() {
        if (this.isInitialized) return;

        // Ensure market data is loaded (check in-memory first to avoid storage reads)
        if (!marketAPI.isLoaded()) {
            await marketAPI.fetch();
        }

        this.isInitialized = true;
    }

    /**
     * Get current level of a house room
     * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
     * @returns {number} Current level (0-8)
     */
    getCurrentRoomLevel(houseRoomHrid) {
        return dataManager.getHouseRoomLevel(houseRoomHrid);
    }

    /**
     * Calculate cost for a single level upgrade
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} targetLevel - Target level (1-8)
     * @returns {Promise<Object>} Cost breakdown
     */
    async calculateLevelCost(houseRoomHrid, targetLevel) {
        const initData = dataManager.getInitClientData();
        if (!initData || !initData.houseRoomDetailMap) {
            throw new Error('Game data not loaded');
        }

        const roomData = initData.houseRoomDetailMap[houseRoomHrid];
        if (!roomData) {
            throw new Error(`House room not found: ${houseRoomHrid}`);
        }

        const upgradeCosts = roomData.upgradeCostsMap[targetLevel];
        if (!upgradeCosts) {
            throw new Error(`No upgrade costs for level ${targetLevel}`);
        }

        // Calculate costs
        let totalCoins = 0;
        const materials = [];

        for (const item of upgradeCosts) {
            if (item.itemHrid === '/items/coin') {
                totalCoins = item.count;
            } else {
                const marketPrice = await this.getItemMarketPrice(item.itemHrid);
                materials.push({
                    itemHrid: item.itemHrid,
                    count: item.count,
                    marketPrice: marketPrice,
                    totalValue: marketPrice * item.count,
                });
            }
        }

        const totalMaterialValue = materials.reduce((sum, m) => sum + m.totalValue, 0);

        return {
            level: targetLevel,
            coins: totalCoins,
            materials: materials,
            totalValue: totalCoins + totalMaterialValue,
        };
    }

    /**
     * Calculate cumulative cost from current level to target level
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current level
     * @param {number} targetLevel - Target level (currentLevel+1 to 8)
     * @returns {Promise<Object>} Aggregated costs
     */
    async calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel) {
        if (targetLevel <= currentLevel) {
            throw new Error('Target level must be greater than current level');
        }

        if (targetLevel > 8) {
            throw new Error('Maximum house level is 8');
        }

        let totalCoins = 0;
        const materialMap = new Map(); // itemHrid -> {itemHrid, count, marketPrice, totalValue}

        // Aggregate costs across all levels
        for (let level = currentLevel + 1; level <= targetLevel; level++) {
            const levelCost = await this.calculateLevelCost(houseRoomHrid, level);

            totalCoins += levelCost.coins;

            // Aggregate materials
            for (const material of levelCost.materials) {
                if (materialMap.has(material.itemHrid)) {
                    const existing = materialMap.get(material.itemHrid);
                    existing.count += material.count;
                    existing.totalValue += material.totalValue;
                } else {
                    materialMap.set(material.itemHrid, { ...material });
                }
            }
        }

        const materials = Array.from(materialMap.values());
        const totalMaterialValue = materials.reduce((sum, m) => sum + m.totalValue, 0);

        return {
            fromLevel: currentLevel,
            toLevel: targetLevel,
            coins: totalCoins,
            materials: materials,
            totalValue: totalCoins + totalMaterialValue,
        };
    }

    /**
     * Get market price for an item (uses 'ask' price for buying materials)
     * @param {string} itemHrid - Item HRID
     * @returns {Promise<number>} Market price
     */
    async getItemMarketPrice(itemHrid) {
        // Use 'ask' mode since house upgrades involve buying materials
        const price = getItemPrice(itemHrid, { mode: 'ask' });

        if (price === null || price === 0) {
            // Fallback to vendor price from game data
            const initData = dataManager.getInitClientData();
            const itemData = initData?.itemDetailMap?.[itemHrid];
            return itemData?.sellPrice || 0;
        }

        return price;
    }

    /**
     * Get player's inventory count for an item
     * @param {string} itemHrid - Item HRID
     * @returns {number} Item count in inventory
     */
    getInventoryCount(itemHrid) {
        const inventory = dataManager.getInventory();
        if (!inventory) return 0;

        const item = inventory.find((i) => i.itemHrid === itemHrid);
        return item ? item.count : 0;
    }

    /**
     * Get item name from game data
     * @param {string} itemHrid - Item HRID
     * @returns {string} Item name
     */
    getItemName(itemHrid) {
        if (itemHrid === '/items/coin') {
            return 'Gold';
        }

        const initData = dataManager.getInitClientData();
        const itemData = initData?.itemDetailMap?.[itemHrid];
        return itemData?.name || 'Unknown Item';
    }

    /**
     * Get house room name from game data
     * @param {string} houseRoomHrid - House room HRID
     * @returns {string} Room name
     */
    getRoomName(houseRoomHrid) {
        const initData = dataManager.getInitClientData();
        const roomData = initData?.houseRoomDetailMap?.[houseRoomHrid];
        return roomData?.name || 'Unknown Room';
    }
}

const houseCostCalculator = new HouseCostCalculator();

export default houseCostCalculator;
