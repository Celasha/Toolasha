/**
 * Philosopher's Stone Transmutation Calculator
 *
 * Calculates expected value and ROI for transmuting items into Philosopher's Stones.
 * Shows a sortable table of all items that can transmute into philos with live market data.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import storage from '../../core/storage.js';
import { formatLargeNumber, formatPercentage, timeReadable } from '../../utils/formatters.js';
import { getEnhancementMultiplier } from '../../utils/enhancement-multipliers.js';

const PHILO_HRID = '/items/philosophers_stone';
const PRIME_CATALYST_HRID = '/items/prime_catalyst';
const PRIME_CATALYST_ADDITIVE_BONUS = 0.25; // 25% additive boost
const TRANSMUTE_ACTION_TIME_SECONDS = 20;
const CATALYTIC_TEA_BUFF_TYPE = '/buff_types/alchemy_success';

class PhiloCalculator {
    constructor() {
        this.isInitialized = false;
        this.modal = null;
        this.sortColumn = 'cost';
        this.sortDirection = 'desc';

        // User-editable inputs
        this.philoPrice = 0;
        this.catalystPrice = 0;
        this.useCatalyst = true;
        this.useCatalyticTea = false;
        this.catalyticTeaRatioBoost = 0;
        this.drinkConcentrationLevel = 0; // 0-20
        this.hideNegativeProfitItems = true;
        this.filterText = '';

        // Cached row data
        this.rows = [];
    }

    /**
     * Initialize the feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_showPhiloCalculator')) {
            return;
        }

        this.isInitialized = true;
        this.addSettingsButton();
    }

    /**
     * Disable / cleanup the feature
     */
    disable() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        this.isInitialized = false;
    }

    /**
     * Add "Philo Gamba" button to settings panel
     */
    addSettingsButton() {
        const ensureButtonExists = () => {
            const settingsPanel = document.querySelector('[class*="SettingsPanel"]');
            if (!settingsPanel) return;

            if (settingsPanel.querySelector('.mwi-philo-calc-button')) {
                return;
            }

            const button = document.createElement('button');
            button.className = 'mwi-philo-calc-button';
            button.textContent = 'Philo Gamba';
            button.style.cssText = `
                margin: 10px;
                padding: 8px 16px;
                background: #4a90e2;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            `;

            button.addEventListener('mouseenter', () => {
                button.style.background = '#357abd';
            });

            button.addEventListener('mouseleave', () => {
                button.style.background = '#4a90e2';
            });

            button.addEventListener('click', () => {
                this.openModal();
            });

            // Insert after the market history button if it exists, otherwise at top
            const historyButton = settingsPanel.querySelector('.mwi-market-history-button');
            if (historyButton) {
                historyButton.after(button);
            } else {
                settingsPanel.insertBefore(button, settingsPanel.firstChild);
            }
        };

        const settingsUI = window.Toolasha?.UI?.settingsUI;
        if (settingsUI && typeof settingsUI.onSettingsPanelAppear === 'function') {
            settingsUI.onSettingsPanelAppear(ensureButtonExists);
        }

        ensureButtonExists();
    }

    /**
     * Get item name from game data
     * @param {string} itemHrid - Item HRID
     * @returns {string} Item name
     */
    getItemName(itemHrid) {
        const initData = dataManager.getInitClientData();
        const itemData = initData?.itemDetailMap?.[itemHrid];
        return itemData?.name || itemHrid.replace('/items/', '').replaceAll('_', ' ');
    }

    /**
     * Load default prices from market data
     */
    loadDefaultPrices() {
        const philoPriceData = marketAPI.getPrice(PHILO_HRID, 0);
        this.philoPrice = philoPriceData?.bid || 0;

        const catalystPriceData = marketAPI.getPrice(PRIME_CATALYST_HRID, 0);
        this.catalystPrice = catalystPriceData?.ask || 0;
    }

    /**
     * Calculate catalytic tea base bonus from game data (item definition)
     * @returns {number} Base ratioBoost from item definition
     */
    calculateCatalyticTeaRatioBoost() {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData?.itemDetailMap) return 0;

            const teaItem = gameData.itemDetailMap['/items/catalytic_tea'];
            if (!teaItem?.consumableDetail?.buffs) return 0;

            // Find alchemy success buff
            for (const buff of teaItem.consumableDetail.buffs) {
                if (buff.typeHrid === CATALYTIC_TEA_BUFF_TYPE) {
                    return buff.ratioBoost || 0;
                }
            }

            return 0;
        } catch (error) {
            console.error('[PhiloCalculator] Failed to calculate catalytic tea ratio boost:', error);
            return 0;
        }
    }

    /**
     * Load settings from storage
     */
    async loadSettings() {
        try {
            const saved = await storage.getJSON('philoCalculatorSettings', 'settings', null);
            if (saved) {
                this.useCatalyst = saved.useCatalyst !== false;
                this.useCatalyticTea = saved.useCatalyticTea || false;
                this.drinkConcentrationLevel = saved.drinkConcentrationLevel || 0;
                this.hideNegativeProfitItems = saved.hideNegativeProfitItems !== false;
                this.filterText = saved.filterText || '';
            }
        } catch (error) {
            console.error('[PhiloCalculator] Failed to load settings:', error);
        }
    }

    /**
     * Save settings to storage
     */
    async saveSettings() {
        try {
            await storage.setJSON(
                'philoCalculatorSettings',
                {
                    useCatalyst: this.useCatalyst,
                    useCatalyticTea: this.useCatalyticTea,
                    drinkConcentrationLevel: this.drinkConcentrationLevel,
                    hideNegativeProfitItems: this.hideNegativeProfitItems,
                    filterText: this.filterText,
                },
                'settings',
                true
            );
        } catch (error) {
            console.error('[PhiloCalculator] Failed to save settings:', error);
        }
    }

    /**
     * Get drink concentration for a given enhancement level
     * @param {number} enhancementLevel - Enhancement level (0-20)
     * @returns {number} Drink concentration as decimal (e.g., 0.1032 for 10.32%)
     */
    getDrinkConcentrationForLevel(enhancementLevel) {
        try {
            const gameData = dataManager.getInitClientData();
            const equipment = dataManager.getEquipment();
            if (!equipment || !gameData?.itemDetailMap) return 0;

            let totalConcentration = 0;
            const baseConcentrationByLevel = new Map();

            // Scan equipment for drink concentration items and their base values
            for (const [_slotHrid, equippedItem] of equipment) {
                const itemDetails = gameData.itemDetailMap[equippedItem.itemHrid];
                if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;

                const baseConcentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
                baseConcentrationByLevel.set(equippedItem.itemHrid, baseConcentration);
            }

            // If we have drink concentration items, apply the requested enhancement level
            for (const [itemHrid, baseConcentration] of baseConcentrationByLevel) {
                const itemDetails = gameData.itemDetailMap[itemHrid];
                const multiplier = getEnhancementMultiplier(itemDetails, enhancementLevel);
                totalConcentration += baseConcentration * multiplier;
            }

            return totalConcentration;
        } catch (error) {
            console.error('[PhiloCalculator] Failed to get drink concentration:', error);
            return 0;
        }
    }

    /**
     * Scan itemDetailMap for all items that can transmute into Philosopher's Stone
     * @returns {Array} Array of { itemHrid, itemDetails } objects
     */
    findPhiloTransmuteItems() {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return [];

        const results = [];

        for (const [itemHrid, itemDetails] of Object.entries(gameData.itemDetailMap)) {
            const alchemy = itemDetails?.alchemyDetail;
            if (!alchemy?.transmuteDropTable || !alchemy.transmuteSuccessRate) continue;

            const hasPhilo = alchemy.transmuteDropTable.some((drop) => drop.itemHrid === PHILO_HRID);
            if (hasPhilo) {
                results.push({ itemHrid, itemDetails });
            }
        }

        return results;
    }

    /**
     * Calculate all columns for a single item
     * @param {string} itemHrid - Item HRID
     * @param {Object} itemDetails - Item detail object
     * @returns {Object|null} Row data or null if price unavailable
     */
    calculateRow(itemHrid, itemDetails) {
        const alchemy = itemDetails.alchemyDetail;
        const baseTransmuteRate = alchemy.transmuteSuccessRate;

        // Calculate additive bonuses
        let totalBonus = 0;

        // Catalytic tea bonus
        if (this.useCatalyticTea && this.catalyticTeaRatioBoost > 0) {
            const drinkConcentration = this.getDrinkConcentrationForLevel(this.drinkConcentrationLevel);
            totalBonus += this.catalyticTeaRatioBoost * (1 + drinkConcentration);
        }

        // Prime catalyst bonus (additive, not multiplicative)
        if (this.useCatalyst) {
            totalBonus += PRIME_CATALYST_ADDITIVE_BONUS;
        }

        const successRate = Math.min(1.0, baseTransmuteRate * (1 + totalBonus));
        const bulkMultiplier = alchemy.bulkMultiplier || 1;

        // Find philo drop rate
        const philoDrop = alchemy.transmuteDropTable.find((d) => d.itemHrid === PHILO_HRID);
        if (!philoDrop) return null;

        const philoDropRate = philoDrop.dropRate;
        const philoChance = successRate * philoDropRate;

        // Get item cost (market ask price)
        const priceData = marketAPI.getPrice(itemHrid, 0);
        const itemCost = priceData?.ask;
        if (itemCost === null || itemCost === undefined) return null;

        // Catalyst cost per action (consumed only on success)
        const catalystCostPerAction = this.useCatalyst ? successRate * this.catalystPrice : 0;

        // Transmute coin cost from game data
        const gameData = dataManager.getInitClientData();
        const transmuteAction = gameData?.actionDetailMap?.['/actions/alchemy/transmute'];
        const coinCost = transmuteAction?.coinCost || 0;

        // Total cost per transmute action
        const totalCostPerAction = itemCost * bulkMultiplier + catalystCostPerAction + coinCost;

        // Calculate EV of all drops (including philo)
        let evPerAction = 0;
        for (const drop of alchemy.transmuteDropTable) {
            let dropValue;
            if (drop.itemHrid === PHILO_HRID) {
                dropValue = this.philoPrice;
            } else {
                const dropPrice = marketAPI.getPrice(drop.itemHrid, 0);
                dropValue = dropPrice?.bid;
                if (dropValue === null || dropValue === undefined) continue;
            }

            const avgCount = (drop.minCount + drop.maxCount) / 2;
            evPerAction += successRate * drop.dropRate * avgCount * dropValue;
        }

        // Profit per action (EV now includes philo value)
        const profitPerAction = evPerAction - totalCostPerAction;

        // Actions and items needed per philo
        const actionsPerPhilo = 1 / philoChance;

        // Net items consumed per action (input minus expected self-returns)
        const selfDrop = alchemy.transmuteDropTable.find((d) => d.itemHrid === itemHrid);
        const selfDropRate = selfDrop ? selfDrop.dropRate : 0;
        const avgSelfCount = selfDrop ? (selfDrop.minCount + selfDrop.maxCount) / 2 : 0;
        const returnChance = successRate * selfDropRate;
        const itemsPerAction = bulkMultiplier - returnChance * avgSelfCount;

        // Items needed per philo (net items consumed × actions needed)
        const itemsPerPhilo = actionsPerPhilo * itemsPerAction;

        // Profit per philo obtained
        const profitPerPhilo = profitPerAction * actionsPerPhilo;

        // Profit margin
        const profitMargin = profitPerAction / totalCostPerAction;

        // Time per philo
        const timePerPhiloSeconds = actionsPerPhilo * TRANSMUTE_ACTION_TIME_SECONDS;

        // Profit per hour
        const actionsPerHour = 3600 / TRANSMUTE_ACTION_TIME_SECONDS;
        const profitPerHour = profitPerAction * actionsPerHour;

        // Revenue and cost per hour
        const revenuePerHour = evPerAction * actionsPerHour;
        const costPerHour = totalCostPerAction * actionsPerHour;

        return {
            itemHrid,
            name: this.getItemName(itemHrid),
            cost: itemCost,
            philoChance,
            returnChance,
            transmuteChance: baseTransmuteRate,
            effectiveTransmuteChance: successRate,
            transmuteCost: totalCostPerAction,
            ev: evPerAction,
            itemsPerAction,
            actionsPerPhilo,
            itemsPerPhilo,
            profitPerPhilo,
            profitMargin,
            timePerPhiloSeconds,
            profitPerHour,
            revenuePerHour,
            costPerHour,
        };
    }

    /**
     * Calculate all rows
     */
    calculateAllRows() {
        const items = this.findPhiloTransmuteItems();
        this.rows = [];

        for (const { itemHrid, itemDetails } of items) {
            const row = this.calculateRow(itemHrid, itemDetails);
            if (row) {
                this.rows.push(row);
            }
        }

        this.sortRows();
    }

    /**
     * Sort rows by current sort column and direction
     */
    sortRows() {
        const col = this.sortColumn;
        const dir = this.sortDirection === 'asc' ? 1 : -1;

        this.rows.sort((a, b) => {
            const aVal = a[col];
            const bVal = b[col];

            if (typeof aVal === 'string') {
                return dir * aVal.localeCompare(bVal);
            }
            return dir * (aVal - bVal);
        });
    }

    /**
     * Handle column header click for sorting
     * @param {string} column - Column key to sort by
     */
    toggleSort(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'desc';
        }
        this.sortRows();
        this.renderTable();
    }

    /**
     * Open the calculator modal
     */
    async openModal() {
        if (this.modal) {
            this.modal.remove();
        }

        // Load saved settings first
        await this.loadSettings();

        this.loadDefaultPrices();
        this.catalyticTeaRatioBoost = this.calculateCatalyticTeaRatioBoost();

        // Set default drink concentration level (only if not previously saved)
        if (this.drinkConcentrationLevel === 0) {
            let currentDrinkEnhancementLevel = 0;
            const gameData = dataManager.getInitClientData();
            const equipment = dataManager.getEquipment();
            if (equipment && gameData?.itemDetailMap) {
                for (const [_slotHrid, equippedItem] of equipment) {
                    const itemDetails = gameData.itemDetailMap[equippedItem.itemHrid];
                    if (itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) {
                        currentDrinkEnhancementLevel = equippedItem.enhancementLevel || 0;
                        break;
                    }
                }
            }
            this.drinkConcentrationLevel = currentDrinkEnhancementLevel;
        }

        this.calculateAllRows();

        this.modal = document.createElement('div');
        this.modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #2a2a2a;
            color: #ffffff;
            border-radius: 8px;
            width: 95%;
            max-width: 1200px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #444;
        `;
        header.innerHTML = `
            <span style="font-size: 18px; font-weight: bold;">Philosopher's Stone Calculator</span>
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #fff;
            font-size: 24px;
            cursor: pointer;
            padding: 0 4px;
        `;
        closeBtn.addEventListener('click', () => {
            this.modal.remove();
            this.modal = null;
        });
        header.appendChild(closeBtn);

        // Controls
        const controls = this.createControls();

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'philo-calc-table-container';
        tableContainer.style.cssText = `
            overflow: auto;
            flex: 1;
            padding: 0 20px 20px;
        `;

        dialog.appendChild(header);
        dialog.appendChild(controls);
        dialog.appendChild(tableContainer);
        this.modal.appendChild(dialog);

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.modal.remove();
                this.modal = null;
            }
        });

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.modal) {
                this.modal.remove();
                this.modal = null;
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(this.modal);
        this.renderTable();
    }

    /**
     * Create the input controls section (philo price, catalyst price, checkbox)
     * @returns {HTMLElement} Controls container
     */
    createControls() {
        const container = document.createElement('div');
        container.style.cssText = `
            padding: 12px 20px;
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
            border-bottom: 1px solid #444;
        `;

        // Philo price input
        const philoLabel = document.createElement('label');
        philoLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
        philoLabel.textContent = 'Philo Price: ';
        const philoInput = document.createElement('input');
        philoInput.type = 'text';
        philoInput.value = this.philoPrice.toLocaleString();
        philoInput.style.cssText = `
            width: 130px;
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;
        philoInput.addEventListener('change', () => {
            const parsed = parseInt(philoInput.value.replaceAll(',', '').replaceAll('.', ''), 10);
            if (!isNaN(parsed)) {
                this.philoPrice = parsed;
                this.recalculate();
            }
        });
        philoLabel.appendChild(philoInput);

        // Catalyst price input
        const catLabel = document.createElement('label');
        catLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
        catLabel.textContent = 'Catalyst Price: ';
        const catInput = document.createElement('input');
        catInput.type = 'text';
        catInput.value = this.catalystPrice.toLocaleString();
        catInput.style.cssText = `
            width: 130px;
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;
        catInput.addEventListener('change', () => {
            const parsed = parseInt(catInput.value.replaceAll(',', '').replaceAll('.', ''), 10);
            if (!isNaN(parsed)) {
                this.catalystPrice = parsed;
                this.recalculate();
            }
        });
        catLabel.appendChild(catInput);

        // Use catalyst checkbox
        const checkLabel = document.createElement('label');
        checkLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.useCatalyst;
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => {
            this.useCatalyst = checkbox.checked;
            this.recalculate();
            this.saveSettings();
        });
        checkLabel.appendChild(checkbox);
        checkLabel.appendChild(document.createTextNode('Use Prime Catalyst'));

        container.appendChild(philoLabel);
        container.appendChild(catLabel);
        container.appendChild(checkLabel);

        // Catalytic Tea checkbox
        const teaCheckLabel = document.createElement('label');
        teaCheckLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;';
        const teaCheckbox = document.createElement('input');
        teaCheckbox.type = 'checkbox';
        teaCheckbox.checked = this.useCatalyticTea;
        teaCheckbox.style.cursor = 'pointer';
        teaCheckbox.addEventListener('change', () => {
            this.useCatalyticTea = teaCheckbox.checked;
            this.recalculate();
            this.saveSettings();
        });
        teaCheckLabel.appendChild(teaCheckbox);

        // Display base ratioBoost if available
        const boostText =
            this.catalyticTeaRatioBoost > 0
                ? ` (${formatPercentage(this.catalyticTeaRatioBoost, 1)})`
                : ' (unavailable)';
        teaCheckLabel.appendChild(document.createTextNode(`Catalytic Tea${boostText}`));
        container.appendChild(teaCheckLabel);

        // Drink Concentration Dropdown
        const drinkLabel = document.createElement('label');
        drinkLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
        drinkLabel.textContent = 'Drink Concentration: ';
        const drinkSelect = document.createElement('select');
        drinkSelect.style.cssText = `
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;

        // Populate dropdown with enhancement levels +0 through +20
        for (let level = 0; level <= 20; level++) {
            const concentration = this.getDrinkConcentrationForLevel(level);
            const option = document.createElement('option');
            option.value = level;
            option.textContent = `+${level} (${formatPercentage(concentration, 2)})`;
            if (level === this.drinkConcentrationLevel) {
                option.selected = true;
            }
            drinkSelect.appendChild(option);
        }

        drinkSelect.addEventListener('change', () => {
            this.drinkConcentrationLevel = parseInt(drinkSelect.value, 10);
            this.recalculate();
            this.saveSettings();
        });
        drinkLabel.appendChild(drinkSelect);
        container.appendChild(drinkLabel);

        // Hide negative profit checkbox
        const hideNegCheckLabel = document.createElement('label');
        hideNegCheckLabel.style.cssText =
            'display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;';
        const hideNegCheckbox = document.createElement('input');
        hideNegCheckbox.type = 'checkbox';
        hideNegCheckbox.checked = this.hideNegativeProfitItems;
        hideNegCheckbox.style.cursor = 'pointer';
        hideNegCheckbox.addEventListener('change', () => {
            this.hideNegativeProfitItems = hideNegCheckbox.checked;
            this.renderTable();
            this.saveSettings();
        });
        hideNegCheckLabel.appendChild(hideNegCheckbox);
        hideNegCheckLabel.appendChild(document.createTextNode('Hide Negative Profit'));
        container.appendChild(hideNegCheckLabel);

        // Filter label
        const filterLabel = document.createElement('label');
        filterLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 13px;';
        filterLabel.textContent = 'Filter: ';
        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.placeholder = 'Item name...';
        filterInput.value = this.filterText;
        filterInput.style.cssText = `
            width: 140px;
            padding: 4px 8px;
            background: #1a1a1a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 13px;
        `;
        filterInput.addEventListener('input', () => {
            this.filterText = filterInput.value;
            this.renderTable();
            this.saveSettings();
        });
        filterLabel.appendChild(filterInput);
        container.appendChild(filterLabel);

        // Refresh prices button
        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Refresh Prices';
        refreshBtn.style.cssText = `
            padding: 4px 12px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        `;
        refreshBtn.addEventListener('mouseenter', () => {
            refreshBtn.style.background = '#357abd';
        });
        refreshBtn.addEventListener('mouseleave', () => {
            refreshBtn.style.background = '#4a90e2';
        });
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
            refreshBtn.style.opacity = '0.6';
            try {
                await marketAPI.fetch(true);
                this.loadDefaultPrices();
                // Update the price inputs to reflect new data
                const inputs = container.querySelectorAll('input[type="text"]');
                if (inputs[0]) inputs[0].value = this.philoPrice.toLocaleString();
                if (inputs[1]) inputs[1].value = this.catalystPrice.toLocaleString();
                this.recalculate();
            } catch (error) {
                console.error('[PhiloCalculator] Failed to refresh prices:', error);
            }
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh Prices';
            refreshBtn.style.opacity = '1';
        });
        container.appendChild(refreshBtn);

        return container;
    }

    /**
     * Recalculate all rows and re-render
     */
    recalculate() {
        this.calculateAllRows();
        this.renderTable();
    }

    /**
     * Render the results table
     */
    renderTable() {
        const container = this.modal?.querySelector('.philo-calc-table-container');
        if (!container) return;

        const columns = [
            { key: 'name', label: 'Item', align: 'left' },
            { key: 'cost', label: 'Cost' },
            { key: 'philoChance', label: 'Philo %' },
            { key: 'returnChance', label: 'Return %' },
            { key: 'transmuteChance', label: 'Base Xmute %' },
            { key: 'effectiveTransmuteChance', label: 'Eff. Xmute %' },
            { key: 'transmuteCost', label: 'Xmute Cost' },
            { key: 'ev', label: 'EV' },
            { key: 'itemsPerAction', label: 'Items/Act' },
            { key: 'actionsPerPhilo', label: 'Acts/Philo' },
            { key: 'itemsPerPhilo', label: 'Items/Philo' },
            { key: 'profitPerPhilo', label: 'Profit/Philo' },
            { key: 'profitMargin', label: 'Margin' },
            { key: 'timePerPhiloSeconds', label: 'Time/Philo' },
            { key: 'profitPerHour', label: 'Profit/Hr' },
            { key: 'revenuePerHour', label: 'Revenue/Hr' },
            { key: 'costPerHour', label: 'Cost/Hr' },
        ];

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        `;

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        for (const col of columns) {
            const th = document.createElement('th');
            th.style.cssText = `
                padding: 8px 6px;
                text-align: ${col.align || 'right'};
                border-bottom: 2px solid #555;
                cursor: pointer;
                user-select: none;
                white-space: nowrap;
                position: sticky;
                top: 0;
                background: #2a2a2a;
                z-index: 1;
            `;

            const arrow = this.sortColumn === col.key ? (this.sortDirection === 'asc' ? ' \u25B2' : ' \u25BC') : '';
            th.textContent = col.label + arrow;

            th.addEventListener('click', () => this.toggleSort(col.key));
            headerRow.appendChild(th);
        }

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');

        // Apply item name filter
        const filterLower = this.filterText.toLowerCase();
        let filteredRows = filterLower
            ? this.rows.filter((row) => row.name.toLowerCase().includes(filterLower))
            : this.rows;

        // Apply negative profit filter
        if (this.hideNegativeProfitItems) {
            filteredRows = filteredRows.filter((row) => row.profitPerPhilo >= 0);
        }

        for (let i = 0; i < filteredRows.length; i++) {
            const row = filteredRows[i];
            const tr = document.createElement('tr');
            const bgColor = i % 2 === 0 ? '#2a2a2a' : '#252525';
            tr.style.cssText = `background: ${bgColor};`;

            for (const col of columns) {
                const td = document.createElement('td');
                td.style.cssText = `
                    padding: 6px;
                    text-align: ${col.align || 'right'};
                    white-space: nowrap;
                `;

                const value = row[col.key];

                // Format based on column type
                switch (col.key) {
                    case 'name':
                        td.textContent = value;
                        break;
                    case 'philoChance':
                    case 'returnChance':
                    case 'transmuteChance':
                    case 'effectiveTransmuteChance':
                        td.textContent = formatPercentage(value, 2);
                        break;
                    case 'profitMargin':
                        td.textContent = formatPercentage(value, 1);
                        td.style.color = value >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                        break;
                    case 'timePerPhiloSeconds':
                        td.textContent = timeReadable(value);
                        break;
                    case 'profitPerPhilo':
                    case 'profitPerHour':
                        td.textContent = formatLargeNumber(Math.round(value));
                        td.style.color = value >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                        break;
                    case 'revenuePerHour':
                    case 'costPerHour':
                        td.textContent = formatLargeNumber(Math.round(value));
                        break;
                    case 'actionsPerPhilo':
                    case 'itemsPerPhilo':
                        td.textContent = formatLargeNumber(Math.round(value));
                        break;
                    case 'itemsPerAction':
                        td.textContent = value.toFixed(2);
                        break;
                    default:
                        td.textContent = formatLargeNumber(Math.round(value));
                        break;
                }

                tr.appendChild(td);
            }

            tbody.appendChild(tr);
        }

        table.appendChild(tbody);

        container.innerHTML = '';
        container.appendChild(table);
    }
}

const philoCalculator = new PhiloCalculator();
export default philoCalculator;
