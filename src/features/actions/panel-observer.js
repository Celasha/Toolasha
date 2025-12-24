/**
 * Action Panel Observer
 *
 * Detects when action panels appear and enhances them with:
 * - Gathering profit calculations (Foraging, Woodcutting, Milking)
 * - Other action panel enhancements (future)
 *
 * Automatically filters out combat action panels.
 */

import dataManager from '../../core/data-manager.js';
import { calculateGatheringProfit, formatProfitDisplay } from './gathering-profit.js';
import { displayEnhancementStats } from './enhancement-display.js';
import { formatWithSeparator } from '../../utils/formatters.js';

/**
 * Action types for gathering skills (3 skills)
 */
const GATHERING_TYPES = [
    '/action_types/foraging',
    '/action_types/woodcutting',
    '/action_types/milking'
];

/**
 * Action type for enhancing
 */
const ENHANCING_TYPE = '/action_types/enhancing';

/**
 * Debounced update tracker for enhancement calculations
 * Maps itemHrid to timeout ID
 */
const updateTimeouts = new Map();

/**
 * Trigger debounced enhancement stats update
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {string} itemHrid - Item HRID
 */
function triggerEnhancementUpdate(panel, itemHrid) {
    // Clear existing timeout for this item
    if (updateTimeouts.has(itemHrid)) {
        clearTimeout(updateTimeouts.get(itemHrid));
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
        await displayEnhancementStats(panel, itemHrid);
        updateTimeouts.delete(itemHrid);
    }, 500); // Wait 500ms after last change

    updateTimeouts.set(itemHrid, timeoutId);
}

/**
 * CSS selectors for action panel detection
 */
const SELECTORS = {
    MODAL_CONTAINER: '.Modal_modalContainer__3B80m',
    REGULAR_PANEL: 'div.SkillActionDetail_regularComponent__3oCgr',
    ENHANCING_PANEL: 'div.SkillActionDetail_enhancingComponent__17bOx',
    EXP_GAIN: 'div.SkillActionDetail_expGain__F5xHu',
    ACTION_NAME: 'div.SkillActionDetail_name__3erHV',
    DROP_TABLE: 'div.SkillActionDetail_dropTable__3ViVp',
    ENHANCING_OUTPUT: 'div.SkillActionDetail_enhancingOutput__VPHbY', // Outputs container
    ITEM_NAME: 'div.Item_name__2C42x' // Item name (without +1)
};

/**
 * Initialize action panel observer
 * Sets up MutationObserver on document.body to watch for action panels
 */
export function initActionPanelObserver() {
    setupMutationObserver();

    // Check for existing enhancing panel (may already be on page)
    checkExistingEnhancingPanel();

    // Listen for equipment and consumable changes to refresh enhancement calculator
    setupEnhancementRefreshListeners();
}

/**
 * Set up MutationObserver to detect action panels
 */
