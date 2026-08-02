/**
 * Shared layout anchor for Toolasha controls injected into production action panels.
 * Keeps the native Requires label/value pair intact and adds one real full-width grid row.
 */

const TOOLS_BLOCK_ID = 'mwi-production-tools-block';

/**
 * Return the shared full-width Toolasha block immediately after the native Requires row.
 * @param {HTMLElement} panel
 * @returns {HTMLElement|null}
 */
export function getOrCreateProductionToolsBlock(panel) {
    if (!panel) return null;

    const itemRequirements = panel.querySelector('[class*="SkillActionDetail_itemRequirements"]');
    const valueCell = itemRequirements?.closest('[class*="SkillActionDetail_value"]');
    const infoGrid = valueCell?.parentElement;
    if (!itemRequirements || !valueCell || !infoGrid?.matches('[class*="SkillActionDetail_info"]')) return null;

    let block = panel.querySelector(`#${TOOLS_BLOCK_ID}`);
    if (!block) {
        block = document.createElement('div');
        block.id = TOOLS_BLOCK_ID;
    }

    block.style.cssText = `
        grid-column: 1 / -1;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        margin: 0;
        padding: 0;
    `;

    if (block.parentElement !== infoGrid || block.previousElementSibling !== valueCell) {
        infoGrid.insertBefore(block, valueCell.nextSibling);
    }

    return block;
}

/**
 * Move all companion controls into the shared row in deterministic order.
 * @param {HTMLElement} panel
 * @returns {HTMLElement|null}
 */
export function normalizeProductionToolsBlock(panel) {
    const block = getOrCreateProductionToolsBlock(panel);
    if (!block) return null;

    const entries = [
        { selector: '#mwi-missing-mats-button', order: 1, margin: '0' },
        { selector: '#mwi-cost-summary', order: 2, margin: '0' },
        { selector: '#mwi-budget-calculator', order: 3, margin: '0 0 8px 0' },
    ];

    for (const entry of entries) {
        const element = panel.querySelector(entry.selector);
        if (!element) continue;
        element.style.order = String(entry.order);
        element.style.width = '100%';
        element.style.maxWidth = '100%';
        element.style.minWidth = '0';
        element.style.boxSizing = 'border-box';
        element.style.margin = entry.margin;
        if (element.parentElement !== block) block.appendChild(element);
    }

    return block;
}

/**
 * Apply a slightly denser rhythm to adjacent top-level action-panel sections.
 * @param {HTMLElement|null} section
 * @returns {HTMLElement|null}
 */
export function compactActionPanelSection(section) {
    if (!section) return section;
    section.style.marginTop = '5px';
    section.style.marginBottom = '5px';
    const header = section.querySelector(':scope > .mwi-section-header');
    if (header) header.style.padding = '3px 0';
    return section;
}
