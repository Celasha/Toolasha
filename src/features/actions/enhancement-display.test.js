// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockCalculateEnhancement } = vi.hoisted(() => ({
    mockCalculateEnhancement: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn(() => false),
        toggleSetting: vi.fn(),
        COLOR_XP_RATE: '#ffffff',
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
        getActionDetails: vi.fn(),
        getPersonalBuffFlatBoost: vi.fn(() => 0),
    },
}));

vi.mock('../../utils/enhancement-config.js', () => ({
    getEnhancingParams: vi.fn(),
}));

vi.mock('../../utils/enhancement-calculator.js', () => ({
    calculateEnhancement: mockCalculateEnhancement,
    BASE_SUCCESS_RATES: [],
}));

vi.mock('../../utils/profit-constants.js', () => ({ MIN_ACTION_TIME_SECONDS: 0.4 }));
vi.mock('../../utils/formatters.js', () => ({
    timeReadable: vi.fn((value) => String(value)),
    formatLargeNumber: vi.fn((value) => String(value)),
}));
vi.mock('../../api/marketplace.js', () => ({ default: { getPrice: vi.fn() } }));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn() }));
vi.mock('./inline-xp-rate.js', () => ({
    renderInlineXpRate: vi.fn(),
    removeInlineXpRate: vi.fn(),
}));

import {
    calculateExpectedEnhancementXp,
    calculateSelectedEnhancementXpPerHour,
    getEnhancementTargetLevelFromUI,
    getSelectedEnhancementLevelFromUI,
} from './enhancement-display.js';

function makePanel({ startLevel = 5, targetLevel = 7, protectFrom = 6 } = {}) {
    const panel = document.createElement('div');
    panel.innerHTML = `
        <div class="SkillActionDetail_primaryItemSelectorContainer__test">
            <span class="Item_name__test">Arcane Crossbow +${startLevel}</span>
        </div>
        <div class="SkillActionDetail_enhancingMaxLevelInputContainer__test">
            <input type="number" value="${targetLevel}">
        </div>
        <div>
            <span>Protect From Level</span>
            <input type="number" value="${protectFrom}">
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

describe('Enhancing inline XP/hour calculation', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mockCalculateEnhancement.mockReset();
    });

    test('reads the live selected enhancement and target levels from the native controls', () => {
        const panel = makePanel({ startLevel: 5, targetLevel: 8 });

        expect(getSelectedEnhancementLevelFromUI(panel)).toBe(5);
        expect(getEnhancementTargetLevelFromUI(panel)).toBe(8);
    });

    test('shares one expected-XP accumulator between inline and detailed calculations', () => {
        const totalXP = calculateExpectedEnhancementXp(
            {
                visitCounts: [0, 0, 0, 0, 0, 2, 2],
                successRates: [{}, {}, {}, {}, {}, { actualRate: 50 }, { actualRate: 50 }],
            },
            7,
            0,
            80
        );

        expect(totalXP).toBeCloseTo(1801.8, 8);
    });

    test('uses expected Markov visits, success/failure XP and current protection settings', () => {
        const panel = makePanel({ startLevel: 5, targetLevel: 7, protectFrom: 6 });
        mockCalculateEnhancement.mockReturnValue({
            attempts: 6,
            visitCounts: [2, 0, 0, 0, 0, 2, 2],
            successRates: [{ actualRate: 50 }, {}, {}, {}, {}, { actualRate: 50 }, { actualRate: 50 }],
        });

        const params = {
            enhancingLevel: 120,
            houseLevel: 8,
            toolBonus: 0,
            speedBonus: 0,
            experienceBonus: 0,
            teas: { blessed: false },
            guzzlingBonus: 1,
        };
        const itemDetails = {
            itemLevel: 80,
            level: 10,
        };

        const xpPerHour = calculateSelectedEnhancementXpPerHour(panel, params, itemDetails, 10);

        expect(mockCalculateEnhancement).toHaveBeenCalledWith(
            expect.objectContaining({
                startLevel: 5,
                targetLevel: 7,
                protectFrom: 6,
                itemLevel: 80,
            })
        );
        // MWI client formula uses itemLevel 80, not the equipment requirement field.
        // A failure can rebuild below the selected +5 start, so +0 visits count too.
        // +0: success 126 / failure 12.6 => 69.3 expected × 2 visits.
        // +5: success 756 / failure 75.6 => 415.8 expected × 2 visits.
        // +6: success 882 / failure 88.2 => 485.1 expected × 2 visits.
        // Total 1,940.4 XP over 60 seconds = 116,424 XP/hour.
        expect(xpPerHour).toBeCloseTo(116424, 8);
    });

    test('returns zero when no enhancement work remains', () => {
        const panel = makePanel({ startLevel: 7, targetLevel: 7 });

        expect(
            calculateSelectedEnhancementXpPerHour(
                panel,
                { experienceBonus: 0, teas: {} },
                { itemLevel: 80, level: 10 },
                10
            )
        ).toBe(0);
        expect(mockCalculateEnhancement).not.toHaveBeenCalled();
    });
});
