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
        },
    };
});

vi.mock('../../core/data-manager.js', () => ({ default: fakeDataManager }));
vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_LOSS: '#f00',
        COLOR_PROFIT: '#0f0',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => vi.fn()) } }));
vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: mockCalculateMaterialRequirements,
    isArtisanTeaOutOfStock: vi.fn(() => false),
}));
vi.mock('../../utils/action-panel-helper.js', async () => {
    const actual = await vi.importActual('../../utils/action-panel-helper.js');
    return actual;
});
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn(() => '/actions/crafting/sword') }));
vi.mock('../../utils/formatters.js', () => ({
    numberFormatter: vi.fn((value) => new Intl.NumberFormat('en-US').format(value)),
}));

import requiredMaterials, { formatRequiredMaterialStatus } from './required-materials.js';

describe('formatRequiredMaterialStatus', () => {
    test('shows the queued reservation once and keeps Missing compact', () => {
        expect(
            formatRequiredMaterialStatus({
                required: 1800,
                queued: 3496,
                missing: 2,
            })
        ).toBe("Required: 1,800 (3,496 Q'd) | Missing: 2");
    });

    test('omits queue and Missing parts when they are not applicable', () => {
        expect(formatRequiredMaterialStatus({ required: 900, queued: 0, missing: 0 })).toBe('Required: 900');
    });
});

function buildPanel(inputValue) {
    document.body.innerHTML = `
        <div class="SkillActionDetail_skillActionDetail_abc">
            <div class="SkillActionDetail_name_xyz">Craft Sword</div>
            <div class="maxActionCountInput_123"><input value="${inputValue}" /></div>
            <div class="SkillActionDetail_itemRequirements_1">
                <span class="inputCount_1"></span>
                <div class="target-1"></div>
            </div>
        </div>
    `;
    return document.querySelector('.SkillActionDetail_skillActionDetail_abc');
}

describe('required-materials — queue-change refresh', () => {
    beforeEach(() => {
        mockCalculateMaterialRequirements.mockReset();
    });

    afterEach(() => {
        requiredMaterials.cleanup();
        document.body.innerHTML = '';
    });

    test("Q'd / Missing text refreshes when the finite action queue changes", () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/log', required: 100, queued: 0, missing: 0 },
        ]);

        buildPanel('5');
        requiredMaterials.initialize();

        let display = document.querySelector('.mwi-required-materials');
        expect(display.textContent).toBe('Required: 100');

        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/log', required: 100, queued: 60, missing: 40 },
        ]);
        fakeDataManager.emit('actions_updated', { endCharacterActions: [] });

        display = document.querySelector('.mwi-required-materials');
        expect(display.textContent).toBe("Required: 100 (60 Q'd) | Missing: 40");
    });

    test('initialize -> cleanup -> initialize registers exactly one actions_updated listener', () => {
        mockCalculateMaterialRequirements.mockReturnValue([
            { itemHrid: '/items/log', required: 100, queued: 0, missing: 0 },
        ]);

        buildPanel('5');
        requiredMaterials.initialize();
        requiredMaterials.cleanup();
        buildPanel('5');
        requiredMaterials.initialize();

        expect(fakeDataManager.listenerCount('actions_updated')).toBe(1);
    });
});
