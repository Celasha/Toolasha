// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getInitClientData: vi.fn(),
    calculateMaterialRequirements: vi.fn(),
    getItemPriceOutlierInfo: vi.fn(),
    setReactInputValue: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));
vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));
vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: (...args) => mocks.getInitClientData(...args) },
}));
vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: (...args) => mocks.calculateMaterialRequirements(...args),
}));
vi.mock('../../utils/market-data.js', () => ({
    getItemPriceOutlierInfo: (...args) => mocks.getItemPriceOutlierInfo(...args),
}));
vi.mock('../../utils/react-input.js', () => ({
    setReactInputValue: (...args) => mocks.setReactInputValue(...args),
}));
vi.mock('../../utils/game-lookups.js', () => ({
    getActionHridFromName: vi.fn(),
    getActionHridFromFiber: vi.fn(() => '/actions/tailoring/large_pouch'),
}));
vi.mock('./production-tools-layout.js', () => ({
    getOrCreateProductionToolsBlock: vi.fn(() => null),
    normalizeProductionToolsBlock: vi.fn(),
}));

import { BudgetCalculator } from './budget-calculator.js';

const ACTION_HRID = '/actions/tailoring/large_pouch';
const ORE_HRID = '/items/ore';
const COIN_HRID = '/items/coin';
const COIN_PER_UNIT = 300;
const ORE_PER_UNIT = 10;
const ORE_ASK = 50;

function gameData() {
    return {
        actionDetailMap: {
            [ACTION_HRID]: {
                type: '/action_types/tailoring',
                inputItems: [
                    { itemHrid: COIN_HRID, count: COIN_PER_UNIT },
                    { itemHrid: ORE_HRID, count: ORE_PER_UNIT },
                ],
            },
        },
        itemDetailMap: { [COIN_HRID]: {}, [ORE_HRID]: { isTradable: true } },
    };
}

function materialsForN(n) {
    return [
        {
            itemHrid: COIN_HRID,
            itemName: 'Coin',
            isTradeable: false,
            required: n * COIN_PER_UNIT,
            have: 1_000_000,
            missing: 0,
        },
        {
            itemHrid: ORE_HRID,
            itemName: 'Ore',
            isTradeable: true,
            required: n * ORE_PER_UNIT,
            have: 0,
            missing: n * ORE_PER_UNIT,
        },
    ];
}

describe('BudgetCalculator - coin cost counts against the budget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        mocks.getInitClientData.mockReturnValue(gameData());
        mocks.calculateMaterialRequirements.mockImplementation((_hrid, n) => materialsForN(n));
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: ORE_ASK, isOutlier: false });
    });

    function clickCalculate(budgetText) {
        const calculator = new BudgetCalculator();
        const panel = document.createElement('div');
        const actionInputWrap = document.createElement('div');
        actionInputWrap.className = 'maxActionCountInput';
        actionInputWrap.appendChild(document.createElement('input'));
        panel.appendChild(actionInputWrap);
        document.body.appendChild(panel);
        const ui = calculator._createUI(panel);
        panel.appendChild(ui);

        ui.querySelector('input').value = budgetText;
        ui.querySelector('button').click();
    }

    test('affordable units include the coin cost, not just the purchased materials', () => {
        // Per unit: 10 ore * 50 ask = 500 purchased + 300 coin = 800. Budget 8000 -> 10 units.
        // Ignoring coin would give 8000 / 500 = 16 units.
        clickCalculate('8000');

        expect(mocks.setReactInputValue).toHaveBeenCalledWith(expect.anything(), 10);
    });

    test('total spend and per-unit cost in the breakdown include coin', () => {
        clickCalculate('8000');

        const rows = Array.from(document.querySelectorAll('#mwi-budget-modal-overlay tfoot tr'));
        const perUnit = rows[0].lastElementChild.textContent;
        const totalSpend = rows[1].lastElementChild.textContent;

        expect(perUnit).toContain('800');
        expect(totalSpend).toContain('8.0K');
    });

    test('the coin row shows its cost in the Total Cost column', () => {
        clickCalculate('8000');

        const coinRow = Array.from(document.querySelectorAll('#mwi-budget-modal-overlay tbody tr')).find((tr) =>
            tr.textContent.includes('Coin')
        );
        // 10 units * 300 coin = 3000 -> "3.0K"
        expect(coinRow.lastElementChild.textContent).toContain('3.0K');
    });
});
