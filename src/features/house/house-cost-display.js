/**
 * House Upgrade Cost Display
 * UI rendering for house upgrade costs
 */

import houseCostCalculator from './house-cost-calculator.js';
import config from '../../core/config.js';
import { coinFormatter } from '../../utils/formatters.js';
import dataManager from '../../core/data-manager.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { createAutofillManager, getReactFiberFromElement } from '../../utils/marketplace-autofill.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import {
    createMaterialTab,
    updateTabBadge,
    removeMaterialTabsForOwner,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
    watchNativeTabExit,
    getVisibleMarketplaceTabContainer,
    clickMarketplaceNavigationButton,
    MARKETPLACE_REMOUNT_GRACE_MS,
    isMarketplaceMarketListingsSelected,
} from '../../utils/marketplace-tabs.js';

function getGameObject() {
    const root = document.getElementById('root');
    const rootFiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    const stack = [rootFiber];
    while (stack.length > 0) {
        const fiber = stack.pop();
        if (
            fiber?.stateNode &&
            (typeof fiber.stateNode.handleGoToMarketplace === 'function' ||
                typeof fiber.stateNode.handleGoToNavTarget === 'function')
        ) {
            return fiber.stateNode;
        }
        if (fiber?.sibling) stack.push(fiber.sibling);
        if (fiber?.child) stack.push(fiber.child);
    }
    return null;
}

class HouseCostDisplay {
    constructor() {
        this.isActive = false;
        this.currentModalContent = null;
        this.isInitialized = false;
        this.currentMaterialsTabs = [];
        this.cleanupObserver = null;
        this.timerRegistry = createTimerRegistry();
        this.autofillManager = createAutofillManager('MissingMats-Houses');
        this._itemsUpdatedHandler = null;
        this._houseRoomsUpdatedHandler = null;
        this._cumulativeState = null;
        this._costContext = null;
        this._houseSessionId = null;
        this._nativeTabExitCleanup = null;
        this._houseReturnGeneration = 0;
        this._cumulativeRenderGeneration = 0;
        this._cumulativeRenderGenerations = new WeakMap();
        this.activeWorkflowModel = null;
    }

