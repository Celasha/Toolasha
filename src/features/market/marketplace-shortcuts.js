/**
 * Marketplace Shortcuts Module
 * Adds a "Marketplace Action" dropdown to the inventory item submenu
 * with quick actions: Sell Now, Buy Now, New Sell Listing, New Buy Listing
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import { navigateToMarketplace } from '../../utils/marketplace-tabs.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { setReactInputValue } from '../../utils/react-input.js';
import { readMarketplaceRuntimeStateFromElement } from '../../utils/marketplace-autofill.js';
import estimatedListingAge from './estimated-listing-age.js';
import { formatRelativeTime, formatWithSeparator } from '../../utils/formatters.js';

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
        this.pendingAutofill = null;
        this.pendingAutofillWriteTimers = new Set();
        this.pendingAutofillExpiryTimer = null;
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
            this.injectMultiplierButtons(modal);
            this.injectOwnedCount(modal);
            this.focusQuantityInput(modal);
        });
        this.unregisterHandlers.push(unregisterModal);

        this.closeHandler = () => this.closeAllDropdowns();
        document.addEventListener('click', this.closeHandler);
    }

    /**
     * Close every currently-rendered Marketplace shortcut dropdown.
     */
    closeAllDropdowns() {
        document.querySelectorAll('.mwi-marketplace-dropdown').forEach((wrapper) => {
            const panel = wrapper.querySelector('.mwi-marketplace-dropdown-panel');
            if (panel) panel.style.display = 'none';
            const chevron = wrapper.querySelector('.mwi-mp-chevron');
            if (chevron) chevron.style.transform = '';
        });
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
        // Build top ask age subtitle if order book data is cached
        let ageHtml = '';
        const cacheEntry = estimatedListingAge.orderBooksCache[itemHrid];
        if (cacheEntry) {
            const orderBookData = cacheEntry.data || cacheEntry;
            const orderBooks = orderBookData?.orderBooks;
            if (orderBooks) {
                // Handle both array format (index = enhancement level) and object format
                const orderBook = Array.isArray(orderBooks)
                    ? orderBooks[enhancementLevel]
                    : orderBooks[enhancementLevel];
                const topAsk = orderBook?.asks?.[0];
                if (topAsk?.createdTimestamp) {
                    const ageMs = Date.now() - new Date(topAsk.createdTimestamp).getTime();
                    if (ageMs > 0) {
                        const ageStr = formatRelativeTime(ageMs);
                        ageHtml = `<div style="font-size: 0.7em; opacity: 0.7; margin-top: 1px;">Top ask: ~${ageStr}</div>`;
                    }
                }
            }
        }

        toggle.innerHTML =
            '<span style="flex: 1; text-align: center;">Marketplace Action' +
            ageHtml +
            '</span>' +
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

        wrapper.appendChild(toggle);
        wrapper.appendChild(panel);
        return wrapper;
    }

    /**
     * Clear local state for the active shortcut autofill without touching another owner's session.
     * @param {number|null} [sessionId]
     */
    clearPendingAutofill(sessionId = null) {
        if (sessionId !== null && this.pendingAutofill && this.pendingAutofill.sessionId !== sessionId) return;

        for (const timer of this.pendingAutofillWriteTimers) {
            clearTimeout(timer);
        }
        this.pendingAutofillWriteTimers.clear();
        if (this.pendingAutofillExpiryTimer !== null) {
            clearTimeout(this.pendingAutofillExpiryTimer);
            this.pendingAutofillExpiryTimer = null;
        }
        this.pendingAutofill = null;
    }

    /**
     * End the currently-owned shortcut session, if any.
     */
    endPendingAutofill() {
        const sessionId = this.pendingAutofill?.sessionId ?? null;
        if (sessionId !== null && marketplaceSession.isActive(sessionId)) {
            marketplaceSession.end(sessionId);
            return;
        }
        this.clearPendingAutofill(sessionId);
    }

    /**
     * Claim exclusive marketplace ownership for one shortcut quantity autofill.
     * @param {{ quantity: number, itemHrid: string, enhancementLevel: number, actionType: string }} target
     */
    startPendingAutofill(target) {
        let sessionId = null;
        sessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.SHORTCUTS,
            onEnd: () => this.clearPendingAutofill(sessionId),
        });

        this.pendingAutofill = Object.freeze({ ...target, sessionId });
        this.pendingAutofillExpiryTimer = setTimeout(() => {
            marketplaceSession.end(sessionId);
        }, 10000);
    }

    /**
     * Update the expected modal type while preserving the same owned session.
     * Used when an unavailable instant order falls back to a new listing.
     * @param {string} actionType
     */
    retargetPendingAutofill(actionType) {
        const current = this.pendingAutofill;
        if (!current || !marketplaceSession.isActive(current.sessionId)) return;
        this.pendingAutofill = Object.freeze({ ...current, actionType });
    }

    /**
     * Get the expected marketplace modal state for a shortcut action.
     * @param {string} actionType
     * @returns {Object|null}
     */
    getPendingAutofillMode(actionType) {
        return (
            {
                buy: { header: 'Buy Now', isSell: false, isPostNewListing: false, isInstantOrder: true },
                sell: { header: 'Sell Now', isSell: true, isPostNewListing: false, isInstantOrder: true },
                'buy-listing': {
                    header: 'Buy Listing',
                    isSell: false,
                    isPostNewListing: true,
                    isInstantOrder: false,
                },
                'sell-listing': {
                    header: 'Sell Listing',
                    isSell: true,
                    isPostNewListing: true,
                    isInstantOrder: false,
                },
            }[actionType] || null
        );
    }

    /**
     * Verify that a live marketplace modal belongs to the exact shortcut target.
     * @param {HTMLElement} modal
     * @param {HTMLInputElement} quantityInput
     * @param {Object} target
     * @returns {boolean}
     */
    matchesPendingAutofill(modal, quantityInput, target) {
        const expected = this.getPendingAutofillMode(target.actionType);
        if (!expected || !modal?.isConnected || !quantityInput?.isConnected) return false;

        const headerText = modal.querySelector('div[class*="MarketplacePanel_header"]')?.textContent?.trim() || '';
        if (headerText !== expected.header) return false;

        const state = readMarketplaceRuntimeStateFromElement(quantityInput);
        if (!state) return false;
        if (state.marketTabKey !== 'MarketListings' || state.marketListingsView !== 'OrderBook') return false;
        if (state.itemHrid !== target.itemHrid || state.enhancementLevel !== target.enhancementLevel) return false;
        if (state.enhancementLevelInput !== target.enhancementLevel) return false;
        if (state.isSell !== expected.isSell) return false;
        if (state.showPostListing !== true) return false;
        if (state.isPostNewListing !== expected.isPostNewListing) return false;
        return state.isInstantOrder === expected.isInstantOrder;
    }

    /**
     * Execute a marketplace action
     * @param {string} actionType - 'sell', 'buy', 'sell-listing', 'buy-listing'
     * @param {string} itemHrid - Item HRID
     * @param {number} enhancementLevel - Enhancement level (0 for base items)
     */
    async executeAction(actionType, itemHrid, enhancementLevel = 0) {
        this.endPendingAutofill();

        // Read quantity from item submenu input before navigating away
        let quantity = 0;
        const amountInput = document.querySelector('[class*="Item_amountInputContainer"] input[type="number"]');
        if (amountInput) {
            const captured = parseInt(amountInput.value, 10);
            if (captured > 0) quantity = captured;
        }

        // If no quantity was captured, default to inventory count for sell actions
        if (quantity <= 0 && (actionType === 'sell' || actionType === 'sell-listing')) {
            const inventory = dataManager.characterItems || [];
            const match = inventory.find(
                (item) =>
                    item.itemHrid === itemHrid &&
                    (item.enhancementLevel || 0) === enhancementLevel &&
                    item.itemLocationHrid === '/item_locations/inventory'
            );
            if (match && match.count > 0) quantity = match.count;
        }

        this.startPendingAutofill({ quantity, itemHrid, enhancementLevel, actionType });

        // Navigate to marketplace for this item
        if (!navigateToMarketplace(itemHrid, enhancementLevel)) {
            this.endPendingAutofill();
            return;
        }

        // Wait for the marketplace panel to render
        await new Promise((resolve) => setTimeout(resolve, 300));

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
                this.retargetPendingAutofill('sell-listing');
                await this.clickListingButton('+ New Sell Listing', 'Button_sell').catch(() => {});
            } else if (actionType === 'buy') {
                this.retargetPendingAutofill('buy-listing');
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
        const target = this.pendingAutofill;
        if (!target) return;
        if (!marketplaceSession.isActive(target.sessionId)) {
            this.clearPendingAutofill(target.sessionId);
            return;
        }

        const expected = this.getPendingAutofillMode(target.actionType);
        const headerText = modal.querySelector('div[class*="MarketplacePanel_header"]')?.textContent?.trim() || '';
        if (!expected || headerText !== expected.header) return;

        // Prefer the newest matching modal if React replaces the modal during convergence.
        for (const timer of this.pendingAutofillWriteTimers) clearTimeout(timer);
        this.pendingAutofillWriteTimers.clear();

        const delays = [100, 250, 500, 1000, 1500];
        for (const delay of delays) {
            const timer = setTimeout(() => {
                this.pendingAutofillWriteTimers.delete(timer);
                if (this.pendingAutofill !== target || !marketplaceSession.isActive(target.sessionId)) return;

                const currentInput = this.findQuantityInput(modal);
                if (!currentInput || !this.matchesPendingAutofill(modal, currentInput, target)) return;

                if (target.quantity > 0) {
                    nativeInputValueSetter.call(currentInput, target.quantity.toString());
                    currentInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                for (const pendingTimer of this.pendingAutofillWriteTimers) clearTimeout(pendingTimer);
                this.pendingAutofillWriteTimers.clear();
                marketplaceSession.end(target.sessionId);
            }, delay);
            this.pendingAutofillWriteTimers.add(timer);
        }
    }

    /**
     * Auto-focus the quantity input when a marketplace modal opens.
     * Runs after autofill to avoid interfering with value setting.
     * @param {HTMLElement} modal - Modal container element
     */
    focusQuantityInput(modal) {
        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) return;

        const headerText = header.textContent.trim();
        if (
            !headerText.includes('Buy Now') &&
            !headerText.includes('Buy Listing')
            // !headerText.includes('Sell Now') &&
            // !headerText.includes('Sell Listing')
        ) {
            return;
        }

        // Delay to run after autofill (100ms) and quick input injection
        setTimeout(() => {
            const quantityInput = this.findQuantityInput(modal);
            if (quantityInput) {
                quantityInput.focus();
                quantityInput.select();
            }
        }, 150);
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
            const defaults = [10, 100, 1000];
            const raw = config.getSettingValue('market_quickInputButtons_presets', '');
            const parsed = raw
                .split(',')
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n) && n > 0);
            const presetValues = parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b).slice(0, 8) : defaults;
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
     * Inject "owned: X" count into Buy Now / Buy Listing modals.
     * @param {HTMLElement} modal - Modal container element
     */
    injectOwnedCount(modal) {
        if (!config.getSetting('market_showOwnedInBuyModal')) return;

        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) return;

        const headerText = header.textContent.trim();
        if (!headerText.includes('Buy Now') && !headerText.includes('Buy Listing')) return;

        setTimeout(() => {
            if (modal.querySelector('.mwi-owned-count')) return;

            // Extract item HRID from the SVG icon in the modal
            const useEl = modal.querySelector('svg use[href], svg use[xlink\\:href]');
            if (!useEl) return;
            const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
            if (!href) return;
            const idMatch = href.match(/#(.+)$/);
            if (!idMatch) return;
            const itemSlug = idMatch[1];
            const itemHrid = `/items/${itemSlug}`;

            // Determine enhancement level from modal (if present)
            let enhancementLevel = 0;
            const allInputs = modal.querySelectorAll('input[type="number"]');
            for (const input of allInputs) {
                const parent = input.closest('div');
                if (parent?.textContent?.includes('Enhancement Level')) {
                    enhancementLevel = parseInt(input.value) || 0;
                    break;
                }
            }

            // Look up inventory count for this specific item + enhancement level
            const inventory = dataManager.characterItems || [];
            let count = 0;
            for (const item of inventory) {
                if (
                    item.itemHrid === itemHrid &&
                    (item.enhancementLevel || 0) === enhancementLevel &&
                    item.itemLocationHrid === '/item_locations/inventory'
                ) {
                    count += item.count || 0;
                }
            }

            // Inject below the "Price" label area, before "Quantity"
            const quantityInput = this.findQuantityInput(modal);
            if (!quantityInput) return;

            // Find the Quantity label container
            const quantityRow = quantityInput.closest('div')?.parentElement?.parentElement;
            if (!quantityRow) return;

            const ownedEl = document.createElement('div');
            ownedEl.className = 'mwi-owned-count';
            ownedEl.style.cssText = `text-align: center; font-size: 13px; color: ${config.COLOR_TEXT_SECONDARY}; margin: 4px 0;`;
            ownedEl.innerHTML = `Owned: <span style="color: ${config.COLOR_ACCENT}; font-weight: 600;">${formatWithSeparator(count)}</span>`;
            quantityRow.insertAdjacentElement('beforebegin', ownedEl);
        }, 100);
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
     * Inject ÷2 and ×2 multiplier buttons into price and quantity rows.
     * @param {HTMLElement} modal - Modal container element
     */
    injectMultiplierButtons(modal) {
        if (!config.getSetting('market_multiplierButtons')) return;

        const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
        if (!header) return;

        const headerText = header.textContent.trim();
        const isMarketplaceModal =
            headerText.includes('Buy Now') ||
            headerText.includes('Buy Listing') ||
            headerText.includes('Sell Now') ||
            headerText.includes('Sell Listing');
        if (!isMarketplaceModal) return;

        setTimeout(() => {
            if (modal.querySelector('.mwi-mp-multiplier')) return;

            const priceRow = modal.querySelector('div[class*="MarketplacePanel_priceInputs"]');
            const quantityRow = modal.querySelector('div[class*="MarketplacePanel_quantityInputs"]');

            for (const row of [priceRow, quantityRow]) {
                if (!row) continue;

                const input = row.querySelector('input[type="number"]');
                if (!input) continue;

                const buttonContainers = row.querySelectorAll('div[class*="MarketplacePanel_buttonContainer"]');
                if (buttonContainers.length < 2) continue;

                const firstContainer = buttonContainers[0];
                const lastContainer = buttonContainers[buttonContainers.length - 1];

                const existingBtn = firstContainer.querySelector('button');
                const btnClass = existingBtn?.className || '';

                const divideWrapper = document.createElement('div');
                divideWrapper.className = firstContainer.className + ' mwi-mp-multiplier';
                const divideBtn = document.createElement('button');
                divideBtn.className = btnClass;
                divideBtn.textContent = '÷2';
                divideBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const current = parseInt(input.value) || 0;
                    setReactInputValue(input, Math.max(1, Math.floor(current / 2)));
                });
                divideWrapper.appendChild(divideBtn);

                const multiplyWrapper = document.createElement('div');
                multiplyWrapper.className = lastContainer.className + ' mwi-mp-multiplier';
                const multiplyBtn = document.createElement('button');
                multiplyBtn.className = btnClass;
                multiplyBtn.textContent = '×2';
                multiplyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const current = parseInt(input.value) || 0;
                    setReactInputValue(input, current * 2);
                });
                multiplyWrapper.appendChild(multiplyBtn);

                firstContainer.insertAdjacentElement('beforebegin', divideWrapper);
                lastContainer.insertAdjacentElement('afterend', multiplyWrapper);
            }
        }, 100);
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

        this.endPendingAutofill();
        this.timerRegistry.clearAll();

        document.querySelectorAll('.mwi-marketplace-dropdown').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-mp-quick-input').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-mp-multiplier').forEach((el) => el.remove());

        this.itemNameToHridCache = null;
        this.isInitialized = false;
    }
}

const marketplaceShortcuts = new MarketplaceShortcuts();

export { MarketplaceShortcuts };

// Auto-initialize (always enabled feature)
marketplaceShortcuts.initialize();

export default marketplaceShortcuts;
