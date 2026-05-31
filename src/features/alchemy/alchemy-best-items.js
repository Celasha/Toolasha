/**
 * Alchemy Best Items
 * Shows a ranked table of all eligible items by profit/hr or XP/hr
 * for the active alchemy type (Coinify, Decompose, Transmute).
 */

import { t } from '../../core/i18n.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import alchemyProfitCalculator from '../market/alchemy-profit-calculator.js';
import { calculateExperienceMultiplier } from '../../utils/experience-parser.js';
import { formatKMB, formatWithSeparator, formatPercentage } from '../../utils/formatters.js';
import { getItemPrice } from '../../utils/market-data.js';
import assetManifest from '../../utils/asset-manifest.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

const ALCHEMY_TYPES = ['coinify', 'decompose', 'transmute'];

const CATALYST_LABELS = {
    '/items/catalyst_of_coinification': 'Coinify',
    '/items/catalyst_of_decomposition': 'Decompose',
    '/items/catalyst_of_transmutation': 'Transmute',
    '/items/prime_catalyst': 'Prime',
};

/**
 * Get base XP for an alchemy action type and item level
 * (mirrors alchemy-profit-display.js getAlchemyBaseXP)
 */
function getAlchemyBaseXP(actionType, itemLevel) {
    switch (actionType) {
        case 'coinify':
            return itemLevel + 10;
        case 'decompose':
            return itemLevel * 1.4 + 14;
        case 'transmute':
            return itemLevel * 1.6 + 16;
        default:
            return 0;
    }
}

/**
 * Calculate expected XP per action for an item
 */
function calcXpPerAction(actionType, itemLevel, successRate) {
    const baseXP = getAlchemyBaseXP(actionType, itemLevel);
    if (baseXP === 0) return 0;

    const xpData = calculateExperienceMultiplier('/skills/alchemy', '/action_types/alchemy');
    const fullXP = baseXP * xpData.totalMultiplier;

    // Expected value: success gives full XP, failure gives 10%
    return successRate * fullXP + (1 - successRate) * fullXP * 0.1;
}

class AlchemyBestItems {
    constructor() {
        this.isInitialized = false;
        this.modal = null;
        this.alchemyTab = null;
        this.tabWatcher = null;
        this.cachedRankings = {}; // { coinify: [...], decompose: [...], transmute: [...] }
        this.sortMode = 'profit'; // 'profit' or 'xp'
        this.currentType = 'coinify';
        this.itemsSpriteUrl = null;
        this.profitableOnly = false;
        this.searchQuery = '';
        this.filterProfitMin = null;
        this.filterProfitMax = null;
        this.filterPriceMin = null;
        this.filterPriceMax = null;
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('alchemy_bestItems')) return;

