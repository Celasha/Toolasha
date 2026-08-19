// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeDataManager, mockCalculateMaterialRequirements } = vi.hoisted(() => {
    const listeners = new Map();
    return {
        mockCalculateMaterialRequirements: vi.fn(),
        fakeDataManager: {
            on: (event, handler) => {
                if (!listeners.has(event)) listeners.set(event, new Set());
                listeners.get(event).add(handler);
            },
            off: (event, handler) => {
                listeners.get(event)?.delete(handler);
            },
            emit: (event, data) => {
                for (const handler of Array.from(listeners.get(event) || [])) handler(data);
            },
            listenerCount: (event) => listeners.get(event)?.size || 0,
            getInitClientData: vi.fn(),
            getCurrentActions: vi.fn(() => []),
            getInventory: vi.fn(() => []),
            getActionDetails: vi.fn(),
            getCurrentCharacterId: vi.fn(() => 'char-1'),
        },
    };
});

vi.mock('../../core/data-manager.js', () => ({ default: fakeDataManager }));
vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn((key) => key !== 'actions_missingMaterialsButton_ignoreQueue') },
}));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));
vi.mock('../../core/marketplace-session.js', () => ({
    marketplaceSession: { isActive: vi.fn(() => false), getActive: vi.fn(() => null), start: vi.fn(), end: vi.fn() },
    MARKETPLACE_OWNER: { ACTIONS: 'actions', ENHANCEMENT: 'enhancement' },
}));
vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: mockCalculateMaterialRequirements,
    calculateEnhancementMaterialRequirements: vi.fn(() => []),
}));
vi.mock('../../utils/formatters.js', () => ({ formatWithSeparator: vi.fn((n) => String(n)) }));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => ({ registerTimeout: vi.fn(), clearAll: vi.fn() }),
}));
vi.mock('../../utils/marketplace-autofill.js', () => ({
    createAutofillManager: () => ({
        initialize: vi.fn(),
        cleanup: vi.fn(),
        startSession: vi.fn(),
        arm: vi.fn(),
        exitSession: vi.fn(),
    }),
    getReactFiberFromElement: vi.fn(() => null),
}));
vi.mock('../../utils/marketplace-tabs.js', () => ({
    createMaterialTab: vi.fn(),
    removeMaterialTabsForOwner: vi.fn(),
    getVisibleMarketplaceTabContainer: vi.fn(() => null),
    setupMarketplaceCleanupObserver: vi.fn(() => vi.fn()),
    navigateToMarketplace: vi.fn(),
    watchNativeTabExit: vi.fn(() => vi.fn()),
    isElementActuallyVisible: vi.fn(() => true),
    clickMarketplaceNavigationButton: vi.fn(() => false),
    updateTabBadge: vi.fn(),
    MARKETPLACE_REMOUNT_GRACE_MS: 350,
    isMarketplaceMarketListingsSelected: vi.fn(() => false),
}));
vi.mock('./enhancement-display.js', () => ({
    getProtectionItemFromUI: vi.fn(() => null),
    getProtectFromLevelFromUI: vi.fn(() => 0),
}));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({ calculateEnhancementPath: vi.fn(() => null) }));
vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn(() => ({})) }));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn(() => vi.fn()) }));
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn(() => '/actions/crafting/sword') }));
vi.mock('./production-tools-layout.js', () => ({
    getOrCreateProductionToolsBlock: vi.fn(() => null),
    normalizeProductionToolsBlock: vi.fn(),
}));

import missingMaterialsButton from './missing-materials-button.js';

function buildPanel(inputValue) {
    document.body.innerHTML = `
        <div class="SkillActionDetail_skillActionDetail_abc">
            <div class="SkillActionDetail_name_xyz">Craft Sword</div>
            <div class="maxActionCountInput_123"><input value="${inputValue}" /></div>
        </div>
    `;
    return document.querySelector('.SkillActionDetail_skillActionDetail_abc');
}

describe('missing-materials-button — queue-change refresh', () => {
    beforeEach(() => {
        mockCalculateMaterialRequirements.mockReset();
        fakeDataManager.getInitClientData.mockReturnValue({
            actionDetailMap: {
                '/actions/crafting/sword': {
                    type: '/action_types/crafting',
                    inputItems: [{ itemHrid: '/items/log', count: 1 }],
                },
            },
        });
    });

    afterEach(() => {
        missingMaterialsButton.cleanup();
        document.body.innerHTML = '';
    });

    test('button becomes enabled when a finite queue change adds missing materials', () => {
        mockCalculateMaterialRequirements.mockReturnValue([{ itemHrid: '/items/log', isTradeable: true, missing: 0 }]);

        buildPanel('5');
        missingMaterialsButton.initialize();

        const button = document.querySelector('#mwi-missing-mats-button');
        expect(button.disabled).toBe(true);

        // Simulate a finite queue change: the fresh calculation now has missing materials.
        mockCalculateMaterialRequirements.mockReturnValue([{ itemHrid: '/items/log', isTradeable: true, missing: 10 }]);
        fakeDataManager.emit('actions_updated', { endCharacterActions: [] });

        const refreshedButton = document.querySelector('#mwi-missing-mats-button');
        expect(refreshedButton.disabled).toBe(false);
    });

    test('button becomes disabled when a finite queue change removes the missing-material reservation', () => {
        mockCalculateMaterialRequirements.mockReturnValue([{ itemHrid: '/items/log', isTradeable: true, missing: 10 }]);

        buildPanel('5');
        missingMaterialsButton.initialize();

        const button = document.querySelector('#mwi-missing-mats-button');
        expect(button.disabled).toBe(false);

        mockCalculateMaterialRequirements.mockReturnValue([{ itemHrid: '/items/log', isTradeable: true, missing: 0 }]);
        fakeDataManager.emit('actions_updated', { endCharacterActions: [] });

        const refreshedButton = document.querySelector('#mwi-missing-mats-button');
        expect(refreshedButton.disabled).toBe(true);
    });

    test('initialize -> cleanup -> initialize registers exactly one actions_updated listener', () => {
        mockCalculateMaterialRequirements.mockReturnValue([{ itemHrid: '/items/log', isTradeable: true, missing: 0 }]);

        buildPanel('5');
        missingMaterialsButton.initialize();
        missingMaterialsButton.cleanup();
        buildPanel('5');
        missingMaterialsButton.initialize();

        expect(fakeDataManager.listenerCount('actions_updated')).toBe(1);
    });
});
