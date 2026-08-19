// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
    fakeDataManager,
    mockOnClass,
    mockCalculateOfflineEconomics,
    mockGetItemDetails,
    settingValues,
    settingChangeCallbacks,
} = vi.hoisted(() => {
    const listeners = new Map();
    return {
        settingValues: { offlineProgressEconomics: true, profitCalc_pricingMode: 'hybrid' },
        settingChangeCallbacks: new Map(),
        mockGetItemDetails: vi.fn(() => null),
        mockCalculateOfflineEconomics: vi.fn(),
        mockOnClass: vi.fn(),
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
        },
    };
});

vi.mock('../../core/data-manager.js', () => ({ default: { ...fakeDataManager, getItemDetails: mockGetItemDetails } }));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => settingValues[key] ?? true),
        getSettingValue: vi.fn((key, def) => settingValues[key] ?? def),
        getPricingModeLabel: vi.fn(() => 'Buy: Ask / Sell: Ask'),
        onSettingChange: (key, cb) => {
            if (!settingChangeCallbacks.has(key)) settingChangeCallbacks.set(key, new Set());
            settingChangeCallbacks.get(key).add(cb);
        },
        offSettingChange: (key, cb) => {
            settingChangeCallbacks.get(key)?.delete(cb);
        },
    },
}));
vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: mockOnClass.mockImplementation(() => vi.fn()),
    },
}));
vi.mock('../../utils/offline-economics-calculator.js', () => ({
    calculateOfflineEconomics: mockCalculateOfflineEconomics,
}));
vi.mock('../../utils/market-data.js', () => ({ formatPrice: vi.fn((n) => String(Math.round(n))) }));

let capturedCleanupCallback = null;
vi.mock('../../utils/dom-observer-helpers.js', () => ({
    createMutationWatcher: vi.fn((_el, callback) => {
        capturedCleanupCallback = callback;
        return vi.fn();
    }),
}));

import offlineProgressEconomics from './offline-progress-economics.js';

function buildModalNode() {
    const modalContent = document.createElement('div');
    modalContent.className = 'OfflineProgressModal_modalContent__3ZsUb';
    modalContent.innerHTML = `
        <div class="OfflineProgressModal_header__3HqPY">Welcome Back!</div>
        <div class="OfflineProgressModal_itemList__26h-Y">
            <div class="OfflineProgressModal_offlineProgress__3P0VR">
                <div class="OfflineProgressModal_label__2HwFG">Offline duration</div>
                <div>3h 0m</div>
            </div>
        </div>
    `;
    document.body.appendChild(modalContent);
    return modalContent;
}

const SAMPLE_ECONOMICS = {
    revenue: 100,
    cost: 20,
    profit: 80,
    revenuePerDay: 300,
    costPerDay: 60,
    profitPerDay: 240,
    durationSeconds: 28800,
    isPartial: false,
    unvaluedItems: [],
    lines: [],
};

function triggerCharacterInitialized(overrides = {}) {
    fakeDataManager.emit('character_initialized', {
        offlineItems: [{ itemHrid: '/items/cheese', enhancementLevel: 0, offlineCount: 10 }],
        currentTimestamp: '2026-08-19T12:00:00.000Z',
        character: { lastOfflineTime: '2026-08-19T04:00:00.000Z' },
        ...overrides,
    });
}

