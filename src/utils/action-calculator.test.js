/**
 * Tests for calculateActionStats' actionContext option (TLA-027).
 *
 * The Current Action Bar needs equipment and drinks to come from one atomic snapshot. Before
 * this fix, calculateActionStats accepted an `equipment` option but always independently
 * re-resolved drinks via resolveActionContext(actionDetails.type) - so a caller passing live
 * current equipment could still get saved-loadout drinks mixed in. actionContext closes that gap:
 * when supplied, both equipment and drinks come from the same object and resolveActionContext is
 * never called.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/data-manager.js', () => ({
    default: {
        getPersonalBuffFlatBoost: vi.fn(() => 0),
        getAchievementBuffFlatBoost: vi.fn(() => 0),
        getCommunityBuffLevel: vi.fn(() => 0),
        isTaskAction: vi.fn(() => false),
        getTaskSpeedBonus: vi.fn(() => 0),
        characterData: { guildActionTypeBuffsMap: {} },
    },
}));

vi.mock('./equipment-parser.js', () => ({
    parseEquipmentSpeedBonuses: vi.fn(() => 0),
    parseEquipmentEfficiencyBonuses: vi.fn(() => 0),
}));

vi.mock('./tea-parser.js', () => ({
    parseTeaEfficiency: vi.fn(() => 0),
    parseTeaEfficiencyBreakdown: vi.fn(() => []),
    getDrinkConcentration: vi.fn(() => 0),
    parseActionLevelBonus: vi.fn(() => 0),
    parseActionLevelBonusBreakdown: vi.fn(() => ({})),
    parseTeaSkillLevelBonus: vi.fn(() => 0),
}));

vi.mock('./house-efficiency.js', () => ({
    calculateHouseEfficiency: vi.fn(() => 0),
}));

const resolveActionContextMock = vi.fn(() => ({
    equipment: 'PREDICTION_EQUIPMENT',
    drinks: 'PREDICTION_DRINKS',
    source: 'saved-loadout',
}));
vi.mock('./action-context.js', () => ({
    resolveActionContext: resolveActionContextMock,
}));

const { calculateActionStats } = await import('./action-calculator.js');
const { parseEquipmentSpeedBonuses, parseEquipmentEfficiencyBonuses } = await import('./equipment-parser.js');
const { parseTeaEfficiency, getDrinkConcentration } = await import('./tea-parser.js');

const actionDetails = {
    type: '/action_types/woodcutting',
    baseTimeCost: 20e9,
    levelRequirement: { level: 1 },
};

describe('calculateActionStats actionContext atomicity (TLA-027)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveActionContextMock.mockReturnValue({
            equipment: 'PREDICTION_EQUIPMENT',
            drinks: 'PREDICTION_DRINKS',
            source: 'saved-loadout',
        });
    });

    test('an explicit actionContext supplies both equipment and drinks atomically, without resolving the predictive context', () => {
        const liveContext = { equipment: 'CURRENT_EQUIPMENT', drinks: 'CURRENT_DRINKS' };

        calculateActionStats(actionDetails, {
            skills: [],
            equipment: 'IGNORED_LEGACY_EQUIPMENT_OPTION',
            actionContext: liveContext,
            itemDetailMap: {},
        });

        expect(resolveActionContextMock).not.toHaveBeenCalled();
        expect(parseEquipmentSpeedBonuses).toHaveBeenCalledWith('CURRENT_EQUIPMENT', actionDetails.type, {});
        expect(getDrinkConcentration).toHaveBeenCalledWith('CURRENT_EQUIPMENT', {});
        expect(parseTeaEfficiency).toHaveBeenCalledWith(actionDetails.type, 'CURRENT_DRINKS', {}, 0);
    });

    test('actionContext.equipment overrides the legacy equipment option rather than merging with it', () => {
        // Guards against a regression where equipment came from actionContext but some other
        // computation still read the legacy `equipment` option, producing a mixed context.
        calculateActionStats(actionDetails, {
            skills: [],
            equipment: 'LEGACY_OPTION',
            actionContext: { equipment: 'CONTEXT_EQUIPMENT', drinks: [] },
            itemDetailMap: {},
        });

        expect(parseEquipmentEfficiencyBonuses).toHaveBeenCalledWith('CONTEXT_EQUIPMENT', actionDetails.type, {});
        expect(parseEquipmentEfficiencyBonuses).not.toHaveBeenCalledWith(
            'LEGACY_OPTION',
            expect.anything(),
            expect.anything()
        );
    });

    test('omitting actionContext preserves legacy behavior: equipment option is used, drinks resolve through resolveActionContext', () => {
        calculateActionStats(actionDetails, {
            skills: [],
            equipment: 'LEGACY_EQUIPMENT',
            itemDetailMap: {},
        });

        expect(resolveActionContextMock).toHaveBeenCalledWith(actionDetails.type);
        expect(parseEquipmentSpeedBonuses).toHaveBeenCalledWith('LEGACY_EQUIPMENT', actionDetails.type, {});
        expect(parseTeaEfficiency).toHaveBeenCalledWith(actionDetails.type, 'PREDICTION_DRINKS', {}, 0);
    });

    test('never mixes actionContext equipment with the predictive resolveActionContext drinks or vice versa', () => {
        const liveContext = { equipment: 'CURRENT_EQUIPMENT', drinks: 'CURRENT_DRINKS' };

        calculateActionStats(actionDetails, {
            skills: [],
            actionContext: liveContext,
            itemDetailMap: {},
        });

        // resolveActionContext must never be consulted at all once actionContext is supplied -
        // there is no code path left that could pull in the saved-loadout drinks.
        expect(resolveActionContextMock).not.toHaveBeenCalled();
    });
});