    /**
     * Setup settings listeners for feature toggle and color changes
     */
    setupSettingListener() {
        config.onSettingChange('houseUpgradeCosts', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize the display system
     */
    initialize() {
        if (!config.getSetting('houseUpgradeCosts')) {
            return;
        }

        this.isActive = true;
        this.isInitialized = true;

        this._itemsUpdatedHandler = () => this._onInventoryChanged();
        dataManager.on('items_updated', this._itemsUpdatedHandler);

        this._houseRoomsUpdatedHandler = () => this._onHouseRoomUpdated();
        dataManager.on('house_rooms_updated', this._houseRoomsUpdatedHandler);

        this.autofillManager.initialize();
    }

    /**
     * Resolve the room level from the same live House component that renders the modal.
     * The DataManager cache remains a fallback for startup/test states, but must not
     * override newer React props after an upgrade message or panel remount.
     * @param {string} houseRoomHrid
     * @returns {number}
     */
    _getLiveHouseRoomLevel(houseRoomHrid) {
        const houseComponent = this._getHouseComponent(houseRoomHrid);
        const liveLevel = houseComponent?.props?.characterHouseRoomDict?.[houseRoomHrid]?.level;
        if (Number.isInteger(liveLevel) && liveLevel >= 0) return liveLevel;
        return houseCostCalculator.getCurrentRoomLevel(houseRoomHrid);
    }

    /**
     * Augment native costs section with market pricing
     * @param {Element} costsSection - The native HousePanel_costs element
     * @param {string} houseRoomHrid - House room HRID
     * @param {Element} modalContent - The modal content element
     */
    async addCostColumn(costsSection, houseRoomHrid, modalContent) {
        this.removeExistingColumn(modalContent);
        this.currentModalContent = modalContent;

        const currentLevel = this._getLiveHouseRoomLevel(houseRoomHrid);

        if (currentLevel >= 8) {
            return;
        }

        try {
            await this.addCompactToLevel(costsSection, houseRoomHrid, currentLevel);
        } catch {
            // Silently fail - augmentation is optional
        }
    }

    /**
     * Remove existing augmentations
     * @param {Element} modalContent - The modal content element
     */
    removeExistingColumn(modalContent) {
        modalContent
            .querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level')
            .forEach((el) => el.remove());

        const itemRequirementsGrid = modalContent.querySelector('[class*="HousePanel_itemRequirements"]');
        if (itemRequirementsGrid) {
            itemRequirementsGrid.style.gridTemplateColumns = '';
        }
    }

    /**
     * Augment native cost items with market pricing
     * @param {Element} costsSection - Native costs section
     * @param {Object} costData - Cost data from calculator
     */
    async augmentNativeCosts(costsSection, costData) {
        const itemRequirementsGrid = costsSection.querySelector('[class*="HousePanel_itemRequirements"]');
        if (!itemRequirementsGrid) {
            return;
        }

        const currentGridStyle = window.getComputedStyle(itemRequirementsGrid).gridTemplateColumns;
        itemRequirementsGrid.style.gridTemplateColumns = currentGridStyle + ' auto';

        const itemContainers = itemRequirementsGrid.querySelectorAll('[class*="Item_itemContainer"]');
        if (itemContainers.length === 0) {
            return;
        }

        for (const itemContainer of itemContainers) {
            const svg = itemContainer.querySelector('svg');
            if (!svg) continue;

            const useElement = svg.querySelector('use');
            const hrefValue = useElement?.getAttribute('href') || '';
            const itemName = hrefValue.split('#')[1];
            if (!itemName) continue;

            const itemHrid = `/items/${itemName}`;

            let materialData;
            if (itemHrid === '/items/coin') {
                materialData = {
                    itemHrid: '/items/coin',
                    count: costData.coins,
                    marketPrice: 1,
                    totalValue: costData.coins,
                };
            } else {
                materialData = costData.materials.find((m) => m.itemHrid === itemHrid);
            }

            if (!materialData) continue;

            if (materialData.itemHrid === '/items/coin') {
                this.addEmptyCell(itemRequirementsGrid, itemContainer);
                continue;
            }

            this.addPricingCell(itemRequirementsGrid, itemContainer, materialData);
        }
    }

    /**
     * Add empty cell for coins to maintain grid structure
     * @param {Element} grid - The requirements grid
     * @param {Element} itemContainer - The item icon container (badge)
     */
    addEmptyCell(grid, itemContainer) {
        const emptyCell = document.createElement('span');
        emptyCell.className = 'mwi-house-pricing-empty HousePanel_itemRequirementCell__3hSBN';
        itemContainer.after(emptyCell);
    }

    /**
     * Add pricing as a new grid cell to the right of the item
     * @param {Element} grid - The requirements grid
     * @param {Element} itemContainer - The item icon container (badge)
     * @param {Object} materialData - Material data with pricing
     */
    addPricingCell(grid, itemContainer, materialData) {
        const nextSibling = itemContainer.nextElementSibling;
        if (nextSibling?.classList.contains('mwi-house-pricing')) {
            return;
        }

        const inventoryCount = houseCostCalculator.getInventoryCount(materialData.itemHrid);
        const hasEnough = inventoryCount >= materialData.count;
        const amountNeeded = Math.max(0, materialData.count - inventoryCount);

        const pricingCell = document.createElement('span');
        pricingCell.className = 'mwi-house-pricing HousePanel_itemRequirementCell__3hSBN';
        pricingCell.style.cssText = `
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        font-size: 0.75rem;
        color: ${config.COLOR_ACCENT};
        padding-left: 8px;
        white-space: nowrap;
    `;

        pricingCell.innerHTML = `
        <span style="color: ${config.COLOR_TEXT_SECONDARY};">@ ${coinFormatter(materialData.marketPrice)}</span>
        <span style="color: ${config.COLOR_ACCENT}; font-weight: bold;">= ${coinFormatter(materialData.totalValue)}</span>
        <span style="color: ${hasEnough ? '#4ade80' : '#f87171'}; margin-left: auto; text-align: right;">${coinFormatter(amountNeeded)}</span>
    `;

        itemContainer.after(pricingCell);
    }

    /**
     * Add total cost below native costs section
     * @param {Element} costsSection - Native costs section
     * @param {Object} costData - Cost data
     */
    addTotalCost(costsSection, costData) {
        const totalDiv = document.createElement('div');
        totalDiv.className = 'mwi-house-total';
        totalDiv.style.cssText = `
        margin-top: 12px;
        padding-top: 12px;
        border-top: 2px solid ${config.COLOR_ACCENT};
        font-weight: bold;
        font-size: 1rem;
        color: ${config.COLOR_ACCENT};
        text-align: center;
    `;
        totalDiv.textContent = `Total Market Value: ${coinFormatter(costData.totalValue)}`;
        costsSection.appendChild(totalDiv);
    }

    /**
     * Add compact "To Level" section
     * @param {Element} costsSection - Native costs section
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current level
     */
    async addCompactToLevel(costsSection, houseRoomHrid, currentLevel) {
        const section = document.createElement('div');
        section.className = 'mwi-house-to-level';
        section.style.cssText = `
        margin-top: 8px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        border: 1px solid ${config.COLOR_BORDER};
        min-height: 0;
        overflow-y: auto;
    `;

        const headerRow = document.createElement('div');
        headerRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 8px;
    `;

        const label = document.createElement('span');
        label.style.cssText = `
        color: ${config.COLOR_ACCENT};
        font-weight: bold;
        font-size: 0.875rem;
    `;
        label.textContent = 'Cumulative to Level:';

        const dropdown = document.createElement('select');
        dropdown.style.cssText = `
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid ${config.COLOR_BORDER};
        color: ${config.SCRIPT_COLOR_MAIN};
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
    `;

        for (let level = currentLevel + 1; level <= 8; level++) {
            const option = document.createElement('option');
            option.value = level;
            option.textContent = level;
            dropdown.appendChild(option);
        }

        const defaultLevel = currentLevel + 1;
        dropdown.value = defaultLevel;

        headerRow.appendChild(label);
        headerRow.appendChild(dropdown);
        section.appendChild(headerRow);

        const costContainer = document.createElement('div');
        costContainer.className = 'mwi-cumulative-cost-container';
        costContainer.style.cssText = `
        font-size: 0.875rem;
        margin-top: 8px;
        text-align: left;
    `;
        section.appendChild(costContainer);

        await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));

        this._cumulativeState = { costContainer, houseRoomHrid, currentLevel, dropdown };
        this._costContext = { houseRoomHrid, currentLevel, targetLevel: parseInt(dropdown.value) };

        dropdown.addEventListener('change', async () => {
            this._costContext = { houseRoomHrid, currentLevel, targetLevel: parseInt(dropdown.value) };
            await this.updateCompactCumulativeDisplay(
                costContainer,
                houseRoomHrid,
                currentLevel,
                parseInt(dropdown.value)
            );
        });

        costsSection.parentElement.appendChild(section);
    }

    /**
     * Update compact cumulative display
     * @param {Element} container - Container element
     * @param {string} houseRoomHrid - House room HRID
     * @param {number} currentLevel - Current level
     * @param {number} targetLevel - Target level
     */
    async updateCompactCumulativeDisplay(container, houseRoomHrid, currentLevel, targetLevel) {
        const renderGeneration = ++this._cumulativeRenderGeneration;
        this._cumulativeRenderGenerations.set(container, renderGeneration);
        container.replaceChildren();

        const costData = await houseCostCalculator.calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel);

        if (this._cumulativeRenderGenerations.get(container) !== renderGeneration) {
            return;
        }

        const materialsList = document.createElement('div');
        materialsList.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
    `;

        if (costData.coins > 0) {
            this.appendMaterialRow(materialsList, {
                itemHrid: '/items/coin',
                count: costData.coins,
                totalValue: costData.coins,
            });
        }

        for (const material of costData.materials) {
            this.appendMaterialRow(materialsList, material);
        }

        const renderNodes = [materialsList];

        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = `
        margin-top: 12px;
        padding-top: 12px;
        border-top: 2px solid ${config.COLOR_ACCENT};
        font-weight: bold;
        font-size: 1rem;
        color: ${config.COLOR_ACCENT};
        text-align: center;
    `;
        totalDiv.textContent = `Total Market Value: ${coinFormatter(costData.totalValue)}`;
        renderNodes.push(totalDiv);

        const missingMaterials = this.getMissingMaterials(costData);
        if (missingMaterials.length > 0) {
            renderNodes.push(this.createMissingMaterialsButton(missingMaterials));
        }

        // Commit the completed render atomically. Concurrent refreshes may overlap while
        // market prices are awaited, but only the latest request for this container may
        // replace its contents. This prevents duplicate material/total/button blocks and
        // prevents an older calculation from overwriting a newer one.
        container.replaceChildren(...renderNodes);
    }

    /**
     * Append material row as single-line compact format
     * @param {Element} container - The container element
     * @param {Object} material - Material data
     */
    appendMaterialRow(container, material) {
        const itemName = houseCostCalculator.getItemName(material.itemHrid);
        const inventoryCount = houseCostCalculator.getInventoryCount(material.itemHrid);
        const hasEnough = inventoryCount >= material.count;
        const amountNeeded = Math.max(0, material.count - inventoryCount);
        const isCoin = material.itemHrid === '/items/coin';

        const row = document.createElement('div');
        row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.875rem;
        line-height: 1.4;
    `;

        const inventorySpan = document.createElement('span');
        inventorySpan.style.cssText = `
        color: ${hasEnough ? 'white' : '#f87171'};
        min-width: 120px;
        text-align: right;
    `;
        inventorySpan.textContent = `${coinFormatter(inventoryCount)} / ${coinFormatter(material.count)}`;
        row.appendChild(inventorySpan);

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `
        color: white;
        min-width: 140px;
    `;
        nameSpan.textContent = itemName;
        row.appendChild(nameSpan);

        if (!isCoin) {
            const pricingSpan = document.createElement('span');
            pricingSpan.style.cssText = `
            color: ${config.COLOR_ACCENT};
            min-width: 180px;
        `;
            pricingSpan.textContent = `@ ${coinFormatter(material.marketPrice)} = ${coinFormatter(material.totalValue)}`;
            row.appendChild(pricingSpan);
        } else {
            const spacer = document.createElement('span');
            spacer.style.minWidth = '180px';
            row.appendChild(spacer);
        }

        const missingSpan = document.createElement('span');
        missingSpan.style.cssText = `
        color: ${hasEnough ? '#4ade80' : '#f87171'};
        margin-left: auto;
        text-align: right;
    `;
        missingSpan.textContent = `Missing: ${coinFormatter(amountNeeded)}`;
        row.appendChild(missingSpan);

        container.appendChild(row);
    }

    /**
     * Get missing materials from cost data
     * @param {Object} costData - Cost data from calculator
     * @returns {Array} Array of missing materials in marketplace format
     */
    getMissingMaterials(costData) {
        const gameData = dataManager.getInitClientData();
        const inventory = dataManager.getInventory();
        const missing = [];

        for (const material of costData.materials) {
            const have = inventory
                .filter(
                    (item) =>
                        item.itemHrid === material.itemHrid &&
                        item.itemLocationHrid === '/item_locations/inventory' &&
                        (!item.enhancementLevel || item.enhancementLevel === 0)
                )
                .reduce((total, item) => total + (item.count || 0), 0);
            const missingAmount = Math.max(0, material.count - have);

            if (missingAmount > 0) {
                const itemDetails = gameData.itemDetailMap[material.itemHrid];
                if (itemDetails) {
                    missing.push({
                        itemHrid: material.itemHrid,
                        itemName: itemDetails.name,
                        required: material.count,
                        missing: missingAmount,
                        isTradeable: itemDetails.isTradable === true,
                    });
                }
            }
        }

        return missing;
    }

    /**
     * Create missing materials marketplace button
     * @param {Array} missingMaterials - Array of missing material objects
     * @returns {HTMLElement} Button element
     */
    createMissingMaterialsButton(missingMaterials) {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = `
        width: 100%;
        padding: 10px 16px;
        margin-top: 12px;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    `;
        button.textContent = 'Missing Mats Marketplace';

        button.addEventListener('mouseenter', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
            button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background =
                'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
            button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
            button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        button.addEventListener('click', async () => {
            try {
                await this.handleMissingMaterialsClick(missingMaterials);
            } catch (error) {
                console.error('[HouseCostDisplay] Missing Materials workflow failed:', error);
                const sessionId = this._houseSessionId ?? this.activeWorkflowModel?.sessionId ?? null;
                if (sessionId !== null && marketplaceSession.isActive(sessionId)) {
                    this.exitHouseMarketplaceSession(sessionId);
                }
            }
        });

        return button;
    }

    // =========================================================================
    // Session lifecycle
    // =========================================================================

    /**
     * End the captured Core House session.
     * The session's onEnd callback performs idempotent local teardown.
     * @param {number|null} capturedSessionId
     * @returns {boolean}
     */
    exitHouseMarketplaceSession(capturedSessionId) {
        if (capturedSessionId == null) return false;
        return marketplaceSession.end(capturedSessionId);
    }

    /**
     * Idempotent local teardown — called by the Core session's onEnd callback.
     * Must NOT call marketplaceSession.end (this IS the onEnd handler).
     * Increments _houseReturnGeneration so any in-flight Return async work stops.
     */
    teardownHouseMarketplaceSession() {
        this._houseReturnGeneration++;

        // Capture before nulling so autofill can disarm the exact old target
        const sessionIdToDisarm = this._houseSessionId ?? this.activeWorkflowModel?.sessionId ?? null;

        this._houseSessionId = null;

        if (this._nativeTabExitCleanup) {
            this._nativeTabExitCleanup();
            this._nativeTabExitCleanup = null;
        }

        removeMaterialTabsForOwner(MARKETPLACE_OWNER.HOUSE);
        this.currentMaterialsTabs.length = 0;

        if (this.cleanupObserver) {
            this.cleanupObserver();
            this.cleanupObserver = null;
        }

        this.activeWorkflowModel = null;
        this.autofillManager.exitSession(sessionIdToDisarm);
        // NOTE: Do NOT unregister _itemsUpdatedHandler — it is feature-level, not session-level.
    }

    // =========================================================================
    // Activation
    // =========================================================================

    /**
     * Handle missing materials button click.
     * Closes the House room modal, navigates to Marketplace, and installs material tabs.
     * @param {Array} missingMaterials
     */
    async handleMissingMaterialsClick(missingMaterials) {
        // 1. Validate and snapshot _costContext — fail closed if room context is absent
        const costCtx = this._costContext;
        const houseRoomHrid = costCtx?.houseRoomHrid ?? null;
        if (!houseRoomHrid) {
            console.error('[HouseCostDisplay] No active room context — cannot start marketplace session');
            return;
        }
        const { currentLevel, targetLevel } = costCtx;
        const gameBeforeMarketplace = getGameObject();
        const previousNavTarget = gameBeforeMarketplace?.state?.navTarget ?? null;

        // 2. Start the Core House session before the first await
        const sessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.HOUSE,
            onEnd: () => this.teardownHouseMarketplaceSession(),
        });
        this._houseSessionId = sessionId;

        // 3. Store model and immutable returnContext immediately, before any await
        this.activeWorkflowModel = {
            sessionId,
            materials: missingMaterials.map((m) => ({ ...m })),
            returnContext: Object.freeze({
                houseRoomHrid,
                currentLevel,
                targetLevel,
                previousNavTarget,
                sessionId,
            }),
        };

        // 4. Prefer the exact visible native close control. Keep a bounded React
        // fallback for retained/test DOMs where that button is unavailable.
        const modalContent = this.currentModalContent;
        const modalContainer = modalContent?.closest('[class*="Modal_modalContainer"]');
        const closeButton = modalContainer?.querySelector('[class*="Modal_closeButton"]');
        let houseComponent = null;
        let modalClosedPredicate = null;

        if (modalContent?.isConnected && modalContainer && closeButton) {
            closeButton.click();
            modalClosedPredicate = () => !modalContent.isConnected || !this._isElementActuallyVisible(modalContainer);
        } else {
            houseComponent = this._getHouseComponent(houseRoomHrid);
            if (!houseComponent) {
                console.error('[HouseCostDisplay] Could not resolve the active House modal close control');
                this.exitHouseMarketplaceSession(sessionId);
                return;
            }
            houseComponent.handleCloseModal();
            modalClosedPredicate = () => houseComponent.state?.selectedHouseRoomHrid !== houseRoomHrid;
        }

        // 5. Bounded wait for the captured modal to detach, hide, or release the room.
        const houseModalClosed = await this._pollUntil(modalClosedPredicate, 1500, 50);

        if (!marketplaceSession.isActive(sessionId) || this._houseSessionId !== sessionId) return;

        if (!houseModalClosed) {
            console.error('[HouseCostDisplay] House room modal did not close within timeout');
            this.exitHouseMarketplaceSession(sessionId);
            return;
        }

        // 7. Navigate to Marketplace
        const navSuccess = await this.navigateToMarketplace(sessionId);

        if (!marketplaceSession.isActive(sessionId) || this._houseSessionId !== sessionId) return;

        if (!navSuccess) {
            console.error('[HouseCostDisplay] Failed to navigate to marketplace — restoring room');
            await this._restoreHouseRoom(houseRoomHrid, targetLevel, sessionId, houseComponent);
            this.exitHouseMarketplaceSession(sessionId);
            return;
        }

        // Brief settle wait for Marketplace tabs to stabilise
        await new Promise((resolve) => {
            const t = setTimeout(resolve, 200);
            this.timerRegistry.registerTimeout(t);
        });

        if (!marketplaceSession.isActive(sessionId) || this._houseSessionId !== sessionId) return;

        // 8. Arm the autofill session
        this.autofillManager.startSession({ sessionId });

        // 9. Install material tabs in the current visible Marketplace tablist.
        if (!this.createMissingMaterialTabs(missingMaterials)) {
            console.error('[HouseCostDisplay] Could not install Marketplace material tabs');
            this.exitHouseMarketplaceSession(sessionId);
            return;
        }

        // 10. Arm and navigate to the first tradeable missing material automatically.
        const firstMaterial = missingMaterials.find((m) => m.isTradeable !== false && (m.missing ?? 0) > 0);
        if (firstMaterial) {
            const capturedItemHrid = firstMaterial.itemHrid;
            const armed = this.autofillManager.arm({
                sessionId,
                itemHrid: firstMaterial.itemHrid,
                enhancementLevel: firstMaterial.enhancementLevel ?? 0,
                modalMode: 'buy',
                quantityProvider: () => {
                    const model = this.activeWorkflowModel;
                    if (model?.sessionId !== sessionId) return 0;
                    const entry = model.materials.find((e) => e.itemHrid === capturedItemHrid);
                    return entry?.missing ?? 0;
                },
            });
            if (!armed || !navigateToMarketplace(firstMaterial.itemHrid, firstMaterial.enhancementLevel ?? 0)) {
                this.exitHouseMarketplaceSession(sessionId);
                return;
            }
        } else {
            this.exitHouseMarketplaceSession(sessionId);
            return;
        }

        // 11. Per-session cleanup observer — ends the captured Core token on overlay close
        this.cleanupObserver = setupMarketplaceCleanupObserver({
            owner: MARKETPLACE_OWNER.HOUSE,
            invalidStateGraceMs: MARKETPLACE_REMOUNT_GRACE_MS,
            onTabsGone: () => {
                if (!marketplaceSession.isActive(sessionId)) return;
                const tabContainer = this._getVisibleMarketplaceTabContainer();
                if (
                    tabContainer &&
                    isMarketplaceMarketListingsSelected(tabContainer) &&
                    this._reinjectHouseMarketplaceTabs(tabContainer, sessionId)
                ) {
                    return;
                }
                this.exitHouseMarketplaceSession(sessionId);
            },
        });
    }

    _openHouseRoomByHrid(houseRoomHrid) {
        const roomName = houseCostCalculator.getRoomName(houseRoomHrid);
        const visiblePanels = Array.from(document.querySelectorAll('[class*="HousePanel_housePanel"]')).filter((el) =>
            this._isElementActuallyVisible(el)
        );
        if (visiblePanels.length !== 1) return false;

        const tiles = Array.from(visiblePanels[0].querySelectorAll('[class*="HousePanel_houseRoom"]'));
        const roomSlug = houseRoomHrid.split('/').pop();
        const tile = tiles.find((candidate) => {
            const name = candidate.querySelector('[class*="HousePanel_name"]')?.textContent?.trim();
            const iconHref = candidate.querySelector('use[href*="house_"]')?.getAttribute('href') || '';
            return name === roomName || iconHref.endsWith(`#house_${roomSlug}`);
        });
        if (!tile) return false;
        tile.click();
        return true;
    }

