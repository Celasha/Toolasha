/**
 * Return true only when every Toolasha-owned layout node is still attached to
 * the current Inventory container.
 * @param {Element[]} injectedElements
 * @param {Element|null} inventoryContainer
 * @returns {boolean}
 */
export function areInjectedLayoutElementsAttached(injectedElements, inventoryContainer) {
    return (
        Boolean(inventoryContainer) &&
        injectedElements.length > 0 &&
        injectedElements.every((element) => element?.parentElement === inventoryContainer)
    );
}

const RELEVANT_LAYOUT_SELECTOR = [
    '[class*="Item_itemContainer"]',
    '.toolasha-ct-topbar',
    '.toolasha-ct-section-header',
    '.toolasha-ct-unorg-header',
    '.toolasha-ct-empty',
    '.toolasha-ct-linebreak',
].join(', ');

/**
 * Return true when a mutation added or removed an inventory tile or one of the
 * Toolasha-owned layout nodes whose loss requires a layout integrity pass.
 * @param {MutationRecord} mutation
 * @returns {boolean}
 */
export function mutationTouchesCustomTabsLayout(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node?.nodeType !== 1) return false;
        return Boolean(node.matches?.(RELEVANT_LAYOUT_SELECTOR) || node.querySelector?.(RELEVANT_LAYOUT_SELECTOR));
    });
}
