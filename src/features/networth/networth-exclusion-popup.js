/**
 * Networth Exclusion Popup
 * Draggable modal for managing net worth exclusions.
 * Shows current exclusions as removable chips and a searchable list of all excludable entries.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import { networthFormatter } from '../../utils/formatters.js';
import { getExclusions, isExcluded, addExclusion, removeExclusion, clearExclusions } from './networth-exclusions.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';

class NetworthExclusionPopup {
    constructor() {
        this.container = null;
        this.networthData = null;
        this.onChangeFn = null;
        this.searchList = [];
        this.searchTimeout = null;
        this.expandedEntries = new Set();

        // Dragging state
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.dragMoveHandler = null;
        this.dragUpHandler = null;
        this.clickOutsideHandler = null;
    }

    /**
     * Open (or refresh) the popup.
     * @param {Object} networthData - Current net worth data from calculator
     * @param {Function} onChangeFn - Called after an exclusion is added/removed
     */
    open(networthData, onChangeFn) {
        this.networthData = networthData;
        this.onChangeFn = onChangeFn;
        this.searchList = this._buildSearchList(networthData);

        if (this.container) {
            bringPanelToFront(this.container);
            this._refreshContent();
            return;
        }

        this._build();
    }

    /**
     * Close and remove the popup.
     */
    close() {
        this._teardown();
    }

    /**
     * Refresh the popup content (called after add/remove exclusion).
     * @param {Object} [networthData] - Updated net worth data (optional)
     */
    refresh(networthData) {
        if (networthData) {
            this.networthData = networthData;
            this.searchList = this._buildSearchList(networthData);
        }
        if (this.container) {
            this._refreshContent();
        }
    }

    // ─── Private ────────────────────────────────────────────────

    /**
     * Build the flat list of all excludable entries for the search.
     * @param {Object} networthData
     * @returns {Array<{type, value, name, amount}>}
     */
    _buildSearchList(networthData) {
        const entries = [];
        const seen = new Map();
        const add = (entry) => {
            const key = `${entry.type}:${entry.value}`;
            const existing = seen.get(key);
            if (!existing) {
                seen.set(key, entry);
                entries.push(entry);
            } else if (entry.amount > existing.amount) {
                existing.amount = entry.amount;
            }
        };

        // Asset types — only show if not already excluded and have remaining value
        const ca = networthData?.currentAssets;
        const fa = networthData?.fixedAssets;
        if (!isExcluded('assetType', 'equipped') && (ca?.equipped?.value ?? 0) > 0)
            add({ type: 'assetType', value: 'equipped', name: 'All Equipped Items', amount: ca.equipped.value });
        if (!isExcluded('assetType', 'listings') && (ca?.listings?.value ?? 0) > 0)
            add({ type: 'assetType', value: 'listings', name: 'All Market Listings', amount: ca.listings.value });
        if (!isExcluded('assetType', 'houses') && (fa?.houses?.totalCost ?? 0) > 0)
            add({ type: 'assetType', value: 'houses', name: 'All Houses', amount: fa.houses.totalCost });
        if (!isExcluded('assetType', 'abilities') && (fa?.abilities?.totalCost ?? 0) > 0)
            add({ type: 'assetType', value: 'abilities', name: 'All Abilities', amount: fa.abilities.totalCost });
        if (!isExcluded('assetType', 'abilityBooks') && (fa?.abilityBooks?.totalCost ?? 0) > 0)
            add({
                type: 'assetType',
                value: 'abilityBooks',
                name: 'All Ability Books',
                amount: fa.abilityBooks.totalCost,
            });

        // Inventory categories — byCategory already reflects post-exclusion items
        for (const [catName, catData] of Object.entries(ca?.inventory?.byCategory ?? {})) {
            if (isExcluded('category', catData.categoryHrid)) continue;
            add({
                type: 'category',
                value: catData.categoryHrid,
                name: `${catName} (category)`,
                amount: catData.totalValue,
            });
        }

        // Individual items — post-exclusion breakdowns only contain included items
        const itemAmounts = new Map();
        for (const item of [...(ca?.inventory?.breakdown ?? []), ...(ca?.equipped?.breakdown ?? [])]) {
            if (!item.itemHrid) continue;
            const cur = itemAmounts.get(item.itemHrid) ?? { name: item.name, amount: 0 };
            cur.amount += item.value;
            itemAmounts.set(item.itemHrid, cur);
        }
        for (const [itemHrid, { name, amount }] of itemAmounts) {
            if (isExcluded('item', itemHrid)) continue;
            add({ type: 'item', value: itemHrid, name, amount });
        }

        // Individual house rooms — breakdown already reflects post-exclusion
        for (const room of fa?.houses?.breakdown ?? []) {
            if (!room.hrid || isExcluded('houseRoom', room.hrid)) continue;
            add({ type: 'houseRoom', value: room.hrid, name: room.name, amount: room.cost });
        }

        // Individual abilities — breakdown already reflects post-exclusion
        for (const ability of fa?.abilities?.breakdown ?? []) {
            if (!ability.hrid || isExcluded('ability', ability.hrid)) continue;
            add({ type: 'ability', value: ability.hrid, name: ability.name, amount: ability.cost });
        }

        // Loadout snapshots — only show if not already excluded
        for (const snapshot of loadoutSnapshot.getAllSnapshots()) {
            if (!snapshot.name || isExcluded('loadout', snapshot.name)) continue;
            const amount = snapshot.equipment.reduce((sum, eq) => {
                const price = marketAPI.getPrice(eq.itemHrid);
                return sum + (price?.ask ?? 0);
            }, 0);
            add({ type: 'loadout', value: snapshot.name, name: `Loadout: ${snapshot.name}`, amount });
        }

        // Sort by amount descending
        entries.sort((a, b) => b.amount - a.amount);
        return entries;
    }

    /**
     * Filter search list by query string.
     * @param {string} query
     * @returns {Array}
     */
    _filterEntries(query) {
        if (!query) return this.searchList.slice(0, 40);
        const lower = query.toLowerCase();
        return this.searchList.filter((e) => e.name.toLowerCase().includes(lower)).slice(0, 40);
    }

    /**
     * Build and insert the popup DOM.
     */
    _build() {
        this.container = document.createElement('div');
        this.container.id = 'mwi-networth-exclusion-popup';
        this.container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: ${config.Z_FLOATING_PANEL};
            width: 400px;
            max-height: 580px;
            display: flex;
            flex-direction: column;
            background: rgba(10, 10, 20, 0.96);
            border: 2px solid ${config.COLOR_ACCENT};
            border-radius: 8px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            user-select: none;
            overflow: hidden;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            cursor: grab;
            background: rgba(255,255,255,0.04);
            flex-shrink: 0;
        `;

        const title = document.createElement('span');
        title.style.cssText = `font-size: 0.9rem; font-weight: 600; color: ${config.COLOR_ACCENT};`;
        title.textContent = 'Net Worth Exclusions';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: none; border: none; color: #aaa;
            font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 0 2px;
        `;
        closeBtn.addEventListener('mouseenter', () => (closeBtn.style.color = '#fff'));
        closeBtn.addEventListener('mouseleave', () => (closeBtn.style.color = '#aaa'));
        closeBtn.addEventListener('click', () => this.close());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Scrollable body
        const body = document.createElement('div');
        body.id = 'mwi-nex-body';
        body.style.cssText = `flex: 1; overflow-y: auto; padding: 10px 14px;`;

        this.container.appendChild(header);
        this.container.appendChild(body);
        document.body.appendChild(this.container);
        registerFloatingPanel(this.container);

        this._renderBody(body);
        this._setupDragging(header);
        this._setupClickOutside();
    }

    /**
     * Refresh the body contents without rebuilding the whole popup.
     */
    _refreshContent() {
        const body = this.container?.querySelector('#mwi-nex-body');
        if (!body) return;
        const prevQuery = body.querySelector('input[type="search"]')?.value ?? '';
        body.innerHTML = '';
        this._renderBody(body, prevQuery);
    }

    /**
     * Render the full body: current exclusions + search.
     * @param {HTMLElement} body
     * @param {string} [initialQuery=''] - Pre-fill search query (preserved across refreshes)
     */
    _renderBody(body, initialQuery = '') {
        const exclusions = getExclusions();

        // ── Current exclusions section ──
        const currentSection = document.createElement('div');
        currentSection.style.cssText = `margin-bottom: 10px;`;

        const currentLabel = document.createElement('div');
        currentLabel.style.cssText = `font-size: 0.75rem; color: rgba(255,255,255,0.45); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between;`;

        const labelText = document.createElement('span');
        labelText.textContent = exclusions.length > 0 ? 'Current Exclusions' : 'No exclusions configured';
        currentLabel.appendChild(labelText);

        if (exclusions.length > 0) {
            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear All';
            clearBtn.style.cssText = `
                background: transparent;
                border: 1px solid rgba(255,100,100,0.4);
                color: rgba(255,100,100,0.7);
                border-radius: 3px;
                padding: 1px 7px;
                font-size: 0.7rem;
                cursor: pointer;
                text-transform: none;
                letter-spacing: 0;
            `;
            clearBtn.addEventListener('mouseenter', () => {
                clearBtn.style.borderColor = 'rgba(255,100,100,0.9)';
                clearBtn.style.color = 'rgba(255,100,100,1)';
            });
            clearBtn.addEventListener('mouseleave', () => {
                clearBtn.style.borderColor = 'rgba(255,100,100,0.4)';
                clearBtn.style.color = 'rgba(255,100,100,0.7)';
            });
            clearBtn.addEventListener('click', async () => {
                await clearExclusions();
                this._refreshContent();
                if (this.onChangeFn) this.onChangeFn();
            });
            currentLabel.appendChild(clearBtn);
        }

        currentSection.appendChild(currentLabel);

        if (exclusions.length > 0) {
            const chips = document.createElement('div');
            chips.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px;`;
            for (const exc of exclusions) {
                const displayName = this._resolveExclusionName(exc);
                const chip = this._makeChip(displayName, exc.type, exc.value);
                chips.appendChild(chip);
            }
            currentSection.appendChild(chips);
        }

        body.appendChild(currentSection);

        // Divider
        const divider = document.createElement('div');
        divider.style.cssText = `border-top: 1px solid rgba(255,255,255,0.08); margin-bottom: 10px;`;
        body.appendChild(divider);

        // ── Search section ──
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search items, categories, houses, loadouts...';
        searchInput.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            padding: 7px 10px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 4px;
            color: #fff;
            font-size: 0.85rem;
            outline: none;
            margin-bottom: 8px;
        `;
        searchInput.addEventListener('focus', () => (searchInput.style.borderColor = config.COLOR_ACCENT));
        searchInput.addEventListener('blur', () => (searchInput.style.borderColor = 'rgba(255,255,255,0.15)'));
        searchInput.value = initialQuery;
        body.appendChild(searchInput);

        const results = document.createElement('div');
        results.id = 'mwi-nex-results';
        body.appendChild(results);

        this._renderResults(results, initialQuery);

        searchInput.addEventListener('input', () => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this._renderResults(results, searchInput.value.trim());
            }, 150);
        });

        // Focus the search input (preventScroll avoids snapping body to top on refresh)
        setTimeout(() => searchInput.focus({ preventScroll: true }), 50);
    }

    /**
     * Get breakdown items for a multi-item exclusion entry.
     * @param {Object} entry - Search list entry {type, value, name, amount}
     * @returns {Array<{name, value}>|null} Array of sub-items, or null if not expandable
     */
    _getBreakdownItems(entry) {
        const data = this.networthData;
        if (!data) return null;

        const ca = data.currentAssets;
        const fa = data.fixedAssets;

        if (entry.type === 'assetType') {
            switch (entry.value) {
                case 'equipped':
                    return (ca?.equipped?.breakdown ?? []).map((i) => ({
                        name: i.name,
                        value: i.value ?? 0,
                    }));
                case 'listings':
                    return (ca?.listings?.breakdown ?? []).map((i) => ({
                        name: i.name,
                        value: i.value ?? 0,
                    }));
                case 'houses':
                    return (fa?.houses?.breakdown ?? []).map((i) => ({
                        name: i.name,
                        value: i.cost ?? 0,
                    }));
                case 'abilities':
                    return (fa?.abilities?.breakdown ?? []).map((i) => ({
                        name: i.name,
                        value: i.cost ?? 0,
                    }));
                case 'abilityBooks':
                    return (fa?.abilityBooks?.breakdown ?? []).map((i) => ({
                        name: `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`,
                        value: i.value ?? 0,
                    }));
            }
        }

        if (entry.type === 'category') {
            for (const [, catData] of Object.entries(ca?.inventory?.byCategory ?? {})) {
                if (catData.categoryHrid === entry.value) {
                    return (catData.items ?? []).map((i) => ({
                        name: `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`,
                        value: i.value ?? 0,
                    }));
                }
            }
        }

        if (entry.type === 'loadout') {
            const snapshot = loadoutSnapshot.getAllSnapshots().find((s) => s.name === entry.value);
            if (snapshot) {
                return snapshot.equipment.map((eq) => {
                    const details = dataManager.getItemDetails(eq.itemHrid);
                    const name = details?.name || eq.itemHrid.replace('/items/', '');
                    const price = marketAPI.getPrice(eq.itemHrid);
                    return { name, value: price?.ask ?? 0 };
                });
            }
        }

        return null;
    }

    /**
     * Render the search results list.
     * @param {HTMLElement} container
     * @param {string} query
     */
    _renderResults(container, query) {
        container.innerHTML = '';
        const filtered = this._filterEntries(query);

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = `color: rgba(255,255,255,0.3); font-size: 0.8rem; text-align: center; padding: 12px 0;`;
            empty.textContent = 'No results';
            container.appendChild(empty);
            return;
        }

        for (const entry of filtered) {
            const alreadyExcluded = isExcluded(entry.type, entry.value);
            const breakdownItems = this._getBreakdownItems(entry);
            const entryKey = `${entry.type}:${entry.value}`;
            const isExpanded = this.expandedEntries.has(entryKey);

            const wrapper = document.createElement('div');

            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 5px 6px;
                border-radius: 3px;
                font-size: 0.82rem;
                gap: 8px;
                ${alreadyExcluded ? 'opacity: 0.55;' : ''}
            `;
            row.addEventListener('mouseenter', () => {
                row.style.background = 'rgba(255,255,255,0.05)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = '';
            });

            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;

            if (breakdownItems && breakdownItems.length > 0) {
                const toggle = document.createElement('span');
                toggle.textContent = isExpanded ? '▾ ' : '▸ ';
                toggle.style.cssText = `cursor: pointer; color: rgba(255,255,255,0.4); font-size: 0.7rem; margin-right: 2px;`;
                nameSpan.appendChild(toggle);
                nameSpan.style.cursor = 'pointer';
                nameSpan.addEventListener('click', () => {
                    if (this.expandedEntries.has(entryKey)) {
                        this.expandedEntries.delete(entryKey);
                    } else {
                        this.expandedEntries.add(entryKey);
                    }
                    this._renderResults(container, query);
                });
            }

            nameSpan.appendChild(document.createTextNode(entry.name));

            const amountSpan = document.createElement('span');
            amountSpan.style.cssText = `color: rgba(255,255,255,0.5); white-space: nowrap; font-size: 0.78rem;`;
            amountSpan.textContent = entry.amount > 0 ? networthFormatter(Math.round(entry.amount)) : '';

            const actionBtn = document.createElement('button');
            actionBtn.style.cssText = `
                background: transparent;
                border: 1px solid ${alreadyExcluded ? 'rgba(255,100,100,0.5)' : 'rgba(255,255,255,0.2)'};
                color: ${alreadyExcluded ? 'rgba(255,100,100,0.8)' : 'rgba(255,255,255,0.6)'};
                border-radius: 3px;
                padding: 2px 8px;
                font-size: 0.75rem;
                cursor: pointer;
                white-space: nowrap;
                flex-shrink: 0;
            `;
            actionBtn.textContent = alreadyExcluded ? '✕ Remove' : '+ Exclude';
            actionBtn.addEventListener('mouseenter', () => {
                actionBtn.style.opacity = '1';
                actionBtn.style.borderColor = alreadyExcluded ? 'rgba(255,100,100,0.9)' : config.COLOR_ACCENT;
            });
            actionBtn.addEventListener('mouseleave', () => {
                actionBtn.style.opacity = '';
                actionBtn.style.borderColor = alreadyExcluded ? 'rgba(255,100,100,0.5)' : 'rgba(255,255,255,0.2)';
            });
            actionBtn.addEventListener('click', () => this._toggleExclusion(entry.type, entry.value));

            row.appendChild(nameSpan);
            row.appendChild(amountSpan);
            row.appendChild(actionBtn);
            wrapper.appendChild(row);

            // Expanded detail sub-list
            if (isExpanded && breakdownItems && breakdownItems.length > 0) {
                const detail = document.createElement('div');
                detail.style.cssText = `
                    padding: 4px 0 4px 16px;
                    margin: 0 6px 4px;
                    border-left: 1px solid rgba(255,255,255,0.08);
                `;

                const sorted = [...breakdownItems].sort((a, b) => b.value - a.value);

                for (const sub of sorted) {
                    const subRow = document.createElement('div');
                    subRow.style.cssText = `
                        display: flex;
                        justify-content: space-between;
                        padding: 1px 0;
                        font-size: 0.75rem;
                        color: rgba(255,255,255,0.55);
                        gap: 8px;
                    `;
                    const subName = document.createElement('span');
                    subName.style.cssText = `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
                    subName.textContent = sub.name;

                    const subVal = document.createElement('span');
                    subVal.style.cssText = `white-space: nowrap; color: rgba(255,255,255,0.4);`;
                    subVal.textContent = sub.value > 0 ? networthFormatter(Math.round(sub.value)) : '';

                    subRow.appendChild(subName);
                    subRow.appendChild(subVal);
                    detail.appendChild(subRow);
                }

                wrapper.appendChild(detail);
            }

            container.appendChild(wrapper);
        }
    }

    /**
     * Resolve a human-readable display name for an exclusion entry.
     * Used for chips so names show correctly even when the entry is no longer in searchList.
     * @param {{type: string, value: string}} exc
     * @returns {string}
     */
    _resolveExclusionName(exc) {
        const entry = this.searchList.find((e) => e.type === exc.type && e.value === exc.value);
        if (entry) return entry.name;

        const ASSET_TYPE_NAMES = {
            equipped: 'All Equipped Items',
            listings: 'All Market Listings',
            houses: 'All Houses',
            abilities: 'All Abilities',
            abilityBooks: 'All Ability Books',
        };
        if (exc.type === 'assetType') return ASSET_TYPE_NAMES[exc.value] ?? exc.value;
        if (exc.type === 'loadout') return `Loadout: ${exc.value}`;

        const gd = dataManager.getInitClientData();
        if (!gd) return exc.value;

        if (exc.type === 'category') {
            const name = gd.itemCategoryDetailMap?.[exc.value]?.name;
            return name ? `${name} (category)` : exc.value;
        }
        if (exc.type === 'item') return gd.itemDetailMap?.[exc.value]?.name ?? exc.value;
        if (exc.type === 'houseRoom') return gd.houseRoomDetailMap?.[exc.value]?.name ?? exc.value;
        if (exc.type === 'ability') return gd.abilityDetailMap?.[exc.value]?.name ?? exc.value;
        return exc.value;
    }

    /**
     * Create a chip element representing an active exclusion.
     * @param {string} label
     * @param {string} type
     * @param {string} value
     * @returns {HTMLElement}
     */
    _makeChip(label, type, value) {
        const chip = document.createElement('div');
        chip.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px;
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 12px;
            font-size: 0.78rem;
            color: rgba(255,255,255,0.8);
            cursor: default;
        `;
        const text = document.createElement('span');
        text.textContent = label;

        const removeBtn = document.createElement('span');
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove exclusion';
        removeBtn.style.cssText = `cursor: pointer; color: rgba(255,100,100,0.7); font-size: 0.9rem; line-height: 1;`;
        removeBtn.addEventListener('mouseenter', () => (removeBtn.style.color = 'rgba(255,100,100,1)'));
        removeBtn.addEventListener('mouseleave', () => (removeBtn.style.color = 'rgba(255,100,100,0.7)'));
        removeBtn.addEventListener('click', () => this._toggleExclusion(type, value));

        chip.appendChild(text);
        chip.appendChild(removeBtn);
        return chip;
    }

    /**
     * Toggle an exclusion on/off, then refresh.
     * @param {string} type
     * @param {string} value
     */
    async _toggleExclusion(type, value) {
        if (isExcluded(type, value)) {
            await removeExclusion(type, value);
        } else {
            await addExclusion(type, value);
        }
        // Immediately refresh the popup UI so button states and chips update
        this._refreshContent();
        // Trigger background recalculation to update the inventory panel
        if (this.onChangeFn) this.onChangeFn();
    }

    // ─── Drag ────────────────────────────────────────────────────

    _setupDragging(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            bringPanelToFront(this.container);
            this.isDragging = true;
            const rect = this.container.getBoundingClientRect();
            this.container.style.transform = 'none';
            this.container.style.top = `${rect.top}px`;
            this.container.style.left = `${rect.left}px`;
            this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        this.dragMoveHandler = (e) => {
            if (!this.isDragging) return;
            let x = e.clientX - this.dragOffset.x;
            let y = e.clientY - this.dragOffset.y;
            const minVisible = 80;
            y = Math.max(0, Math.min(y, window.innerHeight - minVisible));
            x = Math.max(-this.container.offsetWidth + minVisible, Math.min(x, window.innerWidth - minVisible));
            this.container.style.top = `${y}px`;
            this.container.style.left = `${x}px`;
        };

        this.dragUpHandler = () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            header.style.cursor = 'grab';
        };

        document.addEventListener('mousemove', this.dragMoveHandler);
        document.addEventListener('mouseup', this.dragUpHandler);
    }

    _setupClickOutside() {
        this.clickOutsideHandler = (e) => {
            if (this.container && !this.container.contains(e.target)) {
                this.close();
            }
        };
        document.addEventListener('mousedown', this.clickOutsideHandler);
    }

    _teardown() {
        clearTimeout(this.searchTimeout);
        if (this.dragMoveHandler) {
            document.removeEventListener('mousemove', this.dragMoveHandler);
            this.dragMoveHandler = null;
        }
        if (this.dragUpHandler) {
            document.removeEventListener('mouseup', this.dragUpHandler);
            this.dragUpHandler = null;
        }
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
        if (this.container) {
            unregisterFloatingPanel(this.container);
            this.container.remove();
            this.container = null;
        }
        this.isDragging = false;
    }
}

const networthExclusionPopup = new NetworthExclusionPopup();
export default networthExclusionPopup;