    /**
     * Restore the House room and target level after navigation failure.
     * Does not end the session — the caller does that after this returns.
     * @private
     */
    async _restoreHouseRoom(houseRoomHrid, targetLevel, sessionId, houseComponent = null) {
        if (!this._openHouseRoomByHrid(houseRoomHrid)) {
            const fallbackHouse = houseComponent || this._getHouseComponent();
            if (!fallbackHouse || typeof fallbackHouse.handleHouseRoomClicked !== 'function') return;
            fallbackHouse.handleHouseRoomClicked(houseRoomHrid);
        }

        const ready = await this._pollUntil(
            () => {
                if (this._houseSessionId !== sessionId) return true;
                const state = this._cumulativeState;
                return (
                    state?.houseRoomHrid === houseRoomHrid &&
                    state.costContainer?.isConnected &&
                    state.dropdown?.isConnected
                );
            },
            2500,
            50
        );

        if (!ready || this._houseSessionId !== sessionId || !marketplaceSession.isActive(sessionId)) return;
        const state = this._cumulativeState;
        if (!state?.costContainer?.isConnected || !state?.dropdown?.isConnected) return;

        const levelStr = String(targetLevel);
        if (Array.from(state.dropdown.options).some((option) => option.value === levelStr)) {
            state.dropdown.value = levelStr;
            state.dropdown.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Navigate to Marketplace by clicking the nav button, then polling for the panel.
     * @returns {Promise<boolean>}
     */
    async navigateToMarketplace(sessionId) {
        if (!marketplaceSession.isActive(sessionId) || !clickMarketplaceNavigationButton()) {
            console.error('[HouseCostDisplay] Marketplace navbar button not found');
            return false;
        }
        return await this.waitForMarketplace(sessionId);
    }

    /**
     * Poll until the Marketplace panel with "Market Listings" tab appears.
     * @returns {Promise<boolean>}
     */
    async waitForMarketplace(sessionId) {
        const maxAttempts = 50;
        const delayMs = 100;

        for (let i = 0; i < maxAttempts; i++) {
            if (!marketplaceSession.isActive(sessionId) || this._houseSessionId !== sessionId) return false;
            const tabsContainer = this._getVisibleMarketplaceTabContainer();
            if (tabsContainer) {
                const hasMarketListings = Array.from(tabsContainer.children).some((btn) =>
                    btn.textContent.includes('Market Listings')
                );
                if (hasMarketListings) {
                    return true;
                }
            }

            await new Promise((resolve) => {
                const delayTimeout = setTimeout(resolve, delayMs);
                this.timerRegistry.registerTimeout(delayTimeout);
            });
        }

        console.error('[HouseCostDisplay] Marketplace did not open within timeout');
        return false;
    }

    // =========================================================================
    // Tab management
    // =========================================================================

    /**
     * Create custom material tabs (and Return tab) in the Marketplace tab bar.
     * @param {Array} missingMaterials
     */
    createMissingMaterialTabs(
        missingMaterials,
        tabsContainer = this._getVisibleMarketplaceTabContainer(),
        capturedSessionId = this._houseSessionId
    ) {
        if (!marketplaceSession.isActive(capturedSessionId)) {
            return false;
        }

        if (!tabsContainer) {
            console.error('[HouseCostDisplay] Visible Marketplace tabs container not found');
            return false;
        }

        removeMaterialTabsForOwner(MARKETPLACE_OWNER.HOUSE);

        const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));
        if (!referenceTab) {
            console.error('[HouseCostDisplay] Reference tab not found');
            return false;
        }

        tabsContainer.style.flexWrap = 'wrap';

        this._nativeTabExitCleanup?.();
        this._nativeTabExitCleanup = watchNativeTabExit(tabsContainer, () => {
            this.exitHouseMarketplaceSession(capturedSessionId);
        });

        this.currentMaterialsTabs.length = 0;
        for (const material of missingMaterials) {
            const capturedItemHrid = material.itemHrid;
            const tab = createMaterialTab(
                material,
                referenceTab,
                (_e, mat) => {
                    if (!marketplaceSession.isActive(capturedSessionId)) return;
                    const armed = this.autofillManager.arm({
                        sessionId: capturedSessionId,
                        itemHrid: mat.itemHrid,
                        enhancementLevel: material.enhancementLevel ?? 0,
                        modalMode: 'buy',
                        quantityProvider: () => {
                            const model = this.activeWorkflowModel;
                            if (model?.sessionId !== capturedSessionId) return 0;
                            const entry = model.materials.find((e) => e.itemHrid === capturedItemHrid);
                            return entry?.missing ?? 0;
                        },
                    });
                    if (!armed || !navigateToMarketplace(mat.itemHrid, material.enhancementLevel ?? 0)) {
                        this.exitHouseMarketplaceSession(capturedSessionId);
                    }
                },
                MARKETPLACE_OWNER.HOUSE
            );
            tab.setAttribute('data-item-name', material.itemName);
            tabsContainer.appendChild(tab);
            this.currentMaterialsTabs.push(tab);
        }

        if (this.activeWorkflowModel?.returnContext) {
            const returnTab = this._createHouseReturnTab(referenceTab, this.activeWorkflowModel.returnContext);
            tabsContainer.appendChild(returnTab);
            this.currentMaterialsTabs.push(returnTab);
        }

        return true;
    }