        this.isInitialized = true;
        this.addAlchemyTab();
    }

    disable() {
        if (this.tabWatcher) {
            this.tabWatcher();
            this.tabWatcher = null;
        }
        if (this.alchemyTab?.parentNode) {
            this.alchemyTab.remove();
            this.alchemyTab = null;
        }
        if (this.modal?.parentNode) this.modal.remove();
        this.modal = null;
        this.cachedRankings = {};
        this.isInitialized = false;
    }

    /**
     * Inject "Best Items" tab into the alchemy tab bar
     */
    addAlchemyTab() {
        const ensureTabExists = () => {
            const tablist = document.querySelector('[role="tablist"]');
            if (!tablist) return;

            // Verify this is the alchemy tablist
            const hasCoinify = Array.from(tablist.children).some(
                (btn) => btn.textContent.includes('Coinify') && !btn.dataset.mwiBestItemsTab
            );
            if (!hasCoinify) return;

            // Already injected?
            if (tablist.querySelector('[data-mwi-best-items-tab="true"]')) return;

            // Clone an existing tab for structure
            const referenceTab = Array.from(tablist.children).find(
                (btn) => btn.textContent.includes('Coinify') && !btn.dataset.mwiBestItemsTab
            );
            if (!referenceTab) return;

            const tab = referenceTab.cloneNode(true);
            tab.setAttribute('data-mwi-best-items-tab', 'true');
            tab.classList.remove('Mui-selected');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('tabindex', '-1');

            // Set label
            const badge = tab.querySelector('.TabsComponent_badge__1Du26');
            if (badge) {
                const badgeSpan = badge.querySelector('.MuiBadge-badge');
                badge.textContent = '';
                badge.appendChild(document.createTextNode(t('Best Items')));
                if (badgeSpan) badge.appendChild(badgeSpan);
            } else {
                tab.textContent = t('Best Items');
            }

            tab.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openModal();
            });

            tablist.appendChild(tab);
            this.alchemyTab = tab;
        };

        // Watch for DOM changes that recreate the tablist
        if (!this.tabWatcher) {
            this.tabWatcher = createMutationWatcher(
                document.body,
                () => {
                    if (this.alchemyTab && !document.body.contains(this.alchemyTab)) {
                        this.alchemyTab = null;
                    }
                    ensureTabExists();
                },
                { childList: true, subtree: true }
            );
        }

        ensureTabExists();
    }

    /**
     * Detect which alchemy tab is active
     * @returns {string} 'coinify', 'decompose', or 'transmute'
     */
    detectAlchemyType() {
        const tabContainer = document.querySelector('[class*="AlchemyPanel_tabsComponentContainer"]');
        const selectedTab = tabContainer?.querySelector('[role="tab"][aria-selected="true"]');
        const text = selectedTab?.textContent?.trim()?.toLowerCase() || '';

        if (text.includes('decompose')) return 'decompose';
        if (text.includes('transmute')) return 'transmute';
        return 'coinify';
    }

    /**
     * Calculate rankings for a given alchemy type
     * @param {string} alchemyType - 'coinify', 'decompose', or 'transmute'
     * @returns {Array} Sorted array of item results
     */
    calculateRankings(alchemyType) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return [];

        const results = [];
        const calcMethod =
            alchemyType === 'coinify'
                ? 'calculateCoinifyProfit'
                : alchemyType === 'decompose'
                  ? 'calculateDecomposeProfit'
                  : 'calculateTransmuteProfit';

        for (const [itemHrid, itemDetails] of Object.entries(gameData.itemDetailMap)) {
            if (!itemDetails.alchemyDetail) continue;

            // Check eligibility for this alchemy type (match calculator's checks)
            if (alchemyType === 'coinify' && !itemDetails.alchemyDetail.isCoinifiable) continue;
            if (alchemyType === 'decompose' && !itemDetails.alchemyDetail.decomposeItems) continue;
            if (alchemyType === 'transmute' && !itemDetails.alchemyDetail.transmuteDropTable) continue;

            let profitData;
            try {
                if (alchemyType === 'transmute') {
                    profitData = alchemyProfitCalculator[calcMethod](itemHrid);
                } else {
                    profitData = alchemyProfitCalculator[calcMethod](itemHrid, 0);
                }
            } catch {
                continue;
            }

            if (!profitData) continue;

            const itemLevel = itemDetails.itemLevel || 1;
            const xpPerAction = calcXpPerAction(alchemyType, itemLevel, profitData.successRate);
            const xpPerHour = profitData.actionsPerHour * xpPerAction;

            results.push({
                itemHrid,
                name: itemDetails.name,
                itemLevel,
                itemPrice: getItemPrice(itemHrid, { context: 'profit', side: 'buy' }) || 0,
                profitPerHour: profitData.profitPerHour,
                xpPerHour,
                catalyst: profitData.winningCatalystHrid || null,
                profitData,
            });
        }

        return results;
    }

    /**
     * Open the modal with rankings for the current alchemy type
     */
    async openModal() {
        this.currentType = this.detectAlchemyType();

        // Ensure sprite URL is loaded for catalyst icons
        if (!this.itemsSpriteUrl) {
            this.itemsSpriteUrl = await assetManifest.getSpriteUrl('items');
        }

        // Always recalculate on open so tea/gear changes are reflected
        this.cachedRankings[this.currentType] = this.calculateRankings(this.currentType);

        if (!this.modal) {
            this.createModal();
        }

        this.modal.style.display = 'flex';
        this.renderTable();
    }

    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Invalidate cached rankings (call when prices update)
     */
    invalidateCache() {
        this.cachedRankings = {};
    }

    createModal() {
        this.modal = document.createElement('div');
        this.modal.className = 'mwi-alchemy-best-items-modal';
        this.modal.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.8);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        const content = document.createElement('div');
        content.className = 'mwi-alchemy-best-items-content';
        content.style.cssText = `
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            min-width: 500px;
            max-width: 95vw;
            max-height: 90%;
            overflow: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';

        const title = document.createElement('h3');
        title.style.cssText = 'margin: 0; color: #fff;';
        title.setAttribute('data-mwi-best-title', 'true');
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText = 'background: none; border: none; color: #fff; font-size: 20px; cursor: pointer;';
        closeBtn.addEventListener('click', () => this.closeModal());
        header.appendChild(closeBtn);

        content.appendChild(header);

        // Controls row: alchemy type tabs + sort toggle
        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;';

        // Alchemy type tabs
        for (const type of ALCHEMY_TYPES) {
            const tab = document.createElement('button');
            tab.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            tab.setAttribute('data-mwi-type-tab', type);
            tab.style.cssText = `
                padding: 4px 12px; border-radius: 4px; cursor: pointer;
                border: 1px solid #555; font-size: 0.8rem; color: #fff;
            `;
            tab.addEventListener('click', () => {
                this.currentType = type;
                this.cachedRankings[type] = this.calculateRankings(type);
                this.renderTable();
            });
            controls.appendChild(tab);
        }

        // Spacer
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        controls.appendChild(spacer);

        // Sort toggle
        const sortLabel = document.createElement('span');
        sortLabel.style.cssText = 'color: #aaa; font-size: 0.75rem;';
        sortLabel.textContent = t('Sort by:');
        controls.appendChild(sortLabel);

        for (const mode of ['profit', 'xp']) {
            const btn = document.createElement('button');
            btn.textContent = mode === 'profit' ? t('Profit/hr') : t('XP/hr');
            btn.setAttribute('data-mwi-sort-btn', mode);
            btn.style.cssText = `
                padding: 3px 8px; border-radius: 4px; cursor: pointer;
                border: 1px solid #555; font-size: 0.75rem; color: #fff;
            `;
            btn.addEventListener('click', () => {
                this.sortMode = mode;
                this.renderTable();
            });
            controls.appendChild(btn);
        }

        // Profitable only toggle
        const profitToggle = document.createElement('button');
        profitToggle.setAttribute('data-mwi-profit-toggle', 'true');
        profitToggle.textContent = t('Profitable only');
        profitToggle.style.cssText = `
            padding: 3px 8px; border-radius: 4px; cursor: pointer;
            border: 1px solid #555; font-size: 0.75rem; color: #fff;
            margin-left: 4px;
        `;
        profitToggle.addEventListener('click', () => {
            this.profitableOnly = !this.profitableOnly;
            this.renderTable();
        });
        controls.appendChild(profitToggle);

        content.appendChild(controls);

        // Search row
        const searchRow = document.createElement('div');
        searchRow.style.cssText = 'display: flex; margin-bottom: 8px;';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = t('Search items...');
        searchInput.setAttribute('data-mwi-best-search', 'true');
        searchInput.style.cssText = `
            flex: 1; padding: 5px 10px; border-radius: 4px;
            border: 1px solid #555; background: #1a1a2e; color: #fff;
            font-size: 0.8rem; outline: none;
        `;
        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value.trim().toLowerCase();
            this.renderTable();
        });
        searchRow.appendChild(searchInput);
        content.appendChild(searchRow);

        // Filter row: profit/hr and item price ranges
        const filterRow = document.createElement('div');
        filterRow.style.cssText =
            'display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; align-items: center; font-size: 0.75rem; color: #aaa;';

        const filterInputStyle = `
            width: 70px; padding: 3px 6px; border-radius: 3px;
            border: 1px solid #555; background: #1a1a2e; color: #fff;
            font-size: 0.75rem; outline: none;
        `;

        // Profit/hr filter
        const profitFilter = document.createElement('span');
        profitFilter.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        profitFilter.innerHTML = t('Profit/hr:');
        const profitMin = document.createElement('input');
        profitMin.type = 'text';
        profitMin.placeholder = t('Min');
        profitMin.style.cssText = filterInputStyle;
        const profitMax = document.createElement('input');
        profitMax.type = 'text';
        profitMax.placeholder = t('Max');
        profitMax.style.cssText = filterInputStyle;

        const parseFilterValue = (val) => {
            if (!val) return null;
            val = val.trim().toLowerCase();
            const multipliers = { k: 1e3, m: 1e6, b: 1e9 };
            const match = val.match(/^(-?[\d.]+)\s*([kmb])?$/);
            if (!match) return null;
            const num = parseFloat(match[1]);
            return isNaN(num) ? null : num * (multipliers[match[2]] || 1);
        };

        const onFilterChange = () => {
            this.filterProfitMin = parseFilterValue(profitMin.value);
            this.filterProfitMax = parseFilterValue(profitMax.value);
            this.filterPriceMin = parseFilterValue(priceMin.value);
            this.filterPriceMax = parseFilterValue(priceMax.value);
            this.renderTable();
        };

        profitMin.addEventListener('change', onFilterChange);
        profitMax.addEventListener('change', onFilterChange);
        profitFilter.appendChild(profitMin);
        profitFilter.appendChild(document.createTextNode('–'));
        profitFilter.appendChild(profitMax);
        filterRow.appendChild(profitFilter);

        // Item price filter
        const priceFilter = document.createElement('span');
        priceFilter.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        priceFilter.innerHTML = t('Item price:');
        const priceMin = document.createElement('input');
        priceMin.type = 'text';
        priceMin.placeholder = t('Min');
        priceMin.style.cssText = filterInputStyle;
        const priceMax = document.createElement('input');
        priceMax.type = 'text';
        priceMax.placeholder = t('Max');
        priceMax.style.cssText = filterInputStyle;
        priceMin.addEventListener('change', onFilterChange);
        priceMax.addEventListener('change', onFilterChange);
        priceFilter.appendChild(priceMin);
        priceFilter.appendChild(document.createTextNode('–'));
        priceFilter.appendChild(priceMax);
        filterRow.appendChild(priceFilter);

        content.appendChild(filterRow);

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.setAttribute('data-mwi-best-table', 'true');
        content.appendChild(tableContainer);

        this.modal.appendChild(content);
        document.body.appendChild(this.modal);
    }

    renderTable() {
        if (!this.modal) return;

        const rankings = this.cachedRankings[this.currentType] || [];

        // Filter
        let filtered = this.profitableOnly ? rankings.filter((r) => r.profitPerHour > 0) : rankings;
        if (this.searchQuery) {
            filtered = filtered.filter((r) => r.name.toLowerCase().includes(this.searchQuery));
        }
        if (this.filterProfitMin !== null) {
            filtered = filtered.filter((r) => r.profitPerHour >= this.filterProfitMin);
        }
        if (this.filterProfitMax !== null) {
            filtered = filtered.filter((r) => r.profitPerHour <= this.filterProfitMax);
        }
        if (this.filterPriceMin !== null) {
            filtered = filtered.filter((r) => r.itemPrice >= this.filterPriceMin);
        }
        if (this.filterPriceMax !== null) {
            filtered = filtered.filter((r) => r.itemPrice <= this.filterPriceMax);
        }

        // Sort
        const sorted = [...filtered].sort((a, b) => {
            if (this.sortMode === 'xp') return b.xpPerHour - a.xpPerHour;
            return b.profitPerHour - a.profitPerHour;
        });

        // Update title
        const title = this.modal.querySelector('[data-mwi-best-title]');
        if (title) {
            const typeLabel = this.currentType.charAt(0).toUpperCase() + this.currentType.slice(1);
            title.textContent = t('Best Items — {0}', typeLabel);
        }

        // Update tab styling
        this.modal.querySelectorAll('[data-mwi-type-tab]').forEach((tab) => {
            const isActive = tab.getAttribute('data-mwi-type-tab') === this.currentType;
            tab.style.background = isActive ? config.SCRIPT_COLOR_PRIMARY : 'transparent';
        });

        // Update sort button styling
        this.modal.querySelectorAll('[data-mwi-sort-btn]').forEach((btn) => {
            const isActive = btn.getAttribute('data-mwi-sort-btn') === this.sortMode;
            btn.style.background = isActive ? '#555' : 'transparent';
        });

        // Update profitable toggle styling
        const profitToggle = this.modal.querySelector('[data-mwi-profit-toggle]');
        if (profitToggle) {
            profitToggle.style.background = this.profitableOnly ? '#555' : 'transparent';
        }

        // Build table
        const container = this.modal.querySelector('[data-mwi-best-table]');
        if (!container) return;

        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 0.8rem;';

        // Header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'border-bottom: 1px solid #555;';

        for (const col of ['#', 'Item', 'Lvl', 'Catalyst', 'Profit/hr', 'XP/hr']) {
            const th = document.createElement('th');
            th.textContent = t(col);
            th.style.cssText = 'padding: 6px 8px; text-align: left; color: #aaa; font-weight: 500;';
            if (col === '#' || col === 'Lvl') th.style.textAlign = 'center';
            if (col === 'Profit/hr' || col === 'XP/hr') th.style.textAlign = 'right';
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');
        const maxRows = 100;

        for (let i = 0; i < Math.min(sorted.length, maxRows); i++) {
            const item = sorted[i];
            const row = document.createElement('tr');
            row.style.cssText = 'border-bottom: 1px solid #333;';

            // Rank
            const rankTd = document.createElement('td');
            rankTd.textContent = i + 1;
            rankTd.style.cssText = 'padding: 4px 8px; text-align: center; color: #888;';
            row.appendChild(rankTd);

            // Name
            const nameTd = document.createElement('td');
            nameTd.textContent = item.name;
            nameTd.style.cssText = 'padding: 4px 8px; color: #ddd;';
            row.appendChild(nameTd);

            // Level
            const levelTd = document.createElement('td');
            levelTd.textContent = item.itemLevel;
            levelTd.style.cssText = 'padding: 4px 8px; text-align: center; color: #888;';
            row.appendChild(levelTd);

            // Catalyst
            const catTd = document.createElement('td');
            catTd.style.cssText = 'padding: 4px 8px; text-align: center;';
            if (item.catalyst && this.itemsSpriteUrl) {
                const symbolId = item.catalyst.replace('/items/', '');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                svg.setAttribute('viewBox', '0 0 1024 1024');
                svg.style.verticalAlign = 'middle';
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                use.setAttribute('href', `${this.itemsSpriteUrl}#${symbolId}`);
                svg.appendChild(use);
                catTd.appendChild(svg);
                catTd.title = CATALYST_LABELS[item.catalyst] || symbolId;
            } else {
                catTd.textContent = '\u2014';
                catTd.style.color = '#555';
            }
            row.appendChild(catTd);

            // Profit/hr
            const profitTd = document.createElement('td');
            const profitVal = Math.round(item.profitPerHour);
            profitTd.textContent = formatKMB(profitVal);
            profitTd.style.cssText = `padding: 4px 8px; text-align: right; color: ${profitVal >= 0 ? '#4ade80' : '#f87171'};`;
            row.appendChild(profitTd);

            // XP/hr
            const xpTd = document.createElement('td');
            xpTd.textContent = formatKMB(Math.round(item.xpPerHour));
            xpTd.style.cssText = 'padding: 4px 8px; text-align: right; color: #93c5fd;';
            row.appendChild(xpTd);

            row.style.cursor = 'pointer';
            row.addEventListener('click', () => this.toggleBreakdown(row, item, tbody));

            tbody.appendChild(row);
        }

        table.appendChild(tbody);

        container.innerHTML = '';

        if (sorted.length === 0) {
            container.innerHTML =
                '<div style="color: #888; padding: 20px; text-align: center;">' +
                t('No eligible items found') +
                '</div>';
        } else {
            container.appendChild(table);
            if (sorted.length > maxRows) {
                const more = document.createElement('div');
                more.style.cssText = 'color: #888; text-align: center; padding: 8px; font-size: 0.75rem;';
                more.textContent = t('Showing top {0} of {1} items', maxRows, sorted.length);
                container.appendChild(more);
            }
        }
    }

    /**
     * Toggle breakdown expansion for a row
     */
    toggleBreakdown(row, item, tbody) {
        const existing = row.nextElementSibling;
        if (existing?.classList.contains('mwi-best-items-breakdown')) {
            existing.remove();
            return;
        }

        // Collapse any other open breakdown
        tbody.querySelectorAll('.mwi-best-items-breakdown').forEach((el) => el.remove());

        const expansionRow = document.createElement('tr');
        expansionRow.classList.add('mwi-best-items-breakdown');
        const td = document.createElement('td');
        td.setAttribute('colspan', '6');
        td.style.cssText = 'padding: 8px 16px; background: #1e1e1e; font-size: 0.75rem;';
        td.appendChild(this.renderBreakdownContent(item));
        expansionRow.appendChild(td);
        row.after(expansionRow);
    }

    /**
     * Render breakdown content for an expanded item row
     */
    renderBreakdownContent(item) {
        const container = document.createElement('div');
        const profitData = item.profitData;

        if (!profitData) {
            container.textContent = t('No breakdown data available');
            container.style.color = '#888';
            return container;
        }

        // Revenue section
        if (profitData.dropRevenues?.length > 0) {
            const revenueHeader = document.createElement('div');
            revenueHeader.style.cssText = 'color: #fff; font-weight: 500; margin-bottom: 2px;';
            const totalRevenue = profitData.dropRevenues
                .filter((d) => !d.isSelfReturn)
                .reduce((sum, d) => sum + d.revenuePerHour, 0);
            revenueHeader.textContent = t('Revenue: {0}/hr', formatKMB(Math.round(totalRevenue)));
            container.appendChild(revenueHeader);

            for (const drop of profitData.dropRevenues) {
                const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                const itemName = itemDetails?.name || drop.itemHrid.split('/').pop();
                const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                const dropsDisplay =
                    drop.dropsPerHour >= 10000
                        ? formatKMB(Math.round(drop.dropsPerHour))
                        : drop.dropsPerHour.toFixed(2);

                const line = document.createElement('div');
                line.style.cssText = 'margin-left: 8px; color: #aaa;';
                if (drop.isSelfReturn) {
                    line.style.textDecoration = 'line-through';
                    line.style.opacity = '0.6';
                }
                line.textContent = `\u2022 ${itemName}: ${dropsDisplay}/hr (${dropRatePct} \u00d7 ${formatPercentage(profitData.successRate, 1)} success) @ ${formatWithSeparator(Math.round(drop.price))} \u2192 ${formatKMB(Math.round(drop.revenuePerHour))}/hr`;
                container.appendChild(line);
            }
        }

        // Costs section
        const totalCosts =
            (profitData.materialCostPerHour || 0) +
            (profitData.catalystCostPerHour || 0) +
            (profitData.totalTeaCostPerHour || 0);

        if (totalCosts > 0 || profitData.requirementCosts?.length > 0) {
            const costsHeader = document.createElement('div');
            costsHeader.style.cssText = 'color: #fff; font-weight: 500; margin-top: 6px; margin-bottom: 2px;';
            costsHeader.textContent = t('Costs: {0}/hr', formatKMB(Math.round(totalCosts)));
            container.appendChild(costsHeader);

            // Input materials
            if (profitData.requirementCosts) {
                for (const req of profitData.requirementCosts) {
                    const itemDetails = dataManager.getItemDetails(req.itemHrid);
                    const itemName = itemDetails?.name || req.itemHrid.split('/').pop();
                    const line = document.createElement('div');
                    line.style.cssText = 'margin-left: 8px; color: #aaa;';
                    line.textContent = `\u2022 ${itemName}: ${req.count}\u00d7 @ ${formatWithSeparator(Math.round(req.price))} \u2192 ${formatKMB(Math.round(req.costPerHour))}/hr`;
                    container.appendChild(line);
                }
            }

            // Catalyst
            if (profitData.catalystCost?.itemHrid && profitData.catalystCostPerHour > 0) {
                const catDetails = dataManager.getItemDetails(profitData.catalystCost.itemHrid);
                const catName = catDetails?.name || profitData.catalystCost.itemHrid.split('/').pop();
                const line = document.createElement('div');
                line.style.cssText = 'margin-left: 8px; color: #aaa;';
                line.textContent = `\u2022 ${catName} @ ${formatWithSeparator(Math.round(profitData.catalystCost.price))} \u2192 ${formatKMB(Math.round(profitData.catalystCostPerHour))}/hr`;
                container.appendChild(line);
            }

            // Tea
            if (profitData.consumableCosts?.length > 0) {
                for (const tea of profitData.consumableCosts) {
                    const teaDetails = dataManager.getItemDetails(tea.itemHrid);
                    const teaName = teaDetails?.name || tea.itemHrid.split('/').pop();
                    const line = document.createElement('div');
                    line.style.cssText = 'margin-left: 8px; color: #aaa;';
                    line.textContent = `\u2022 ${teaName} \u2192 ${formatKMB(Math.round(tea.costPerHour))}/hr`;
                    container.appendChild(line);
                }
            }
        }

        // Stats line
        const statsLine = document.createElement('div');
        statsLine.style.cssText = 'color: #888; margin-top: 6px; font-size: 0.7rem;';
        const parts = [];
        if (profitData.actionsPerHour) parts.push(`${Math.round(profitData.actionsPerHour)}/hr`);
        if (profitData.successRate) parts.push(`${formatPercentage(profitData.successRate, 1)} success`);
        if (profitData.efficiency != null) parts.push(`${formatPercentage(profitData.efficiency, 1)} efficiency`);
        statsLine.textContent = parts.join(' | ');
        container.appendChild(statsLine);

        return container;
    }
}

const alchemyBestItems = new AlchemyBestItems();

export default alchemyBestItems;
