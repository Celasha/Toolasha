// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getInitClientData: vi.fn(),
    calculateMaterialRequirements: vi.fn(),
    getItemPriceOutlierInfo: vi.fn(),
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
vi.mock('../../utils/react-input.js', () => ({ setReactInputValue: vi.fn() }));
vi.mock('../../utils/game-lookups.js', () => ({
    getActionHridFromName: vi.fn(),
    getActionHridFromFiber: vi.fn(() => '/actions/crafting/make_widget'),
}));
vi.mock('./production-tools-layout.js', () => ({
    getOrCreateProductionToolsBlock: vi.fn(() => null),
    normalizeProductionToolsBlock: vi.fn(),
}));

import { BudgetCalculator } from './budget-calculator.js';

const ACTION_HRID = '/actions/crafting/make_widget';
const MAT_HRID = '/items/ore';

function gameData() {
    return {
        actionDetailMap: {
            [ACTION_HRID]: { type: '/action_types/crafting', inputItems: [{ itemHrid: MAT_HRID, count: 1 }] },
        },
        itemDetailMap: { [MAT_HRID]: { isTradable: true } },
    };
}

function materialsForN(n, missingPerUnit = 10) {
    return [
        {
            itemHrid: MAT_HRID,
            itemName: 'Ore',
            isTradeable: true,
            required: n * missingPerUnit,
            have: 0,
            missing: n * missingPerUnit,
        },
    ];
}

describe('BudgetCalculator - outlier guard propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        mocks.getInitClientData.mockReturnValue(gameData());
        mocks.calculateMaterialRequirements.mockImplementation((_hrid, n) => materialsForN(n));
    });

    function clickCalculate(budgetText) {
        const calculator = new BudgetCalculator();
        const panel = document.createElement('div');
        document.body.appendChild(panel);
        const ui = calculator._createUI(panel);
        panel.appendChild(ui);

        const input = ui.querySelector('input');
        const calcBtn = ui.querySelector('button');
        input.value = budgetText;
        calcBtn.click();

        return { calculator, panel };
    }

    test('an outlier ask price is clamped before it skews the binary-searched affordable unit count', () => {
        // Raw/unclamped would be 1000/unit -> only 1 unit affordable at budget 2000 for 10 missing/unit.
        // Clamped (outlier-guarded) value is 50/unit -> affordable units should reflect the clamped price.
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: true });

        clickCalculate('2000');

        // 10 missing/unit * 50/unit = 500/unit cost -> budget 2000 affords 4 units.
        const overlay = document.getElementById('mwi-budget-modal-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.textContent).toContain('4');
    });

    test('shows the outlier warning icon on the Ask Price cell when a material price was substituted', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: true });

        clickCalculate('2000');

        const overlay = document.getElementById('mwi-budget-modal-overlay');
        expect(overlay.innerHTML).toContain('⚠');
    });

    test('does not show the outlier warning icon when no material price was substituted', () => {
        mocks.getItemPriceOutlierInfo.mockReturnValue({ value: 50, isOutlier: false });

        clickCalculate('2000');

        const overlay = document.getElementById('mwi-budget-modal-overlay');
        expect(overlay.innerHTML).not.toContain('⚠');
    });
});