function setupMutationObserver() {
    const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
            // Handle attribute changes
            if (mutation.type === 'attributes') {
                // Handle value attribute changes on INPUT elements (clicking up/down arrows)
                if (mutation.attributeName === 'value' && mutation.target.tagName === 'INPUT') {
                    const input = mutation.target;
                    const panel = input.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid) {
                            // Trigger the same debounced update
                            triggerEnhancementUpdate(panel, itemHrid);
                        }
                    }
                }

                // Handle href attribute changes on USE elements (item sprite changes when selecting different item)
                if (mutation.attributeName === 'href' && mutation.target.tagName === 'use') {
                    const panel = mutation.target.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        // Item changed - re-detect and recalculate
                        await handleEnhancingPanel(panel);
                    }
                }
            }

            for (const addedNode of mutation.addedNodes) {
                if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

                // Check for modal container with regular action panel (gathering/crafting)
                if (
                    addedNode.classList?.contains('Modal_modalContainer__3B80m') &&
                    addedNode.querySelector(SELECTORS.REGULAR_PANEL)
                ) {
                    const panel = addedNode.querySelector(SELECTORS.REGULAR_PANEL);
                    await handleActionPanel(panel);
                }

                // Check for enhancing panel (non-modal, on main page)
                if (
                    addedNode.classList?.contains('SkillActionDetail_enhancingComponent__17bOx') ||
                    addedNode.querySelector(SELECTORS.ENHANCING_PANEL)
                ) {
                    const panel = addedNode.classList?.contains('SkillActionDetail_enhancingComponent__17bOx')
                        ? addedNode
                        : addedNode.querySelector(SELECTORS.ENHANCING_PANEL);
                    await handleEnhancingPanel(panel);
                }

                // Check if this is an outputs section being added to an existing enhancing panel
                if (
                    addedNode.classList?.contains('SkillActionDetail_enhancingOutput__VPHbY') ||
                    (addedNode.querySelector && addedNode.querySelector(SELECTORS.ENHANCING_OUTPUT))
                ) {
                    // Find the parent enhancing panel
                    let panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        await handleEnhancingPanel(panel);
                    }
                }

                // Also check for item div being added (in case outputs container already exists)
                if (
                    addedNode.classList?.contains('SkillActionDetail_item__2vEAz') ||
                    addedNode.classList?.contains('Item_name__2C42x')
                ) {
                    // Find the parent enhancing panel
                    let panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        await handleEnhancingPanel(panel);
                    }
                }

                // Check for new input elements being added (e.g., Protect From Level after dropping protection item)
                if (addedNode.tagName === 'INPUT' && (addedNode.type === 'number' || addedNode.type === 'text')) {
                    const panel = addedNode.closest(SELECTORS.ENHANCING_PANEL);
                    if (panel) {
                        // Get the item HRID from the panel's data
                        const itemHrid = panel.dataset.mwiItemHrid;
                        if (itemHrid) {
                            addInputListener(addedNode, panel, itemHrid);
                        }
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,  // Watch entire tree, not just direct children
        attributes: true,  // Watch for attribute changes (all attributes)
        attributeOldValue: true  // Track old values
    });
}

/**
 * Set up listeners for equipment and consumable changes
 * Refreshes enhancement calculator when gear or teas change
 */
function setupEnhancementRefreshListeners() {
    // Listen for equipment changes (equipping/unequipping items)
    dataManager.on('items_updated', () => {
        refreshEnhancementCalculator();
    });

    // Listen for consumable changes (drinking teas)
    dataManager.on('consumables_updated', () => {
        refreshEnhancementCalculator();
    });
}

/**
 * Refresh enhancement calculator if panel is currently visible
 */
function refreshEnhancementCalculator() {
    const panel = document.querySelector(SELECTORS.ENHANCING_PANEL);
    if (!panel) return;  // Not on enhancing panel, skip

    const itemHrid = panel.dataset.mwiItemHrid;
    if (!itemHrid) return;  // No item detected yet, skip

    // Trigger debounced update
    triggerEnhancementUpdate(panel, itemHrid);
}

/**
 * Check for existing enhancing panel on page load
 * The enhancing panel may already exist when MWI Tools initializes
 */
function checkExistingEnhancingPanel() {
    // Wait a moment for page to settle
    setTimeout(() => {
        const existingPanel = document.querySelector(SELECTORS.ENHANCING_PANEL);
        if (existingPanel) {
            handleEnhancingPanel(existingPanel);
        }
    }, 500);
}

/**
 * Handle action panel appearance (gathering/crafting/production)
 * @param {HTMLElement} panel - Action panel element
 */
async function handleActionPanel(panel) {
    if (!panel) return;

    // Filter out combat action panels (they don't have XP gain display)
    const expGainElement = panel.querySelector(SELECTORS.EXP_GAIN);
    if (!expGainElement) return; // Combat panel, skip

    // Get action name
    const actionNameElement = panel.querySelector(SELECTORS.ACTION_NAME);
    if (!actionNameElement) return;

    const actionName = getOriginalText(actionNameElement);
    const actionHrid = getActionHridFromName(actionName);
    if (!actionHrid) return;

    // Get action details
    const gameData = dataManager.getInitClientData();
    const actionDetail = gameData.actionDetailMap[actionHrid];
    if (!actionDetail) return;

    // Check if this is a gathering action
    if (GATHERING_TYPES.includes(actionDetail.type)) {
        const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
        if (dropTableElement) {
            await displayGatheringProfit(panel, actionHrid);
        }
    }
}

