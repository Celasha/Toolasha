/**
 * Item Navigation Utilities
 * Handles Alt+click navigation to crafting/gathering actions or item dictionary
 */

import dataManager from '../core/data-manager.js';

/**
 * Get game object via React fiber tree traversal
 * @returns {Object|null} Game component instance
 */
function getGameObject() {
    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function find(fiber) {
        if (!fiber) return null;
        if (fiber.stateNode?.handleGoToMarketplace) return fiber.stateNode;
        return find(fiber.child) || find(fiber.sibling);
    }

    return find(rootFiber);
}

/**
 * Find which action produces a given item
 * Prioritizes production actions over gathering actions
 * @param {string} itemHrid - Item HRID to search for
 * @returns {Object|null} { actionHrid, type: 'production'|'gathering' } or null
 */
export function findActionForItem(itemHrid) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) {
        return null;
    }

    // First pass: Look for production actions (outputItems)
    for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (action.outputItems?.some((item) => item.itemHrid === itemHrid)) {
            return { actionHrid, type: 'production' };
        }
    }

    // Second pass: Look for gathering actions (dropTable)
    for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
        if (action.dropTable?.some((drop) => drop.itemHrid === itemHrid)) {
            return { actionHrid, type: 'gathering' };
        }
    }

    return null;
}

/**
 * Navigate to the action page for an item, or item dictionary if no action found
 * @param {string} itemHrid - Item HRID to navigate to
 * @returns {boolean} True if navigation was attempted, false if game API unavailable
 */
export function navigateToItem(itemHrid) {
    const game = getGameObject();
    if (!game) {
        return false;
    }

    // Try to find action that produces this item
    const actionInfo = findActionForItem(itemHrid);

    if (actionInfo && game.handleGoToAction) {
        // Navigate to the action page
        game.handleGoToAction(actionInfo.actionHrid);
        return true;
    } else if (game.handleOpenItemDictionary) {
        // Fallback to item dictionary
        game.handleOpenItemDictionary(itemHrid);
        return true;
    }

    return false;
}

/**
 * Setup Alt+click handler on an element
 * @param {HTMLElement} element - Element to attach handler to
 * @param {string} itemHrid - Item HRID to navigate to when Alt+clicked
 */
export function setupAltClickNavigation(element, itemHrid) {
    if (!element || !itemHrid) {
        return;
    }

    element.addEventListener('click', (event) => {
        // Check for Alt/Option key (same key, different labels on Mac/Windows)
        if (event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            navigateToItem(itemHrid);
        }
    });

    // Add visual hint that Alt+click is available
    element.style.cursor = 'pointer';
    element.setAttribute('title', element.getAttribute('title') + ' (Alt+click to navigate)');
}
