// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetItemPrice, mockComputeBestCraftingPlan, mockCalculateMaterialRequirements } = vi.hoisted(() => ({
    mockGetItemPrice: vi.fn(),
    mockComputeBestCraftingPlan: vi.fn(),
    mockCalculateMaterialRequirements: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => null) },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => vi.fn()) },
}));

vi.mock('../../utils/action-panel-helper.js', () => ({
    findActionInput: vi.fn(),
    attachInputListeners: vi.fn(),
    performInitialUpdate: vi.fn(),
}));

vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: mockCalculateMaterialRequirements,
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: mockGetItemPrice,
    formatPrice: vi.fn((value) => String(value)),
}));

vi.mock('../../features/crafting-plan/crafting-plan-calculator.js', () => ({
    computeBestCraftingPlan: mockComputeBestCraftingPlan,
}));

vi.mock('../../utils/game-lookups.js', () => ({
    getActionHridFromName: vi.fn(),
}));

import { buildBlock, renderBlock } from './cost-summary.js';

function readRows(block) {
    return Array.from(block.children)
        .slice(1)
        .map((row) => Array.from(row.children).map((child) => child.textContent));
}

describe('cost-summary', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mockGetItemPrice.mockReset();
        mockComputeBestCraftingPlan.mockReset();
        mockCalculateMaterialRequirements.mockReset();
    });

    test('uses Ask purchase prices for direct, missing, plan and finished-item comparisons', () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/cheese', required: 10, missing: 4, isTradeable: true },
            { itemHrid: '/items/log', required: 2, missing: 1, isTradeable: true },
        ]);
        mockGetItemPrice.mockImplementation((itemHrid) => {
            if (itemHrid === '/items/cheese') return 5;
            if (itemHrid === '/items/log') return 10;
            if (itemHrid === '/items/sword') return 100;
            return null;
        });
        mockComputeBestCraftingPlan.mockReturnValue({ totalCost: 55 });

        const block = buildBlock('/actions/crafting/sword', 1, '/items/sword', 3);

        expect(mockGetItemPrice).toHaveBeenNthCalledWith(1, '/items/cheese', { mode: 'ask', side: 'buy' });
        expect(mockGetItemPrice).toHaveBeenNthCalledWith(2, '/items/log', { mode: 'ask', side: 'buy' });
        expect(mockGetItemPrice).toHaveBeenNthCalledWith(3, '/items/sword', { mode: 'ask', side: 'buy' });
        expect(mockComputeBestCraftingPlan).toHaveBeenCalledWith('/items/sword', 3, 'ask');
        expect(readRows(block)).toEqual([
            ['Direct recipe cost', '70'],
            ['Missing direct mats', '30'],
            ['Best crafting plan', '55'],
            ['Finished item market', '300'],
        ]);
    });

    test('counts Coin at its fixed value and marks other non-tradeable materials as partial', () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/coin', required: 5000, missing: 2000, isTradeable: false },
            { itemHrid: '/items/task_crystal', required: 2, missing: 1, isTradeable: false },
        ]);
        mockComputeBestCraftingPlan.mockReturnValue(null);
        mockGetItemPrice.mockReturnValue(null);

        const block = buildBlock('/actions/tailoring/small_pouch', 1, null, 0);

        expect(readRows(block)[0]).toEqual(['Direct recipe cost', '5000*']);
        expect(readRows(block)[1]).toEqual(['Missing direct mats', '2000*']);
        expect(mockGetItemPrice).not.toHaveBeenCalledWith('/items/coin', expect.anything());
        expect(mockGetItemPrice).not.toHaveBeenCalledWith('/items/task_crystal', expect.anything());
    });

    test('renders only the compact four-line summary with no pricing footer or separator', () => {
        const block = renderBlock({
            directCost: 10,
            directComplete: true,
            missingCost: 5,
            missingComplete: true,
            planCost: 8,
            marketCost: 12,
        });

        expect(block.textContent).not.toContain('Pricing:');
        expect(block.textContent).not.toContain('Buy:');
        expect(block.children).toHaveLength(5);
        expect(block.querySelector('hr')).toBeNull();
    });

    test('shows a real zero when no missing materials need to be purchased', () => {
        const block = renderBlock({
            directCost: 10,
            directComplete: true,
            missingCost: 0,
            missingComplete: true,
            planCost: 8,
            marketCost: 12,
        });

        expect(readRows(block)[1]).toEqual(['Missing direct mats', '0']);
    });

    test('marks incomplete Ask data as partial without pretending a bid price is available', () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/unpriced', required: 2, missing: 1, isTradeable: true },
        ]);
        mockGetItemPrice.mockReturnValue(null);
        mockComputeBestCraftingPlan.mockReturnValue(null);

        const block = buildBlock('/actions/crafting/test', 1, '/items/output', 1);
        const rows = readRows(block);

        expect(rows[0]).toEqual(['Direct recipe cost', '—']);
        expect(rows[1]).toEqual(['Missing direct mats', '—']);
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/unpriced', { mode: 'ask', side: 'buy' });
        expect(mockGetItemPrice).toHaveBeenCalledWith('/items/output', { mode: 'ask', side: 'buy' });
    });
});