/**
 * Find and cache the Current Action tab button
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {HTMLButtonElement|null} Current Action tab button or null
 */
function getCurrentActionTabButton(panel) {
    // Check if we already cached it
    if (panel._cachedCurrentActionTab) {
        return panel._cachedCurrentActionTab;
    }

    // Walk up the DOM to find tab buttons (only once)
    let current = panel;
    let depth = 0;
    const maxDepth = 5;

    while (current && depth < maxDepth) {
        const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
        const currentActionTab = buttons.find(btn => btn.textContent.trim() === 'Current Action');

        if (currentActionTab) {
            // Cache it on the panel for future lookups
            panel._cachedCurrentActionTab = currentActionTab;
            return currentActionTab;
        }

        current = current.parentElement;
        depth++;
    }

    return null;
}

/**
 * Check if we're on the "Enhance" tab (not "Current Action" tab)
 * @param {HTMLElement} panel - Enhancing panel element
 * @returns {boolean} True if on Enhance tab
 */
function isEnhanceTabActive(panel) {
    // Get cached tab button (DOM query happens only once per panel)
    const currentActionTab = getCurrentActionTabButton(panel);

    if (!currentActionTab) {
        // No Current Action tab found, show calculator
        return true;
    }

    // Fast checks: just 3 property accesses (no DOM queries)
    if (currentActionTab.getAttribute('aria-selected') === 'true') {
        return false; // Current Action is active
    }

    if (currentActionTab.classList.contains('Mui-selected')) {
        return false;
    }

    if (currentActionTab.getAttribute('tabindex') === '0') {
        return false;
    }

    // Enhance tab is active
    return true;
}

/**
 * Handle enhancing panel appearance
 * @param {HTMLElement} panel - Enhancing panel element
 */
async function handleEnhancingPanel(panel) {
    if (!panel) return;

    // Set up tab click listeners (only once per panel)
    if (!panel.dataset.mwiTabListenersAdded) {
        setupTabClickListeners(panel);
        panel.dataset.mwiTabListenersAdded = 'true';
    }

    // Only show calculator on "Enhance" tab, not "Current Action" tab
    if (!isEnhanceTabActive(panel)) {
        // Remove calculator if it exists
        const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
        if (existingDisplay) {
            existingDisplay.remove();
        }
        return;
    }

    // Find the output element that shows the enhanced item
    const outputsSection = panel.querySelector(SELECTORS.ENHANCING_OUTPUT);
    if (!outputsSection) {
        return;
    }

    // Check if there's actually an item selected (not just placeholder)
    // When no item is selected, the outputs section exists but has no item icon
    const itemIcon = outputsSection.querySelector('svg[role="img"], img');
    if (!itemIcon) {
        // No item icon = no item selected, don't show calculator
        // Remove existing calculator display if present
        const existingDisplay = panel.querySelector('#mwi-enhancement-stats');
        if (existingDisplay) {
            existingDisplay.remove();
        }
        return;
    }

    // Get the item name from the Item_name element (without +1)
    const itemNameElement = outputsSection.querySelector(SELECTORS.ITEM_NAME);
    if (!itemNameElement) {
        return;
    }

    const itemName = itemNameElement.textContent.trim();

    if (!itemName) {
        return;
    }

    // Find the item HRID from the name
    const gameData = dataManager.getInitClientData();
    const itemHrid = getItemHridFromName(itemName, gameData);

    if (!itemHrid) {
        return;
    }

    // Get item details
    const itemDetails = gameData.itemDetailMap[itemHrid];
    if (!itemDetails) return;

    // Store itemHrid on panel for later reference (when new inputs are added)
    panel.dataset.mwiItemHrid = itemHrid;

    // Double-check tab state right before rendering (safety check for race conditions)
    if (!isEnhanceTabActive(panel)) {
        // Current Action tab became active during processing, don't render
        return;
    }

    // Display enhancement stats using the item HRID directly
    await displayEnhancementStats(panel, itemHrid);

    // Set up observers for Target Level and Protect From Level inputs
    setupInputObservers(panel, itemHrid);
}

