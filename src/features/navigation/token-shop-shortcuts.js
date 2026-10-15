/**
 * Token Shop Shortcuts
 * Adds a "View <shop>" button to the item action menu of every token (and guild credit) that has a shop, like the
 * game's own "View Cowbell Store" button on the Cowbell item.
 */

import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { getItemHridFromIconHref, getItemHridFromName } from '../../utils/game-lookups.js';
import { getGameObject } from '../../utils/item-navigation.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const BUTTON_CLASS = 'mwi-token-shop-button';
const TAB_POLL_MS = 50;
const TAB_POLL_ATTEMPTS = 40;

/**
 * Where each shop lives: the game's top-level nav target, plus the tab inside that page. Tabs are
 * matched by position within the page's own tab container, not by label, because the labels are
 * localized.
 */
const DESTINATIONS = {
    dungeon: {
        labelKey: 'tokenShopShortcuts.dungeonShop',
        navTarget: 'shop',
        tabContainerClass: 'ShopPanel_tabsComponentContainer',
        tabIndex: 1,
    },
    labyrinth: {
        labelKey: 'tokenShopShortcuts.labyrinthShop',
        navTarget: 'labyrinth',
        tabContainerClass: 'LabyrinthPanel_tabsComponentContainer',
        tabIndex: 3,
    },
    task: {
        labelKey: 'tokenShopShortcuts.taskShop',
        navTarget: 'tasks',
        tabContainerClass: 'TasksPanel_tabsComponentContainer',
        tabIndex: 1,
    },
    guild: {
        labelKey: 'tokenShopShortcuts.guildShop',
        navTarget: 'guild',
        tabContainerClass: 'GuildPanel_tabsComponentContainer',
        tabIndex: 4,
    },
};

const TOKEN_SHOPS = {
    '/items/chimerical_token': DESTINATIONS.dungeon,
    '/items/sinister_token': DESTINATIONS.dungeon,
    '/items/enchanted_token': DESTINATIONS.dungeon,
    '/items/pirate_token': DESTINATIONS.dungeon,
    '/items/labyrinth_token': DESTINATIONS.labyrinth,
    '/items/task_token': DESTINATIONS.task,
    '/items/guild_token': DESTINATIONS.guild,
    '/items/blue_guild_credit': DESTINATIONS.guild,
    '/items/brown_guild_credit': DESTINATIONS.guild,
    '/items/gold_guild_credit': DESTINATIONS.guild,
    '/items/green_guild_credit': DESTINATIONS.guild,
    '/items/purple_guild_credit': DESTINATIONS.guild,
    '/items/red_guild_credit': DESTINATIONS.guild,
    '/items/silver_guild_credit': DESTINATIONS.guild,
    '/items/white_guild_credit': DESTINATIONS.guild,
};

/**
 * @param {string} itemHrid
 * @returns {{labelKey: string, navTarget: string, tabContainerClass: string, tabIndex: number}|null}
 */
export function getShopDestination(itemHrid) {
    return TOKEN_SHOPS[itemHrid] || null;
}

class TokenShopShortcuts {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.timerRegistry = createTimerRegistry();
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        const unregister = domObserver.onClass('TokenShopShortcuts', 'Item_actionMenu', (actionMenu) => {
            this.injectButton(actionMenu);
        });
        this.unregisterHandlers.push(unregister);
    }

    /**
     * @param {HTMLElement} actionMenu - The Item_actionMenu element
     */
    injectButton(actionMenu) {
        if (actionMenu.querySelector(`.${BUTTON_CLASS}`)) return;

        const nameEl = actionMenu.querySelector('[class*="Item_name"]');
        if (!nameEl) return;

        // The popup's own icon sprite is locale-independent; the translated name is the fallback.
        const useEl = actionMenu.querySelector('svg use');
        const itemHrid =
            getItemHridFromIconHref(useEl?.getAttribute('href')) || getItemHridFromName(nameEl.textContent.trim());
        const destination = itemHrid ? getShopDestination(itemHrid) : null;
        if (!destination) return;

        const button = document.createElement('button');
        button.textContent = t(destination.labelKey);
        const existingButton = actionMenu.querySelector('button');
        if (existingButton) button.className = existingButton.className;
        button.classList.add(BUTTON_CLASS);

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.goToShop(destination);
        });

        // Sit above the native buttons, like the game's own Cowbell shop button
        if (existingButton) {
            actionMenu.insertBefore(button, existingButton);
        } else {
            actionMenu.appendChild(button);
        }
    }

    /**
     * Navigate to the shop's page, then select its tab once the page's tab bar has mounted.
     * If the tab never appears the player is still left on the right page.
     * @param {{navTarget: string, tabContainerClass: string, tabIndex: number}} destination
     */
    goToShop(destination) {
        const game = getGameObject();
        if (!game || typeof game.handleGoToNavTarget !== 'function') {
            console.error('[TokenShopShortcuts] Game navigation is unavailable');
            return;
        }
        game.handleGoToNavTarget(destination.navTarget);

        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const tabs = document.querySelectorAll(`[class*="${destination.tabContainerClass}"] button[role="tab"]`);
            const tab = tabs[destination.tabIndex];
            if (tab) {
                clearInterval(interval);
                if (!tab.matches('[aria-selected="true"]')) tab.click();
            } else if (attempts >= TAB_POLL_ATTEMPTS) {
                clearInterval(interval);
            }
        }, TAB_POLL_MS);
        this.timerRegistry.registerInterval(interval);
    }

    cleanup() {
        this.timerRegistry.clearAll();
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
        this.isInitialized = false;
    }
}

const tokenShopShortcuts = new TokenShopShortcuts();

export default {
    name: 'Token Shop Shortcuts',
    initialize: () => tokenShopShortcuts.initialize(),
    cleanup: () => tokenShopShortcuts.cleanup(),
};
export { TokenShopShortcuts };
