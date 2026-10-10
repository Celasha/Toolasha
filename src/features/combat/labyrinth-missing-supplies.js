/**
 * Labyrinth Missing Supplies Button
 * Adds a button next to the Labyrinth entry screen's "Supplies" label that opens the
 * marketplace with tabs for whichever Torch/Shroud/Beacon tier is short of its carry cap.
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import { createAutofillManager } from '../../utils/marketplace-autofill.js';
import {
    createMaterialTab,
    removeMaterialTabsForOwner,
    getVisibleMarketplaceTabContainer,
    setupMarketplaceCleanupObserver,
    navigateToMarketplace,
    watchNativeTabExit,
    clickMarketplaceNavigationButton,
    MARKETPLACE_REMOUNT_GRACE_MS,
    isMarketplaceMarketListingsSelected,
    updateTabBadge,
} from '../../utils/marketplace-tabs.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { translateGameName } from '../../utils/game-i18n.js';

// Mirrors the game client's labyrinthTorchHrid/ShroudHrid/BeaconHrid (characterSetting) and
// labyrinthTorchCap/ShroudCap/BeaconCap (characterInfo, falling back to the client's base caps
// of 100/4/5 when a character has no cap override yet).
const SUPPLY_CATEGORIES = [
    { settingKey: 'labyrinthTorchHrid', capKey: 'labyrinthTorchCap', baseCap: 100 },
    { settingKey: 'labyrinthShroudHrid', capKey: 'labyrinthShroudCap', baseCap: 4 },
    { settingKey: 'labyrinthBeaconHrid', capKey: 'labyrinthBeaconCap', baseCap: 5 },
];

const BUTTON_CLASS = 'mwi-labyrinth-missing-supplies-button';

let domObserverUnregister = null;
let cleanupObserver = null;
let nativeTabExitCleanup = null;
let inventoryUpdateHandler = null;
let activeSessionId = null;
let activeMaterials = null;
const currentTabs = [];
const timerRegistry = createTimerRegistry();
const autofillManager = createAutofillManager('LabyrinthMissingSupplies');

export function initialize() {
    if (!config.getSetting('labyrinthMissingSuppliesButton')) {
        return;
    }

    autofillManager.initialize();

    domObserverUnregister = domObserver.onClass('LabyrinthMissingSupplies', 'LabyrinthPanel_suppliesGrid', (grid) =>
        injectButton(grid)
    );

    document.querySelectorAll('[class*="LabyrinthPanel_suppliesGrid"]').forEach((grid) => injectButton(grid));
}

export function cleanup() {
    const sessionIdToEnd = activeSessionId;
    if (sessionIdToEnd !== null && marketplaceSession.isActive(sessionIdToEnd)) {
        marketplaceSession.end(sessionIdToEnd);
    } else {
        teardownSession();
    }

    if (domObserverUnregister) {
        domObserverUnregister();
        domObserverUnregister = null;
    }

    autofillManager.cleanup();
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((el) => el.remove());
    timerRegistry.clearAll();
}

/**
 * Inject the button next to the "Supplies" label, once per rendered panel instance.
 * @param {Element} grid - The LabyrinthPanel_suppliesGrid element.
 */
export function injectButton(grid) {
    const wrapper = grid.parentElement;
    if (!wrapper || wrapper.querySelector(`.${BUTTON_CLASS}`)) {
        return;
    }

    const label = wrapper.querySelector('[class*="LabyrinthPanel_label"]');
    if (!label) {
        return;
    }

    label.insertAdjacentElement('afterend', createButton());
}

function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = t('labyrinthMissingSupplies.buttonLabel');
    button.style.cssText = `
        margin: 4px 0 8px 0;
        padding: 4px 10px;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
    `;

    button.addEventListener('click', async () => {
        try {
            await handleClick();
        } catch (error) {
            console.error('[LabyrinthMissingSupplies] Workflow failed:', error);
            if (activeSessionId !== null && marketplaceSession.isActive(activeSessionId)) {
                marketplaceSession.end(activeSessionId);
            }
        }
    });

    return button;
}

/**
 * Owned count of an unenhanced stack (torches/shrouds/beacons have no enhancement levels).
 * @param {string} itemHrid
 * @returns {number}
 */