/**
 * Set up click listeners on tab buttons to show/hide calculator
 * @param {HTMLElement} panel - Enhancing panel element
 */
function setupTabClickListeners(panel) {
    // Walk up the DOM to find tab buttons
    let current = panel;
    let depth = 0;
    const maxDepth = 5;

    let tabButtons = [];

    while (current && depth < maxDepth) {
        const buttons = Array.from(current.querySelectorAll('button[role="tab"]'));
        const foundTabs = buttons.filter(btn => {
            const text = btn.textContent.trim();
            return text === 'Enhance' || text === 'Current Action';
        });

        if (foundTabs.length === 2) {
            tabButtons = foundTabs;
            break;
        }

        current = current.parentElement;
        depth++;
    }

    if (tabButtons.length !== 2) {
        return; // Can't find tabs, skip listener setup
    }

    // Add click listeners to both tabs
    tabButtons.forEach(button => {
        button.addEventListener('click', async () => {
            // Small delay to let the tab change take effect
            setTimeout(async () => {
                const isEnhanceActive = isEnhanceTabActive(panel);
                const existingDisplay = panel.querySelector('#mwi-enhancement-stats');

                if (!isEnhanceActive) {
                    // Current Action tab clicked - remove calculator
                    if (existingDisplay) {
                        existingDisplay.remove();
                    }
                } else {
                    // Enhance tab clicked - show calculator if item is selected
                    const itemHrid = panel.dataset.mwiItemHrid;
                    if (itemHrid && !existingDisplay) {
                        // Re-render calculator
                        await displayEnhancementStats(panel, itemHrid);
                    }
                }
            }, 100);
        });
    });
}

/**
 * Add input listener to a single input element
 * @param {HTMLInputElement} input - Input element
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {string} itemHrid - Item HRID
 */
function addInputListener(input, panel, itemHrid) {
    // Handler that triggers the shared debounced update
    const handleInputChange = () => {
        triggerEnhancementUpdate(panel, itemHrid);
    };

    // Add change listeners
    input.addEventListener('input', handleInputChange);
    input.addEventListener('change', handleInputChange);
}

/**
 * Set up observers for Target Level and Protect From Level inputs
 * Re-calculates enhancement stats when user changes these values
 * @param {HTMLElement} panel - Enhancing panel element
 * @param {string} itemHrid - Item HRID
 */
function setupInputObservers(panel, itemHrid) {
    // Find all input elements in the panel
    const inputs = panel.querySelectorAll('input[type="number"], input[type="text"]');

    // Add listeners to all existing inputs
    inputs.forEach(input => {
        addInputListener(input, panel, itemHrid);
    });
}

/**
 * Create a collapsible section
 * @param {string} icon - Icon/emoji for the section
 * @param {string} title - Section title
 * @param {string} summary - Summary text (shown when collapsed)
 * @param {HTMLElement} content - Content element to show/hide
 * @param {boolean} defaultOpen - Whether section starts open
 * @param {number} indent - Indentation level (0 = root, 1 = nested, etc.)
 * @returns {HTMLElement} Section container
 */
