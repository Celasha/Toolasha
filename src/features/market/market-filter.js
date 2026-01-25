/**
 * Market Filter
 * Adds filter dropdowns to marketplace to filter by level, class (skill requirement), and equipment slot
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';

class MarketFilter {
    constructor() {
        this.isActive = false;
        this.unregisterHandlers = [];
        this.isInitialized = false;

        // Filter state
        this.minLevel = 1;
        this.maxLevel = 1000;
        this.skillRequirement = 'all';
        this.equipmentSlot = 'all';

        // Filter container reference
        this.filterContainer = null;
    }

    /**
     * Initialize market filter
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            console.log('[MarketFilter] ⚠️ BLOCKED duplicate initialization (fix working!)');
            return;
        }

        if (!config.getSetting('marketFilter')) {
            return;
        }

        console.log('[MarketFilter] ✓ Initializing (first time)');
        this.isInitialized = true;

        // Register DOM observer for marketplace panel
        this.registerDOMObservers();

        this.isActive = true;
    }

    /**
     * Register DOM observers for marketplace panel
     */
    registerDOMObservers() {
        // Watch for marketplace panel appearing
        const unregister = domObserver.onClass(
            'market-filter-container',
            'MarketplacePanel_itemFilterContainer',
            (filterContainer) => {
                this.injectFilterUI(filterContainer);
            }
        );

        this.unregisterHandlers.push(unregister);

        // Watch for market items appearing/updating
        const unregisterItems = domObserver.onClass(
            'market-filter-items',
            'MarketplacePanel_marketItems',
            (marketItemsContainer) => {
                this.applyFilters();
            }
        );

        this.unregisterHandlers.push(unregisterItems);

        // Also check immediately in case marketplace is already open
        const existingFilterContainer = document.querySelector('div[class*="MarketplacePanel_itemFilterContainer"]');
        if (existingFilterContainer) {
            this.injectFilterUI(existingFilterContainer);
        }
    }

    /**
     * Inject filter UI into marketplace panel
     * @param {HTMLElement} oriFilterContainer - Original filter container
     */
    injectFilterUI(oriFilterContainer) {
        // Check if already injected
        if (document.querySelector('#toolasha-market-filters')) {
            return;
        }

        // Create filter container
        const filterDiv = document.createElement('div');
        filterDiv.id = 'toolasha-market-filters';
        filterDiv.style.cssText = 'display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;';

        // Add level range filters
        filterDiv.appendChild(this.createLevelFilter('min'));
        filterDiv.appendChild(this.createLevelFilter('max'));

        // Add class (skill requirement) filter
        filterDiv.appendChild(this.createClassFilter());

        // Add slot (equipment type) filter
        filterDiv.appendChild(this.createSlotFilter());

        // Insert after the original filter container
        oriFilterContainer.parentElement.insertBefore(filterDiv, oriFilterContainer.nextSibling);

        this.filterContainer = filterDiv;

        // Apply initial filters
        this.applyFilters();
    }

    /**
     * Create level filter dropdown
     * @param {string} type - 'min' or 'max'
     * @returns {HTMLElement} Filter element
     */
    createLevelFilter(type) {
        const container = document.createElement('span');
        container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

        const label = document.createElement('label');
        label.textContent = type === 'min' ? 'Level >= ' : 'Level < ';
        label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

        const select = document.createElement('select');
        select.id = `toolasha-level-${type}`;
        select.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

        // Level options
        const levels = type === 'min'
            ? [1, 10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100]
            : [10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100, 1000];

        levels.forEach(level => {
            const option = document.createElement('option');
            option.value = level;
            option.textContent = level === 1000 ? 'All' : level;
            if ((type === 'min' && level === 1) || (type === 'max' && level === 1000)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // Event listener
        select.addEventListener('change', () => {
            if (type === 'min') {
                this.minLevel = parseInt(select.value);
            } else {
                this.maxLevel = parseInt(select.value);
            }
            this.applyFilters();
        });

        container.appendChild(label);
        container.appendChild(select);
        return container;
    }

    /**
     * Create class (skill requirement) filter dropdown
     * @returns {HTMLElement} Filter element
     */
    createClassFilter() {
        const container = document.createElement('span');
        container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

        const label = document.createElement('label');
        label.textContent = 'Class: ';
        label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

        const select = document.createElement('select');
        select.id = 'toolasha-class-filter';
        select.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

        const classes = [
            { value: 'all', label: 'All' },
            { value: 'attack', label: 'Attack' },
            { value: 'melee', label: 'Melee' },
            { value: 'defense', label: 'Defense' },
            { value: 'ranged', label: 'Ranged' },
            { value: 'magic', label: 'Magic' },
            { value: 'others', label: 'Others' }
        ];

        classes.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls.value;
            option.textContent = cls.label;
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            this.skillRequirement = select.value;
            this.applyFilters();
        });

        container.appendChild(label);
        container.appendChild(select);
        return container;
    }

    /**
     * Create slot (equipment type) filter dropdown
     * @returns {HTMLElement} Filter element
     */
    createSlotFilter() {
        const container = document.createElement('span');
        container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

        const label = document.createElement('label');
        label.textContent = 'Slot: ';
        label.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.7);';

        const select = document.createElement('select');
        select.id = 'toolasha-slot-filter';
        select.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(91, 141, 239, 0.3);';

        const slots = [
            { value: 'all', label: 'All' },
            { value: 'main_hand', label: 'Main Hand' },
            { value: 'off_hand', label: 'Off Hand' },
            { value: 'two_hand', label: 'Two Hand' },
            { value: 'head', label: 'Head' },
            { value: 'body', label: 'Body' },
            { value: 'hands', label: 'Hands' },
            { value: 'legs', label: 'Legs' },
            { value: 'feet', label: 'Feet' },
            { value: 'neck', label: 'Neck' },
            { value: 'earrings', label: 'Earrings' },
            { value: 'ring', label: 'Ring' },
            { value: 'pouch', label: 'Pouch' },
            { value: 'back', label: 'Back' }
        ];

        slots.forEach(slot => {
            const option = document.createElement('option');
            option.value = slot.value;
            option.textContent = slot.label;
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            this.equipmentSlot = select.value;
            this.applyFilters();
        });

        container.appendChild(label);
        container.appendChild(select);
        return container;
    }

    /**
     * Apply filters to all market items
     */
    applyFilters() {
        const marketItemsContainer = document.querySelector('div[class*="MarketplacePanel_marketItems"]');
        if (!marketItemsContainer) {
            return;
        }

        // Get game data
        const gameData = dataManager.getInitClientData();
        if (!gameData || !gameData.itemDetailMap) {
            return;
        }

        // Find all item divs
        const itemDivs = marketItemsContainer.querySelectorAll('div[class*="Item_itemContainer"]');

        itemDivs.forEach(itemDiv => {
            // Get item HRID from SVG use element (same as MWI Tools)
            const useElement = itemDiv.querySelector('use');
            if (!useElement) {
                return;
            }

            const href = useElement.getAttribute('href');
            if (!href) {
                return;
            }

            // Extract HRID from href (e.g., #azure_sword -> /items/azure_sword)
            const hrefName = href.split('#')[1];
            if (!hrefName) {
                return;
            }

            const itemHrid = `/items/${hrefName}`;
            const itemData = gameData.itemDetailMap[itemHrid];

            if (!itemData) {
                itemDiv.style.display = '';
                return;
            }

            if (!itemData.equipmentDetail) {
                // Not equipment, hide if any non-"all" filter is active
                if (this.minLevel > 1 || this.maxLevel < 1000 || this.skillRequirement !== 'all' || this.equipmentSlot !== 'all') {
                    itemDiv.style.display = 'none';
                } else {
                    itemDiv.style.display = '';
                }
                return;
            }

            // Check if item passes all filters
            const passesFilters = this.checkItemFilters(itemData);
            itemDiv.style.display = passesFilters ? '' : 'none';
        });
    }

    /**
     * Check if item passes all current filters
     * @param {Object} itemData - Item data from game
     * @returns {boolean} True if item should be shown
     */
    checkItemFilters(itemData) {
        const itemLevel = itemData.itemLevel || 0;
        const equipmentDetail = itemData.equipmentDetail;

        // Level filter
        if (itemLevel < this.minLevel || itemLevel >= this.maxLevel) {
            return false;
        }

        // Slot filter
        if (this.equipmentSlot !== 'all') {
            const itemType = equipmentDetail.type || '';
            if (!itemType.includes(this.equipmentSlot)) {
                return false;
            }
        }

        // Class (skill requirement) filter
        if (this.skillRequirement !== 'all') {
            const levelRequirements = equipmentDetail.levelRequirements || [];

            if (this.skillRequirement === 'others') {
                // "Others" means non-combat skills
                const combatSkills = ['attack', 'melee', 'defense', 'ranged', 'magic'];
                const hasCombatReq = levelRequirements.some(req =>
                    combatSkills.some(skill => req.skillHrid.includes(skill))
                );
                if (hasCombatReq) {
                    return false;
                }
            } else {
                // Specific skill requirement
                const hasRequirement = levelRequirements.some(req =>
                    req.skillHrid.includes(this.skillRequirement)
                );
                if (!hasRequirement) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Cleanup on disable
     */
    disable() {
        this.unregisterHandlers.forEach(unregister => unregister());
        this.unregisterHandlers = [];

        // Remove filter UI
        if (this.filterContainer) {
            this.filterContainer.remove();
            this.filterContainer = null;
        }

        this.isActive = false;
        this.isInitialized = false;
    }
}

// Create and export singleton instance
const marketFilter = new MarketFilter();

export default marketFilter;
