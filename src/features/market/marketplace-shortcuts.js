/**
 * Marketplace Shortcuts Module
 * Adds a "Marketplace Action" dropdown to the inventory item submenu
 * with quick actions: Sell Now, Buy Now, New Sell Listing, New Buy Listing
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { navigateToMarketplace } from '../../utils/marketplace-tabs.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { setReactInputValue } from '../../utils/react-input.js';

/** Native input value setter for triggering React state updates */
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

/**
 * MarketplaceShortcuts class manages the dropdown in item submenus
 */
class MarketplaceShortcuts {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.timerRegistry = createTimerRegistry();
        this.itemNameToHridCache = null;
        this.closeHandler = null;
        this.pendingQuantity = null;
        this.addMode = false;
    }

    /**
     * Initialize marketplace shortcuts feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Watch for item action menu popups
        const unregister = domObserver.onClass('MarketplaceShortcuts', 'Item_actionMenu', (actionMenu) => {
            this.injectDropdown(actionMenu);
        });
        this.unregisterHandlers.push(unregister);

        // Watch for marketplace modals to autofill quantity and inject quick input buttons
        const unregisterModal = domObserver.onClass('MarketplaceShortcuts_modal', 'Modal_modalContainer', (modal) => {
            this.autofillQuantity(modal);
            this.injectQuickInputButtons(modal);
        });
        this.unregisterHandlers.push(unregisterModal);
    }

    /**
     * Inject marketplace dropdown into the item action menu
     * @param {HTMLElement} actionMenu - The Item_actionMenu element
     */
    injectDropdown(actionMenu) {
        // Check if feature is enabled
        if (!config.getSetting('market_marketplaceShortcuts')) return;

        // Skip if already injected
        if (actionMenu.querySelector('.mwi-marketplace-dropdown')) {
            return;
        }

        // Get item name
        const nameEl = actionMenu.querySelector('[class*="Item_name"]');
        if (!nameEl) return;

        const itemName = nameEl.textContent.trim();
        const itemHrid = this.findItemHrid(itemName);
        if (!itemHrid) return;

        // Get enhancement level (e.g. "+3" → 3, absent → 0)
        let enhancementLevel = 0;
        const enhEl = actionMenu.querySelector('[class*="Item_enhancementLevel"]');
        if (enhEl) {
            const match = enhEl.textContent.match(/\+(\d+)/);
            if (match) {
                enhancementLevel = parseInt(match[1], 10);
            }
        }

        // Check tradeability
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return;

        const itemDetails = gameData.itemDetailMap[itemHrid];
        if (!itemDetails?.isTradable) return;

        // Find "View Marketplace" button
        const viewMarketplaceBtn = this.findButtonByText(actionMenu, 'View Marketplace');
        if (!viewMarketplaceBtn) return;

        // Build and insert dropdown
        const dropdown = this.buildDropdown(actionMenu, itemHrid, enhancementLevel);
        viewMarketplaceBtn.insertAdjacentElement('afterend', dropdown);
    }

    /**
     * Build the dropdown UI
     * @param {HTMLElement} actionMenu - The action menu container
     * @param {string} itemHrid - Item HRID for marketplace navigation
     * @param {number} enhancementLevel - Enhancement level (0 for base items)
     * @returns {HTMLElement} Dropdown wrapper element
     */
    buildDropdown(actionMenu, itemHrid, enhancementLevel = 0) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('mwi-marketplace-dropdown');
        wrapper.style.cssText = 'position: relative; width: 100%;';

        // Create toggle button matching game button style
        const toggle = document.createElement('button');
        const existingBtn = actionMenu.querySelector('button');
        if (existingBtn) {
            toggle.className = existingBtn.className;
        }
        toggle.classList.add('mwi-marketplace-dropdown-toggle');
        toggle.style.cssText = 'display: flex; justify-content: space-between; align-items: center; width: 100%;';
        toggle.innerHTML =
            '<span style="flex: 1; text-align: center;">Marketplace Action</span>' +
            '<span class="mwi-mp-chevron" style="font-size: 0.65em; transition: transform 0.15s; display: inline-block;">▼</span>';

        // Create dropdown panel (hidden by default)
        const panel = document.createElement('div');
        panel.classList.add('mwi-marketplace-dropdown-panel');
        panel.style.cssText = `
            display: none;
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            width: 100%;
            z-index: 9999;
            flex-direction: column;
            background: var(--color-surface, #1e1e2e);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
            padding: 4px;
            gap: 3px;
            box-sizing: border-box;
        `;

        // Action buttons
        const actions = [
            { label: 'Sell Now', type: 'sell', color: '#c2410c' },
            { label: 'Buy Now', type: 'buy', color: '#2fc4a7' },
            { label: 'New Sell Listing', type: 'sell-listing', color: '#9a3412' },
            { label: 'New Buy Listing', type: 'buy-listing', color: '#2fc4a7' },
        ];

        for (const action of actions) {
            const btn = document.createElement('button');
            btn.textContent = action.label;
            btn.style.cssText = `
                display: block;
                width: 100%;
                padding: 6px 12px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.85rem;
                font-weight: 600;
                color: #fff;
                background: ${action.color};
                text-align: center;
                transition: opacity 0.15s;
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.opacity = '0.85';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.opacity = '1';
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                closePanel();
                // Dismiss the game's action menu by simulating Escape
                document.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        which: 27,
                        bubbles: true,
                        cancelable: true,
                    })
                );
                this.executeAction(action.type, itemHrid, enhancementLevel);
            });
            panel.appendChild(btn);
        }

        // Toggle logic
        let open = false;

        const closePanel = () => {
            open = false;
            panel.style.display = 'none';
            const chevron = toggle.querySelector('.mwi-mp-chevron');
            if (chevron) chevron.style.transform = '';
        };

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            open = !open;
            panel.style.display = open ? 'flex' : 'none';
            const chevron = toggle.querySelector('.mwi-mp-chevron');
            if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
        });

        // Close on outside click
        this.closeHandler = () => closePanel();
        document.addEventListener('click', this.closeHandler);

        wrapper.appendChild(toggle);
        wrapper.appendChild(panel);
        return wrapper;
    }

    /**
     * Execute a marketplace action
     * @param {string} actionType - 'sell', 'buy', 'sell-listing', 'buy-listing'
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (0 for base items)
     */
    async executeAction(actionType, itemHrid, enhancementLevel = 0) {
        // Read quantity from item submenu input before navigating away
        const amountInput = document.querySelector('[class*="Item_amountInputContainer"] input[type="number"]');
        if (amountInput) {
            const qty = parseInt(amountInput.value, 10);
            if (qty > 0) {
                this.pendingQuantity = qty;
            }
        }

        // Navigate to marketplace for this item
        navigateToMarketplace(itemHrid, enhancementLevel);

        // Wait for the marketplace panel to render
        await new Promise((r) => setTimeout(r, 300));

        try {
            switch (actionType) {
                case 'sell':
                    await this.clickInstantActionButton('Sell');
                    break;
                case 'buy':
                    await this.clickInstantActionButton('Buy');
                    break;
                case 'sell-listing':
                    await this.clickListingButton('+ New Sell Listing', 'Button_sell');
                    break;
                case 'buy-listing':
                    await this.clickListingButton('+ New Buy Listing', 'Button_buy');
                    break;
            }
        } catch {
            // Instant sell/buy failed (no matching orders) — fall back to listing form
            if (actionType === 'sell') {
                await this.clickListingButton('+ New Sell Listing', 'Button_sell').catch(() => {});
            } else if (actionType === 'buy') {
                await this.clickListingButton('+ New Buy Listing', 'Button_buy').catch(() => {});
            }
        }
    }

    /**
     * Find and click an instant action button (Sell/Buy) on the marketplace order book.
     * These buttons have text inside MarketplacePanel_actionButtonText divs.
     * @param {string} buttonText - 'Sell' or 'Buy'
     * @param {number} timeout - Max wait time in ms (default 3000)
     * @returns {Promise<void>}
     */
    async clickInstantActionButton(buttonText, timeout = 3000) {
        const start = Date.now();

        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                const actionTexts = document.querySelectorAll('[class*="MarketplacePanel_actionButtonText"]');
                for (const div of actionTexts) {
                    // Skip entries with SVGs (those are icon-only buttons)
                    if (!div.querySelector('svg') && div.textContent.trim() === buttonText) {
                        const parentBtn = div.closest('button');
                        if (parentBtn) {
                            clearInterval(interval);
                            parentBtn.click();
                            resolve();
                            return;
                        }
                    }
                }

                if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Timeout waiting for instant action button: ${buttonText}`));
                }
            }, 50);

            this.timerRegistry.registerInterval(interval);
        });
    }

    /**
     * Find and click a new listing button (+ New Sell Listing / + New Buy Listing).
     * These buttons use game's Button_sell or Button_buy CSS classes.
     * @param {string} buttonText - Full button text to match
     * @param {string} partialClass - Partial CSS class to match (e.g. 'Button_sell')
     * @param {number} timeout - Max wait time in ms (default 3000)
     * @returns {Promise<void>}
     */
    async clickListingButton(buttonText, partialClass, timeout = 3000) {
        const start = Date.now();

        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                const candidates = document.querySelectorAll(`[class*="${partialClass}"]`);
                for (const btn of candidates) {
                    if (btn.textContent.trim() === buttonText) {
                        clearInterval(interval);
                        btn.click();
                        resolve();
                        return;
                    }
                }

                if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Timeout waiting for listing button: ${buttonText}`));
                }
            }, 50);

            this.timerRegistry.registerInterval(interval);
        });
    }

    /**
     * Autofill quantity into a marketplace modal when it appears.
     * Delayed slightly to run after auto-click-max has processed the modal.
     * @param {HTMLElement} modal - Modal container element
     */
    autofillQuantity(modal) {
        if (!this.pendingQuantity) return;

        // Check if this is a marketplace action modal (Sell Now, Buy Now, or listing form)
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) return;

        const headerText = header.textContent.trim();
        const isMarketplaceModal =
            headerText.includes('Buy Now') ||
            headerText.includes('Buy Listing') ||
            headerText.includes('Sell Now') ||
            headerText.includes('Sell Listing');
        if (!isMarketplaceModal) return;

        // Delay to run after auto-click-max which fires synchronously on modal appearance
        const qty = this.pendingQuantity;
        this.pendingQuantity = null;

        setTimeout(() => {
            const quantityInput = this.findQuantityInput(modal);
            if (!quantityInput) return;

            nativeInputValueSetter.call(quantityInput, qty.toString());
            quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
        }, 100);
    }

    /**
     * Inject quick input buttons (10, 100, 1000, + toggle) into a marketplace modal.
     * @param {HTMLElement} modal - Modal container element
     */
    injectQuickInputButtons(modal) {
        // Check setting
        if (!config.getSetting('market_quickInputButtons')) return;

        // Check if this is a marketplace modal
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) return;

        const headerText = header.textContent.trim();
        const isMarketplaceModal =
            headerText.includes('Buy Now') ||
            headerText.includes('Buy Listing') ||
            headerText.includes('Sell Now') ||
            headerText.includes('Sell Listing');
        if (!isMarketplaceModal) return;

        // Delay to let the modal fully render
        setTimeout(() => {
            // Skip if already injected
            if (modal.querySelector('.mwi-mp-quick-input')) return;

            const quantityInput = this.findQuantityInput(modal);
            if (!quantityInput) return;

            // Create button row
            const row = document.createElement('div');
            row.className = 'mwi-mp-quick-input';
            row.style.cssText =
                'display: flex; align-items: center; justify-content: center; gap: 2px; margin-top: 2px;';

            // + toggle button
            const addToggle = document.createElement('button');
            addToggle.textContent = '+';
            addToggle.title = 'Toggle add mode: click to accumulate counts instead of setting them';
            addToggle.style.cssText = `
                font-size: 11px;
                font-weight: 700;
                padding: 1px 5px;
                border-radius: 4px;
                border: 1px solid rgba(215, 183, 255, 0.3);
                background: transparent;
                color: rgba(215, 183, 255, 0.5);
                cursor: pointer;
                margin-right: 4px;
                line-height: 1.4;
                transition: background 0.15s, color 0.15s, border-color 0.15s;
            `;

            const applyToggleStyle = (active) => {
                if (active) {
                    addToggle.style.background = 'rgba(215, 183, 255, 0.2)';
                    addToggle.style.color = '#d7b7ff';
                    addToggle.style.borderColor = '#d7b7ff';
                } else {
                    addToggle.style.background = 'transparent';
                    addToggle.style.color = 'rgba(215, 183, 255, 0.5)';
                    addToggle.style.borderColor = 'rgba(215, 183, 255, 0.3)';
                }
            };

            applyToggleStyle(this.addMode);
            addToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.addMode = !this.addMode;
                applyToggleStyle(this.addMode);
            });
            row.appendChild(addToggle);

            // Preset count buttons
            const presetValues = [10, 100, 1000];
            for (const value of presetValues) {
                const btn = document.createElement('button');
                btn.textContent = value.toLocaleString();
                btn.className = 'mwi-quick-input-btn';
                btn.style.cssText = `
                    background-color: white;
                    color: black;
                    padding: 1px 6px;
                    margin: 1px;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 0.9em;
                `;
                btn.addEventListener('mouseenter', () => {
                    btn.style.backgroundColor = '#f0f0f0';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.backgroundColor = 'white';
                });
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this.addMode) {
                        const current = parseInt(quantityInput.value) || 0;
                        setReactInputValue(quantityInput, current + value, { focus: true });
                    } else {
                        setReactInputValue(quantityInput, value, { focus: true });
                    }
                });
                row.appendChild(btn);
            }

            // Insert below the quantity input row (1 / input / Max)
            const inputRow = quantityInput.closest('div')?.parentElement?.parentElement;
            if (inputRow) {
                inputRow.insertAdjacentElement('afterend', row);
            }
        }, 150);
    }

    /**
     * Find the quantity input in a marketplace modal.
     * Equipment items have multiple number inputs (enhancement level + quantity),
     * so we identify the correct one by checking parent containers.
     * @param {HTMLElement} modal - Modal container element
     * @returns {HTMLInputElement|null} Quantity input element or null
     */
    findQuantityInput(modal) {
        const allInputs = Array.from(modal.querySelectorAll('input[type="number"]'));

        if (allInputs.length === 0) return null;
        if (allInputs.length === 1) return allInputs[0];

        // Multiple inputs — find the one near "Quantity" text, not "Enhancement Level"
        for (let level = 0; level < 4; level++) {
            for (const input of allInputs) {
                let parent = input.parentElement;
                for (let j = 0; j < level && parent; j++) {
                    parent = parent.parentElement;
                }
                if (!parent) continue;

                const text = parent.textContent;
                if (text.includes('Quantity') && !text.includes('Enhancement Level')) {
                    return input;
                }
            }
        }

        return allInputs[0];
    }

    /**
     * Find a button by its text content
     * @param {HTMLElement} container - Container to search in
     * @param {string} text - Button text to find
     * @returns {HTMLElement|null} Button element or null
     */
    findButtonByText(container, text) {
        const buttons = container.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent.trim() === text) return btn;
        }
        return null;
    }

    /**
     * Find item HRID by name using game data
     * @param {string} itemName - Item display name
     * @returns {string|null} Item HRID or null
     */
    findItemHrid(itemName) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return null;

        // Build cache on first use
        if (!this.itemNameToHridCache) {
            this.itemNameToHridCache = new Map();
            for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                if (item.name) {
                    this.itemNameToHridCache.set(item.name, hrid);
                }
            }
        }

        return this.itemNameToHridCache.get(itemName) || null;
    }

    /**
     * Disable and cleanup
     */
    disable() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        if (this.closeHandler) {
            document.removeEventListener('click', this.closeHandler);
            this.closeHandler = null;
        }

        this.timerRegistry.clearAll();

        document.querySelectorAll('.mwi-marketplace-dropdown').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-mp-quick-input').forEach((el) => el.remove());

        this.itemNameToHridCache = null;
        this.isInitialized = false;
    }
}

const marketplaceShortcuts = new MarketplaceShortcuts();

// Auto-initialize (always enabled feature)
marketplaceShortcuts.initialize();

export default marketplaceShortcuts;
