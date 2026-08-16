/**
 * Game Data Lookup Utilities
 *
 * Centralized functions for resolving display names to HRIDs, plus locale-independent
 * resolution via icon sprite references (see below) - prefer the sprite-based functions
 * over the name-based ones wherever a `<use>` element is reachable, since display names are
 * translated client-side and the name-based functions below only ever match the client's
 * English-language data, silently failing on any other game locale.
 */

import dataManager from '../core/data-manager.js';

/**
 * Extract the last path segment from an hrid, e.g. "/actions/gathering/milking" -> "milking".
 * This is the fragment MWI's sprite sheets key icons by, for both actions and skills.
 * @param {string} hrid
 * @returns {string}
 */
function lastHridSegment(hrid) {
    return hrid.slice(hrid.lastIndexOf('/') + 1);
}

let actionFragmentToHridMap = null;
let skillFragmentToHridMap = null;

/**
 * Resolve an action HRID from its icon sprite `<use>` href (e.g.
 * ".../actions_sprite.<hash>.svg#milking"), which is locale-independent - the href's fragment is
 * always the action's last hrid segment, unlike the tile's rendered name text.
 * @param {string|null|undefined} href
 * @returns {string|null}
 */
export function getActionHridFromIconHref(href) {
    if (!href || !href.includes('actions_sprite')) return null;
    const fragment = href.split('#')[1];
    if (!fragment) return null;

    if (!actionFragmentToHridMap) {
        actionFragmentToHridMap = new Map();
        const gameData = dataManager.getInitClientData();
        for (const hrid of Object.keys(gameData?.actionDetailMap || {})) {
            actionFragmentToHridMap.set(lastHridSegment(hrid), hrid);
        }
    }

    return actionFragmentToHridMap.get(fragment) || null;
}

/**
 * Resolve a skill HRID from its icon sprite `<use>` href (e.g.
 * ".../skills_sprite.<hash>.svg#milking"), which is locale-independent - the href's fragment is
 * always the skill's last hrid segment, unlike the nav bar's rendered label text.
 * @param {string|null|undefined} href
 * @returns {string|null}
 */
export function getSkillHridFromIconHref(href) {
    if (!href || !href.includes('skills_sprite')) return null;
    const fragment = href.split('#')[1];
    if (!fragment) return null;

    if (!skillFragmentToHridMap) {
        skillFragmentToHridMap = new Map();
        const gameData = dataManager.getInitClientData();
        for (const hrid of Object.keys(gameData?.skillDetailMap || {})) {
            skillFragmentToHridMap.set(lastHridSegment(hrid), hrid);
        }
    }

    return skillFragmentToHridMap.get(fragment) || null;
}

/**
 * Resolve an item HRID from its icon sprite `<use>` href (e.g.
 * ".../items_sprite.<hash>.svg#redwood_log"), which is locale-independent - unlike items, the
 * href's fragment IS the full remaining hrid segment (items have no sub-category prefix like
 * actions/skills do), so no reverse map is needed - just validate it against itemDetailMap.
 * @param {string|null|undefined} href
 * @returns {string|null}
 */
export function getItemHridFromIconHref(href) {
    if (!href || !href.includes('items_sprite')) return null;
    const fragment = href.split('#')[1];
    if (!fragment) return null;

    const hrid = `/items/${fragment}`;
    const gameData = dataManager.getInitClientData();
    return gameData?.itemDetailMap?.[hrid] ? hrid : null;
}

/**
 * Generate alternate display names to handle ★ ↔ (R) refined item naming.
 * @param {string} name - Original display name
 * @returns {string[]} Array of alternate names to try (may be empty)
 */
function getRefinedNameVariants(name) {
    const variants = [];
    if (name.includes('★')) {
        variants.push(name.replace(/\s*★/, ' (R)'));
    }
    if (name.includes('(R)')) {
        variants.push(name.replace(/\s*\(R\)/, ' ★'));
    }
    return variants;
}