describe('offline-progress-economics', () => {
    beforeEach(() => {
        settingValues.offlineProgressEconomics = true;
        settingValues.profitCalc_pricingMode = 'hybrid';
        mockCalculateOfflineEconomics.mockReset().mockReturnValue(SAMPLE_ECONOMICS);
        mockGetItemDetails.mockReset().mockReturnValue(null);
        mockOnClass.mockClear();
        capturedCleanupCallback = null;
    });

    afterEach(() => {
        offlineProgressEconomics.disable();
        document.body.innerHTML = '';
    });

    test('injects the economics block after character_initialized delivers offline items and the modal mounts', () => {
        offlineProgressEconomics.initialize();
        triggerCharacterInitialized();

        const modalNode = buildModalNode();
        const onClassCallback = mockOnClass.mock.calls[0][2];
        onClassCallback(modalNode);

        const block = document.querySelector('#mwi-offline-economics');
        expect(block).not.toBeNull();
        expect(block.previousElementSibling.className).toContain('OfflineProgressModal_itemList');
    });

    test('does not inject anything when there is no cached offline data (e.g. an ordinary login with no offline items)', () => {
        offlineProgressEconomics.initialize();
        fakeDataManager.emit('character_initialized', {
            offlineItems: [],
            currentTimestamp: '2026-08-19T12:00:00.000Z',
            character: { lastOfflineTime: '2026-08-19T04:00:00.000Z' },
        });

        const modalNode = buildModalNode();
        mockOnClass.mock.calls[0][2](modalNode);

        expect(document.querySelector('#mwi-offline-economics')).toBeNull();
    });

    test('processing the same modal node twice only injects the block once', () => {
        offlineProgressEconomics.initialize();
        triggerCharacterInitialized();

        const modalNode = buildModalNode();
        const onClassCallback = mockOnClass.mock.calls[0][2];
        onClassCallback(modalNode);
        onClassCallback(modalNode);

        expect(document.querySelectorAll('#mwi-offline-economics')).toHaveLength(1);
    });

    test('character_switching removes the injected block and clears cached offline data', () => {
        offlineProgressEconomics.initialize();
        triggerCharacterInitialized();
        const modalNode = buildModalNode();
        mockOnClass.mock.calls[0][2](modalNode);
        expect(document.querySelector('#mwi-offline-economics')).not.toBeNull();

        fakeDataManager.emit('character_switching', {});

        expect(document.querySelector('#mwi-offline-economics')).toBeNull();

        // A second modal for a different character with no fresh character_initialized must not
        // resurrect the old block.
        document.body.innerHTML = '';
        const secondModalNode = buildModalNode();
        mockOnClass.mock.calls[0][2](secondModalNode);
        expect(document.querySelector('#mwi-offline-economics')).toBeNull();
    });

    test('the injected block is removed once the native modal closes', () => {
        offlineProgressEconomics.initialize();
        triggerCharacterInitialized();
        const modalNode = buildModalNode();
        mockOnClass.mock.calls[0][2](modalNode);
        expect(document.querySelector('#mwi-offline-economics')).not.toBeNull();

        modalNode.remove();
        capturedCleanupCallback();

        expect(document.querySelector('#mwi-offline-economics')).toBeNull();
    });

    test('a pricing mode change while the modal is open recomputes and replaces the block', () => {
        offlineProgressEconomics.initialize();
        triggerCharacterInitialized();
        const modalNode = buildModalNode();
        mockOnClass.mock.calls[0][2](modalNode);

        mockCalculateOfflineEconomics.mockReturnValue({ ...SAMPLE_ECONOMICS, revenue: 999 });
        for (const cb of settingChangeCallbacks.get('profitCalc_pricingMode')) cb('optimistic');

        expect(mockCalculateOfflineEconomics).toHaveBeenCalledTimes(2);
        expect(document.querySelectorAll('#mwi-offline-economics')).toHaveLength(1);
        expect(document.querySelector('#mwi-offline-economics').textContent).toContain('999');
    });

    test('the pricing mode listener is unsubscribed once the modal closes (no leaked recompute)', () => {
        offlineProgressEconomics.initialize();
        triggerCharacterInitialized();
        const modalNode = buildModalNode();
        mockOnClass.mock.calls[0][2](modalNode);

        modalNode.remove();
        capturedCleanupCallback();

        expect(settingChangeCallbacks.get('profitCalc_pricingMode').size).toBe(0);
    });

    test('does nothing when the feature setting is disabled', () => {
        settingValues.offlineProgressEconomics = false;
        offlineProgressEconomics.initialize();

        expect(fakeDataManager.listenerCount('character_initialized')).toBe(0);
        expect(mockOnClass).not.toHaveBeenCalled();
    });

    test('initialize -> disable -> initialize registers exactly one character_initialized listener', () => {
        offlineProgressEconomics.initialize();
        offlineProgressEconomics.disable();
        offlineProgressEconomics.initialize();

        expect(fakeDataManager.listenerCount('character_initialized')).toBe(1);
        expect(fakeDataManager.listenerCount('character_switching')).toBe(1);
    });
});