function createCollapsibleSection(icon, title, summary, content, defaultOpen = false, indent = 0) {
    const section = document.createElement('div');
    section.className = 'mwi-collapsible-section';
    section.style.cssText = `
        margin-top: ${indent > 0 ? '4px' : '8px'};
        margin-bottom: ${indent > 0 ? '4px' : '8px'};
        margin-left: ${indent * 16}px;
    `;

    // Create header
    const header = document.createElement('div');
    header.className = 'mwi-section-header';
    header.style.cssText = `
        display: flex;
        align-items: center;
        cursor: pointer;
        user-select: none;
        padding: 4px 0;
        color: var(--text-color-primary, #fff);
        font-weight: ${indent === 0 ? '500' : '400'};
        font-size: ${indent > 0 ? '0.9em' : '1em'};
    `;

    const arrow = document.createElement('span');
    arrow.textContent = defaultOpen ? '▼' : '▶';
    arrow.style.cssText = `
        margin-right: 6px;
        font-size: 0.7em;
        transition: transform 0.2s;
    `;

    const label = document.createElement('span');
    label.textContent = icon ? `${icon} ${title}` : title;

    header.appendChild(arrow);
    header.appendChild(label);

    // Create summary (shown when collapsed)
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = `
        margin-left: 16px;
        margin-top: 2px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        display: ${defaultOpen ? 'none' : 'block'};
    `;
    if (summary) {
        summaryDiv.textContent = summary;
    }

    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'mwi-section-content';
    contentWrapper.style.cssText = `
        display: ${defaultOpen ? 'block' : 'none'};
        margin-left: ${indent === 0 ? '16px' : '0px'};
        margin-top: 4px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        line-height: 1.6;
    `;
    contentWrapper.appendChild(content);

    // Toggle functionality
    header.addEventListener('click', () => {
        const isOpen = contentWrapper.style.display === 'block';
        contentWrapper.style.display = isOpen ? 'none' : 'block';
        if (summary) {
            summaryDiv.style.display = isOpen ? 'block' : 'none';
        }
        arrow.textContent = isOpen ? '▶' : '▼';
    });

    section.appendChild(header);
    if (summary) {
        section.appendChild(summaryDiv);
    }
    section.appendChild(contentWrapper);

    return section;
}

/**
 * Display gathering profit calculation in panel
 * @param {HTMLElement} panel - Action panel element
 * @param {string} actionHrid - Action HRID
 */
