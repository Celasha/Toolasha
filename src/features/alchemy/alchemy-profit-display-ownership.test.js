// @vitest-environment jsdom

/**
 * Tests for TLA-026: Alchemy non-market metrics (inline XP/hr, Action Speed & Time, Level
 * Progress) must stay visible when `alchemy_profitDisplay` is off (including Iron Cow's forced
 * disable) or market data is unavailable. Only Profitability is gated on those conditions.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

const settingsState = {};

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => settingsState[key] ?? true),
        getSettingValue: vi.fn((_key, def) => def),
        getPricingModeLabel: vi.fn(() => 'Hybrid'),
        COLOR_TEXT_SECONDARY: '#888888',
        COLOR_TEXT_PRIMARY: '#ffffff',
        COLOR_INFO: '#60a5fa',
        COLOR_XP_RATE: '#ffffff',
        COLOR_BORDER: '#333333',
        color_loss: '#f87171',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

const ITEM_HRID = '/items/test_alchemy_item';
const gameDataState = {
    itemDetailMap: { [ITEM_HRID]: { itemLevel: 10 } },
    levelExperienceTable: { 10: 1000, 11: 2000 },
};

const dataManagerMock = {
    getInitClientData: vi.fn(() => gameDataState),
    getSkills: vi.fn(() => [{ skillHrid: '/skills/alchemy', level: 10, experience: 1500 }]),
    getItemDetails: vi.fn((hrid) => gameDataState.itemDetailMap[hrid]),
    on: vi.fn(),
    off: vi.fn(),
};
vi.mock('../../core/data-manager.js', () => ({ default: dataManagerMock }));

const alchemyProfitMock = {
    getCurrentActionHrid: vi.fn(),
    extractDrops: vi.fn(async () => []),
    extractRequirements: vi.fn(async () => []),
    getStateFingerprint: vi.fn(() => 'fp'),
};
vi.mock('./alchemy-profit.js', () => ({ default: alchemyProfitMock }));

const alchemyProfitCalculatorMock = {
    calculateCoinifyProfit: vi.fn(),
    calculateDecomposeProfit: vi.fn(),
    calculateTransmuteProfit: vi.fn(),
    calculateAlchemyActionMetrics: vi.fn(),
};
vi.mock('../market/alchemy-profit-calculator.js', () => ({ default: alchemyProfitCalculatorMock }));

vi.mock('../../utils/experience-parser.js', () => ({
    calculateExperienceMultiplier: vi.fn(() => ({
        totalMultiplier: 1,
        totalWisdom: 0,
        charmExperience: 0,
        breakdown: {},
    })),
}));
vi.mock('../../utils/profit-helpers.js', () => ({
    calculateActionsPerHour: vi.fn((seconds) => 3600 / seconds),
}));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: vi.fn(() => ({ clearAll: vi.fn(), registerTimeout: vi.fn() })),
}));

const { AlchemyProfitDisplay } = await import('./alchemy-profit-display.js');

function makeFullProfitData(overrides = {}) {
    return {
        actionType: 'coinify',
        itemHrid: ITEM_HRID,
        enhancementLevel: 0,
        profitPerHour: 1000,
        profitPerDay: 24000,
        revenuePerHour: 2000,
        actionsPerHour: 100,
        actionTime: 10,
        materialCost: 5,
        catalystPrice: 0,
        costPerAttempt: 5,
        incomePerAttempt: 20,
        netProfitPerAttempt: 15,
        profitPerAction: 10,
        materialCostPerHour: 500,
        catalystCostPerHour: 0,
        totalTeaCostPerHour: 0,
        requirementCosts: [
            { itemHrid: ITEM_HRID, count: 1, price: 5, costPerAction: 5, costPerHour: 500, enhancementLevel: 0 },
        ],
        dropRevenues: [
            {
                itemHrid: '/items/coin',
                count: 20,
                dropRate: 1,
                effectiveDropRate: 1,
                price: 1,
                isEssence: false,
                isRare: false,
                revenuePerAttempt: 20,
                revenuePerHour: 2000,
                dropsPerHour: 2000,
            },
        ],
        catalystCost: { itemHrid: null, price: 0, costPerSuccess: 0, costPerAttempt: 0, costPerHour: 0 },
        consumableCosts: [],
        successRate: 0.7,
        efficiency: 0,
        successRateBreakdown: { total: 0.7, base: 0.7, tea: 0, catalyst: 0 },
        efficiencyBreakdown: {
            levelEfficiency: 0,
            houseEfficiency: 0,
            teaEfficiency: 0,
            equipmentEfficiency: 0,
            communityEfficiency: 0,
            achievementEfficiency: 0,
        },
        actionSpeedBreakdown: { total: 0, equipment: 0, tea: 0, equipmentDetails: [], teaDetails: [] },
        winningCatalystHrid: null,
        winningTeaUsed: false,
        pricingMode: 'hybrid',
        ...overrides,
    };
}

function makePureMetrics(overrides = {}) {
    return {
        actionType: 'coinify',
        itemHrid: ITEM_HRID,
        actionTime: 10,
        actionsPerHour: 100,
        efficiency: 0,
        efficiencyBreakdown: {
            levelEfficiency: 0,
            houseEfficiency: 0,
            teaEfficiency: 0,
            equipmentEfficiency: 0,
            communityEfficiency: 0,
            achievementEfficiency: 0,
        },
        actionSpeedBreakdown: { total: 0, equipment: 0, tea: 0, equipmentDetails: [], teaDetails: [] },
        successRate: 0.7,
        successRateBreakdown: { total: 0.7, base: 0.7, tea: 0, catalyst: 0 },
        pricingMode: 'hybrid',
        ...overrides,
    };
}

function buildAlchemyComponentDom() {
    document.body.innerHTML = `
        <div class="SkillActionDetail_alchemyComponent__x">
            <div class="SkillActionDetail_info__x">
                <div class="SkillActionDetail_expOnSuccess__x"><span>100</span></div>
            </div>
            <div class="maxActionCountInput__x"><input value="10" /></div>
        </div>
    `;
    return document.querySelector('.SkillActionDetail_info__x');
}

describe('AlchemyProfitDisplay.createDisplay ownership split (TLA-026)', () => {
    let display;
    let infoContainer;

    beforeEach(() => {
        for (const key of Object.keys(settingsState)) delete settingsState[key];
        infoContainer = buildAlchemyComponentDom();
        display = new AlchemyProfitDisplay();
    });

    test('1. market character + alchemy_profitDisplay=true renders Profitability plus all non-market metrics', () => {
        display.createDisplay(infoContainer, makeFullProfitData(), 'coinify', ITEM_HRID, true);

        expect(document.getElementById('mwi-alchemy-profit')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-speed-time')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).not.toBeNull();
        expect(document.querySelector('[data-mwi-inline-xp-owner="alchemy"]')).not.toBeNull();
    });

    test('2. market character + alchemy_profitDisplay=false hides Profitability but keeps the rest', () => {
        settingsState.alchemy_profitDisplay = false;

        display.createDisplay(infoContainer, makeFullProfitData(), 'coinify', ITEM_HRID, true);

        expect(document.getElementById('mwi-alchemy-profit')).toBeNull();
        expect(document.getElementById('mwi-alchemy-speed-time')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).not.toBeNull();
        expect(document.querySelector('[data-mwi-inline-xp-owner="alchemy"]')).not.toBeNull();
    });

    test('3. Iron Cow (alchemy_profitDisplay AND actionPanel_showProfitDetail forced off) hides only Profitability', () => {
        settingsState.alchemy_profitDisplay = false;
        settingsState.actionPanel_showProfitDetail = false;

        // Even in the hypothetical case market data was available, Iron Cow's forced-off
        // settings alone must be enough to hide Profitability.
        display.createDisplay(infoContainer, makeFullProfitData(), 'coinify', ITEM_HRID, true);

        expect(document.getElementById('mwi-alchemy-profit')).toBeNull();
        expect(document.getElementById('mwi-alchemy-speed-time')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).not.toBeNull();
        expect(document.querySelector('[data-mwi-inline-xp-owner="alchemy"]')).not.toBeNull();
    });

    test('4. missing market data (hasProfitData=false) fails Profitability closed even with both settings on, but non-market metrics still render from the pure fallback scenario', () => {
        // Both settings enabled - this is the realistic Iron Cow case too, since market prices
        // are genuinely unavailable regardless of what the settings say.
        display.createDisplay(infoContainer, makePureMetrics(), 'coinify', ITEM_HRID, false);

        expect(document.getElementById('mwi-alchemy-profit')).toBeNull();
        expect(document.getElementById('mwi-alchemy-speed-time')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).not.toBeNull();
        expect(document.querySelector('[data-mwi-inline-xp-owner="alchemy"]')).not.toBeNull();
    });

    test('5. actionPanel_showProfitDetail=false alone (global hide) hides Profitability but keeps the rest', () => {
        settingsState.actionPanel_showProfitDetail = false;

        display.createDisplay(infoContainer, makeFullProfitData(), 'coinify', ITEM_HRID, true);

        expect(document.getElementById('mwi-alchemy-profit')).toBeNull();
        expect(document.getElementById('mwi-alchemy-speed-time')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).not.toBeNull();
    });

    test('6. rebuilding the display never leaves duplicate sections or duplicate inline XP rows', () => {
        display.createDisplay(infoContainer, makeFullProfitData(), 'coinify', ITEM_HRID, true);
        display.createDisplay(infoContainer, makeFullProfitData(), 'coinify', ITEM_HRID, true);

        expect(document.querySelectorAll('#mwi-alchemy-profit').length).toBe(1);
        expect(document.querySelectorAll('#mwi-alchemy-speed-time').length).toBe(1);
        expect(document.querySelectorAll('#mwi-alchemy-level-progress').length).toBe(1);
        expect(document.querySelectorAll('[data-mwi-inline-xp-owner="alchemy"]').length).toBe(1);
    });

    test('7. removeDisplay cleans up all sections and the inline rate, whether or not Profitability was ever shown', () => {
        display.createDisplay(infoContainer, makePureMetrics(), 'coinify', ITEM_HRID, false);

        display.removeDisplay();

        expect(document.getElementById('mwi-alchemy-profit')).toBeNull();
        expect(document.getElementById('mwi-alchemy-speed-time')).toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).toBeNull();
        expect(document.querySelector('[data-mwi-inline-xp-owner="alchemy"]')).toBeNull();
    });

    test('8. displayElement anchor reflects a non-market section when Profitability is absent, so checkAndUpdateDisplay does not treat the panel as unmounted', () => {
        display.createDisplay(infoContainer, makePureMetrics(), 'coinify', ITEM_HRID, false);

        expect(display.displayElement).not.toBeNull();
        expect(display.displayElement.parentNode).not.toBeNull();
        expect(display.displayElement.id).not.toBe('mwi-alchemy-profit');
    });

    test('transmute/decompose still work end-to-end through the non-market path', () => {
        display.createDisplay(
            buildAlchemyComponentDom(),
            makePureMetrics({ actionType: 'decompose' }),
            'decompose',
            ITEM_HRID,
            false
        );
        expect(document.getElementById('mwi-alchemy-speed-time')).not.toBeNull();
        expect(document.getElementById('mwi-alchemy-level-progress')).not.toBeNull();
    });
});

describe('AlchemyProfitDisplay.updateDisplay routing to the pure metrics fallback (TLA-026)', () => {
    let display;
    let infoContainer;

    beforeEach(() => {
        for (const key of Object.keys(settingsState)) delete settingsState[key];
        infoContainer = buildAlchemyComponentDom();
        display = new AlchemyProfitDisplay();
        display.createDisplay = vi.fn();
        display.removeDisplay = vi.fn();

        alchemyProfitMock.getCurrentActionHrid.mockReturnValue('/actions/alchemy/coinify');
        alchemyProfitMock.extractDrops.mockResolvedValue([]);
        alchemyProfitMock.extractRequirements.mockResolvedValue([{ itemHrid: ITEM_HRID, enhancementLevel: 0 }]);

        alchemyProfitCalculatorMock.calculateCoinifyProfit.mockReset();
        alchemyProfitCalculatorMock.calculateAlchemyActionMetrics.mockReset();
    });

    test('9. falls back to calculateAlchemyActionMetrics and renders with hasProfitData=false when the market calculator returns null', async () => {
        alchemyProfitCalculatorMock.calculateCoinifyProfit.mockReturnValue(null);
        const pureMetrics = makePureMetrics();
        alchemyProfitCalculatorMock.calculateAlchemyActionMetrics.mockReturnValue(pureMetrics);

        await display.updateDisplay(infoContainer);

        expect(alchemyProfitCalculatorMock.calculateAlchemyActionMetrics).toHaveBeenCalledWith(ITEM_HRID, 'coinify');
        expect(display.createDisplay).toHaveBeenCalledWith(infoContainer, pureMetrics, 'coinify', ITEM_HRID, false);
    });

    test('10. uses the full profit data directly (no fallback call) and renders with hasProfitData=true when market data is available', async () => {
        const fullProfitData = makeFullProfitData();
        alchemyProfitCalculatorMock.calculateCoinifyProfit.mockReturnValue(fullProfitData);

        await display.updateDisplay(infoContainer);

        expect(alchemyProfitCalculatorMock.calculateAlchemyActionMetrics).not.toHaveBeenCalled();
        expect(display.createDisplay).toHaveBeenCalledWith(infoContainer, fullProfitData, 'coinify', ITEM_HRID, true);
    });

    test('11. removes the display and renders nothing when neither market data nor the pure fallback are available', async () => {
        alchemyProfitCalculatorMock.calculateCoinifyProfit.mockReturnValue(null);
        alchemyProfitCalculatorMock.calculateAlchemyActionMetrics.mockReturnValue(null);

        await display.updateDisplay(infoContainer);

        expect(display.removeDisplay).toHaveBeenCalled();
        expect(display.createDisplay).not.toHaveBeenCalled();
    });
});