function getOwnedCount(itemHrid) {
    const inventory = dataManager.getInventory() || [];
    const stack = inventory.find((item) => item.itemHrid === itemHrid && item.enhancementLevel === 0);
    return stack?.count || 0;
}

/**
 * Compute missing = cap - owned (clamped at 0) for each currently-selected supply tier.
 * @returns {Array<{itemHrid: string, itemName: string, missing: number, queued: number, isTradeable: boolean, required: number}>}
 */
export function calculateMissingSupplies() {
    const characterSetting = dataManager.characterData?.characterSetting || {};
    const characterInfo = dataManager.characterData?.characterInfo || {};
    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

    const materials = [];
    for (const category of SUPPLY_CATEGORIES) {
        const itemHrid = characterSetting[category.settingKey];
        if (!itemHrid) {
            continue;
        }

        const cap = characterInfo[category.capKey] ?? category.baseCap;
        const owned = getOwnedCount(itemHrid);
        const missing = Math.max(0, cap - owned);
        if (missing <= 0) {
            continue;
        }

        const itemDetails = itemDetailMap[itemHrid];
        materials.push({
            itemHrid,
            itemName: itemDetails?.name || itemHrid.split('/').pop(),
            missing,
            queued: 0,
            isTradeable: itemDetails?.isTradable === true,
            required: cap,
        });
    }
    return materials;
}

