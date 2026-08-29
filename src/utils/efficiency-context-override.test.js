/**
 * Tests for getActionEfficiencyContext's hypothetical-scenario overrides (TLA-024 REOPEN/OPT-28).
 *
 * FAIL D required extending the shared context so a hypothetical scenario (Skilling
 * Optimizer/Simulator) can override equipment/drinks/skill level instead of tea-optimizer.js
 * reconstructing its own parallel global-buff collector. These tests prove: (1) providing
 * overrides never touches the live/saved resolveActionContext() path, and (2) the override path
 * produces byte-for-byte identical output to the live path when both resolve to the same
 * equipment/drinks/level - i.e. the override branch is a genuine parity path, not a second
 * divergent implementation.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    skills: [{ skillHrid: '/skills/milking', level: 20 }],
    personalBuffs: {},
    achievementBuffs: {},
    communityBuffLevel: 0,
    houseRooms: new Map(),
    guildBuffs: {},
    liveEquipment: new Map(),
    liveDrinks: [],
}));

vi.mock('../core/data-manager.js', () => ({
    default: {
        getSkills: vi.fn(() => mocks.skills),
        getEquipment: vi.fn(() => mocks.liveEquipment),
        getHouseRooms: vi.fn(() => mocks.houseRooms),
        getHouseRoomLevel: vi.fn(() => 0),
        getCommunityBuffLevel: vi.fn(() => mocks.communityBuffLevel),
        getAchievementBuffFlatBoost: vi.fn((actionType, buffType) => mocks.achievementBuffs[buffType] || 0),
        getPersonalBuffFlatBoost: vi.fn((actionType, buffType) => mocks.personalBuffs[buffType] || 0),
        getInitClientData: vi.fn(() => ({ itemDetailMap: {} })),
        get characterData() {
            return { guildActionTypeBuffsMap: mocks.guildBuffs };
        },
    },
}));

vi.mock('./action-context.js', () => ({
    resolveActionContext: vi.fn(() => ({
        equipment: mocks.liveEquipment,
        drinks: mocks.liveDrinks,
        source: 'current',
        loadoutSelection: null,
    })),
}));

const { getActionEfficiencyContext } = await import('./efficiency.js');
const { resolveActionContext } = await import('./action-context.js');

const MILKING_TEA = '/items/milking_tea';
const itemDetailMap = {
    [MILKING_TEA]: {
        name: 'Milking Tea',
        consumableDetail: { buffs: [{ typeHrid: '/buff_types/milking_level', flatBoost: 3 }] },
    },
};

const actionDetails = {
    type: '/action_types/milking',
    baseTimeCost: 10e9,
    levelRequirement: { level: 5, skillHrid: '/skills/milking' },
};

describe('getActionEfficiencyContext hypothetical overrides', () => {
    beforeEach(() => {
        mocks.skills = [{ skillHrid: '/skills/milking', level: 20 }];
        mocks.personalBuffs = { '/buff_types/efficiency': 0.05 };
        mocks.achievementBuffs = {};
        mocks.communityBuffLevel = 0;
        mocks.houseRooms = new Map();
        mocks.guildBuffs = {};
        mocks.liveEquipment = new Map();
        mocks.liveDrinks = [];
        vi.clearAllMocks();
    });

    test('providing equipment/drinks overrides never calls the live/saved resolveActionContext()', () => {
        getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            equipmentOverride: new Map(),
            drinksOverride: [{ itemHrid: MILKING_TEA }],
            skillLevelOverride: 10,
        });

        expect(resolveActionContext).not.toHaveBeenCalled();
    });

    test('omitting overrides resolves through the live/saved resolveActionContext() as before', () => {
        mocks.liveDrinks = [{ itemHrid: MILKING_TEA }];

        getActionEfficiencyContext(actionDetails, { isProduction: false, gameData: { itemDetailMap } });

        expect(resolveActionContext).toHaveBeenCalledWith(actionDetails.type);
    });

    test('the override path is a genuine parity path: identical equipment/drinks/level produce byte-for-byte identical output to the live path', () => {
        const sharedEquipment = new Map();
        const sharedDrinks = [{ itemHrid: MILKING_TEA }];
        const sharedLevel = 12;

        // Live path: resolveActionContext() resolves to this exact equipment/drinks, and
        // getSkills() reports this exact level for the skill.
        mocks.liveEquipment = sharedEquipment;
        mocks.liveDrinks = sharedDrinks;
        mocks.skills = [{ skillHrid: '/skills/milking', level: sharedLevel }];
        const viaLive = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
        });

        // Override path: the exact same equipment/drinks/level supplied explicitly instead.
        const viaOverride = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            equipmentOverride: sharedEquipment,
            drinksOverride: sharedDrinks,
            skillLevelOverride: sharedLevel,
        });

        expect(viaOverride.efficiencyBreakdown).toEqual(viaLive.efficiencyBreakdown);
        expect(viaOverride.efficiencyMultiplier).toBe(viaLive.efficiencyMultiplier);
        expect(viaOverride.actionTime).toBe(viaLive.actionTime);
        expect(viaOverride.teaSkillLevelBonus).toBe(viaLive.teaSkillLevelBonus);
        expect(viaOverride.houseEfficiency).toBe(viaLive.houseEfficiency);
        expect(viaOverride.personalEfficiency).toBe(viaLive.personalEfficiency);
        expect(viaOverride.guildEfficiency).toBe(viaLive.guildEfficiency);
    });

    test('Force (guild efficiency) and Tempo (guild speed) apply through the override path exactly as they do live', () => {
        mocks.guildBuffs = {
            '/action_types/milking': [
                { typeHrid: '/buff_types/efficiency', flatBoost: 0.5 },
                { typeHrid: '/buff_types/action_speed', flatBoost: 1.0 },
            ],
        };

        const result = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            equipmentOverride: new Map(),
            drinksOverride: [],
            skillLevelOverride: 10,
        });

        expect(result.guildEfficiency).toBe(50);
        expect(result.guildSpeedBonus).toBe(1.0);
    });

    test('skillLevelOverride is used instead of the live character skill level', () => {
        mocks.skills = [{ skillHrid: '/skills/milking', level: 99 }];

        const result = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            equipmentOverride: new Map(),
            drinksOverride: [],
            skillLevelOverride: 7,
        });

        expect(result.skillLevel).toBe(7);
    });
});

describe('getActionEfficiencyContext live actionContextOverride (TLA-027)', () => {
    beforeEach(() => {
        mocks.skills = [{ skillHrid: '/skills/milking', level: 20 }];
        mocks.personalBuffs = { '/buff_types/efficiency': 0.05 };
        mocks.liveEquipment = new Map([['/item_locations/tool', { itemHrid: '/items/live_tool' }]]);
        mocks.liveDrinks = [{ itemHrid: '/items/live_tea' }];
        vi.clearAllMocks();
    });

    test('an explicit actionContextOverride never calls the live/saved resolveActionContext()', () => {
        const liveContext = {
            equipment: new Map([['/item_locations/tool', { itemHrid: '/items/current_tool' }]]),
            drinks: [{ itemHrid: MILKING_TEA }],
        };

        getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            actionContextOverride: liveContext,
        });

        expect(resolveActionContext).not.toHaveBeenCalled();
    });

    test('an explicit actionContextOverride never mixes with the live path - equipment and drinks come from one atomic object', () => {
        const liveContext = {
            equipment: new Map([['/item_locations/tool', { itemHrid: '/items/current_tool' }]]),
            drinks: [{ itemHrid: MILKING_TEA }],
        };
        // Live path would otherwise resolve to totally different equipment/drinks.
        mocks.liveEquipment = new Map([['/item_locations/tool', { itemHrid: '/items/other_tool' }]]);
        mocks.liveDrinks = [];

        const result = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            actionContextOverride: liveContext,
        });

        expect(result.equipment).toBe(liveContext.equipment);
        // teaSkillLevelBonus only nonzero if the tea in liveContext.drinks was actually used.
        expect(result.teaSkillLevelBonus).toBe(3);
    });

    test('actionContextOverride takes priority over a hypothetical equipmentOverride/drinksOverride pairing', () => {
        const liveContext = {
            equipment: new Map([['/item_locations/tool', { itemHrid: '/items/current_tool' }]]),
            drinks: [],
        };
        const hypotheticalEquipment = new Map([['/item_locations/tool', { itemHrid: '/items/hypothetical_tool' }]]);

        const result = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            actionContextOverride: liveContext,
            equipmentOverride: hypotheticalEquipment,
            drinksOverride: [{ itemHrid: MILKING_TEA }],
        });

        expect(result.equipment).toBe(liveContext.equipment);
        expect(result.teaSkillLevelBonus).toBe(0); // liveContext.drinks is empty, not the hypothetical tea
    });

    test('actionContextOverride is a genuine parity path: identical equipment/drinks produce byte-for-byte identical output to the live path', () => {
        const sharedEquipment = new Map();
        const sharedDrinks = [{ itemHrid: MILKING_TEA }];

        mocks.liveEquipment = sharedEquipment;
        mocks.liveDrinks = sharedDrinks;
        const viaLive = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
        });

        const viaOverride = getActionEfficiencyContext(actionDetails, {
            isProduction: false,
            gameData: { itemDetailMap },
            actionContextOverride: { equipment: sharedEquipment, drinks: sharedDrinks },
        });

        expect(viaOverride.efficiencyBreakdown).toEqual(viaLive.efficiencyBreakdown);
        expect(viaOverride.actionTime).toBe(viaLive.actionTime);
        expect(viaOverride.teaSkillLevelBonus).toBe(viaLive.teaSkillLevelBonus);
    });
});
