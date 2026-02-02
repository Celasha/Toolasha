/**
 * Market History Viewer Module
 *
 * Displays a comprehensive table of all market listings with:
 * - Sortable columns
 * - Search/filter functionality
 * - Pagination with user-configurable rows per page
 * - CSV export
 * - Summary statistics
 */

import storage from '../../core/storage.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { formatWithSeparator, formatKMB } from '../../utils/formatters.js';
import settingsUI from '../settings/settings-ui.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class MarketHistoryViewer {
    constructor() {
        this.isInitialized = false;
        this.modal = null;
        this.listings = [];
        this.filteredListings = [];
        this.currentPage = 1;
        this.rowsPerPage = 50;
        this.showAll = false;
        this.sortColumn = 'createdTimestamp';
        this.sortDirection = 'desc'; // Most recent first
        this.searchTerm = '';
        this.typeFilter = 'all'; // 'all', 'buy', 'sell'
        this.useKMBFormat = false; // K/M/B formatting toggle
        this.storageKey = 'marketListingTimestamps';
        this.timerRegistry = createTimerRegistry();

        // Column filters
        this.filters = {
            dateFrom: null, // Date object or null
            dateTo: null, // Date object or null
            selectedItems: [], // Array of itemHrids
            selectedEnhLevels: [], // Array of enhancement levels (numbers)
            selectedTypes: [], // Array of 'buy' and/or 'sell'
        };
        this.activeFilterPopup = null; // Track currently open filter popup
        this.popupCloseHandler = null; // Track the close handler to clean it up properly
    }

    /**
     * Initialize the feature
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('market_showHistoryViewer')) {
            return;
        }

        this.isInitialized = true;

        // Load K/M/B format preference
        this.useKMBFormat = await storage.get('marketHistoryKMBFormat', 'settings', false);

        // Load saved filters
        await this.loadFilters();

        // Add button to settings panel
        this.addSettingsButton();
    }

    /**
     * Load saved filters from storage
     */
    async loadFilters() {
        try {
            const savedFilters = await storage.getJSON('marketHistoryFilters', 'settings', null);
            if (savedFilters) {
                // Convert date strings back to Date objects
                this.filters.dateFrom = savedFilters.dateFrom ? new Date(savedFilters.dateFrom) : null;
                this.filters.dateTo = savedFilters.dateTo ? new Date(savedFilters.dateTo) : null;
                this.filters.selectedItems = savedFilters.selectedItems || [];
                this.filters.selectedEnhLevels = savedFilters.selectedEnhLevels || [];
                this.filters.selectedTypes = savedFilters.selectedTypes || [];
            }
        } catch (error) {
            console.error('[MarketHistoryViewer] Failed to load filters:', error);
        }
    }

    /**
     * Save filters to storage
     */
    async saveFilters() {
        try {
            // Convert Date objects to strings for storage
            const filtersToSave = {
                dateFrom: this.filters.dateFrom ? this.filters.dateFrom.toISOString() : null,
                dateTo: this.filters.dateTo ? this.filters.dateTo.toISOString() : null,
                selectedItems: this.filters.selectedItems,
                selectedEnhLevels: this.filters.selectedEnhLevels,
                selectedTypes: this.filters.selectedTypes,
            };
            await storage.setJSON('marketHistoryFilters', filtersToSave, 'settings', true);
        } catch (error) {
            console.error('[MarketHistoryViewer] Failed to save filters:', error);
        }
    }

    /**
     * Add "View Market History" button to settings panel
     */
    addSettingsButton() {
        // Function to check and add button if needed
        const ensureButtonExists = () => {
            const settingsPanel = document.querySelector('[class*="SettingsPanel"]');
            if (!settingsPanel) return;

            // Check if button already exists
            if (settingsPanel.querySelector('.mwi-market-history-button')) {
                return;
            }

            // Create button
            const button = document.createElement('button');
            button.className = 'mwi-market-history-button';
            button.textContent = 'View Market History';
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

            // Insert button at top of settings panel
            settingsPanel.insertBefore(button, settingsPanel.firstChild);
        };

        // Register callback with settings UI to be notified when settings panel appears
        settingsUI.onSettingsPanelAppear(ensureButtonExists);

        // Also try immediately in case settings is already open
        ensureButtonExists();
    }

    /**
     * Load listings from storage
     */
    async loadListings() {
        try {
            const stored = await storage.getJSON(this.storageKey, 'marketListings', []);
            this.listings = stored;
            this.cachedDateRange = null; // Clear cache when loading new data
            this.applyFilters();
        } catch (error) {
            console.error('[MarketHistoryViewer] Failed to load listings:', error);
            this.listings = [];
            this.filteredListings = [];
        }
    }

    /**
     * Apply filters and search to listings
     */
    applyFilters() {
        let filtered = [...this.listings];

        // Clear cached date range when filters change
        this.cachedDateRange = null;

        // Apply type filter (legacy - kept for backwards compatibility)
        if (this.typeFilter === 'buy') {
            filtered = filtered.filter((listing) => !listing.isSell);
        } else if (this.typeFilter === 'sell') {
            filtered = filtered.filter((listing) => listing.isSell);
        }

        // Apply search term (search in item name)
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filtered = filtered.filter((listing) => {
                const itemName = this.getItemName(listing.itemHrid).toLowerCase();
                return itemName.includes(term);
            });
        }

        // Apply date range filter
        if (this.filters.dateFrom || this.filters.dateTo) {
            filtered = filtered.filter((listing) => {
                const listingDate = new Date(listing.createdTimestamp || listing.timestamp);

                if (this.filters.dateFrom && listingDate < this.filters.dateFrom) {
                    return false;
                }

                if (this.filters.dateTo) {
                    // Set dateTo to end of day (23:59:59.999)
                    const endOfDay = new Date(this.filters.dateTo);
                    endOfDay.setHours(23, 59, 59, 999);
                    if (listingDate > endOfDay) {
                        return false;
                    }
                }

                return true;
            });
        }

        // Apply item filter
        if (this.filters.selectedItems.length > 0) {
            filtered = filtered.filter((listing) => this.filters.selectedItems.includes(listing.itemHrid));
        }

        // Apply enhancement level filter
        if (this.filters.selectedEnhLevels.length > 0) {
            filtered = filtered.filter((listing) => this.filters.selectedEnhLevels.includes(listing.enhancementLevel));
        }

        // Apply type filter (column filter)
        if (this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2) {
            // Only filter if not both selected (both selected = show all)
            const showBuy = this.filters.selectedTypes.includes('buy');
            const showSell = this.filters.selectedTypes.includes('sell');

            filtered = filtered.filter((listing) => {
                if (showBuy && !listing.isSell) return true;
                if (showSell && listing.isSell) return true;
                return false;
            });
        }

        // Apply sorting
        filtered.sort((a, b) => {
            let aVal = a[this.sortColumn];
            let bVal = b[this.sortColumn];

            // Handle timestamp sorting
            if (this.sortColumn === 'createdTimestamp') {
                aVal = a.timestamp; // Use numeric timestamp for sorting
                bVal = b.timestamp;
            }

            // Handle item name sorting
            if (this.sortColumn === 'itemHrid') {
                aVal = this.getItemName(a.itemHrid);
                bVal = this.getItemName(b.itemHrid);
            }

            // Handle total (price × filled) sorting
            if (this.sortColumn === 'total') {
                aVal = a.price * a.filledQuantity;
                bVal = b.price * b.filledQuantity;
            }

            if (typeof aVal === 'string') {
                return this.sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            } else {
                return this.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }
        });

        this.filteredListings = filtered;
        this.currentPage = 1; // Reset to first page when filters change

        // Auto-cleanup invalid filter selections (only on first pass to prevent infinite recursion)
        if (!this._cleanupInProgress) {
            this._cleanupInProgress = true;
            const cleaned = this.cleanupInvalidSelections();

            if (cleaned) {
                // Selections were cleaned - re-apply filters with the cleaned selections
                this.applyFilters();
            }

            this._cleanupInProgress = false;

            // Re-render table if modal is open and cleanup happened (only on outermost call)
            if (cleaned && this.modal && this.modal.style.display !== 'none') {
                this.renderTable();
            }
        }
    }

    /**
     * Remove filter selections that yield no results with current filters
     * @returns {boolean} True if any selections were cleaned up
     */
    cleanupInvalidSelections() {
        let changed = false;

        // Check item selections
        if (this.filters.selectedItems.length > 0) {
            const validItems = new Set(this.filteredListings.map((l) => l.itemHrid));
            const originalLength = this.filters.selectedItems.length;
            this.filters.selectedItems = this.filters.selectedItems.filter((hrid) => validItems.has(hrid));

            if (this.filters.selectedItems.length !== originalLength) {
                changed = true;
            }
        }

        // Check enhancement level selections
        if (this.filters.selectedEnhLevels.length > 0) {
            const validLevels = new Set(this.filteredListings.map((l) => l.enhancementLevel));
            const originalLength = this.filters.selectedEnhLevels.length;
            this.filters.selectedEnhLevels = this.filters.selectedEnhLevels.filter((level) => validLevels.has(level));

            if (this.filters.selectedEnhLevels.length !== originalLength) {
                changed = true;
            }
        }

        // Check type selections
        if (this.filters.selectedTypes.length > 0) {
            const hasBuy = this.filteredListings.some((l) => !l.isSell);
            const hasSell = this.filteredListings.some((l) => l.isSell);
            const originalLength = this.filters.selectedTypes.length;

            this.filters.selectedTypes = this.filters.selectedTypes.filter((type) => {
                if (type === 'buy') return hasBuy;
                if (type === 'sell') return hasSell;
                return false;
            });

            if (this.filters.selectedTypes.length !== originalLength) {
                changed = true;
            }
        }

        // Save changes to storage
        if (changed) {
            this.saveFilters();
        }

        return changed;
    }

    /**
     * Get item name from HRID
     */
    getItemName(itemHrid) {
        const itemDetails = dataManager.getItemDetails(itemHrid);
        return itemDetails?.name || itemHrid.split('/').pop().replace(/_/g, ' ');
    }

    /**
     * Format number based on K/M/B toggle
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    formatNumber(num) {
        return this.useKMBFormat ? formatKMB(num, 1) : formatWithSeparator(num);
    }

    /**
     * Get paginated listings for current page
     */
    getPaginatedListings() {
        if (this.showAll) {
            return this.filteredListings;
        }

        const start = (this.currentPage - 1) * this.rowsPerPage;
        const end = start + this.rowsPerPage;
        return this.filteredListings.slice(start, end);
    }

    /**
     * Get total pages
     */
    getTotalPages() {
        if (this.showAll) {
            return 1;
        }
        return Math.ceil(this.filteredListings.length / this.rowsPerPage);
    }

    /**
     * Open the market history modal
     */
    async openModal() {
        // Load listings
        await this.loadListings();

        // Create modal if it doesn't exist
        if (!this.modal) {
            this.createModal();
        }

        // Show modal
        this.modal.style.display = 'flex';

        // Render table
        this.renderTable();
    }

    /**
     * Close the modal
     */
    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Create modal structure
     */
    createModal() {
        // Modal overlay
        this.modal = document.createElement('div');
        this.modal.className = 'mwi-market-history-modal';
        this.modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        // Modal content
        const content = document.createElement('div');
        content.className = 'mwi-market-history-content';
        content.style.cssText = `
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            max-width: 95%;
            max-height: 90%;
            overflow: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'Market History';
        title.style.cssText = `
            margin: 0;
            color: #fff;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #fff;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
        `;
        closeBtn.addEventListener('click', () => this.closeModal());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Controls container
        const controls = document.createElement('div');
        controls.className = 'mwi-market-history-controls';
        controls.style.cssText = `
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
        `;

        content.appendChild(header);
        content.appendChild(controls);

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'mwi-market-history-table-container';
        content.appendChild(tableContainer);

        // Pagination container
        const pagination = document.createElement('div');
        pagination.className = 'mwi-market-history-pagination';
        pagination.style.cssText = `
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        content.appendChild(pagination);

        this.modal.appendChild(content);
        document.body.appendChild(this.modal);

        // Close on background click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });
    }

    /**
     * Render controls (search, filters, export)
     */
    renderControls() {
        const controls = this.modal.querySelector('.mwi-market-history-controls');

        // Only render if controls are empty (prevents re-rendering on every keystroke)
        if (controls.children.length > 0) {
            // Just update the stats text
            this.updateStats();
            return;
        }

        // Left group: Search and filters
        const leftGroup = document.createElement('div');
        leftGroup.style.cssText = `
            display: flex;
            gap: 10px;
            align-items: center;
        `;

        // Search box
        const searchBox = document.createElement('input');
        searchBox.type = 'text';
        searchBox.placeholder = 'Search items...';
        searchBox.value = this.searchTerm;
        searchBox.className = 'mwi-search-box';
        searchBox.style.cssText = `
            padding: 6px 12px;
            border: 1px solid #555;
            border-radius: 4px;
            background: #1a1a1a;
            color: #fff;
            min-width: 200px;
        `;
        searchBox.addEventListener('input', (e) => {
            this.searchTerm = e.target.value;
            this.applyFilters();
            this.renderTable();
        });

        // Type filter
        const typeFilter = document.createElement('select');
        typeFilter.style.cssText = `
            padding: 6px 12px;
            border: 1px solid #555;
            border-radius: 4px;
            background: #1a1a1a;
            color: #fff;
        `;
        const typeOptions = [
            { value: 'all', label: 'All Types' },
            { value: 'buy', label: 'Buy Orders' },
            { value: 'sell', label: 'Sell Orders' },
        ];
        typeOptions.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === this.typeFilter) {
                option.selected = true;
            }
            typeFilter.appendChild(option);
        });
        typeFilter.addEventListener('change', (e) => {
            this.typeFilter = e.target.value;
            this.applyFilters();
            this.renderTable();
        });

        leftGroup.appendChild(searchBox);
        leftGroup.appendChild(typeFilter);

        // Middle group: Active filter badges
        const middleGroup = document.createElement('div');
        middleGroup.className = 'mwi-active-filters';
        middleGroup.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            flex: 1;
            min-height: 32px;
        `;

        // Action buttons group
        const actionGroup = document.createElement('div');
        actionGroup.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
        `;

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export CSV';
        exportBtn.style.cssText = `
            padding: 6px 12px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        exportBtn.addEventListener('click', () => this.exportCSV());

        // Import button
        const importBtn = document.createElement('button');
        importBtn.textContent = 'Import Market Data';
        importBtn.style.cssText = `
            padding: 6px 12px;
            background: #9b59b6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        importBtn.addEventListener('click', () => this.showImportDialog());

        // Clear History button (destructive action - red)
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear History';
        clearBtn.style.cssText = `
            padding: 6px 12px;
            background: #dc2626;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        clearBtn.addEventListener('mouseenter', () => {
            clearBtn.style.background = '#b91c1c';
        });
        clearBtn.addEventListener('mouseleave', () => {
            clearBtn.style.background = '#dc2626';
        });
        clearBtn.addEventListener('click', () => this.clearHistory());

        actionGroup.appendChild(exportBtn);
        actionGroup.appendChild(importBtn);
        actionGroup.appendChild(clearBtn);

        // Right group: Options and stats
        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = `
            display: flex;
            gap: 12px;
            align-items: center;
            margin-left: auto;
        `;

        // K/M/B Format checkbox
        const kmbCheckbox = document.createElement('input');
        kmbCheckbox.type = 'checkbox';
        kmbCheckbox.checked = this.useKMBFormat;
        kmbCheckbox.id = 'mwi-kmb-format';
        kmbCheckbox.style.cssText = `
            cursor: pointer;
        `;
        kmbCheckbox.addEventListener('change', (e) => {
            this.useKMBFormat = e.target.checked;
            // Save preference to storage
            storage.set('marketHistoryKMBFormat', this.useKMBFormat, 'settings');
            this.renderTable(); // Re-render to apply formatting
        });

        const kmbLabel = document.createElement('label');
        kmbLabel.htmlFor = 'mwi-kmb-format';
        kmbLabel.textContent = 'K/M/B Format';
        kmbLabel.style.cssText = `
            cursor: pointer;
            color: #aaa;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
        `;
        kmbLabel.prepend(kmbCheckbox);

        // Summary stats
        const stats = document.createElement('div');
        stats.className = 'mwi-market-history-stats';
        stats.style.cssText = `
            color: #aaa;
            font-size: 14px;
            white-space: nowrap;
        `;
        stats.textContent = `Total: ${this.filteredListings.length} listings`;

        rightGroup.appendChild(kmbLabel);
        rightGroup.appendChild(stats);

        controls.appendChild(leftGroup);
        controls.appendChild(middleGroup);
        controls.appendChild(actionGroup);
        controls.appendChild(rightGroup);

        // Add Clear All Filters button if needed (handled dynamically)
        this.updateClearFiltersButton();

        // Render active filter badges
        this.renderActiveFilters();
    }

    /**
     * Update just the stats text (without re-rendering controls)
     */
    updateStats() {
        const stats = this.modal.querySelector('.mwi-market-history-stats');
        if (stats) {
            stats.textContent = `Total: ${this.filteredListings.length} listings`;
        }

        // Update Clear All Filters button visibility
        this.updateClearFiltersButton();

        // Update active filter badges
        this.renderActiveFilters();
    }

    /**
     * Render active filter badges in the middle section
     */
    renderActiveFilters() {
        const container = this.modal.querySelector('.mwi-active-filters');
        if (!container) return;

        // Explicitly remove all children to ensure SVG elements are garbage collected
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        const badges = [];

        // Date filter
        if (this.filters.dateFrom || this.filters.dateTo) {
            const dateText = [];
            if (this.filters.dateFrom) {
                dateText.push(this.filters.dateFrom.toLocaleDateString());
            }
            if (this.filters.dateTo) {
                dateText.push(this.filters.dateTo.toLocaleDateString());
            }
            badges.push({
                label: `Date: ${dateText.join(' - ')}`,
                onRemove: () => {
                    this.filters.dateFrom = null;
                    this.filters.dateTo = null;
                    this.saveFilters();
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        // Item filters
        if (this.filters.selectedItems.length > 0) {
            if (this.filters.selectedItems.length === 1) {
                badges.push({
                    label: this.getItemName(this.filters.selectedItems[0]),
                    icon: this.filters.selectedItems[0],
                    onRemove: () => {
                        this.filters.selectedItems = [];
                        this.saveFilters();
                        this.applyFilters();
                        this.renderTable();
                    },
                });
            } else {
                badges.push({
                    label: `${this.filters.selectedItems.length} items selected`,
                    icon: this.filters.selectedItems[0], // Show first item's icon
                    onRemove: () => {
                        this.filters.selectedItems = [];
                        this.saveFilters();
                        this.applyFilters();
                        this.renderTable();
                    },
                });
            }
        }

        // Enhancement level filters
        if (this.filters.selectedEnhLevels.length > 0) {
            const levels = this.filters.selectedEnhLevels.sort((a, b) => a - b);
            if (levels.length === 1) {
                const levelText = levels[0] > 0 ? `+${levels[0]}` : 'No Enhancement';
                badges.push({
                    label: `Enh Lvl: ${levelText}`,
                    onRemove: () => {
                        this.filters.selectedEnhLevels = [];
                        this.saveFilters();
                        this.applyFilters();
                        this.renderTable();
                    },
                });
            } else {
                badges.push({
                    label: `Enh Lvl: ${levels.length} selected`,
                    onRemove: () => {
                        this.filters.selectedEnhLevels = [];
                        this.saveFilters();
                        this.applyFilters();
                        this.renderTable();
                    },
                });
            }
        }

        // Type filters
        if (this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2) {
            badges.push({
                label: `Type: ${this.filters.selectedTypes.includes('buy') ? 'Buy' : 'Sell'}`,
                onRemove: () => {
                    this.filters.selectedTypes = [];
                    this.saveFilters();
                    this.applyFilters();
                    this.renderTable();
                },
            });
        }

        // Render badges
        badges.forEach((badge) => {
            const badgeEl = document.createElement('div');
            badgeEl.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                background: #3a3a3a;
                border: 1px solid #555;
                border-radius: 4px;
                color: #aaa;
                font-size: 13px;
            `;

            // Add icon if provided
            if (badge.icon) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '16');
                svg.setAttribute('height', '16');
                svg.style.flexShrink = '0';
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                const iconName = badge.icon.split('/').pop();
                use.setAttribute('href', `/static/media/items_sprite.328d6606.svg#${iconName}`);
                svg.appendChild(use);
                badgeEl.appendChild(svg);
            }

            const label = document.createElement('span');
            label.textContent = badge.label;

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '✕';
            removeBtn.style.cssText = `
                background: none;
                border: none;
                color: #aaa;
                cursor: pointer;
                padding: 0;
                font-size: 14px;
                line-height: 1;
            `;
            removeBtn.addEventListener('mouseenter', () => {
                removeBtn.style.color = '#fff';
            });
            removeBtn.addEventListener('mouseleave', () => {
                removeBtn.style.color = '#aaa';
            });
            removeBtn.addEventListener('click', badge.onRemove);

            badgeEl.appendChild(label);
            badgeEl.appendChild(removeBtn);
            container.appendChild(badgeEl);
        });
    }

    /**
     * Update Clear All Filters button visibility based on filter state
     */
    updateClearFiltersButton() {
        const controls = this.modal.querySelector('.mwi-market-history-controls');
        if (!controls) return;

        const hasActiveFilters =
            this.filters.dateFrom !== null ||
            this.filters.dateTo !== null ||
            this.filters.selectedItems.length > 0 ||
            this.filters.selectedEnhLevels.length > 0 ||
            (this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2);

        const existingBtn = controls.querySelector('.mwi-clear-filters-button');

        if (hasActiveFilters && !existingBtn) {
            // Create button
            const clearFiltersBtn = document.createElement('button');
            clearFiltersBtn.className = 'mwi-clear-filters-button';
            clearFiltersBtn.textContent = 'Clear All Filters';
            clearFiltersBtn.style.cssText = `
                padding: 6px 12px;
                background: #e67e22;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                white-space: nowrap;
            `;
            clearFiltersBtn.addEventListener('mouseenter', () => {
                clearFiltersBtn.style.background = '#d35400';
            });
            clearFiltersBtn.addEventListener('mouseleave', () => {
                clearFiltersBtn.style.background = '#e67e22';
            });
            clearFiltersBtn.addEventListener('click', () => this.clearAllFilters());

            // Insert into right group (before K/M/B checkbox)
            const rightGroup = controls.children[3]; // Fourth child is rightGroup
            if (rightGroup) {
                rightGroup.insertBefore(clearFiltersBtn, rightGroup.firstChild);
            }
        } else if (!hasActiveFilters && existingBtn) {
            // Remove button
            existingBtn.remove();
        }
    }

    /**
     * Render table with listings
     */
    renderTable() {
        this.renderControls();

        const tableContainer = this.modal.querySelector('.mwi-market-history-table-container');

        // Explicitly remove all children to ensure SVG elements are garbage collected
        while (tableContainer.firstChild) {
            tableContainer.removeChild(tableContainer.firstChild);
        }

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            color: #fff;
        `;

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = `
            background: #1a1a1a;
        `;

        const columns = [
            { key: 'createdTimestamp', label: 'Date' },
            { key: 'itemHrid', label: 'Item' },
            { key: 'enhancementLevel', label: 'Enh Lvl' },
            { key: 'isSell', label: 'Type' },
            { key: 'price', label: 'Price' },
            { key: 'orderQuantity', label: 'Quantity' },
            { key: 'filledQuantity', label: 'Filled' },
            { key: 'total', label: 'Total' },
        ];

        columns.forEach((col) => {
            const th = document.createElement('th');
            th.style.cssText = `
                padding: 10px;
                text-align: left;
                border-bottom: 2px solid #555;
                user-select: none;
                position: relative;
            `;

            // Create header content container
            const headerContent = document.createElement('div');
            headerContent.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            // Label and sort indicator
            const labelSpan = document.createElement('span');
            labelSpan.textContent = col.label;
            labelSpan.style.cursor = 'pointer';

            // Sort indicator
            if (this.sortColumn === col.key) {
                labelSpan.textContent += this.sortDirection === 'asc' ? ' ▲' : ' ▼';
            }

            // Sort click handler
            labelSpan.addEventListener('click', () => {
                if (this.sortColumn === col.key) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = col.key;
                    this.sortDirection = 'desc';
                }
                this.applyFilters();
                this.renderTable();
            });

            headerContent.appendChild(labelSpan);

            // Add filter button for filterable columns
            const filterableColumns = ['createdTimestamp', 'itemHrid', 'enhancementLevel', 'isSell'];
            if (filterableColumns.includes(col.key)) {
                const filterBtn = document.createElement('button');
                filterBtn.textContent = '⋮';
                filterBtn.style.cssText = `
                    background: none;
                    border: none;
                    color: #aaa;
                    cursor: pointer;
                    font-size: 16px;
                    padding: 2px 4px;
                    font-weight: bold;
                `;

                // Check if filter is active
                const hasActiveFilter = this.hasActiveFilter(col.key);
                if (hasActiveFilter) {
                    filterBtn.style.color = '#4a90e2';
                    filterBtn.textContent = '⋮';
                }

                filterBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showFilterPopup(col.key, filterBtn);
                });

                headerContent.appendChild(filterBtn);
            }

            th.appendChild(headerContent);
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        const paginatedListings = this.getPaginatedListings();

        if (paginatedListings.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = columns.length;
            cell.textContent = 'No listings found';
            cell.style.cssText = `
                padding: 20px;
                text-align: center;
                color: #888;
            `;
            row.appendChild(cell);
            tbody.appendChild(row);
        } else {
            paginatedListings.forEach((listing, index) => {
                const row = document.createElement('tr');
                row.style.cssText = `
                    border-bottom: 1px solid #333;
                    background: ${index % 2 === 0 ? '#2a2a2a' : '#252525'};
                `;

                // Date
                const dateCell = document.createElement('td');
                // Use createdTimestamp if available, otherwise fall back to numeric timestamp
                const dateValue = listing.createdTimestamp || listing.timestamp;
                dateCell.textContent = new Date(dateValue).toLocaleString();
                dateCell.style.padding = '4px 10px';
                row.appendChild(dateCell);

                // Item (with icon)
                const itemCell = document.createElement('td');
                itemCell.style.cssText = `
                    padding: 4px 10px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                `;

                // Create SVG icon
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                const iconName = listing.itemHrid.split('/').pop();
                use.setAttribute('href', `/static/media/items_sprite.328d6606.svg#${iconName}`);
                svg.appendChild(use);

                // Add icon and text
                itemCell.appendChild(svg);
                const textSpan = document.createElement('span');
                textSpan.textContent = this.getItemName(listing.itemHrid);
                itemCell.appendChild(textSpan);

                row.appendChild(itemCell);

                // Enhancement
                const enhCell = document.createElement('td');
                enhCell.textContent = listing.enhancementLevel > 0 ? `+${listing.enhancementLevel}` : '-';
                enhCell.style.padding = '4px 10px';
                row.appendChild(enhCell);

                // Type
                const typeCell = document.createElement('td');
                typeCell.textContent = listing.isSell ? 'Sell' : 'Buy';
                typeCell.style.cssText = `
                    padding: 4px 10px;
                    color: ${listing.isSell ? '#4ade80' : '#60a5fa'};
                `;
                row.appendChild(typeCell);

                // Price
                const priceCell = document.createElement('td');
                priceCell.textContent = this.formatNumber(listing.price);
                priceCell.style.padding = '4px 10px';
                row.appendChild(priceCell);

                // Quantity
                const qtyCell = document.createElement('td');
                qtyCell.textContent = this.formatNumber(listing.orderQuantity);
                qtyCell.style.padding = '4px 10px';
                row.appendChild(qtyCell);

                // Filled
                const filledCell = document.createElement('td');
                filledCell.textContent = this.formatNumber(listing.filledQuantity);
                filledCell.style.padding = '4px 10px';
                row.appendChild(filledCell);

                // Total (Price × Filled)
                const totalCell = document.createElement('td');
                const totalValue = listing.price * listing.filledQuantity;
                totalCell.textContent = this.formatNumber(totalValue);
                totalCell.style.padding = '4px 10px';
                row.appendChild(totalCell);

                tbody.appendChild(row);
            });
        }

        table.appendChild(tbody);
        tableContainer.appendChild(table);

        // Render pagination
        this.renderPagination();
    }

    /**
     * Render pagination controls
     */
    renderPagination() {
        const pagination = this.modal.querySelector('.mwi-market-history-pagination');

        // Explicitly remove all children to ensure proper cleanup
        while (pagination.firstChild) {
            pagination.removeChild(pagination.firstChild);
        }

        // Left side: Rows per page
        const leftSide = document.createElement('div');
        leftSide.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            color: #aaa;
        `;

        const label = document.createElement('span');
        label.textContent = 'Rows per page:';

        const rowsInput = document.createElement('input');
        rowsInput.type = 'number';
        rowsInput.value = this.rowsPerPage;
        rowsInput.min = '1';
        rowsInput.disabled = this.showAll;
        rowsInput.style.cssText = `
            width: 60px;
            padding: 4px 8px;
            border: 1px solid #555;
            border-radius: 4px;
            background: ${this.showAll ? '#333' : '#1a1a1a'};
            color: ${this.showAll ? '#666' : '#fff'};
        `;
        rowsInput.addEventListener('change', (e) => {
            this.rowsPerPage = Math.max(1, parseInt(e.target.value) || 50);
            this.currentPage = 1;
            this.renderTable();
        });

        const showAllCheckbox = document.createElement('input');
        showAllCheckbox.type = 'checkbox';
        showAllCheckbox.checked = this.showAll;
        showAllCheckbox.style.cssText = `
            cursor: pointer;
        `;
        showAllCheckbox.addEventListener('change', (e) => {
            this.showAll = e.target.checked;
            rowsInput.disabled = this.showAll;
            rowsInput.style.background = this.showAll ? '#333' : '#1a1a1a';
            rowsInput.style.color = this.showAll ? '#666' : '#fff';
            this.currentPage = 1;
            this.renderTable();
        });

        const showAllLabel = document.createElement('label');
        showAllLabel.textContent = 'Show All';
        showAllLabel.style.cssText = `
            cursor: pointer;
            color: #aaa;
        `;
        showAllLabel.prepend(showAllCheckbox);

        leftSide.appendChild(label);
        leftSide.appendChild(rowsInput);
        leftSide.appendChild(showAllLabel);

        // Right side: Page navigation
        const rightSide = document.createElement('div');
        rightSide.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            color: #aaa;
        `;

        if (!this.showAll) {
            const totalPages = this.getTotalPages();

            const prevBtn = document.createElement('button');
            prevBtn.textContent = '◀';
            prevBtn.disabled = this.currentPage === 1;
            prevBtn.style.cssText = `
                padding: 4px 12px;
                background: ${this.currentPage === 1 ? '#333' : '#4a90e2'};
                color: ${this.currentPage === 1 ? '#666' : 'white'};
                border: none;
                border-radius: 4px;
                cursor: ${this.currentPage === 1 ? 'default' : 'pointer'};
            `;
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.renderTable();
                }
            });

            const pageInfo = document.createElement('span');
            pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;

            const nextBtn = document.createElement('button');
            nextBtn.textContent = '▶';
            nextBtn.disabled = this.currentPage === totalPages;
            nextBtn.style.cssText = `
                padding: 4px 12px;
                background: ${this.currentPage === totalPages ? '#333' : '#4a90e2'};
                color: ${this.currentPage === totalPages ? '#666' : 'white'};
                border: none;
                border-radius: 4px;
                cursor: ${this.currentPage === totalPages ? 'default' : 'pointer'};
            `;
            nextBtn.addEventListener('click', () => {
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.renderTable();
                }
            });

            rightSide.appendChild(prevBtn);
            rightSide.appendChild(pageInfo);
            rightSide.appendChild(nextBtn);
        } else {
            const showingInfo = document.createElement('span');
            showingInfo.textContent = `Showing all ${this.filteredListings.length} listings`;
            rightSide.appendChild(showingInfo);
        }

        pagination.appendChild(leftSide);
        pagination.appendChild(rightSide);
    }

    /**
     * Export listings to CSV
     */
    exportCSV() {
        const headers = ['Date', 'Item', 'Enhancement', 'Type', 'Price', 'Quantity', 'Filled', 'Total', 'ID'];
        const rows = this.filteredListings.map((listing) => [
            new Date(listing.createdTimestamp || listing.timestamp).toISOString(),
            this.getItemName(listing.itemHrid),
            listing.enhancementLevel || 0,
            listing.isSell ? 'Sell' : 'Buy',
            listing.price,
            listing.orderQuantity,
            listing.filledQuantity,
            listing.price * listing.filledQuantity, // Total
            listing.id,
        ]);

        const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `market-history-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Import listings from CSV
     */
    async importCSV(csvText) {
        try {
            // Parse CSV
            const lines = csvText.trim().split('\n');
            if (lines.length < 2) {
                throw new Error('CSV file is empty or invalid');
            }

            // Parse header
            const _headerLine = lines[0];
            const _expectedHeaders = [
                'Date',
                'Item',
                'Enhancement',
                'Type',
                'Price',
                'Quantity',
                'Filled',
                'Total',
                'ID',
            ];

            // Show progress message
            const progressMsg = document.createElement('div');
            progressMsg.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2a2a2a;
                padding: 20px;
                border-radius: 8px;
                color: #fff;
                z-index: 10001;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            `;
            progressMsg.textContent = `Importing ${lines.length - 1} listings from CSV...`;
            document.body.appendChild(progressMsg);

            // Load existing listings
            const existingListings = await storage.getJSON(this.storageKey, 'marketListings', []);
            const existingIds = new Set(existingListings.map((l) => l.id));

            let imported = 0;
            let skipped = 0;

            // Build item name to HRID map
            const itemNameToHrid = {};
            const gameData = dataManager.getInitClientData();
            if (gameData?.itemDetailMap) {
                for (const [hrid, details] of Object.entries(gameData.itemDetailMap)) {
                    if (details.name) {
                        itemNameToHrid[details.name] = hrid;
                    }
                }
            }

            // Process each line
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                // Parse CSV row (handle quoted fields)
                const fields = [];
                let currentField = '';
                let inQuotes = false;

                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        fields.push(currentField);
                        currentField = '';
                    } else {
                        currentField += char;
                    }
                }
                fields.push(currentField); // Add last field

                if (fields.length < 9) {
                    console.warn(`[MarketHistoryViewer] Skipping invalid CSV row ${i}: ${line}`);
                    continue;
                }

                const [dateStr, itemName, enhStr, typeStr, priceStr, qtyStr, filledStr, _totalStr, idStr] = fields;

                // Parse ID
                const id = parseInt(idStr);
                if (isNaN(id)) {
                    console.warn(`[MarketHistoryViewer] Skipping row with invalid ID: ${idStr}`);
                    continue;
                }

                // Skip duplicates
                if (existingIds.has(id)) {
                    skipped++;
                    continue;
                }

                // Find item HRID from name
                const itemHrid = itemNameToHrid[itemName];
                if (!itemHrid) {
                    console.warn(`[MarketHistoryViewer] Could not find HRID for item: ${itemName}`);
                    skipped++;
                    continue;
                }

                // Create listing object
                const listing = {
                    id: id,
                    timestamp: new Date(dateStr).getTime(),
                    createdTimestamp: dateStr,
                    itemHrid: itemHrid,
                    enhancementLevel: parseInt(enhStr) || 0,
                    price: parseFloat(priceStr),
                    orderQuantity: parseFloat(qtyStr),
                    filledQuantity: parseFloat(filledStr),
                    isSell: typeStr.toLowerCase() === 'sell',
                };

                existingListings.push(listing);
                imported++;
            }

            // Save to storage
            await storage.setJSON(this.storageKey, existingListings, 'marketListings', true);

            // Remove progress message
            document.body.removeChild(progressMsg);

            // Show success message
            alert(
                `Import complete!\n\nImported: ${imported} new listings\nSkipped: ${skipped} duplicates or invalid rows\nTotal: ${existingListings.length} listings`
            );

            // Reload and render table
            await this.loadListings();
            this.renderTable();
        } catch (error) {
            console.error('[MarketHistoryViewer] CSV import error:', error);
            throw error;
        }
    }

    /**
     * Show import dialog
     */
    showImportDialog() {
        // Create file input
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.txt,.json,.csv';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();

                // Detect file type and use appropriate import method
                if (file.name.endsWith('.csv')) {
                    await this.importCSV(text);
                } else {
                    await this.importEdibleToolsData(text);
                }
            } catch (error) {
                console.error('[MarketHistoryViewer] Import failed:', error);
                alert(`Import failed: ${error.message}`);
            }
        });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }

    /**
     * Import market listing data (supports Edible Tools format)
     */
    async importEdibleToolsData(jsonText) {
        try {
            // Check for truncated file
            if (!jsonText.trim().endsWith('}')) {
                throw new Error(
                    'File appears to be truncated or incomplete. The JSON does not end properly. ' +
                        'Try exporting from Edible Tools again, or export to CSV from the Market History Viewer and import that instead.'
                );
            }

            // Parse the storage file
            const data = JSON.parse(jsonText);

            if (!data.market_list) {
                throw new Error('No market_list found in file. Expected format: {"market_list": "[...]"}');
            }

            // Parse the market_list JSON string
            const marketList = JSON.parse(data.market_list);

            if (!Array.isArray(marketList) || marketList.length === 0) {
                throw new Error('market_list is empty or invalid');
            }

            // Show progress message
            const progressMsg = document.createElement('div');
            progressMsg.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2a2a2a;
                padding: 20px;
                border-radius: 8px;
                color: #fff;
                z-index: 10001;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            `;
            progressMsg.textContent = `Importing ${marketList.length} listings...`;
            document.body.appendChild(progressMsg);

            // Convert imported format to Toolasha format
            const existingListings = await storage.getJSON(this.storageKey, 'marketListings', []);
            const existingIds = new Set(existingListings.map((l) => l.id));

            let imported = 0;
            let skipped = 0;

            for (const etListing of marketList) {
                // Skip if we already have this listing
                if (existingIds.has(etListing.id)) {
                    skipped++;
                    continue;
                }

                // Convert to Toolasha format
                const toolashaListing = {
                    id: etListing.id,
                    timestamp: new Date(etListing.createdTimestamp).getTime(),
                    createdTimestamp: etListing.createdTimestamp,
                    itemHrid: etListing.itemHrid,
                    enhancementLevel: etListing.enhancementLevel || 0,
                    price: etListing.price,
                    orderQuantity: etListing.orderQuantity,
                    filledQuantity: etListing.filledQuantity,
                    isSell: etListing.isSell,
                };

                existingListings.push(toolashaListing);
                imported++;
            }

            // Save to storage
            await storage.setJSON(this.storageKey, existingListings, 'marketListings', true);

            // Remove progress message
            document.body.removeChild(progressMsg);

            // Show success message
            alert(
                `Import complete!\n\nImported: ${imported} new listings\nSkipped: ${skipped} duplicates\nTotal: ${existingListings.length} listings`
            );

            // Reload and render table
            await this.loadListings();
            this.renderTable();
        } catch (error) {
            console.error('[MarketHistoryViewer] Import error:', error);
            throw error;
        }
    }

    /**
     * Clear all market history data
     */
    async clearHistory() {
        // Strong confirmation dialog
        const confirmed = confirm(
            `⚠️ WARNING: This will permanently delete ALL market history data!\n` +
                `You are about to delete ${this.listings.length} listings.\n` +
                `RECOMMENDATION: Export to CSV first using the "Export CSV" button.\n` +
                `This action CANNOT be undone!\n` +
                `Are you absolutely sure you want to continue?`
        );

        if (!confirmed) {
            return;
        }

        try {
            // Clear from storage
            await storage.setJSON(this.storageKey, [], 'marketListings', true);

            // Clear local data
            this.listings = [];
            this.filteredListings = [];

            // Show success message
            alert('Market history cleared successfully.');

            // Reload and render table (will show empty state)
            await this.loadListings();
            this.renderTable();
        } catch (error) {
            console.error('[MarketHistoryViewer] Failed to clear history:', error);
            alert(`Failed to clear history: ${error.message}`);
        }
    }

    /**
     * Get filtered listings excluding a specific filter type
     * Used for dynamic filter options - shows what's available given OTHER active filters
     * @param {string} excludeFilterType - Filter to exclude: 'date', 'item', 'enhancementLevel', 'type'
     * @returns {Array} Filtered listings
     */
    getFilteredListingsExcluding(excludeFilterType) {
        let filtered = [...this.listings];

        // Apply legacy type filter if set
        if (this.typeFilter === 'buy') {
            filtered = filtered.filter((listing) => !listing.isSell);
        } else if (this.typeFilter === 'sell') {
            filtered = filtered.filter((listing) => listing.isSell);
        }

        // Apply search term
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filtered = filtered.filter((listing) => {
                const itemName = this.getItemName(listing.itemHrid).toLowerCase();
                return itemName.includes(term);
            });
        }

        // Apply date range filter (unless excluded)
        if (excludeFilterType !== 'date' && (this.filters.dateFrom || this.filters.dateTo)) {
            filtered = filtered.filter((listing) => {
                const listingDate = new Date(listing.createdTimestamp || listing.timestamp);

                if (this.filters.dateFrom && listingDate < this.filters.dateFrom) {
                    return false;
                }

                if (this.filters.dateTo) {
                    const endOfDay = new Date(this.filters.dateTo);
                    endOfDay.setHours(23, 59, 59, 999);
                    if (listingDate > endOfDay) {
                        return false;
                    }
                }

                return true;
            });
        }

        // Apply item filter (unless excluded)
        if (excludeFilterType !== 'item' && this.filters.selectedItems.length > 0) {
            filtered = filtered.filter((listing) => this.filters.selectedItems.includes(listing.itemHrid));
        }

        // Apply enhancement level filter (unless excluded)
        if (excludeFilterType !== 'enhancementLevel' && this.filters.selectedEnhLevels.length > 0) {
            filtered = filtered.filter((listing) => this.filters.selectedEnhLevels.includes(listing.enhancementLevel));
        }

        // Apply type filter (unless excluded)
        if (
            excludeFilterType !== 'type' &&
            this.filters.selectedTypes.length > 0 &&
            this.filters.selectedTypes.length < 2
        ) {
            const showBuy = this.filters.selectedTypes.includes('buy');
            const showSell = this.filters.selectedTypes.includes('sell');

            filtered = filtered.filter((listing) => {
                if (showBuy && !listing.isSell) return true;
                if (showSell && listing.isSell) return true;
                return false;
            });
        }

        return filtered;
    }

    /**
     * Check if a column has an active filter
     * @param {string} columnKey - Column key to check
     * @returns {boolean} True if filter is active
     */
    hasActiveFilter(columnKey) {
        switch (columnKey) {
            case 'createdTimestamp':
                return this.filters.dateFrom !== null || this.filters.dateTo !== null;
            case 'itemHrid':
                return this.filters.selectedItems.length > 0;
            case 'enhancementLevel':
                return this.filters.selectedEnhLevels.length > 0;
            case 'isSell':
                return this.filters.selectedTypes.length > 0 && this.filters.selectedTypes.length < 2;
            default:
                return false;
        }
    }

    /**
     * Show filter popup for a column
     * @param {string} columnKey - Column key
     * @param {HTMLElement} buttonElement - Button that triggered popup
     */
    showFilterPopup(columnKey, buttonElement) {
        // If clicking the same button that opened the current popup, close it (toggle behavior)
        if (this.activeFilterPopup && this.activeFilterButton === buttonElement) {
            this.activeFilterPopup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
            if (this.popupCloseHandler) {
                document.removeEventListener('click', this.popupCloseHandler);
                this.popupCloseHandler = null;
            }
            return;
        }

        // Close any existing popup and remove its event listener
        if (this.activeFilterPopup) {
            this.activeFilterPopup.remove();
            this.activeFilterPopup = null;
        }
        if (this.popupCloseHandler) {
            document.removeEventListener('click', this.popupCloseHandler);
            this.popupCloseHandler = null;
        }

        // Create popup based on column type
        let popup;
        switch (columnKey) {
            case 'createdTimestamp':
                popup = this.createDateFilterPopup();
                break;
            case 'itemHrid':
                popup = this.createItemFilterPopup();
                break;
            case 'enhancementLevel':
                popup = this.createEnhancementFilterPopup();
                break;
            case 'isSell':
                popup = this.createTypeFilterPopup();
                break;
            default:
                return;
        }

        // Position popup below button
        const buttonRect = buttonElement.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.top = `${buttonRect.bottom + 5}px`;
        popup.style.left = `${buttonRect.left}px`;
        popup.style.zIndex = '10002';

        document.body.appendChild(popup);
        this.activeFilterPopup = popup;
        this.activeFilterButton = buttonElement; // Track which button opened this popup

        // Close popup when clicking outside
        this.popupCloseHandler = (e) => {
            // Don't close if clicking on date inputs or their calendar pickers
            if (e.target.type === 'date' || e.target.closest('input[type="date"]')) {
                return;
            }

            if (!popup.contains(e.target) && e.target !== buttonElement) {
                popup.remove();
                this.activeFilterPopup = null;
                this.activeFilterButton = null;
                document.removeEventListener('click', this.popupCloseHandler);
                this.popupCloseHandler = null;
            }
        };
        const popupTimeout = setTimeout(() => document.addEventListener('click', this.popupCloseHandler), 10);
        this.timerRegistry.registerTimeout(popupTimeout);
    }

    /**
     * Create date filter popup
     * @returns {HTMLElement} Popup element
     */
    createDateFilterPopup() {
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 250px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Title
        const title = document.createElement('div');
        title.textContent = 'Filter by Date';
        title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
        popup.appendChild(title);

        // Get date range from filtered listings (excluding date filter itself)
        // Cache the result to avoid recalculating on every popup open
        if (!this.cachedDateRange) {
            const filteredListings = this.getFilteredListingsExcluding('date');

            if (filteredListings.length > 0) {
                // Use timestamps directly to avoid creating Date objects unnecessarily
                const timestamps = filteredListings.map((l) => l.timestamp || new Date(l.createdTimestamp).getTime());
                this.cachedDateRange = {
                    minDate: new Date(Math.min(...timestamps)),
                    maxDate: new Date(Math.max(...timestamps)),
                };
            } else {
                this.cachedDateRange = { minDate: null, maxDate: null };
            }
        }

        const { minDate, maxDate } = this.cachedDateRange;

        if (minDate && maxDate) {
            // Show available date range
            const rangeInfo = document.createElement('div');
            rangeInfo.style.cssText = `
                color: #aaa;
                font-size: 11px;
                margin-bottom: 10px;
                padding: 6px;
                background: #1a1a1a;
                border-radius: 3px;
            `;
            rangeInfo.textContent = `Available: ${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;
            popup.appendChild(rangeInfo);
        }

        // From date
        const fromLabel = document.createElement('label');
        fromLabel.textContent = 'From:';
        fromLabel.style.cssText = `
            display: block;
            color: #aaa;
            margin-bottom: 4px;
            font-size: 12px;
        `;

        const fromInput = document.createElement('input');
        fromInput.type = 'date';
        fromInput.value = this.filters.dateFrom ? this.filters.dateFrom.toISOString().split('T')[0] : '';
        if (minDate) fromInput.min = minDate.toISOString().split('T')[0];
        if (maxDate) fromInput.max = maxDate.toISOString().split('T')[0];
        fromInput.style.cssText = `
            width: 100%;
            padding: 6px;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 3px;
            color: #fff;
            margin-bottom: 10px;
        `;

        // To date
        const toLabel = document.createElement('label');
        toLabel.textContent = 'To:';
        toLabel.style.cssText = `
            display: block;
            color: #aaa;
            margin-bottom: 4px;
            font-size: 12px;
        `;

        const toInput = document.createElement('input');
        toInput.type = 'date';
        toInput.value = this.filters.dateTo ? this.filters.dateTo.toISOString().split('T')[0] : '';
        if (minDate) toInput.min = minDate.toISOString().split('T')[0];
        if (maxDate) toInput.max = maxDate.toISOString().split('T')[0];
        toInput.style.cssText = `
            width: 100%;
            padding: 6px;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 3px;
            color: #fff;
            margin-bottom: 10px;
        `;

        // Buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 10px;
        `;

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        applyBtn.addEventListener('click', () => {
            this.filters.dateFrom = fromInput.value ? new Date(fromInput.value) : null;
            this.filters.dateTo = toInput.value ? new Date(toInput.value) : null;
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        clearBtn.addEventListener('click', () => {
            this.filters.dateFrom = null;
            this.filters.dateTo = null;
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        buttonContainer.appendChild(applyBtn);
        buttonContainer.appendChild(clearBtn);

        popup.appendChild(fromLabel);
        popup.appendChild(fromInput);
        popup.appendChild(toLabel);
        popup.appendChild(toInput);
        popup.appendChild(buttonContainer);

        return popup;
    }

    /**
     * Create item filter popup
     * @returns {HTMLElement} Popup element
     */
    createItemFilterPopup() {
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 300px;
            max-height: 400px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Title
        const title = document.createElement('div');
        title.textContent = 'Filter by Item';
        title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
        popup.appendChild(title);

        // Search box
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search items...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 6px;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 3px;
            color: #fff;
            margin-bottom: 8px;
        `;

        popup.appendChild(searchInput);

        // Get unique items from filtered listings (excluding item filter itself)
        const filteredListings = this.getFilteredListingsExcluding('item');
        const itemHrids = [...new Set(filteredListings.map((l) => l.itemHrid))];
        const itemsWithNames = itemHrids.map((hrid) => ({
            hrid,
            name: this.getItemName(hrid),
        }));
        itemsWithNames.sort((a, b) => a.name.localeCompare(b.name));

        // Checkboxes container
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            margin-bottom: 10px;
            max-height: 250px;
        `;

        const renderCheckboxes = (filterText = '') => {
            // Explicitly remove all children to ensure proper cleanup
            while (checkboxContainer.firstChild) {
                checkboxContainer.removeChild(checkboxContainer.firstChild);
            }

            const filtered = filterText
                ? itemsWithNames.filter((item) => item.name.toLowerCase().includes(filterText.toLowerCase()))
                : itemsWithNames;

            filtered.forEach((item) => {
                const label = document.createElement('label');
                label.style.cssText = `
                    display: block;
                    color: #fff;
                    padding: 4px;
                    cursor: pointer;
                `;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = this.filters.selectedItems.includes(item.hrid);
                checkbox.style.marginRight = '6px';

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(item.name));
                checkboxContainer.appendChild(label);

                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        if (!this.filters.selectedItems.includes(item.hrid)) {
                            this.filters.selectedItems.push(item.hrid);
                        }
                    } else {
                        const index = this.filters.selectedItems.indexOf(item.hrid);
                        if (index > -1) {
                            this.filters.selectedItems.splice(index, 1);
                        }
                    }
                });
            });
        };

        renderCheckboxes();
        searchInput.addEventListener('input', (e) => renderCheckboxes(e.target.value));

        popup.appendChild(checkboxContainer);

        // Buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        applyBtn.addEventListener('click', () => {
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        clearBtn.addEventListener('click', () => {
            this.filters.selectedItems = [];
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        buttonContainer.appendChild(applyBtn);
        buttonContainer.appendChild(clearBtn);
        popup.appendChild(buttonContainer);

        return popup;
    }

    /**
     * Create enhancement level filter popup
     * @returns {HTMLElement} Popup element
     */
    createEnhancementFilterPopup() {
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Title
        const title = document.createElement('div');
        title.textContent = 'Filter by Enhancement Level';
        title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
        popup.appendChild(title);

        // Get unique enhancement levels from filtered listings (excluding enhancement filter itself)
        const filteredListings = this.getFilteredListingsExcluding('enhancementLevel');
        const enhLevels = [...new Set(filteredListings.map((l) => l.enhancementLevel))];
        enhLevels.sort((a, b) => a - b);

        // Checkboxes
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = `
            max-height: 250px;
            overflow-y: auto;
            margin-bottom: 10px;
        `;

        enhLevels.forEach((level) => {
            const label = document.createElement('label');
            label.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px;
                cursor: pointer;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.filters.selectedEnhLevels.includes(level);
            checkbox.style.marginRight = '6px';

            const levelText = level > 0 ? `+${level}` : 'No Enhancement';

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(levelText));
            checkboxContainer.appendChild(label);

            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    if (!this.filters.selectedEnhLevels.includes(level)) {
                        this.filters.selectedEnhLevels.push(level);
                    }
                } else {
                    const index = this.filters.selectedEnhLevels.indexOf(level);
                    if (index > -1) {
                        this.filters.selectedEnhLevels.splice(index, 1);
                    }
                }
            });
        });

        popup.appendChild(checkboxContainer);

        // Buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        applyBtn.addEventListener('click', () => {
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        clearBtn.addEventListener('click', () => {
            this.filters.selectedEnhLevels = [];
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        buttonContainer.appendChild(applyBtn);
        buttonContainer.appendChild(clearBtn);
        popup.appendChild(buttonContainer);

        return popup;
    }

    /**
     * Create type filter popup (Buy/Sell)
     * @returns {HTMLElement} Popup element
     */
    createTypeFilterPopup() {
        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 150px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Title
        const title = document.createElement('div');
        title.textContent = 'Filter by Type';
        title.style.cssText = `
            color: #fff;
            font-weight: bold;
            margin-bottom: 10px;
        `;
        popup.appendChild(title);

        // Check which types exist in filtered listings (excluding type filter itself)
        const filteredListings = this.getFilteredListingsExcluding('type');
        const hasBuyOrders = filteredListings.some((l) => !l.isSell);
        const hasSellOrders = filteredListings.some((l) => l.isSell);

        // Buy checkbox
        if (hasBuyOrders) {
            const buyLabel = document.createElement('label');
            buyLabel.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px;
                cursor: pointer;
                margin-bottom: 6px;
            `;

            const buyCheckbox = document.createElement('input');
            buyCheckbox.type = 'checkbox';
            buyCheckbox.checked = this.filters.selectedTypes.includes('buy');
            buyCheckbox.style.marginRight = '6px';

            buyLabel.appendChild(buyCheckbox);
            buyLabel.appendChild(document.createTextNode('Buy Orders'));
            popup.appendChild(buyLabel);

            buyCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    if (!this.filters.selectedTypes.includes('buy')) {
                        this.filters.selectedTypes.push('buy');
                    }
                } else {
                    const index = this.filters.selectedTypes.indexOf('buy');
                    if (index > -1) {
                        this.filters.selectedTypes.splice(index, 1);
                    }
                }
            });
        }

        // Sell checkbox
        if (hasSellOrders) {
            const sellLabel = document.createElement('label');
            sellLabel.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px;
                cursor: pointer;
            `;

            const sellCheckbox = document.createElement('input');
            sellCheckbox.type = 'checkbox';
            sellCheckbox.checked = this.filters.selectedTypes.includes('sell');
            sellCheckbox.style.marginRight = '6px';

            sellLabel.appendChild(sellCheckbox);
            sellLabel.appendChild(document.createTextNode('Sell Orders'));
            popup.appendChild(sellLabel);

            sellCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    if (!this.filters.selectedTypes.includes('sell')) {
                        this.filters.selectedTypes.push('sell');
                    }
                } else {
                    const index = this.filters.selectedTypes.indexOf('sell');
                    if (index > -1) {
                        this.filters.selectedTypes.splice(index, 1);
                    }
                }
            });
        }

        // Buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 10px;
        `;

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        applyBtn.addEventListener('click', () => {
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        clearBtn.addEventListener('click', () => {
            this.filters.selectedTypes = [];
            this.saveFilters();
            this.applyFilters();
            this.renderTable();
            popup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        });

        buttonContainer.appendChild(applyBtn);
        buttonContainer.appendChild(clearBtn);
        popup.appendChild(buttonContainer);

        return popup;
    }

    /**
     * Clear all active filters
     */
    async clearAllFilters() {
        this.filters.dateFrom = null;
        this.filters.dateTo = null;
        this.filters.selectedItems = [];
        this.filters.selectedEnhLevels = [];
        this.filters.selectedTypes = [];

        await this.saveFilters();
        this.applyFilters();
        this.renderTable();
    }

    /**
     * Disable the feature
     */
    disable() {
        // Note: We don't need to disconnect observer since we're using the shared settings UI observer

        // Clean up any active filter popup and its event listener
        if (this.activeFilterPopup) {
            this.activeFilterPopup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        }
        if (this.popupCloseHandler) {
            document.removeEventListener('click', this.popupCloseHandler);
            this.popupCloseHandler = null;
        }

        this.timerRegistry.clearAll();

        // Remove modal and all its event listeners
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }

        // Remove settings button
        const button = document.querySelector('.mwi-market-history-button');
        if (button) {
            button.remove();
        }

        // Clear data references
        this.listings = [];
        this.filteredListings = [];
        this.cachedDateRange = null;

        this.isInitialized = false;
    }
}

const marketHistoryViewer = new MarketHistoryViewer();

export default marketHistoryViewer;
