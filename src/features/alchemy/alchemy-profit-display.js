/**
 * Alchemy Profit Display Module
 * Displays profit calculator in alchemy action detail panel
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import alchemyProfit from './alchemy-profit.js';
import { formatWithSeparator, formatPercentage, formatLargeNumber } from '../../utils/formatters.js';
import { createCollapsibleSection } from '../../utils/ui-components.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class AlchemyProfitDisplay {
    constructor() {
        this.isActive = false;
        this.unregisterObserver = null;
        this.displayElement = null;
        this.updateTimeout = null;
        this.lastFingerprint = null;
        this.pollInterval = null;
        this.isInitialized = false;
        this.timerRegistry = createTimerRegistry();
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
            (_alchemyComponent) => {
                this.checkAndUpdateDisplay();
            }
        );

        // Initial check for existing panel
        this.checkAndUpdateDisplay();

        // Polling interval to check DOM state (like enhancement-ui.js does)
        // This catches state changes that the observer might miss
        this.pollInterval = setInterval(() => {
            this.checkAndUpdateDisplay();
        }, 200); // Check 5× per second for responsive updates
        this.timerRegistry.registerInterval(this.pollInterval);
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
            // Extract action data
            const actionData = await alchemyProfit.extractActionData();
            if (!actionData) {
                this.removeDisplay();
                return;
            }

            // Calculate profit
            const profitData = alchemyProfit.calculateProfit(actionData);
            if (!profitData) {
                this.removeDisplay();
                return;
            }

            // Save expanded/collapsed state before recreating
            const expandedState = this.saveExpandedState();

            // Always recreate display (complex collapsible structure makes refresh difficult)
            this.createDisplay(infoContainer, profitData);

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
     */
    createDisplay(container, profitData) {
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
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
                const dropRatePct = formatPercentage(drop.dropRate, drop.dropRate < 0.01 ? 3 : 2);

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${dropRatePct} × ${formatPercentage(profitData.successRate, 1)} success) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
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
                const decimals = drop.dropsPerHour < 1 ? 2 : 1;
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

                // Show both base and effective drop rate
                if (profitData.rareFindBreakdown && profitData.rareFindBreakdown.total > 0) {
                    const rareFindBonus = formatPercentage(profitData.rareFindBreakdown.total, 1);
                    line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct} base × ${rareFindBonus} rare find = ${effectiveDropRatePct}, × ${formatPercentage(profitData.successRate, 1)} success) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
                } else {
                    line.textContent = `• ${itemName}: ${drop.dropsPerHour.toFixed(decimals)}/hr (${baseDropRatePct} × ${formatPercentage(profitData.successRate, 1)} success) @ ${formatWithSeparator(Math.round(drop.price))} → ${formatLargeNumber(Math.round(drop.revenuePerHour))}/hr`;
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

                // Show decomposition value if enhanced
                if (material.enhancementLevel > 0 && material.decompositionValuePerHour > 0) {
                    const netCostPerHour = material.costPerHour - material.decompositionValuePerHour;
                    line.textContent = `• ${itemName}${enhText}: ${amountPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(material.price))} → ${formatLargeNumber(Math.round(material.costPerHour))}/hr (recovers ${formatLargeNumber(Math.round(material.decompositionValuePerHour))}/hr, net ${formatLargeNumber(Math.round(netCostPerHour))}/hr)`;
                } else {
                    line.textContent = `• ${itemName}${enhText}: ${amountPerHour.toFixed(1)}/hr (consumed on all attempts) @ ${formatWithSeparator(Math.round(material.price))} → ${formatLargeNumber(Math.round(material.costPerHour))}/hr`;
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

            const line = document.createElement('div');
            line.style.marginLeft = '8px';
            line.textContent = `• ${itemName}: ${catalystsPerHour.toFixed(1)}/hr (consumed only on success, ${formatPercentage(profitData.successRate, 1)}) @ ${formatWithSeparator(Math.round(profitData.catalystCost.price))} → ${formatLargeNumber(Math.round(profitData.catalystCost.costPerHour))}/hr`;
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

                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• ${itemName}: ${drink.drinksPerHour.toFixed(1)}/hr @ ${formatWithSeparator(Math.round(drink.price))} → ${formatLargeNumber(Math.round(drink.costPerHour))}/hr`;
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

            if (effBreakdown.level > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Level Bonus: +${effBreakdown.level.toFixed(1)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.house > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• House Bonus: +${effBreakdown.house.toFixed(1)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.tea > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Tea Bonus: +${effBreakdown.tea.toFixed(1)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.equipment > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Equipment Bonus: +${effBreakdown.equipment.toFixed(1)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.community > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Community Buff: +${effBreakdown.community.toFixed(1)}%`;
                effContent.appendChild(line);
            }

            if (effBreakdown.achievement > 0) {
                const line = document.createElement('div');
                line.style.marginLeft = '8px';
                line.textContent = `• Achievement Bonus: +${effBreakdown.achievement.toFixed(1)}%`;
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
                    line.textContent = `• Equipment Bonus: +${rareBreakdown.equipment.toFixed(1)}%`;
                    rareContent.appendChild(line);
                }

                if (rareBreakdown.achievement > 0) {
                    const line = document.createElement('div');
                    line.style.marginLeft = '8px';
                    line.textContent = `• Achievement Bonus: +${rareBreakdown.achievement.toFixed(1)}%`;
                    rareContent.appendChild(line);
                }

                const rareSection = createCollapsibleSection(
                    '',
                    `Rare Find: +${formatPercentage(rareBreakdown.total, 1)}`,
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
                    line.textContent = `• Equipment Bonus: +${essenceBreakdown.equipment.toFixed(1)}%`;
                    essenceContent.appendChild(line);
                }

                const essenceSection = createCollapsibleSection(
                    '',
                    `Essence Find: +${formatPercentage(essenceBreakdown.total, 1)}`,
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
            <div style="margin-bottom: 4px;">Actions: ${profitData.actionsPerHour.toFixed(1)}/hr | Success Rate: ${formatPercentage(profitData.successRate, 1)}</div>
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
        this.displayElement = profitSection;
    }

    /**
     * Remove profit display
     */
    removeDisplay() {
        if (this.displayElement && this.displayElement.parentNode) {
            this.displayElement.remove();
        }
        this.displayElement = null;
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

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
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