export async function handleClick() {
    const upfrontMaterials = calculateMissingSupplies();
    if (upfrontMaterials.length === 0) {
        return;
    }

    const capturedSessionId = marketplaceSession.start({
        owner: MARKETPLACE_OWNER.LABYRINTH_SUPPLIES,
        onEnd: teardownSession,
    });
    activeSessionId = capturedSessionId;

    if (!clickMarketplaceNavigationButton()) {
        console.error('[LabyrinthMissingSupplies] Marketplace navbar button not found');
        marketplaceSession.end(capturedSessionId);
        return;
    }

    const opened = await waitForMarketplace(capturedSessionId);
    if (!opened || !marketplaceSession.isActive(capturedSessionId)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    // Recalculate fresh - inventory/selection may have changed since the button was rendered.
    const materials = calculateMissingSupplies();
    if (materials.length === 0) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    activeMaterials = materials;
    autofillManager.startSession({ sessionId: capturedSessionId, quantityProvider: null });

    if (!createTabs(materials, capturedSessionId)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    const first = materials.find((m) => m.isTradeable !== false);
    if (!first) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    const armed = autofillManager.arm({
        sessionId: capturedSessionId,
        itemHrid: first.itemHrid,
        enhancementLevel: 0,
        modalMode: 'buy',
        quantityProvider: () => activeMaterials?.find((m) => m.itemHrid === first.itemHrid)?.missing ?? 0,
    });
    if (!armed || !navigateToMarketplace(first.itemHrid, 0)) {
        marketplaceSession.end(capturedSessionId);
        return;
    }

    setupCleanupObserver(capturedSessionId);
    setupInventoryListener();
}

async function waitForMarketplace(sessionId) {
    const maxAttempts = 50;
    const delayMs = 100;

    for (let i = 0; i < maxAttempts; i++) {
        if (!marketplaceSession.isActive(sessionId)) {
            return false;
        }
        if (getVisibleMarketplaceTabContainer()) {
            return true;
        }

        await new Promise((resolve) => {
            const delayTimeout = setTimeout(resolve, delayMs);
            timerRegistry.registerTimeout(delayTimeout);
        });
    }

    console.error('[LabyrinthMissingSupplies] Marketplace did not open within timeout');
    return false;
}

function makeMaterialClickHandler(tabRef, sessionId) {
    return (_e, mat) => {
        if (!marketplaceSession.isActive(sessionId)) {
            return;
        }
        const liveMissing = parseInt(tabRef.tab?.getAttribute('data-missing-quantity') || '0', 10);
        if (!Number.isFinite(liveMissing) || liveMissing <= 0 || mat.isTradeable === false) {
            return;
        }

        const armed = autofillManager.arm({
            sessionId,
            itemHrid: mat.itemHrid,
            enhancementLevel: 0,
            modalMode: 'buy',
            quantityProvider: () => activeMaterials?.find((entry) => entry.itemHrid === mat.itemHrid)?.missing ?? 0,
        });
        if (!armed || !navigateToMarketplace(mat.itemHrid, 0)) {
            marketplaceSession.end(sessionId);
        }
    };
}

function createTabs(materials, sessionId, tabContainer = null) {
    const tabsContainer = tabContainer || getVisibleMarketplaceTabContainer();
    if (!tabsContainer || !marketplaceSession.isActive(sessionId)) {
        console.error('[LabyrinthMissingSupplies] Visible Marketplace tabs container not found');
        return false;
    }

    removeMaterialTabsForOwner(MARKETPLACE_OWNER.LABYRINTH_SUPPLIES);
    currentTabs.length = 0;

    // The My Listings tab label is localized by the game (zh: 我的挂牌), so match
    // both the English and translated text.
    const myListingsLabel = translateGameName('marketplacePanel', 'myListings', 'My Listings');
    const referenceTab = Array.from(tabsContainer.children).find(
        (btn) => btn.textContent.includes('My Listings') || btn.textContent.includes(myListingsLabel)
    );
    if (!referenceTab) {
        console.error('[LabyrinthMissingSupplies] Reference tab not found');
        return false;
    }

    tabsContainer.style.flexWrap = 'wrap';

    nativeTabExitCleanup?.();
    nativeTabExitCleanup = watchNativeTabExit(tabsContainer, () => {
        marketplaceSession.end(sessionId);
    });

    for (const material of materials) {
        const tabRef = { tab: null };
        const handler = makeMaterialClickHandler(tabRef, sessionId);
        const tab = createMaterialTab(material, referenceTab, handler, MARKETPLACE_OWNER.LABYRINTH_SUPPLIES);
        tabRef.tab = tab;
        tabsContainer.appendChild(tab);
        currentTabs.push(tab);
    }

    return true;
}

function setupCleanupObserver(sessionId) {
    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }
    cleanupObserver = setupMarketplaceCleanupObserver({
        owner: MARKETPLACE_OWNER.LABYRINTH_SUPPLIES,
        invalidStateGraceMs: MARKETPLACE_REMOUNT_GRACE_MS,
        onTabsGone: () => {
            if (!marketplaceSession.isActive(sessionId)) {
                return;
            }
            const tabContainer = getVisibleMarketplaceTabContainer();
            if (
                tabContainer &&
                isMarketplaceMarketListingsSelected(tabContainer) &&
                activeMaterials &&
                createTabs(activeMaterials, sessionId, tabContainer)
            ) {
                return;
            }
            marketplaceSession.end(sessionId);
        },
    });
}

function setupInventoryListener() {
    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
    }

    inventoryUpdateHandler = () => {
        if (!activeMaterials || !marketplaceSession.isActive(activeSessionId)) {
            return;
        }
        const updated = calculateMissingSupplies();
        const updatedByHrid = new Map(updated.map((material) => [material.itemHrid, material]));

        for (const entry of activeMaterials) {
            const fresh = updatedByHrid.get(entry.itemHrid);
            entry.missing = fresh?.missing ?? 0;
            const tab = currentTabs.find((t) => t.getAttribute('data-item-hrid') === entry.itemHrid);
            if (tab) {
                updateTabBadge(tab, entry);
            }
        }
    };

    dataManager.on('items_updated', inventoryUpdateHandler);
}

function teardownSession() {
    removeMaterialTabsForOwner(MARKETPLACE_OWNER.LABYRINTH_SUPPLIES);
    currentTabs.length = 0;

    if (inventoryUpdateHandler) {
        dataManager.off('items_updated', inventoryUpdateHandler);
        inventoryUpdateHandler = null;
    }

    if (cleanupObserver) {
        cleanupObserver();
        cleanupObserver = null;
    }

    if (nativeTabExitCleanup) {
        nativeTabExitCleanup();
        nativeTabExitCleanup = null;
    }

    autofillManager.exitSession(activeSessionId);
    activeSessionId = null;
    activeMaterials = null;
}

export default {
    initialize,
    cleanup,
};