    /**
     * Reinject House material tabs after a remount (e.g. page navigation within Marketplace).
     * @param {Element} tabContainer
     * @param {number} capturedSessionId - Guards against stale reinject calls
     */
    _reinjectHouseMarketplaceTabs(tabContainer, capturedSessionId) {
        const model = this.activeWorkflowModel;
        if (!model || model.sessionId !== capturedSessionId || !marketplaceSession.isActive(capturedSessionId)) {
            return false;
        }
        return this.createMissingMaterialTabs(model.materials, tabContainer, capturedSessionId);
    }

    /**
     * Create a dedicated Return tab node (not a material tab) by cloning the reference tab.
     * Carries data-mwi-house-return so _updateMarketplaceTabs skips it.
     * @param {Element} referenceTab
     * @param {Object} returnContext - Immutable snapshot
     * @returns {Element}
     */
    _createHouseReturnTab(referenceTab, returnContext) {
        const tab = referenceTab.cloneNode(true);
        tab.setAttribute('data-mwi-custom-tab', 'true');
        tab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.HOUSE);
        tab.setAttribute('data-mwi-house-return', 'true');
        tab.removeAttribute('data-item-hrid');
        tab.removeAttribute('data-missing-quantity');
        tab.removeAttribute('id');
        tab.removeAttribute('aria-controls');
        tab.classList.remove('Mui-selected');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
        const badgeSpan = tab.querySelector('[class*="TabsComponent_badge"]');
        if (badgeSpan) {
            const roomName = houseCostCalculator.getRoomName(returnContext.houseRoomHrid) || 'House';
            badgeSpan.innerHTML =
                `<div style="text-align:center;"><div>↩ Return</div>` +
                `<div style="font-size:0.75em;color:#60a5fa;">${roomName}</div></div>`;
        } else {
            tab.textContent = '↩ Return to House';
        }
        tab.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await this._handleHouseReturn(returnContext);
            } catch (error) {
                console.error('[HouseCostDisplay] Return workflow failed:', error);
                this.exitHouseMarketplaceSession(returnContext.sessionId);
            }
        });
        return tab;
    }

    // =========================================================================
    // Component resolvers
    // =========================================================================

    /**
     * Return true only when an element and every element ancestor are actually visible.
     * Connected-but-hidden stale React panels must not participate in runtime resolution.
     * @param {Element|null} element
     * @returns {boolean}
     */
    _isElementActuallyVisible(element) {
        if (!element?.isConnected) return false;

        let current = element;
        while (current) {
            if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
            const style = getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
                return false;
            }
            current = current.parentElement;
        }

        return true;
    }

    /**
     * Get all currently visible Marketplace panels.
     * @returns {Element[]}
     */
    _getVisibleMarketplacePanels() {
        return Array.from(document.querySelectorAll('[class*="MarketplacePanel_marketplacePanel"]')).filter((panel) =>
            this._isElementActuallyVisible(panel)
        );
    }

    _getVisibleMarketplaceTabContainer() {
        return getVisibleMarketplaceTabContainer();
    }

    /**
     * Find the single visible Marketplace component via fiber ancestry.
     * Requires exactly one connected panel and exactly one matching fiber ancestor.
     * Returns null on zero or multiple candidates (fail-closed).
     * @returns {Object|null}
     */
    _getMarketplaceComponent() {
        const panels = this._getVisibleMarketplacePanels();

        if (panels.length !== 1) return null;

        const candidates = [];
        let fiber = getReactFiberFromElement(panels[0]);
        if (!fiber) return null;
        let depth = 0;
        const seen = new Set();
        while (fiber && depth < 64) {
            const node = fiber.stateNode;
            if (typeof node?.handleCloseMarketplaceModal === 'function' && !seen.has(node)) {
                seen.add(node);
                candidates.push(node);
            }
            fiber = fiber.return;
            depth++;
        }

        return candidates.length === 1 ? candidates[0] : null;
    }

    /**
     * Find the single House component in the fiber tree using the full behavioral signature.
     * Anchors from visible [class*="HousePanel_"] elements and walks .return ancestry (≤64 depth).
     * Optionally filters to a component whose state.selectedHouseRoomHrid matches capturedRoomHrid.
     * Requires exactly one candidate (fail-closed on zero or multiple).
     * @param {string|null} capturedRoomHrid - If non-null, additionally require state match
     * @returns {Object|null}
     */
    _getHouseComponent(capturedRoomHrid = null) {
        const anchors = [];

        if (this.currentModalContent?.isConnected && this._isElementActuallyVisible(this.currentModalContent)) {
            anchors.push(this.currentModalContent);
        }

        const modalHousePanel = this.currentModalContent?.closest('[class*="HousePanel_"]');
        if (modalHousePanel && this._isElementActuallyVisible(modalHousePanel) && !anchors.includes(modalHousePanel)) {
            anchors.push(modalHousePanel);
        }

        if (anchors.length === 0) {
            const visibleHouseRoots = Array.from(document.querySelectorAll('[class*="HousePanel_"]')).filter((el) =>
                this._isElementActuallyVisible(el)
            );
            if (visibleHouseRoots.length === 0) return null;
            anchors.push(...visibleHouseRoots);
        }

        const seen = new Set();
        const candidates = [];

        for (const anchor of anchors) {
            let fiber = getReactFiberFromElement(anchor);
            if (!fiber) continue;
            let depth = 0;
            while (fiber && depth < 64) {
                const node = fiber.stateNode;
                if (
                    node &&
                    !seen.has(node) &&
                    typeof node.handleHouseRoomClicked === 'function' &&
                    typeof node.handleCloseModal === 'function' &&
                    node.state &&
                    Object.prototype.hasOwnProperty.call(node.state, 'selectedHouseRoomHrid')
                ) {
                    seen.add(node);
                    if (capturedRoomHrid === null || node.state.selectedHouseRoomHrid === capturedRoomHrid) {
                        candidates.push(node);
                    }
                }
                fiber = fiber.return;
                depth++;
            }
        }

        return candidates.length === 1 ? candidates[0] : null;
    }

    // =========================================================================
    // House Return flow
    // =========================================================================

    /**
     * Handle Return tab click: close Marketplace, reopen the saved House room,
     * restore the target level, then end the captured Core session.
     * Session is kept alive until successful restoration.
     * @param {Object} returnContext - Immutable snapshot: { houseRoomHrid, currentLevel, targetLevel, sessionId }
     */
    async _handleHouseReturn(returnContext) {
        const { houseRoomHrid, targetLevel, previousNavTarget, sessionId: capturedSessionId } = returnContext;

        // Guard before incrementing generation: a stale detached Return node must not
        // cancel a valid Return already in progress for the current session.
        if (capturedSessionId !== this._houseSessionId || !marketplaceSession.isActive(capturedSessionId)) return;

        // Bump Return generation — any older valid concurrent Return stops after its next await.
        const generation = ++this._houseReturnGeneration;

        // Cancel cleanup observer and native-tab listener before closing Marketplace
        // to prevent premature session end when the Marketplace tabs disappear
        if (this.cleanupObserver) {
            this.cleanupObserver();
            this.cleanupObserver = null;
        }
        if (this._nativeTabExitCleanup) {
            this._nativeTabExitCleanup();
            this._nativeTabExitCleanup = null;
        }

        // Marketplace is normally opened as the main nav target. Restore that exact
        // target when available; retained modal-based clients use the native close handler.
        const game = getGameObject();
        let fallbackHouseComponent = null;
        if (game && typeof game.handleChangeNavTarget === 'function' && previousNavTarget != null) {
            game.handleChangeNavTarget(previousNavTarget);
        } else {
            const marketplaceComponent = this._getMarketplaceComponent();
            if (!marketplaceComponent) {
                console.error('[HouseCostDisplay] Return: missing Marketplace navigation owner');
                this.exitHouseMarketplaceSession(capturedSessionId);
                return;
            }
            marketplaceComponent.handleCloseMarketplaceModal();
            fallbackHouseComponent = this._getHouseComponent();
        }

        // Bounded wait: no actually visible Marketplace panel remains.
        const marketplaceClosed = await this._pollUntil(
            () => this._getVisibleMarketplacePanels().length === 0,
            2000,
            50
        );

        // After await: verify this Return has not been superseded
        if (this._houseReturnGeneration !== generation) return;
        if (capturedSessionId !== this._houseSessionId || !marketplaceSession.isActive(capturedSessionId)) return;

        if (!marketplaceClosed) {
            console.error('[HouseCostDisplay] Return: Marketplace did not close within timeout');
            this.exitHouseMarketplaceSession(capturedSessionId);
            return;
        }

        // Restore through the freshly mounted visible House React owner. Restoring a
        // previous main-nav target can remount the House panel (notably while combat is
        // active), so a stale pre-Marketplace tile/component must never receive the click.
        fallbackHouseComponent = this._getHouseComponent();
        if (!fallbackHouseComponent) {
            await this._pollUntil(
                () => {
                    fallbackHouseComponent = this._getHouseComponent();
                    return Boolean(fallbackHouseComponent);
                },
                2000,
                50
            );
        }

        if (this._houseReturnGeneration !== generation) return;
        if (capturedSessionId !== this._houseSessionId || !marketplaceSession.isActive(capturedSessionId)) return;

        if (fallbackHouseComponent && typeof fallbackHouseComponent.handleHouseRoomClicked === 'function') {
            fallbackHouseComponent.handleHouseRoomClicked(houseRoomHrid);
        } else if (!this._openHouseRoomByHrid(houseRoomHrid)) {
            console.error('[HouseCostDisplay] Return: could not open the saved House room');
            this.exitHouseMarketplaceSession(capturedSessionId);
            return;
        }

        // Bounded wait: freshly connected exact-room Toolasha target control
        const roomReady = await this._pollUntil(
            () => {
                if (this._houseReturnGeneration !== generation) return true; // superseded — exit loop
                const s = this._cumulativeState;
                const fallbackOwnsRoom =
                    !fallbackHouseComponent || fallbackHouseComponent.state?.selectedHouseRoomHrid === houseRoomHrid;
                return (
                    fallbackOwnsRoom &&
                    s?.houseRoomHrid === houseRoomHrid &&
                    s.costContainer?.isConnected &&
                    s.dropdown?.isConnected
                );
            },
            3000,
            50
        );

        // After await: verify generation and session
        if (this._houseReturnGeneration !== generation) return;
        if (capturedSessionId !== this._houseSessionId || !marketplaceSession.isActive(capturedSessionId)) return;

        if (!roomReady) {
            console.warn('[HouseCostDisplay] Return: room did not become ready within timeout');
            this.exitHouseMarketplaceSession(capturedSessionId);
            return;
        }

        // Final connected-state validation
        const s = this._cumulativeState;
        if (!s?.dropdown?.isConnected || !s?.costContainer?.isConnected) {
            this.exitHouseMarketplaceSession(capturedSessionId);
            return;
        }

        // Require target option to exist before writing
        const levelStr = String(targetLevel);
        if (!Array.from(s.dropdown.options).some((o) => o.value === levelStr)) {
            this.exitHouseMarketplaceSession(capturedSessionId);
            return;
        }

        // Restore target level
        s.dropdown.value = levelStr;
        s.dropdown.dispatchEvent(new Event('change', { bubbles: true }));

        // End only the captured Core session — onEnd handles local teardown
        this.exitHouseMarketplaceSession(capturedSessionId);
    }

    // =========================================================================
    // Bounded polling
    // =========================================================================

    /**
     * Poll conditionFn every stepMs up to maxMs, returning true as soon as it passes.
     * Returns the final result of conditionFn if maxMs is exhausted without passing.
     * @param {Function} conditionFn
     * @param {number} maxMs
     * @param {number} stepMs
     * @returns {Promise<boolean>}
     */
    async _pollUntil(conditionFn, maxMs = 2000, stepMs = 50) {
        let elapsed = 0;
        while (elapsed < maxMs) {
            if (conditionFn()) return true;
            await new Promise((resolve) => {
                const t = setTimeout(resolve, stepMs);
                this.timerRegistry.registerTimeout(t);
            });
            elapsed += stepMs;
        }
        return conditionFn();
    }

    // =========================================================================
    // Cleanup / legacy path
    // =========================================================================

    /**
     * Handle marketplace cleanup (called when leaving Marketplace outside normal Return).
     */
    handleMarketplaceCleanup() {
        const capturedSessionId = this.activeWorkflowModel?.sessionId ?? this._houseSessionId ?? null;
        removeMaterialTabsForOwner(MARKETPLACE_OWNER.HOUSE);
        this.currentMaterialsTabs.length = 0;
        this.activeWorkflowModel = null;
        this.exitHouseMarketplaceSession(capturedSessionId);
    }

    // =========================================================================
    // Inventory / house-room updates
    // =========================================================================

    /**
     * Refresh colors on existing displays
     */
    refresh() {
        document.querySelectorAll('.mwi-house-pricing').forEach((cell) => {
            cell.style.color = config.COLOR_ACCENT;
            const boldSpan = cell.querySelector('span[style*="font-weight: bold"]');
            if (boldSpan) {
                boldSpan.style.color = config.COLOR_ACCENT;
            }
        });

        document.querySelectorAll('.mwi-house-total').forEach((total) => {
            total.style.borderTopColor = config.COLOR_ACCENT;
            total.style.color = config.COLOR_ACCENT;
        });

        document.querySelectorAll('.mwi-house-to-level span[style*="font-weight: bold"]').forEach((label) => {
            label.style.color = config.COLOR_ACCENT;
        });

        document.querySelectorAll('.mwi-cumulative-cost-container span[style*="font-weight: bold"]').forEach((span) => {
            span.style.color = config.COLOR_ACCENT;
        });
    }

    /**
     * Handle inventory changes — refresh the cumulative display if visible
     */
    async _onInventoryChanged() {
        this._updateMarketplaceTabs();

        if (!this._cumulativeState) return;
        const { costContainer, houseRoomHrid, currentLevel, dropdown } = this._cumulativeState;
        if (!costContainer.isConnected) {
            this._cumulativeState = null;
            return;
        }
        await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));
    }

    /**
     * Handle house room level changes — refresh the dropdown and cumulative display
     */
    async _onHouseRoomUpdated() {
        if (!this._cumulativeState) return;
        const { costContainer, houseRoomHrid, dropdown } = this._cumulativeState;
        if (!costContainer.isConnected) {
            this._cumulativeState = null;
            return;
        }

        const newLevel = this._getLiveHouseRoomLevel(houseRoomHrid);
        if (newLevel >= 8) {
            this._cumulativeRenderGenerations.set(costContainer, ++this._cumulativeRenderGeneration);
            costContainer.innerHTML = '';
            this._cumulativeState = null;
            this._costContext = null;
            return;
        }

        while (dropdown.options.length > 0 && parseInt(dropdown.options[0].value) <= newLevel) {
            dropdown.remove(0);
        }

        if (dropdown.options.length === 0) {
            this._cumulativeRenderGenerations.set(costContainer, ++this._cumulativeRenderGeneration);
            costContainer.innerHTML = '';
            this._cumulativeState = null;
            this._costContext = null;
            return;
        }

        dropdown.value = dropdown.options[0].value;
        const targetLevel = parseInt(dropdown.value);

        this._cumulativeState.currentLevel = newLevel;
        this._costContext = { houseRoomHrid, currentLevel: newLevel, targetLevel };

        await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, newLevel, targetLevel);
    }

    /**
     * Update marketplace tab badges when inventory changes.
     * Skips the dedicated Return tab (data-mwi-house-return).
     */
    async _updateMarketplaceTabs() {
        if (this.currentMaterialsTabs.length === 0) return;
        if (!this._costContext) return;

        const capturedSessionId = this._houseSessionId;
        const capturedCostContext = this._costContext;

        const { houseRoomHrid, currentLevel, targetLevel } = capturedCostContext;
        const costData = await houseCostCalculator.calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel);

        if (this._houseSessionId !== capturedSessionId) return;
        if (this._costContext !== capturedCostContext) return;
        if (!marketplaceSession.isActive(capturedSessionId)) return;

        const updatedMaterials = this.getMissingMaterials(costData);

        if (this.activeWorkflowModel) {
            for (const modelEntry of this.activeWorkflowModel.materials) {
                const updated = updatedMaterials.find((material) => material.itemHrid === modelEntry.itemHrid);
                if (updated) Object.assign(modelEntry, updated);
                else modelEntry.missing = 0;
            }
        }

        const connectedTabs = document.querySelectorAll(
            `[data-mwi-custom-tab][data-mwi-tab-owner="${MARKETPLACE_OWNER.HOUSE}"][data-item-hrid]`
        );
        for (const tab of connectedTabs) {
            const itemHrid = tab.getAttribute('data-item-hrid');
            const material = this.activeWorkflowModel?.materials.find((entry) => entry.itemHrid === itemHrid);
            if (material) updateTabBadge(tab, material);
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        document
            .querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level')
            .forEach((el) => el.remove());

        document.querySelectorAll('[class*="HousePanel_itemRequirements"]').forEach((grid) => {
            grid.style.gridTemplateColumns = '';
        });

        // End the active House session — onEnd callback handles local teardown.
        // Fall back to local teardown if the Core token was already gone.
        if (!this.exitHouseMarketplaceSession(this._houseSessionId)) {
            this.teardownHouseMarketplaceSession();
        }

        if (this.cleanupObserver) {
            this.cleanupObserver();
            this.cleanupObserver = null;
        }

        if (this._itemsUpdatedHandler) {
            dataManager.off('items_updated', this._itemsUpdatedHandler);
            this._itemsUpdatedHandler = null;
        }

        if (this._houseRoomsUpdatedHandler) {
            dataManager.off('house_rooms_updated', this._houseRoomsUpdatedHandler);
            this._houseRoomsUpdatedHandler = null;
        }

        this._cumulativeState = null;
        this._costContext = null;
        this._cumulativeRenderGeneration++;
        this._cumulativeRenderGenerations = new WeakMap();

        this.autofillManager.cleanup();
        this.timerRegistry.clearAll();

        this.currentModalContent = null;
        this.isActive = false;
        this.isInitialized = false;
    }
}

const houseCostDisplay = new HouseCostDisplay();
houseCostDisplay.setupSettingListener();

export default houseCostDisplay;