/**
 * Resolve a task card's underlying quest object (which carries actionHrid/monsterHrid directly)
 * by walking the React fiber tree from the card's own "Go"/success button up to the component
 * holding it as `characterQuest` - locale-independent, unlike parsing the card's translated
 * "SkillType - TaskName" text. Mirrors the fiber-walk pattern already used in
 * task-profit-display.js's _getQuestFromFiber.
 * @param {HTMLElement} taskCard - A RandomTask_randomTask card element.
 * @returns {Object|null} The characterQuest object, or null if not found.
 */
export function getQuestFromTaskCard(taskCard) {
    const goBtn = taskCard.querySelector('button.Button_success__6d6kU');
    if (!goBtn) return null;

    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function walk(fiber, target) {
        if (!fiber) return null;
        if (fiber.stateNode === target) return fiber;
        return walk(fiber.child, target) || walk(fiber.sibling, target);
    }

    const btnFiber = walk(rootFiber, goBtn);
    if (!btnFiber) return null;

    let f = btnFiber.return;
    while (f) {
        if (f.memoizedProps?.characterQuest && f.memoizedProps?.rerollRandomTaskHandler) {
            return f.memoizedProps.characterQuest;
        }
        f = f.return;
    }
    return null;
}

/**
 * Find an action HRID from its display name.
 * Tries exact match first, then ★ ↔ (R) variants for refined items.
 * @param {string} actionName - Display name of the action
 * @returns {string|null} Action HRID or null if not found
 */
export function getActionHridFromName(actionName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) {
        return null;
    }

    // Try exact match first
    for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
        if (detail.name === actionName) {
            return hrid;
        }
    }

    // Try ★ ↔ (R) variants for refined items
    for (const variant of getRefinedNameVariants(actionName)) {
        for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
            if (detail.name === variant) {
                return hrid;
            }
        }
    }

    return null;
}

/**
 * Find an item HRID from its display name.
 * Tries exact match first, then ★ ↔ (R) variants for refined items.
 * @param {string} itemName - Display name of the item
 * @returns {string|null} Item HRID or null if not found
 */
export function getItemHridFromName(itemName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.itemDetailMap) {
        return null;
    }

    // Try exact match first
    for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
        if (detail.name === itemName) {
            return hrid;
        }
    }

    // Try ★ ↔ (R) variants for refined items
    for (const variant of getRefinedNameVariants(itemName)) {
        for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
            if (detail.name === variant) {
                return hrid;
            }
        }
    }

    return null;
}

/**
 * Resolve an action HRID by walking up the React fiber tree from a DOM element inside the
 * action detail modal (SkillActionDetail) - unlike the tile list, that modal renders no
 * hrid-keyed icon of its own, but `this.props.actionDetail.hrid` is set on its own component
 * instance (confirmed against the client bundle), so this is locale-independent, unlike matching
 * the modal's translated name text. Mirrors the fiber-walk pattern already used for quest data
 * in task-profit-display.js's _getQuestFromFiber.
 * @param {HTMLElement} element - Any DOM node inside the action detail modal.
 * @returns {string|null}
 */
export function getActionHridFromFiber(element) {
    if (!element) return null;
    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function findFiberForNode(fiber, node) {
        if (!fiber) return null;
        if (fiber.stateNode === node) return fiber;
        return findFiberForNode(fiber.child, node) || findFiberForNode(fiber.sibling, node);
    }

    let f = findFiberForNode(rootFiber, element);
    while (f) {
        const hrid = f.memoizedProps?.actionDetail?.hrid;
        if (hrid) return hrid;
        f = f.return;
    }
    return null;
}

/**
 * Get the coin cost of an item from the in-game shop.
 * Returns 0 if the item is not available in the shop or not purchasable with coins.
 * @param {string} itemHrid - Item HRID
 * @returns {number} Coin cost, or 0 if not available in shop
 */
export function getShopCoinCost(itemHrid) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.shopItemDetailMap) return 0;

    for (const shopItem of Object.values(gameData.shopItemDetailMap)) {
        if (shopItem.itemHrid === itemHrid) {
            if (shopItem.costs && shopItem.costs.length > 0) {
                const coinCost = shopItem.costs.find((cost) => cost.itemHrid === '/items/coin');
                if (coinCost) {
                    return coinCost.count;
                }
            }
        }
    }

    return 0;
}
