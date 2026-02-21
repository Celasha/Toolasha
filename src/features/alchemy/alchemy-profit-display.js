/**
 * Alchemy Profit Display Module
 * Displays profit calculator in alchemy action detail panel
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import alchemyProfit from './alchemy-profit.js';
import alchemyProfitCalculator from '../market/alchemy-profit-calculator.js';
import { formatWithSeparator, formatPercentage, formatLargeNumber, timeReadable } from '../../utils/formatters.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { calculateExperienceMultiplier } from '../../utils/experience-parser.js';
import { calculateActionsPerHour } from '../../utils/profit-helpers.js';

class AlchemyProfitDisplay {
    constructor() {
        this.isActive = false;
        this.unregisterObserver = null;
        this.contentObserver = null;
        this.tabObserver = null;
        this.displayElement = null;
        this.updateTimeout = null;
        this.lastFingerprint = null;
        this.isInitialized = false;
        this.timerRegistry = createTimerRegistry();
        this.equipmentChangeHandler = null;
        this.cachedInputField = null; // Cache input field since it gets removed when action starts
    }

    /**
     * Initialize the display system
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('alchemy_profitDisplay')) {
            return;
        }

        this.isInitialized = true;
        this.setupObserver();

        // Listen for equipment changes (alchemy allows equipment changes while panel is open)
        this.equipmentChangeHandler = () => {
            // Debounce to avoid excessive updates
            clearTimeout(this.equipmentChangeTimeout);
            this.equipmentChangeTimeout = setTimeout(() => {
                if (this.isActive) {
                    // Clear fingerprint to force update since equipment affects calculations
                    this.lastFingerprint = null;
                    this.checkAndUpdateDisplay();
                }
            }, 100);
        };
        dataManager.on('items_updated', this.equipmentChangeHandler);

        this.isActive = true;
    }

    /**
     * Setup DOM observer to watch for alchemy panel
     */
    setupObserver() {
        // Observer for alchemy component appearing
        this.unregisterObserver = domObserver.onClass(
            'AlchemyProfitDisplay',
            'SkillActionDetail_alchemyComponent',
            (alchemyComponent) => {
                this.checkAndUpdateDisplay();
                // Setup content observer when alchemy component appears
                this.setupContentObserver(alchemyComponent);
            }
        );

        // Initial check for existing panel
        const existingComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
        if (existingComponent) {
            this.checkAndUpdateDisplay();
            this.setupContentObserver(existingComponent);
        }
    }

    /**
     * Setup observer for content changes within alchemy component
     * Watches for tab switches and item selection changes
     * @param {HTMLElement} alchemyComponent - The alchemy component container
     */
    setupContentObserver(alchemyComponent) {
        // Don't create duplicate observers
        if (this.contentObserver) {
            this.contentObserver.disconnect();
        }
        if (this.tabObserver) {
            this.tabObserver.disconnect();
        }

        // Debounce timer for update calls
        let debounceTimer = null;

        const triggerUpdate = () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                this.checkAndUpdateDisplay();
            }, 50);
        };

        // Observer for tab switches - observe the tab container separately
        const tabContainer = document.querySelector('[class*="AlchemyPanel_tabsComponentContainer"]');
        if (tabContainer) {
            this.tabObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'aria-selected') {
                        if (mutation.target.getAttribute('aria-selected') === 'true') {
                            triggerUpdate();
                            return;
                        }
                    }
                }
            });

            this.tabObserver.observe(tabContainer, {
                attributes: true,
                attributeFilter: ['aria-selected'],
                subtree: true,
            });
        }

        // Observer for content changes (item selection)
        this.contentObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const className = node.className || '';
                            if (
                                typeof className === 'string' &&
                                (className.includes('SkillActionDetail_itemRequirements') ||
                                    className.includes('SkillActionDetail_alchemyOutput') ||
                                    className.includes('SkillActionDetail_primaryItemSelectorContainer') ||
                                    className.includes('SkillActionDetail_instructions'))
                            ) {
                                triggerUpdate();
                                return;
                            }
                        }
                    }
                }
            }
        });

        // Observe the alchemy component for content changes
        this.contentObserver.observe(alchemyComponent, {
            childList: true,
            subtree: true,
        });
    }

    /**
     * Check DOM state and update display accordingly
     * Pattern from enhancement-ui.js
     */
    checkAndUpdateDisplay() {
        // Query current DOM state
        const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
        const instructionsEl = document.querySelector('[class*="SkillActionDetail_instructions"]');
        const infoContainer = document.querySelector('[class*="SkillActionDetail_info"]');

        // Determine if display should be shown
        // Show if: alchemy component exists AND instructions NOT present AND info container exists
        const shouldShow = alchemyComponent && !instructionsEl && infoContainer;

        if (shouldShow && (!this.displayElement || !this.displayElement.parentNode)) {
            // Should show but doesn't exist - create it
            this.handleAlchemyPanelUpdate(alchemyComponent);
        } else if (!shouldShow && this.displayElement?.parentNode) {
            // Shouldn't show but exists - remove it
            this.removeDisplay();
        } else if (shouldShow && this.displayElement?.parentNode) {
            // Should show and exists - check if state changed
            const fingerprint = alchemyProfit.getStateFingerprint();
            if (fingerprint !== this.lastFingerprint) {
                this.handleAlchemyPanelUpdate(alchemyComponent);
            }
        }
    }

    /**
     * Handle alchemy panel update
     * @param {HTMLElement} alchemyComponent - Alchemy component container
     */
    handleAlchemyPanelUpdate(alchemyComponent) {
        // Get info container
        const infoContainer = alchemyComponent.querySelector('[class*="SkillActionDetail_info"]');
        if (!infoContainer) {
            this.removeDisplay();
            return;
        }

        // Check if state has changed
        const fingerprint = alchemyProfit.getStateFingerprint();
        if (fingerprint === this.lastFingerprint && this.displayElement?.parentNode) {
            return; // No change, display still valid
        }
        this.lastFingerprint = fingerprint;

        // Debounce updates
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = setTimeout(() => {
            this.updateDisplay(infoContainer);
        }, 100);
        this.timerRegistry.registerTimeout(this.updateTimeout);
    }

    /**
     * Update or create profit display
     * @param {HTMLElement} infoContainer - Info container to append display to
     */
    async updateDisplay(infoContainer) {
        try {
            // Get current action HRID to determine action type
            const actionHrid = alchemyProfit.getCurrentActionHrid();

            let profitData = null;

            // Check alchemy action type by examining the drops and requirements
            const drops = await alchemyProfit.extractDrops(actionHrid);
            const requirements = await alchemyProfit.extractRequirements();

            // Determine action type from actionHrid (most reliable) or DOM tab state
            let isCoinify = false;
            let isTransmute = false;
            let isDecompose = false;

            if (actionHrid) {
                // Player is actively performing an alchemy action - use actionHrid
                isCoinify = actionHrid === '/actions/alchemy/coinify';
                isTransmute = actionHrid === '/actions/alchemy/transmute';
                isDecompose = actionHrid === '/actions/alchemy/decompose';
            } else {
                // Not actively performing - check which tab is selected in the DOM
                const selectedTab = document.querySelector(
                    '[class*="AlchemyPanel_tabButton"][aria-selected="true"], ' +
                        '[class*="AlchemyPanel_tab"][aria-selected="true"]'
                );
                const tabText = selectedTab?.textContent?.trim()?.toLowerCase() || '';

                if (tabText.includes('coinify')) {
                    isCoinify = true;
                } else if (tabText.includes('transmute')) {
                    isTransmute = true;
                } else if (tabText.includes('decompose')) {
                    isDecompose = true;
                } else {
                    // Final fallback: use drop/item data heuristics
                    isCoinify = drops.length > 0 && drops[0].itemHrid === '/items/coin';
                    if (!isCoinify && requirements && requirements.length > 0) {
                        const reqItemHrid = requirements[0].itemHrid;
                        const reqItemDetails = dataManager.getItemDetails(reqItemHrid);
                        const hasDecompose =
                            Array.isArray(reqItemDetails?.alchemyDetail?.decomposeItems) &&
                            reqItemDetails.alchemyDetail.decomposeItems.length > 0;
                        const hasTransmute = !!reqItemDetails?.alchemyDetail?.transmuteDropTable;
                        // If both exist, default to transmute; if only one, use that one
                        if (hasDecompose && !hasTransmute) {
                            isDecompose = true;
                        } else if (hasTransmute) {
                            isTransmute = true;
                        } else if (hasDecompose) {
                            isDecompose = true;
                        }
                    }
                }
            }

            if (isCoinify) {
                // Use unified calculator for coinify
                if (requirements && requirements.length > 0) {
                    const itemHrid = requirements[0].itemHrid;
                    const enhancementLevel = requirements[0].enhancementLevel || 0;

                    // Call unified calculator
                    profitData = alchemyProfitCalculator.calculateCoinifyProfit(itemHrid, enhancementLevel);
                }
            } else if (isTransmute) {
                // Use unified calculator for transmute
                if (requirements && requirements.length > 0) {
                    const itemHrid = requirements[0].itemHrid;

                    // Call unified calculator
                    profitData = alchemyProfitCalculator.calculateTransmuteProfit(itemHrid);
                }
            } else if ((isDecompose || (!isCoinify && !isTransmute)) && requirements && requirements.length > 0) {
                // Use unified calculator for decompose
                const itemHrid = requirements[0].itemHrid;
                const enhancementLevel = requirements[0].enhancementLevel || 0;

                // Call unified calculator
                profitData = alchemyProfitCalculator.calculateDecomposeProfit(itemHrid, enhancementLevel);
            }

            if (!profitData) {
                this.removeDisplay();
                return;
            }

            // Determine action type string for XP calculation
            let actionType = null;
            if (isCoinify) actionType = 'coinify';
            else if (isDecompose) actionType = 'decompose';
            else if (isTransmute) actionType = 'transmute';

            // Get item HRID from requirements
            const itemHrid = requirements && requirements.length > 0 ? requirements[0].itemHrid : null;

            // Save expanded/collapsed state before recreating
            const expandedState = this.saveExpandedState();

            // Always recreate display (complex collapsible structure makes refresh difficult)
            this.createDisplay(infoContainer, profitData, actionType, itemHrid);

            // Restore expanded/collapsed state
            this.restoreExpandedState(expandedState);
        } catch (error) {
            console.error('[AlchemyProfitDisplay] Failed to update display:', error);
            this.removeDisplay();
        }
    }

    /**
     * Save the expanded/collapsed state of all collapsible sections
     * @returns {Map<string, boolean>} Map of section titles to their expanded state
     */
    saveExpandedState() {
        const state = new Map();

        if (!this.displayElement) {
            return state;
        }

        // Find all collapsible sections and save their state
        const sections = this.displayElement.querySelectorAll('.mwi-collapsible-section');
        sections.forEach((section) => {
            const header = section.querySelector('.mwi-section-header');
            const content = section.querySelector('.mwi-section-content');
            const label = header?.querySelector('span:last-child');

            if (label && content) {
                const title = label.textContent.trim();
                const isExpanded = content.style.display === 'block';
                state.set(title, isExpanded);
            }
        });

        return state;
    }

    /**
     * Restore the expanded/collapsed state of collapsible sections
     * @param {Map<string, boolean>} state - Map of section titles to their expanded state
     */
    restoreExpandedState(state) {
        if (!this.displayElement || state.size === 0) {
            return;
        }

        // Find all collapsible sections and restore their state
        const sections = this.displayElement.querySelectorAll('.mwi-collapsible-section');
        sections.forEach((section) => {
            const header = section.querySelector('.mwi-section-header');
            const content = section.querySelector('.mwi-section-content');
            const summary = section.querySelector('div[style*="margin-left: 16px"]');
            const arrow = header?.querySelector('span:first-child');
            const label = header?.querySelector('span:last-child');

            if (label && content && arrow) {
                const title = label.textContent.trim();
                const shouldBeExpanded = state.get(title);

                if (shouldBeExpanded !== undefined && shouldBeExpanded) {
                    // Expand this section
                    content.style.display = 'block';
                    if (summary) {
                        summary.style.display = 'none';
                    }
                    arrow.textContent = '▼';
                }
            }
        });
    }

    /**
     * Create profit display element with detailed breakdown
     * @param {HTMLElement} container - Container to append to
     * @param {Object} profitData - Profit calculation results from calculateProfit()
     * @param {string} actionType - Alchemy action type ('coinify', 'decompose', or 'transmute')
     * @param {string} itemHrid - Item HRID being processed
     */
    createDisplay(container, profitData, actionType, itemHrid) {
        // Remove any existing display
        this.removeDisplay();

        // Validate required data
        if (
            !profitData ||
            !profitData.dropRevenues ||
            !profitData.requirementCosts ||
            !profitData.catalystCost ||
            !profitData.consumableCosts
        ) {
            console.error('[AlchemyProfitDisplay] Missing required profit data fields:', profitData);
            return;
        }

        // Extract summary values
        const profit = Math.round(profitData.profitPerHour);
        const profitPerDay = Math.round(profitData.profitPerDay);
        const revenue = Math.round(profitData.revenuePerHour);
        const costs = Math.round(
            profitData.materialCostPerHour + profitData.catalystCostPerHour + profitData.totalTeaCostPerHour
        );
        const summary = `${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;

        const detailsContent = document.createElement('div');

        // Revenue Section
        const revenueDiv = document.createElement('div');
        revenueDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;">Revenue: ${formatLargeNumber(revenue)}/hr</div>`;

        // Split drops into normal, essence, and rare
        const normalDrops = profitData.dropRevenues.filter((drop) => !drop.isEssence && !drop.isRare);
        const essenceDrops = profitData.dropRevenues.filter((drop) => drop.isEssence);
        const rareDrops = profitData.dropRevenues.filter((drop) => drop.isRare);

        // Normal Drops subsection
        if (normalDrops.length > 0) {
            const normalDropsContent = document.createElement('div');
            let normalDropsRevenue = 0;

            for (const drop of normalDrops) {
                const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                const itemName = itemDetails?.name || drop.itemHrid;
                const decimals = 2; // Always use 2 decimals
                const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);

                const dropsDisplay =
                    drop.dropsPerHour >= 10000
                        ? formatLargeNumber(Math.round(drop.dropsPerHour))
                        : drop.dropsPerHour.toFixed(decimals);

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                if (drop.isSelfReturn) {
                    line.style.textDecoration = 'line-through';
                    line.style.opacity = '0.6';
                }
                line.textContent = `• ${itemName}: ${dropsDisplay}/hr (${dropRatePct} × ${formatPercentage(profitData.successRate, 1)} success) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                normalDropsContent.appendChild(line);

                normalDropsRevenue += drop.revenuePerHour;
            }

            const normalDropsSection = createCollapsibleSection(
                '',
                `Normal Drops: ${formatLargeNumber(Math.round(normalDropsRevenue))}/hr (${normalDrops.length} item${normalDrops.length !== 1 ? 's' : ''})`,
                null,
                normalDropsContent,
                false,
                1
            );
            revenueDiv.appendChild(normalDropsSection);
        }

        // Essence Drops subsection
        if (essenceDrops.length > 0) {
            const essenceContent = document.createElement('div');
            let essenceRevenue = 0;

            for (const drop of essenceDrops) {
                const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                const itemName = itemDetails?.name || drop.itemHrid;
                const decimals = 2; // Always use 2 decimals
                const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct}, not affected by success rate) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                essenceContent.appendChild(line);

                essenceRevenue += drop.revenuePerHour;
            }

            const essenceSection = createCollapsibleSection(
                '',
                `Essence Drops: ${formatLargeNumber(Math.round(essenceRevenue))}/hr (${essenceDrops.length} item${essenceDrops.length !== 1 ? 's' : ''})`,
                null,
                essenceContent,
                false,
                1
            );
            revenueDiv.appendChild(essenceSection);
        }

        // Rare Drops subsection
        if (rareDrops.length > 0) {
            const rareContent = document.createElement('div');
            let rareRevenue = 0;

            for (const drop of rareDrops) {
                const itemDetails = dataManager.getItemDetails(drop.itemHrid);
                const itemName = itemDetails?.name || drop.itemHrid;
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                const baseDropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);
                const effectiveDropRatePct = formatPercentage(
                    drop.effectiveDropRate,
                    drop.effectiveDropRate < 0.01 ? 3 : 2
                );

                const line = document.createElement('div');
                line.style.marginLeft = '8px';

                // Show both base and effective drop rate (not affected by success rate)
                if (profitData.rareFindBreakdown && profitData.rareFindBreakdown.total > 0) {
                    const rareFindBonus = `${profitData.rareFindBreakdown.total.toFixed(2)}%`;
                    line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct} base × ${rareFindBonus} rare find = ${effectiveDropRatePct}, not affected by success rate) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                } else {
                    line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct}, not affected by success rate) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                }

                rareContent.appendChild(line);

                rareRevenue += drop.revenuePerHour;
            }

            const rareSection = createCollapsibleSection(
                '',
                `Rare Drops: ${formatLargeNumber(Math.round(rareRevenue))}/hr (${rareDrops.length} item${rareDrops.length !== 1 ? 's' : ''})`,
                null,
                rareContent,
                false,
                1
            );
            revenueDiv.appendChild(rareSection);
        }

        // Costs Section
        const costsDiv = document.createElement('div');
        costsDiv.innerHTML = `<div style="font-weight: 500; color: var(--text-color-primary, #fff); margin-top: 12px; margin-bottom: 4px;">Costs: ${formatLargeNumber(costs)}/hr</div>`;

        // Material Costs subsection (consumed on ALL attempts)
        if (profitData.requirementCosts && profitData.requirementCosts.length > 0) {
            const materialCostsContent = document.createElement('div');
            for (const material of profitData.requirementCosts) {
                const itemDetails = dataManager.getItemDetails(material.itemHrid);
                const itemName = itemDetails?.name || material.itemHrid;
                const amountPerHour = material.count * profitData.actionsPerHour;

                const line = document.createElement('div');
                line.style.marginLeft = '8px';

                // Show enhancement level if > 0
                const enhText = material.enhancementLevel > 0 ? ` +${material.enhancementLevel}` : '';

                // Format amount per hour
                const formattedAmount =
                    amountPerHour >= 10000
                        ? formatLargeNumber(amountPerHour)
                        : formatWithSeparator(amountPerHour.toFixed(2));

                // Show decomposition value if enhanced
                if (material.enhancementLevel > 0 && material.decompositionValuePerHour > 0) {
                    const netCostPerHour = material.costPerHour - material.decompositionValuePerHour;
                    line.textContent = `• ${itemName}${enhText}: ${formattedAmount}/hr @ ${formatWithSeparator(Math.round(material.price))} → ${formatLargeNumber(Math.round(material.costPerHour))}/hr (recovers ${formatLargeNumber(Math.round(material.decompositionValuePerHour))}/hr, net ${formatLargeNumber(Math.round(netCostPerHour))}/hr)`;
                } else {
                    line.textContent = `• ${itemName}${enhText}: ${formattedAmount}/hr (consumed on all attempts) @ ${formatWithSeparator(Math.round(material.price))} → ${formatLargeNumber(Math.round(material.costPerHour))}/hr`;
                }

                materialCostsContent.appendChild(line);
            }

            const materialCostsSection = createCollapsibleSection(
                '',
                `Material Costs: ${formatLargeNumber(Math.round(profitData.materialCostPerHour))}/hr (${profitData.requirementCosts.length} material${profitData.requirementCosts.length !== 1 ? 's' : ''})`,
                null,
                materialCostsContent,
                false,
                1
            );
            costsDiv.appendChild(materialCostsSection);
        }

        // Catalyst Cost subsection (consumed only on success)
        if (profitData.catalystCost && profitData.catalystCost.itemHrid) {
            const catalystContent = document.createElement('div');
            const itemDetails = dataManager.getItemDetails(profitData.catalystCost.itemHrid);
            const itemName = itemDetails?.name || profitData.catalystCost.itemHrid;

            // Calculate catalysts per hour (only consumed on success)
            const catalystsPerHour = profitData.actionsPerHour * profitData.successRate;

            // Format catalyst amount
            const formattedCatalystAmount =
                catalystsPerHour >= 10000
                    ? formatLargeNumber(catalystsPerHour)
                    : formatWithSeparator(catalystsPerHour.toFixed(2));

            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${itemName}: ${formattedCatalystAmount}/hr (consumed only on success, ${formatPercentage(profitData.successRate, 2)}) @ ${formatWithSeparator(Math.round(profitData.catalystCost.price))} → ${formatLargeNumber(Math.round(profitData.catalystCost.costPerHour))}/hr`;
            catalystContent.appendChild(line);

            const catalystSection = createCollapsibleSection(
                '',
                `Catalyst Cost: ${formatLargeNumber(Math.round(profitData.catalystCost.costPerHour))}/hr`,
                null,
                catalystContent,
                false,
                1
            );
            costsDiv.appendChild(catalystSection);
        }

        // Drink Costs subsection
        if (profitData.consumableCosts && profitData.consumableCosts.length > 0) {
            const drinkCostsContent = document.createElement('div');
            for (const drink of profitData.consumableCosts) {
                const itemDetails = dataManager.getItemDetails(drink.itemHrid);
                const itemName = itemDetails?.name || drink.itemHrid;

                // Format drinks per hour
                const formattedDrinkAmount =
                    drink.drinksPerHour >= 10000
                        ? formatLargeNumber(drink.drinksPerHour)
                        : formatWithSeparator(drink.drinksPerHour.toFixed(2));

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${itemName}: ${formattedDrinkAmount}/hr @ ${formatWithSeparator(Math.round(drink.price))} → ${formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
                drinkCostsContent.appendChild(line);
            }

            const drinkCount = profitData.consumableCosts.length;
            const drinkCostsSection = createCollapsibleSection(
                '',
                `Drink Costs: ${formatLargeNumber(Math.round(profitData.totalTeaCostPerHour))}/hr (${drinkCount} drink${drinkCount !== 1 ? 's' : ''})`,
                null,
                drinkCostsContent,
                false,
                1
            );
            costsDiv.appendChild(drinkCostsSection);
        }

        // Modifiers Section
        const modifiersDiv = document.createElement('div');
        modifiersDiv.style.cssText = `
            margin-top: 12px;
        `;

        // Main modifiers header
        const modifiersHeader = document.createElement('div');
        modifiersHeader.style.cssText = 'font-weight: 500; color: var(--text-color-primary, #fff); margin-bottom: 4px;';
        modifiersHeader.textContent = 'Modifiers:';
        modifiersDiv.appendChild(modifiersHeader);

        // Success Rate breakdown
        if (profitData.successRateBreakdown) {
            const successBreakdown = profitData.successRateBreakdown;
            const successContent = document.createElement('div');

            // Base success rate (from player level vs recipe requirement)
            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• Base Success Rate: ${formatPercentage(successBreakdown.base, 1)}`;
            successContent.appendChild(line);

            // Tea bonus (from Catalytic Tea)
            if (successBreakdown.tea > 0) {
                const teaLine = document.createElement('div');
                teaLine.style.marginLeft = '8px';
                teaLine.textContent = `• Tea Bonus: +${formatPercentage(successBreakdown.tea, 1)} (multiplicative)`;
                successContent.appendChild(teaLine);
            }

            const successSection = createCollapsibleSection(
                '',
                `Success Rate: ${formatPercentage(profitData.successRate, 1)}`,
                null,
                successContent,
                false,
                1
            );
            modifiersDiv.appendChild(successSection);
        } else {
            // Fallback if breakdown not available
            const successRateLine = document.createElement('div');
            successRateLine.style.marginLeft = '8px';
            successRateLine.textContent = `• Success Rate: ${formatPercentage(profitData.successRate, 1)}`;
            modifiersDiv.appendChild(successRateLine);
        }

        // Efficiency breakdown
        if (profitData.efficiencyBreakdown) {
            const effBreakdown = profitData.efficiencyBreakdown;
            const effContent = document.createElement('div');

            if (effBreakdown.levelEfficiency > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Level Bonus: +${effBreakdown.levelEfficiency.toFixed(2)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.houseEfficiency > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• House Bonus: +${effBreakdown.houseEfficiency.toFixed(2)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.teaEfficiency > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Tea Bonus: +${effBreakdown.teaEfficiency.toFixed(2)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.equipmentEfficiency > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Equipment Bonus: +${effBreakdown.equipmentEfficiency.toFixed(2)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.communityEfficiency > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Community Buff: +${effBreakdown.communityEfficiency.toFixed(2)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.achievementEfficiency > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Achievement Bonus: +${effBreakdown.achievementEfficiency.toFixed(2)}%`;
                effContent.appendChild(line);
            }

            const effSection = createCollapsibleSection(
                '',
                `Efficiency: +${formatPercentage(profitData.efficiency, 1)}`,
                null,
                effContent,
                false,
                1
            );
            modifiersDiv.appendChild(effSection);
        }

        // Action Speed breakdown
        if (profitData.actionSpeedBreakdown) {
            const speedBreakdown = profitData.actionSpeedBreakdown;
            const baseActionTime = 20; // Alchemy base time is 20 seconds
            const actionSpeed = baseActionTime / profitData.actionTime - 1;

            if (actionSpeed > 0) {
                const speedContent = document.createElement('div');

                if (speedBreakdown.equipment > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Equipment Bonus: +${formatPercentage(speedBreakdown.equipment, 1)}`;
                    speedContent.appendChild(line);
                }

                if (speedBreakdown.tea > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Tea Bonus: +${formatPercentage(speedBreakdown.tea, 1)}`;
                    speedContent.appendChild(line);
                }

                const speedSection = createCollapsibleSection(
                    '',
                    `Action Speed: +${formatPercentage(actionSpeed, 1)}`,
                    null,
                    speedContent,
                    false,
                    1
                );
                modifiersDiv.appendChild(speedSection);
            }
        }

        // Rare Find breakdown
        if (profitData.rareFindBreakdown) {
            const rareBreakdown = profitData.rareFindBreakdown;

            if (rareBreakdown.total > 0) {
                const rareContent = document.createElement('div');

                if (rareBreakdown.equipment > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Equipment Bonus: +${rareBreakdown.equipment.toFixed(2)}%`;
                    rareContent.appendChild(line);
                }

                if (rareBreakdown.house > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• House Bonus: +${rareBreakdown.house.toFixed(2)}%`;
                    rareContent.appendChild(line);
                }

                if (rareBreakdown.achievement > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Achievement Bonus: +${rareBreakdown.achievement.toFixed(2)}%`;
                    rareContent.appendChild(line);
                }

                const rareSection = createCollapsibleSection(
                    '',
                    `Rare Find: +${rareBreakdown.total.toFixed(2)}%`,
                    null,
                    rareContent,
                    false,
                    1
                );
                modifiersDiv.appendChild(rareSection);
            }
        }

        // Essence Find breakdown
        if (profitData.essenceFindBreakdown) {
            const essenceBreakdown = profitData.essenceFindBreakdown;

            if (essenceBreakdown.total > 0) {
                const essenceContent = document.createElement('div');

                if (essenceBreakdown.equipment > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Equipment Bonus: +${essenceBreakdown.equipment.toFixed(2)}%`;
                    essenceContent.appendChild(line);
                }

                const essenceSection = createCollapsibleSection(
                    '',
                    `Essence Find: +${essenceBreakdown.total.toFixed(2)}%`,
                    null,
                    essenceContent,
                    false,
                    1
                );
                modifiersDiv.appendChild(essenceSection);
            }
        }

        // Assemble Detailed Breakdown
        detailsContent.appendChild(revenueDiv);
        detailsContent.appendChild(costsDiv);
        detailsContent.appendChild(modifiersDiv);

        // Create "Detailed Breakdown" collapsible
        const topLevelContent = document.createElement('div');
        topLevelContent.innerHTML = `
            <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(2)}/hr | Success Rate: ${formatPercentage(profitData.successRate, 2)}</div>
        `;

        // Add Net Profit line at top level (always visible when Profitability is expanded)
        const profitColor = profit >= 0 ? '#4ade80' : config.getSetting('color_loss') || '#f87171';
        const netProfitLine = document.createElement('div');
        netProfitLine.style.cssText = `
            font-weight: 500;
            color: ${profitColor};
            margin-bottom: 8px;
        `;
        netProfitLine.textContent = `Net Profit: ${formatLargeNumber(profit)}/hr, ${formatLargeNumber(profitPerDay)}/day`;
        topLevelContent.appendChild(netProfitLine);

        // Add pricing mode label
        const pricingMode = profitData.pricingMode || 'hybrid';
        const modeLabel =
            {
                conservative: 'Conservative',
                hybrid: 'Hybrid',
                optimistic: 'Optimistic',
            }[pricingMode] || 'Hybrid';

        const modeDiv = document.createElement('div');
        modeDiv.style.cssText = `
            margin-bottom: 8px;
            color: #888;
            font-size: 0.85em;
        `;
        modeDiv.textContent = `Pricing Mode: ${modeLabel}`;
        topLevelContent.appendChild(modeDiv);

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
        const profitSection = createCollapsibleSection('💰', 'Profitability', summary, topLevelContent, false, 0);
        profitSection.id = 'mwi-alchemy-profit';
        profitSection.classList.add('mwi-alchemy-profit');

        // Append to container
        container.appendChild(profitSection);

        // Find the Repeat input field for dynamic updates
        const alchemyComponent = document.querySelector('[class*="SkillActionDetail_alchemyComponent"]');
        const inputContainer = alchemyComponent?.querySelector('[class*="maxActionCountInput"]');
        const inputField = inputContainer?.querySelector('input');

        // Cache the input field if available (it gets removed when action starts)
        if (inputField) {
            this.cachedInputField = inputField;
        }

        // Use cached input field if current one is not available
        const effectiveInputField = inputField || this.cachedInputField;

        // Create Action Speed & Time section (after profitability)
        if (effectiveInputField && profitData.actionTime && profitData.efficiencyBreakdown) {
            const speedTimeSection = this.createActionSpeedTimeSection(profitData, effectiveInputField);
            if (speedTimeSection) {
                speedTimeSection.id = 'mwi-alchemy-speed-time';
                speedTimeSection.classList.add('mwi-alchemy-speed-time');
                container.appendChild(speedTimeSection);
            }
        }

        // Create Level Progress section (after action speed)
        if (actionType && itemHrid) {
            const levelProgressSection = this.createLevelProgressSection(actionType, itemHrid, profitData);
            if (levelProgressSection) {
                levelProgressSection.id = 'mwi-alchemy-level-progress';
                levelProgressSection.classList.add('mwi-alchemy-level-progress');
                container.appendChild(levelProgressSection);
            }
        }

        this.displayElement = profitSection;
    }

    /**
     * Calculate alchemy base XP based on action type and item level
     * @param {string} actionType - 'coinify', 'decompose', or 'transmute'
     * @param {number} itemLevel - Item level from itemDetailMap
     * @returns {number} Base XP before wisdom multiplier
     */
    getAlchemyBaseXP(actionType, itemLevel) {
        switch (actionType) {
            case 'coinify':
                return itemLevel + 10;
            case 'decompose':
                return itemLevel * 1.4 + 14;
            case 'transmute':
                return itemLevel * 1.6 + 16;
            default:
                return 0;
        }
    }

    /**
     * Calculate expected XP per action accounting for success rate and wisdom
     * @param {string} actionType - Alchemy action type
     * @param {string} itemHrid - Item HRID
     * @param {number} successRate - Success rate (0-1)
     * @returns {number} Expected XP per action
     */
    calculateAlchemyXPPerAction(actionType, itemHrid, successRate) {
        const gameData = dataManager.getInitClientData();
        if (!gameData || !itemHrid) return 0;

        const itemDetails = gameData.itemDetailMap?.[itemHrid];
        if (!itemDetails || !itemDetails.itemLevel) return 0;

        const baseXP = this.getAlchemyBaseXP(actionType, itemDetails.itemLevel);
        if (baseXP === 0) return 0;

        // Calculate wisdom multiplier
        const xpData = calculateExperienceMultiplier('/skills/alchemy', '/action_types/alchemy');
        const wisdomMultiplier = xpData.totalMultiplier;

        // Calculate expected XP with success/failure rates
        const successXP = baseXP * wisdomMultiplier;
        const failureXP = successXP * 0.1; // Failed actions give 10% XP

        // Expected value = (success rate × full XP) + (failure rate × 10% XP)
        return successRate * successXP + (1 - successRate) * failureXP;
    }

    /**
     * Create Action Speed & Time section
     * @param {Object} profitData - Profit data with action time and efficiency
     * @param {HTMLInputElement} inputField - Repeat input field
     * @returns {HTMLElement|null} Action Speed & Time section element
     */
    createActionSpeedTimeSection(profitData, inputField) {
        try {
            const actionTime = profitData.actionTime;
            const actionsPerHourBase = calculateActionsPerHour(actionTime); // Base without efficiency
            const efficiencyMultiplier = 1 + profitData.efficiency; // efficiency is already decimal (0.933 = 93.3%)
            const effectiveActionsPerHour = Math.round(actionsPerHourBase * efficiencyMultiplier);

            const content = document.createElement('div');
            content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

            const lines = [];

            // Base time and speed
            const baseTime = 20;
            lines.push(`Base: ${baseTime.toFixed(2)}s → ${actionTime.toFixed(2)}s`);

            // Always show actions/hr
            lines.push(`${calculateActionsPerHour(actionTime).toFixed(0)}/hr`);

            // Speed breakdown (if any bonuses exist)
            if (profitData.actionSpeedBreakdown && profitData.actionSpeedBreakdown.total > 0) {
                const speedBonus = profitData.actionSpeedBreakdown.total;
                lines.push(`Speed: +${formatPercentage(speedBonus, 1)}`);

                // Show detailed equipment breakdown if available
                const speedBreakdown = profitData.actionSpeedBreakdown;
                if (speedBreakdown.equipmentDetails && speedBreakdown.equipmentDetails.length > 0) {
                    for (const item of speedBreakdown.equipmentDetails) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`  - ${item.name}${enhText}: +${formatPercentage(item.speedBonus, 1)}`);
                    }
                } else if (speedBreakdown.equipment > 0) {
                    // Fallback to total if details not available
                    lines.push(`  - Equipment: +${formatPercentage(speedBreakdown.equipment, 1)}`);
                }

                // Show tea speed if available
                if (speedBreakdown.teaDetails && speedBreakdown.teaDetails.length > 0) {
                    for (const tea of speedBreakdown.teaDetails) {
                        lines.push(`  - ${tea.name}: +${formatPercentage(tea.speedBonus, 1)}`);
                    }
                } else if (speedBreakdown.tea > 0) {
                    // Fallback to total if details not available
                    lines.push(`  - Tea: +${formatPercentage(speedBreakdown.tea, 1)}`);
                }
            }

            // Efficiency breakdown
            lines.push('');
            lines.push(
                `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">Efficiency: +${(profitData.efficiency * 100).toFixed(2)}% → Output: ×${efficiencyMultiplier.toFixed(2)} (${effectiveActionsPerHour}/hr)</span>`
            );

            const effBreakdown = profitData.efficiencyBreakdown;
            if (effBreakdown.levelEfficiency > 0) {
                lines.push(`  - Level: +${effBreakdown.levelEfficiency.toFixed(2)}%`);
            }
            if (effBreakdown.houseEfficiency > 0) {
                lines.push(`  - House: +${effBreakdown.houseEfficiency.toFixed(2)}%`);
            }
            if (effBreakdown.equipmentEfficiency > 0) {
                lines.push(`  - Equipment: +${effBreakdown.equipmentEfficiency.toFixed(2)}%`);
            }
            if (effBreakdown.teaEfficiency > 0) {
                lines.push(`  - Tea: +${effBreakdown.teaEfficiency.toFixed(2)}%`);
            }
            if (effBreakdown.achievementEfficiency > 0) {
                lines.push(`  - Achievement: +${effBreakdown.achievementEfficiency.toFixed(2)}%`);
            }
            if (effBreakdown.communityEfficiency > 0) {
                lines.push(`  - Community: +${effBreakdown.communityEfficiency.toFixed(2)}%`);
            }

            // Total time (dynamic)
            const totalTimeLine = document.createElement('div');
            totalTimeLine.style.cssText = `
                color: var(--text-color-main, ${config.COLOR_INFO});
                font-weight: 500;
                margin-top: 4px;
            `;

            const updateTotalTime = () => {
                const inputValue = inputField.value;

                if (inputValue === '∞') {
                    totalTimeLine.textContent = 'Total time: ∞';
                    return;
                }

                const repeatCount = parseInt(inputValue) || 0;
                if (repeatCount > 0) {
                    const baseActionsNeeded = Math.ceil(repeatCount / efficiencyMultiplier);
                    const totalSeconds = baseActionsNeeded * actionTime;
                    totalTimeLine.textContent = `Total time: ${timeReadable(totalSeconds)}`;
                } else {
                    totalTimeLine.textContent = 'Total time: 0s';
                }
            };

            lines.push('');
            content.innerHTML = lines.join('<br>');
            content.appendChild(totalTimeLine);

            // Initial update
            updateTotalTime();

            // Watch for input changes
            const updateOnInput = () => updateTotalTime();
            const updateOnChange = () => updateTotalTime();
            inputField.addEventListener('input', updateOnInput);
            inputField.addEventListener('change', updateOnChange);

            // Create summary for collapsed view (dynamic based on input)
            const getSummary = () => {
                const inputValue = inputField.value;
                if (inputValue === '∞') {
                    return `${effectiveActionsPerHour}/hr | Total time: ∞`;
                }
                const repeatCount = parseInt(inputValue) || 0;
                if (repeatCount > 0) {
                    const baseActionsNeeded = Math.ceil(repeatCount / efficiencyMultiplier);
                    const totalSeconds = baseActionsNeeded * actionTime;
                    return `${effectiveActionsPerHour}/hr | Total time: ${timeReadable(totalSeconds)}`;
                }
                return `${effectiveActionsPerHour}/hr | Total time: 0s`;
            };

            const summary = getSummary();

            return createCollapsibleSection('⏱', 'Action Speed & Time', summary, content, false);
        } catch (error) {
            console.error('[AlchemyProfitDisplay] Error creating action speed/time section:', error);
            return null;
        }
    }

    /**
     * Create Level Progress section
     * @param {string} actionType - Alchemy action type
     * @param {string} itemHrid - Item HRID being processed
     * @param {Object} profitData - Profit data
     * @returns {HTMLElement|null} Level Progress section element
     */
    createLevelProgressSection(actionType, itemHrid, profitData) {
        try {
            const gameData = dataManager.getInitClientData();
            if (!gameData) return null;

            const skills = dataManager.getSkills();
            if (!skills) return null;

            const alchemySkill = skills.find((s) => s.skillHrid === '/skills/alchemy');
            if (!alchemySkill) return null;

            const levelExperienceTable = gameData.levelExperienceTable;
            if (!levelExperienceTable) return null;

            const currentLevel = alchemySkill.level;
            const currentXP = alchemySkill.experience || 0;
            const nextLevel = currentLevel + 1;
            const xpForNextLevel = levelExperienceTable[nextLevel];

            if (!xpForNextLevel) {
                // Max level reached
                return null;
            }

            // Calculate XP per action
            const xpPerAction = this.calculateAlchemyXPPerAction(actionType, itemHrid, profitData.successRate);
            if (xpPerAction === 0) return null;

            // Calculate progress
            const xpForCurrentLevel = levelExperienceTable[currentLevel] || 0;
            const xpGainedThisLevel = currentXP - xpForCurrentLevel;
            const xpNeededThisLevel = xpForNextLevel - xpForCurrentLevel;
            const progressPercent = (xpGainedThisLevel / xpNeededThisLevel) * 100;
            const xpNeeded = xpForNextLevel - currentXP;

            // Calculate actions and time needed
            const actionsNeeded = Math.ceil(xpNeeded / xpPerAction);
            const actionTime = profitData.actionTime;
            const efficiencyMultiplier = 1 + profitData.efficiency; // efficiency is already decimal
            const baseActionsNeeded = Math.ceil(actionsNeeded / efficiencyMultiplier);
            const timeNeeded = baseActionsNeeded * actionTime;

            // Calculate rates
            const actionsPerHourBase = calculateActionsPerHour(actionTime);
            const xpPerHour = actionsPerHourBase * efficiencyMultiplier * xpPerAction;
            const xpPerDay = xpPerHour * 24;

            const content = document.createElement('div');
            content.style.cssText = `
                color: var(--text-color-secondary, ${config.COLOR_TEXT_SECONDARY});
                font-size: 0.9em;
                line-height: 1.6;
            `;

            const lines = [];

            // Current level and progress
            lines.push(`Current: Level ${currentLevel} | ${progressPercent.toFixed(2)}% to Level ${nextLevel}`);
            lines.push('');

            // Calculate XP breakdown
            const itemDetails = gameData.itemDetailMap?.[itemHrid];
            const itemLevel = itemDetails?.itemLevel || 0;
            const baseXP = this.getAlchemyBaseXP(actionType, itemLevel);
            const xpData = calculateExperienceMultiplier('/skills/alchemy', '/action_types/alchemy');
            const wisdomMultiplier = xpData.totalMultiplier;

            // Show base → modified XP with multiplier
            const modifiedXPSuccess = baseXP * wisdomMultiplier;
            lines.push(
                `XP per action: ${formatWithSeparator(baseXP.toFixed(2))} base → ${formatWithSeparator(modifiedXPSuccess.toFixed(2))} (×${wisdomMultiplier.toFixed(3)})`
            );

            // Show success rate impact on XP
            if (profitData.successRate < 1) {
                lines.push(
                    `  Expected XP: ${formatWithSeparator(xpPerAction.toFixed(2))} (${formatPercentage(profitData.successRate, 2)} success, 10% XP on fail)`
                );
            }

            // XP breakdown (if any bonuses exist)
            if (xpData.totalWisdom > 0 || xpData.charmExperience > 0) {
                const totalXPBonus = xpData.totalWisdom + xpData.charmExperience;
                lines.push(`  Total XP Bonus: +${totalXPBonus.toFixed(2)}%`);

                // Equipment skill-specific XP (e.g., alchemy-specific equipment)
                if (xpData.charmBreakdown && xpData.charmBreakdown.length > 0) {
                    for (const item of xpData.charmBreakdown) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(2)}%`);
                    }
                }

                // Equipment wisdom (e.g., Necklace Of Wisdom, Philosopher's Necklace)
                if (xpData.wisdomBreakdown && xpData.wisdomBreakdown.length > 0) {
                    for (const item of xpData.wisdomBreakdown) {
                        const enhText = item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : '';
                        lines.push(`    • ${item.name}${enhText}: +${item.value.toFixed(2)}%`);
                    }
                }

                // House rooms
                if (xpData.breakdown.houseWisdom > 0) {
                    lines.push(`    • House Rooms: +${xpData.breakdown.houseWisdom.toFixed(2)}%`);
                }

                // Community buff
                if (xpData.breakdown.communityWisdom > 0) {
                    lines.push(`    • Community Buff: +${xpData.breakdown.communityWisdom.toFixed(2)}%`);
                }

                // Tea/Coffee
                if (xpData.breakdown.consumableWisdom > 0) {
                    lines.push(`    • Wisdom Tea: +${xpData.breakdown.consumableWisdom.toFixed(2)}%`);
                }

                // Achievement wisdom
                if (xpData.breakdown.achievementWisdom > 0) {
                    lines.push(`    • Achievement: +${xpData.breakdown.achievementWisdom.toFixed(2)}%`);
                }

                // MooPass wisdom
                if (xpData.breakdown.mooPassWisdom > 0) {
                    lines.push(`    • MooPass: +${xpData.breakdown.mooPassWisdom.toFixed(2)}%`);
                }
            }

            lines.push('');

            // To next level
            lines.push(
                `<span style="font-weight: 500; color: var(--text-color-primary, ${config.COLOR_TEXT_PRIMARY});">To Level ${nextLevel}:</span>`
            );
            lines.push(`  Actions: ${formatWithSeparator(actionsNeeded)}`);
            lines.push(`  Time: ${timeReadable(timeNeeded)}`);

            lines.push('');
            lines.push(
                `XP/hour: ${formatWithSeparator(Math.round(xpPerHour))} | XP/day: ${formatWithSeparator(Math.round(xpPerDay))}`
            );

            content.innerHTML = lines.join('<br>');

            // Create summary for collapsed view
            const summary = `${timeReadable(timeNeeded)} to Level ${nextLevel}`;

            return createCollapsibleSection('📈', 'Level Progress', summary, content, false);
        } catch (error) {
            console.error('[AlchemyProfitDisplay] Error creating level progress section:', error);
            return null;
        }
    }

    /**
     * Remove profit display
     */
    removeDisplay() {
        // Remove profitability section
        if (this.displayElement && this.displayElement.parentNode) {
            this.displayElement.remove();
        }
        this.displayElement = null;

        // Remove Action Speed & Time section
        const speedTimeSection = document.getElementById('mwi-alchemy-speed-time');
        if (speedTimeSection && speedTimeSection.parentNode) {
            speedTimeSection.remove();
        }

        // Remove Level Progress section
        const levelProgressSection = document.getElementById('mwi-alchemy-level-progress');
        if (levelProgressSection && levelProgressSection.parentNode) {
            levelProgressSection.remove();
        }

        // Don't clear lastFingerprint here - we need to track state across recreations
    }

    /**
     * Disable the display
     */
    disable() {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }

        if (this.equipmentChangeTimeout) {
            clearTimeout(this.equipmentChangeTimeout);
            this.equipmentChangeTimeout = null;
        }

        if (this.equipmentChangeHandler) {
            dataManager.off('items_updated', this.equipmentChangeHandler);
            this.equipmentChangeHandler = null;
        }

        if (this.contentObserver) {
            this.contentObserver.disconnect();
            this.contentObserver = null;
        }

        if (this.tabObserver) {
            this.tabObserver.disconnect();
            this.tabObserver = null;
        }

        this.timerRegistry.clearAll();

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        this.removeDisplay();
        this.lastFingerprint = null; // Clear fingerprint on disable
        this.isActive = false;
        this.isInitialized = false;
    }
}

const alchemyProfitDisplay = new AlchemyProfitDisplay();

export default alchemyProfitDisplay;