async function displayGatheringProfit(panel, actionHrid) {
    // Calculate profit
    const profitData = await calculateGatheringProfit(actionHrid);
    if (!profitData) {
        console.error('❌ Gathering profit calculation failed for:', actionHrid);
        return;
    }

    // Check if we already added profit display
    const existingProfit = panel.querySelector('#mwi-foraging-profit');
    if (existingProfit) {
        existingProfit.remove();
    }

    // Create top-level summary
    const profit = Math.round(profitData.profitPerHour);
    const profitPerDay = Math.round(profitData.profitPerDay);
    const revenue = Math.round(profitData.revenuePerHour);
    const costs = Math.round(profitData.drinkCostPerHour);
    const summary = `${formatWithSeparator(profit)}/hr, ${formatWithSeparator(profitPerDay)}/day`;

    // ===== Build Detailed Breakdown Content =====
    const detailsContent = document.createElement('div');

    // Revenue Section
    const revenueDiv = document.createElement('div');
    revenueDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;">Revenue: ${formatWithSeparator(revenue)}/hr</div>`;

    // Base Output subsection
    const baseOutputContent = document.createElement('div');
    if (profitData.baseOutputs && profitData.baseOutputs.length > 0) {
        for (const output of profitData.baseOutputs) {
            const decimals = output.itemsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${output.name}: ${output.itemsPerHour.toFixed(decimals)}/hr @ ${formatWithSeparator(output.priceEach)} each → ${formatWithSeparator(Math.round(output.revenuePerHour))}/hr`;
            baseOutputContent.appendChild(line);
        }
    }

    const baseRevenue = profitData.baseOutputs?.reduce((sum, o) => sum + o.revenuePerHour, 0) || 0;
    const baseOutputSection = createCollapsibleSection(
        '',
        `Base Output: ${formatWithSeparator(Math.round(baseRevenue))}/hr (${profitData.baseOutputs?.length || 0} item${profitData.baseOutputs?.length !== 1 ? 's' : ''})`,
        null,
        baseOutputContent,
        false,
        1
    );

    // Bonus Drops subsections - split by type
    const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
    const essenceDrops = bonusDrops.filter(drop => drop.type === 'essence');
    const rareFinds = bonusDrops.filter(drop => drop.type === 'rare_find');

    // Essence Drops subsection
    let essenceSection = null;
    if (essenceDrops.length > 0) {
        const essenceContent = document.createElement('div');
        for (const drop of essenceDrops) {
            const decimals = drop.dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}%) → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hr`;
            essenceContent.appendChild(line);
        }

        const essenceRevenue = essenceDrops.reduce((sum, d) => sum + d.revenuePerHour, 0);
        const essenceFindBonus = profitData.bonusRevenue?.essenceFindBonus || 0;
        essenceSection = createCollapsibleSection(
            '',
            `Essence Drops: ${formatWithSeparator(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''}, ${essenceFindBonus.toFixed(1)}% essence find)`,
            null,
            essenceContent,
            false,
            1
        );
    }

    // Rare Finds subsection
    let rareFindSection = null;
    if (rareFinds.length > 0) {
        const rareFindContent = document.createElement('div');
        for (const drop of rareFinds) {
            const decimals = drop.dropsPerHour < 1 ? 2 : 1;
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${drop.itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${(drop.dropRate * 100).toFixed(drop.dropRate < 0.01 ? 3 : 2)}%) → ${formatWithSeparator(Math.round(drop.revenuePerHour))}/hr`;
            rareFindContent.appendChild(line);
        }

        const rareFindRevenue = rareFinds.reduce((sum, d) => sum + d.revenuePerHour, 0);
        const rareFindBonus = profitData.bonusRevenue?.rareFindBonus || 0;
        rareFindSection = createCollapsibleSection(
            '',
            `Rare Finds: ${formatWithSeparator(Math.round(rareFindRevenue))}/hr (${rareFinds.length} item${rareFinds.length !== 1 ? 's' : ''}, ${rareFindBonus.toFixed(1)}% rare find)`,
            null,
            rareFindContent,
            false,
            1
        );
    }

    revenueDiv.appendChild(baseOutputSection);
    if (essenceSection) {
        revenueDiv.appendChild(essenceSection);
    }
    if (rareFindSection) {
        revenueDiv.appendChild(rareFindSection);
    }

    // Costs Section
    const costsDiv = document.createElement('div');
    costsDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-top: 12px; margin-bottom: 4px;">Costs: ${formatWithSeparator(costs)}/hr</div>`;

    // Drink Costs subsection
    const drinkCostsContent = document.createElement('div');
    if (profitData.drinkCosts && profitData.drinkCosts.length > 0) {
        for (const drink of profitData.drinkCosts) {
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${drink.name}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(drink.priceEach)} → ${formatWithSeparator(Math.round(drink.costPerHour))}/hr`;
            drinkCostsContent.appendChild(line);
        }
    }

    const drinkCount = profitData.drinkCosts?.length || 0;
    const drinkCostsSection = createCollapsibleSection(
        '',
        `Drink Costs: ${formatWithSeparator(costs)}/hr (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
        null,
        drinkCostsContent,
        false,
        1
    );

    costsDiv.appendChild(drinkCostsSection);

    // Modifiers Section
    const modifiersDiv = document.createElement('div');
    modifiersDiv.style.cssText = `
        margin-top: 12px;
        color: var(--text-color-secondary, #888);
    `;

    const modifierLines = [];

    // Efficiency breakdown
    const effParts = [];
    if (profitData.details.levelEfficiency > 0) {
        effParts.push(`${profitData.details.levelEfficiency}% level`);
    }
    if (profitData.details.houseEfficiency > 0) {
        effParts.push(`${profitData.details.houseEfficiency.toFixed(1)}% house`);
    }
    if (profitData.details.teaEfficiency > 0) {
        effParts.push(`${profitData.details.teaEfficiency.toFixed(1)}% tea`);
    }
    if (profitData.details.equipmentEfficiency > 0) {
        effParts.push(`${profitData.details.equipmentEfficiency.toFixed(1)}% equip`);
    }
    if (profitData.details.gourmetBonus > 0) {
        effParts.push(`${profitData.details.gourmetBonus.toFixed(1)}% gourmet`);
    }

    if (effParts.length > 0) {
        modifierLines.push(`<div style="font-weight: 500; color: var(--text-color-primary, #fff);">Modifiers:</div>`);
        modifierLines.push(`<div style="margin-left: 8px;">• Efficiency: +${profitData.totalEfficiency.toFixed(1)}% (${effParts.join(', ')})</div>`);
    }

    // Gathering Quantity
    if (profitData.gatheringQuantity > 0) {
        const gatheringParts = [];
        if (profitData.details.communityBuffQuantity > 0) {
            gatheringParts.push(`${profitData.details.communityBuffQuantity.toFixed(1)}% community`);
        }
        if (profitData.details.gatheringTeaBonus > 0) {
            gatheringParts.push(`${profitData.details.gatheringTeaBonus.toFixed(1)}% tea`);
        }
        modifierLines.push(`<div style="margin-left: 8px;">• Gathering Quantity: +${profitData.gatheringQuantity.toFixed(1)}% (${gatheringParts.join(', ')})</div>`);
    }

    modifiersDiv.innerHTML = modifierLines.join('');

    // Assemble Detailed Breakdown (WITHOUT net profit - that goes in top level)
    detailsContent.appendChild(revenueDiv);
    detailsContent.appendChild(costsDiv);
    detailsContent.appendChild(modifiersDiv);

    // Create "Detailed Breakdown" collapsible
    const topLevelContent = document.createElement('div');
    topLevelContent.innerHTML = `
        <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr | Efficiency: +${profitData.totalEfficiency.toFixed(1)}%</div>
    `;

    // Add Net Profit line at top level (always visible when Profitability is expanded)
    const profitColor = profit >= 0 ? '#4ade80' : '#f87171'; // green if positive, red if negative
    const netProfitLine = document.createElement('div');
    netProfitLine.style.cssText = `
        font-weight: 500;
        color: ${profitColor};
        margin-bottom: 8px;
    `;
    netProfitLine.textContent = `Net Profit: ${formatWithSeparator(profit)}/hr`;
    topLevelContent.appendChild(netProfitLine);

    const detailedBreakdownSection = createCollapsibleSection(
        '📊',
        'Detailed Breakdown',
        null,
        detailsContent,
        false,
        0
    );

    topLevelContent.appendChild(detailedBreakdownSection);

    // Create main profit section
    const profitSection = createCollapsibleSection(
        '💰',
        'Profitability',
        summary,
        topLevelContent,
        false,
        0
    );
    profitSection.id = 'mwi-foraging-profit';

    // Find insertion point - look for existing collapsible sections or drop table
    let insertionPoint = panel.querySelector('.mwi-collapsible-section');
    if (insertionPoint) {
        // Insert after last collapsible section
        while (insertionPoint.nextElementSibling && insertionPoint.nextElementSibling.className === 'mwi-collapsible-section') {
            insertionPoint = insertionPoint.nextElementSibling;
        }
        insertionPoint.insertAdjacentElement('afterend', profitSection);
    } else {
        // Fallback: insert after drop table
        const dropTableElement = panel.querySelector(SELECTORS.DROP_TABLE);
        if (dropTableElement) {
            dropTableElement.parentNode.insertBefore(
                profitSection,
                dropTableElement.nextSibling
            );
        }
    }
}

/**
 * Get original text from element (strips injected content)
 * @param {HTMLElement} element - Element to extract text from
 * @returns {string} Original text content
 */
function getOriginalText(element) {
    // Clone element to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove any injected elements
    const injected = clone.querySelectorAll('[id^="mwi-"]');
    injected.forEach(el => el.remove());

    return clone.textContent.trim();
}

/**
 * Convert action name to HRID
 * @param {string} actionName - Display name of action
 * @returns {string|null} Action HRID or null if not found
 */
function getActionHridFromName(actionName) {
    const gameData = dataManager.getInitClientData();
    if (!gameData?.actionDetailMap) {
        return null;
    }

    // Search for action by name
    for (const [hrid, detail] of Object.entries(gameData.actionDetailMap)) {
        if (detail.name === actionName) {
            return hrid;
        }
    }

    return null;
}

/**
 * Convert item name to HRID
 * @param {string} itemName - Display name of item
 * @param {Object} gameData - Game data from dataManager
 * @returns {string|null} Item HRID or null if not found
 */
function getItemHridFromName(itemName, gameData) {
    if (!gameData?.itemDetailMap) {
        return null;
    }

    // Search for item by name
    for (const [hrid, detail] of Object.entries(gameData.itemDetailMap)) {
        if (detail.name === itemName) {
            return hrid;
        }
    }

    return null;
}
