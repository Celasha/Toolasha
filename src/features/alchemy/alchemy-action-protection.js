/**
 * Alchemy Action Protection
 * Prevents accidental alchemy actions on items from protected categories.
 * Uses a double-confirm pattern: blocks the action button for 3 seconds,
 * then requires a second click within 3 seconds to proceed.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';

const STORAGE_KEY_PREFIX = 'alchemyProtectedCategories';
const LOCKDOWN_MS = 3000;
const CONFIRM_WINDOW_MS = 3000;

function getStorageKey() {
    const charId = dataManager.getCurrentCharacterId() || 'default';
    return `${STORAGE_KEY_PREFIX}_${charId}`;
}

const DEFAULT_PROTECTION = {
    coinify: [],
    decompose: [],
    transmute: [],
};

class AlchemyActionProtection {
    constructor() {
        this.isInitialized = false;
        this.protectedMap = new Map();
        this.unregisterHandlers = [];
        this.confirmTimer = null;
        this.lockdownTimer = null;
    }

    async initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('alchemy_actionProtection')) return;

        this.isInitialized = true;

        const saved = await storage.getJSON(getStorageKey(), 'settings', null);
        if (saved) {
            for (const [type, categories] of Object.entries(saved)) {
                this.protectedMap.set(type, new Set(categories));
            }
        } else {
            for (const [type, categories] of Object.entries(DEFAULT_PROTECTION)) {
                this.protectedMap.set(type, new Set(categories));
            }
            await this._saveProtection();
        }

        this._setupClickInterceptor();
        this._setupShieldButton();
    }

    _setupClickInterceptor() {
        const handler = (e) => {
            if (!config.getSetting('alchemy_actionProtection')) return;

            const btn = e.target.closest('button');
            if (!btn) return;

            if (!btn.classList.contains('Button_success__6d6kU')) return;

            const alchemyPanel = btn.closest('[class*="SkillActionDetail_alchemyComponent"]');
            if (!alchemyPanel) return;

            const alchemyType = this._getAlchemyType();
            if (!alchemyType) return;

            const protectedCategories = this.protectedMap.get(alchemyType);
            if (!protectedCategories || protectedCategories.size === 0) return;

            const itemHrid = this._getSelectedItemHrid();
            if (!itemHrid) return;

            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) return;

            const categoryHrid = itemDetails.categoryHrid;
            if (!protectedCategories.has(categoryHrid)) return;

            // Item is in a protected category — apply state machine
            if (alchemyPanel.dataset.mwiAlchemyConfirmed === '1') {
                alchemyPanel.dataset.mwiAlchemyConfirmed = '';
                this._clearWarning(alchemyPanel);
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (alchemyPanel.dataset.mwiAlchemyLocked === '1') return;

            alchemyPanel.dataset.mwiAlchemyLocked = '1';

            const categoryName = this._getCategoryDisplayName(categoryHrid);
            this._showWarning(alchemyPanel, `Protected category (${categoryName})! Unlocks in 3s...`);

            if (this.lockdownTimer) clearTimeout(this.lockdownTimer);
            if (this.confirmTimer) clearTimeout(this.confirmTimer);

            this.lockdownTimer = setTimeout(() => {
                alchemyPanel.dataset.mwiAlchemyLocked = '';
                alchemyPanel.dataset.mwiAlchemyConfirmed = '1';
                this._showWarning(alchemyPanel, 'Click again to confirm.');

                this.confirmTimer = setTimeout(() => {
                    alchemyPanel.dataset.mwiAlchemyConfirmed = '';
                    this._clearWarning(alchemyPanel);
                }, CONFIRM_WINDOW_MS);
            }, LOCKDOWN_MS);
        };

        document.addEventListener('click', handler, true);
        this.unregisterHandlers.push(() => document.removeEventListener('click', handler, true));
    }

    _setupShieldButton() {
        const unregister = domObserver.onClass(
            'AlchemyActionProtection-Shield',
            'AlchemyPanel_tabsComponentContainer',
            (tabContainer) => {
                this._injectShieldButton(tabContainer);
            }
        );
        this.unregisterHandlers.push(unregister);
    }

    _injectShieldButton(tabContainer) {
        const parent = tabContainer.parentElement;
        if (!parent || parent.querySelector('.mwi-alchemy-protection-btn')) return;

        const btn = document.createElement('span');
        btn.className = 'mwi-alchemy-protection-btn';
        btn.textContent = '\u{1F6E1}\u{FE0F}';
        btn.style.cssText =
            'cursor:pointer; font-size:16px; margin-left:8px; opacity:0.7; transition:opacity 0.1s; vertical-align:middle; display:inline-block; position:relative; z-index:10;';
        btn.addEventListener('mouseenter', () => {
            btn.style.opacity = '1';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.opacity = '0.7';
        });
        btn.addEventListener('click', () => this.openConfigPopup());

        tabContainer.appendChild(btn);

        const updateVisibility = () => {
            const type = this._getAlchemyType();
            btn.style.display = type ? 'inline-block' : 'none';
        };

        updateVisibility();

        const observer = new MutationObserver(updateVisibility);
        observer.observe(tabContainer, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
        this.unregisterHandlers.push(() => observer.disconnect());
    }

    _getAlchemyType() {
        const tabContainer = document.querySelector('[class*="AlchemyPanel_tabsComponentContainer"]');
        const selectedTab = tabContainer?.querySelector('[role="tab"][aria-selected="true"]');
        const tabText = selectedTab?.textContent?.trim()?.toLowerCase() || '';

        if (tabText.includes('transmute')) return 'transmute';
        if (tabText.includes('decompose')) return 'decompose';
        if (tabText.includes('coinify')) return 'coinify';
        return null;
    }

    _getSelectedItemHrid() {
        const reqContainer = document.querySelector(
            '[class*="SkillActionDetail_itemRequirements"] [class*="Item_itemContainer"]'
        );
        if (!reqContainer) return null;

        const use = reqContainer.querySelector('svg use');
        if (!use) return null;

        const href = use.getAttribute('href');
        if (!href) return null;

        const itemId = href.split('#')[1];
        return itemId ? `/items/${itemId}` : null;
    }

    _getCategoryDisplayName(categoryHrid) {
        const name = categoryHrid.replace('/item_categories/', '').replace(/_/g, ' ');
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    _showWarning(container, message) {
        this._clearWarning(container);

        const warning = document.createElement('div');
        warning.className = 'mwi-alchemy-protection-warning';
        warning.style.cssText = `
            text-align: center;
            font-size: 12px;
            font-weight: 700;
            color: #ff6b6b;
            background: rgba(0, 0, 0, 0.85);
            padding: 6px 12px;
            border-radius: 4px;
            margin-top: 6px;
        `;
        warning.textContent = message;

        const actionBtn = container.querySelector('button.Button_success__6d6kU');
        if (actionBtn) {
            actionBtn.parentElement.insertAdjacentElement('afterend', warning);
        } else {
            container.appendChild(warning);
        }
    }

    _clearWarning(container) {
        const existing = container.querySelector('.mwi-alchemy-protection-warning');
        if (existing) existing.remove();
    }

    async openConfigPopup() {
        const existing = document.getElementById('mwi-alchemy-protection-popup');
        if (existing) {
            existing.remove();
            return;
        }

        const popup = document.createElement('div');
        popup.id = 'mwi-alchemy-protection-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1e1e2e;
            border: 2px solid #555;
            border-radius: 8px;
            padding: 20px;
            z-index: 100001;
            min-width: 340px;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            color: #ccc;
            font-size: 13px;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;';
        header.innerHTML = `<h3 style="margin:0; font-size:16px; color:#eee;">Alchemy Action Protection</h3>`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText =
            'background:#a33; color:#fff; border:none; cursor:pointer; font-size:16px; padding:2px 8px; border-radius:4px;';
        closeBtn.addEventListener('click', () => popup.remove());
        header.appendChild(closeBtn);
        popup.appendChild(header);

        const desc = document.createElement('p');
        desc.style.cssText = 'color:#999; margin:0 0 10px 0; font-size:12px;';
        desc.textContent =
            'Select which item categories to protect from each alchemy action. Protected items require a 3-second confirmation before the action proceeds.';
        popup.appendChild(desc);

        const alchemyTypes = ['coinify', 'decompose', 'transmute'];
        const categories = this._getAlchemizableCategories();

        for (const type of alchemyTypes) {
            const typeCats = categories[type];
            if (!typeCats || typeCats.length === 0) continue;

            const section = document.createElement('div');
            section.style.cssText = 'margin-bottom: 10px;';

            const typeHeader = document.createElement('div');
            typeHeader.style.cssText = 'font-weight:bold; margin-bottom:6px; text-transform:capitalize; color:#ddd;';
            typeHeader.textContent = type;
            section.appendChild(typeHeader);

            const protectedSet = this.protectedMap.get(type) || new Set();

            for (const cat of typeCats) {
                const row = document.createElement('label');
                row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:2px 0; cursor:pointer;';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = protectedSet.has(cat.hrid);
                checkbox.style.cssText = 'cursor:pointer;';
                checkbox.addEventListener('change', async () => {
                    if (checkbox.checked) {
                        protectedSet.add(cat.hrid);
                    } else {
                        protectedSet.delete(cat.hrid);
                    }
                    this.protectedMap.set(type, protectedSet);
                    await this._saveProtection();
                });

                const label = document.createElement('span');
                label.textContent = `${cat.name} (${cat.count} items)`;

                row.appendChild(checkbox);
                row.appendChild(label);
                section.appendChild(row);
            }

            popup.appendChild(section);
        }

        // Click outside to close
        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:100000;';
        backdrop.addEventListener('click', () => {
            popup.remove();
            backdrop.remove();
        });

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
    }

    _getAlchemizableCategories() {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return {};

        const result = { transmute: {}, decompose: {}, coinify: {} };

        for (const item of Object.values(gameData.itemDetailMap)) {
            if (!item.alchemyDetail || !item.categoryHrid) continue;

            const cat = item.categoryHrid;

            if (item.alchemyDetail.transmuteDropTable) {
                if (!result.transmute[cat]) result.transmute[cat] = 0;
                result.transmute[cat]++;
            }
            if (item.alchemyDetail.decomposeItems) {
                if (!result.decompose[cat]) result.decompose[cat] = 0;
                result.decompose[cat]++;
            }
            if (item.alchemyDetail.isCoinifiable) {
                if (!result.coinify[cat]) result.coinify[cat] = 0;
                result.coinify[cat]++;
            }
        }

        const format = (catMap) =>
            Object.entries(catMap)
                .map(([hrid, count]) => ({
                    hrid,
                    name: this._getCategoryDisplayName(hrid),
                    count,
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

        return {
            transmute: format(result.transmute),
            decompose: format(result.decompose),
            coinify: format(result.coinify),
        };
    }

    async _saveProtection() {
        const obj = {};
        for (const [type, set] of this.protectedMap) {
            obj[type] = [...set];
        }
        await storage.setJSON(getStorageKey(), obj, 'settings');
    }

    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        if (this.lockdownTimer) clearTimeout(this.lockdownTimer);
        if (this.confirmTimer) clearTimeout(this.confirmTimer);

        this.isInitialized = false;
        this.protectedMap.clear();

        const warning = document.querySelector('.mwi-alchemy-protection-warning');
        if (warning) warning.remove();
        const popup = document.getElementById('mwi-alchemy-protection-popup');
        if (popup) popup.remove();
        const btn = document.querySelector('.mwi-alchemy-protection-btn');
        if (btn) btn.remove();
    }
}

const alchemyActionProtection = new AlchemyActionProtection();

export default {
    name: 'Alchemy Action Protection',
    initialize: async () => {
        await alchemyActionProtection.initialize();
    },
    cleanup: () => {
        alchemyActionProtection.disable();
    },
    disable: () => {
        alchemyActionProtection.disable();
    },
};
