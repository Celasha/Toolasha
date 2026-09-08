/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    gameData: {},
}));

vi.mock('./combat-sim-adapter.js', () => ({
    buildGameDataPayload: vi.fn(() => mocks.gameData),
    buildAllPlayerDTOs: vi.fn(),
    parseShykaiImport: vi.fn(),
    applyLoadoutSnapshotToDTO: vi.fn(),
    COMBAT_SHRINE_HRIDS: [],
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getAllSnapshots: vi.fn(() => []),
    },
}));

import { SimEditor } from './sim-editor.js';
import Achievement from './engine/achievement.js';
import { setGameData } from './engine/game-data.js';

// Tier/achievement names and boost values below are arbitrary test fixtures, deliberately
// nonstandard (never Novice/Veteran/Elite/+2%), so tests fail if TLA-046 ever hardcodes real
// tier semantics instead of discovering them from current game data.
const CUSTOM_DAMAGE_TIER = {
    name: 'Blazing Tier',
    buff: {
        uniqueHrid: '/buff_uniques/blazing_tier',
        typeHrid: '/buff_types/damage',
        ratioBoost: 0.07,
        ratioBoostLevelBonus: 0,
        flatBoost: 0,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/combat': true },
};

const CUSTOM_WISDOM_TIER = {
    name: 'Owlkin Tier',
    buff: {
        uniqueHrid: '/buff_uniques/owlkin_tier',
        typeHrid: '/buff_types/wisdom',
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.05,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/combat': true },
};

const NONCOMBAT_TIER = {
    name: 'Farmhand Tier',
    buff: {
        uniqueHrid: '/buff_uniques/farmhand_tier',
        typeHrid: '/buff_types/gathering',
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.03,
        flatBoostLevelBonus: 0,
        duration: 0,
    },
    usableInActionTypeMap: { '/action_types/foraging': true },
};

function gameData() {
    return {
        achievementDetailMap: {
            '/achievements/dmg_a': { tierHrid: '/achievement_tiers/blazing', sortIndex: 0, name: 'Burn 10' },
            '/achievements/dmg_b': { tierHrid: '/achievement_tiers/blazing', sortIndex: 1, name: 'Burn 100' },
            '/achievements/wis_a': { tierHrid: '/achievement_tiers/owlkin', sortIndex: 0, name: 'Learn 1' },
            '/achievements/farm_a': { tierHrid: '/achievement_tiers/farmhand', sortIndex: 0, name: 'Farm 1' },
        },
        achievementTierDetailMap: {
            '/achievement_tiers/blazing': CUSTOM_DAMAGE_TIER,
            '/achievement_tiers/owlkin': CUSTOM_WISDOM_TIER,
            '/achievement_tiers/farmhand': NONCOMBAT_TIER,
        },
    };
}

function minimalDto(characterAchievements = []) {
    return {
        equipment: {},
        abilities: [],
        food: [],
        drinks: [],
        houseRooms: {},
        shrineLevels: {},
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        characterAchievements,
    };
}

function editorWithPlayers(playerAchievements) {
    const editorEl = document.createElement('div');
    const editor = new SimEditor({ editorEl });
    editor._editedDTOs = {};
    editor._originalDTOs = {};
    editor._editedPlayerInfo = [];
    for (const [hrid, achievements] of Object.entries(playerAchievements)) {
        editor._editedDTOs[hrid] = minimalDto(structuredClone(achievements));
        editor._originalDTOs[hrid] = minimalDto(structuredClone(achievements));
        editor._editedPlayerInfo.push({ hrid, name: hrid });
    }
    editor._activeEditPlayer = Object.keys(playerAchievements)[0] || null;
    editor._editorInitialized = true;
    return editor;
}

const FULL_BLAZING = [
    { achievementHrid: '/achievements/dmg_a', isCompleted: true },
    { achievementHrid: '/achievements/dmg_b', isCompleted: true },
];

describe('TLA-046: Combat Simulator Achievement what-if modes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.gameData = gameData();
    });

    test('TLA046-01: Current is the default for a newly loaded player', () => {
        const editor = editorWithPlayers({ player1: [] });
        expect(editor.getAchievementMode('player1')).toBe('current');
    });

    test('TLA046-02: Current resolves the same characterAchievements/buffs as before TLA-046', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING });
        editor.renderEditor();

        const resolved = editor._editedDTOs.player1.characterAchievements;
        expect(resolved).toEqual(FULL_BLAZING);

        setGameData(gameData());
        const achievement = new Achievement(resolved);
        expect(achievement.buffs).toHaveLength(1);
        expect(achievement.buffs[0].typeHrid).toBe('/buff_types/damage');
    });

    test('TLA046-03: None removes Achievement effects only, leaving other DTO state untouched', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING });
        editor._editedDTOs.player1.shrineLevels = { '/guild_shrines/force': 5 };
        editor.setAchievementMode('player1', 'none');

        expect(editor._editedDTOs.player1.characterAchievements).toEqual([]);
        expect(editor._editedDTOs.player1.shrineLevels).toEqual({ '/guild_shrines/force': 5 });
    });

    test('TLA046-04: None never mutates the source baseline', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING });
        editor.setAchievementMode('player1', 'none');

        expect(editor._originalDTOs.player1.characterAchievements).toEqual(FULL_BLAZING);
    });

    test('TLA046-05: Current -> None -> Current round trip is lossless', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING });
        editor.setAchievementMode('player1', 'none');
        editor.setAchievementMode('player1', 'current');

        expect(editor._editedDTOs.player1.characterAchievements).toEqual(FULL_BLAZING);
    });

    test('TLA046-06: first Custom entry seeds from Current, not all-off', () => {
        const editor = editorWithPlayers({ player1: [FULL_BLAZING[0]] }); // only dmg_a completed
        editor.setAchievementMode('player1', 'custom');

        const resolved = editor._editedDTOs.player1.characterAchievements;
        const dmgA = resolved.find((a) => a.achievementHrid === '/achievements/dmg_a');
        const dmgB = resolved.find((a) => a.achievementHrid === '/achievements/dmg_b');
        expect(dmgA.isCompleted).toBe(true);
        expect(dmgB?.isCompleted ?? false).toBe(false);
    });

    test('TLA046-07: completing the final missing member unlocks a tier', () => {
        const editor = editorWithPlayers({ player1: [FULL_BLAZING[0]] }); // dmg_a only
        editor.setAchievementMode('player1', 'custom');
        editor.toggleCustomAchievementCompletion('player1', '/achievements/dmg_b', true);

        setGameData(gameData());
        const achievement = new Achievement(editor._editedDTOs.player1.characterAchievements);
        expect(achievement.buffs.some((b) => b.typeHrid === '/buff_types/damage')).toBe(true);
    });

    test('TLA046-08: partial custom completion does not fake a tier buff', () => {
        const editor = editorWithPlayers({ player1: [] });
        editor.setAchievementMode('player1', 'custom');
        editor.toggleCustomAchievementCompletion('player1', '/achievements/dmg_a', true);
        // dmg_b intentionally left unchecked

        setGameData(gameData());
        const achievement = new Achievement(editor._editedDTOs.player1.characterAchievements);
        expect(achievement.buffs.some((b) => b.typeHrid === '/buff_types/damage')).toBe(false);
    });

    test('TLA046-09: Custom can remove a currently earned tier', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING });
        editor.setAchievementMode('player1', 'custom'); // seeds both dmg_a/dmg_b completed
        editor.toggleCustomAchievementCompletion('player1', '/achievements/dmg_b', false);

        setGameData(gameData());
        const achievement = new Achievement(editor._editedDTOs.player1.characterAchievements);
        expect(achievement.buffs.some((b) => b.typeHrid === '/buff_types/damage')).toBe(false);
    });

    test('TLA046-10: combat-relevant tiers are discovered from data, noncombat tiers excluded', () => {
        const editor = editorWithPlayers({ player1: [] });
        const tiers = editor._getCombatRelevantAchievementTiers(mocks.gameData);
        const tierHrids = tiers.map((t) => t.tierHrid);
        expect(tierHrids).toContain('/achievement_tiers/blazing');
        expect(tierHrids).toContain('/achievement_tiers/owlkin');
        expect(tierHrids).not.toContain('/achievement_tiers/farmhand');
    });

    test('TLA046-11: no hardcoded tier names/boost values - synthetic tier data drives resolution', () => {
        const editor = editorWithPlayers({ player1: [] });
        editor.setAchievementMode('player1', 'custom');
        editor.toggleCustomAchievementCompletion('player1', '/achievements/wis_a', true);

        setGameData(gameData());
        const achievement = new Achievement(editor._editedDTOs.player1.characterAchievements);
        expect(achievement.buffs[0]).toMatchObject({ typeHrid: '/buff_types/wisdom', flatBoost: 0.05 });
    });

    test('TLA046-12: per-player mode isolation', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING, player2: FULL_BLAZING, player3: FULL_BLAZING });
        editor.setAchievementMode('player2', 'none');
        editor.setAchievementMode('player3', 'custom');

        expect(editor.getAchievementMode('player1')).toBe('current');
        expect(editor.getAchievementMode('player2')).toBe('none');
        expect(editor.getAchievementMode('player3')).toBe('custom');
        expect(editor._editedDTOs.player1.characterAchievements).toEqual(FULL_BLAZING);
        expect(editor._editedDTOs.player2.characterAchievements).toEqual([]);
    });

    test('TLA046-13: per-player Custom isolation and restoration across tab switches', () => {
        const editor = editorWithPlayers({ player1: [], player2: [] });
        editor.setAchievementMode('player1', 'custom');
        editor.toggleCustomAchievementCompletion('player1', '/achievements/dmg_a', true);

        editor._activeEditPlayer = 'player2';
        editor.renderEditor();
        expect(editor.getAchievementMode('player2')).toBe('current');

        editor._activeEditPlayer = 'player1';
        editor.renderEditor();
        expect(editor.getAchievementMode('player1')).toBe('custom');
        const resolved = editor._editedDTOs.player1.characterAchievements;
        expect(resolved.find((a) => a.achievementHrid === '/achievements/dmg_a').isCompleted).toBe(true);
    });

    test('TLA046-14: resetting to Current Gear preserves the active Achievement scenario', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING });
        editor.setAchievementMode('player1', 'none');
        editor._editedDTOs.player1.equipment = { '/equipment_types/head': { hrid: '/items/x', enhancementLevel: 5 } };

        editor.applyLoadoutByName('');

        expect(editor.getAchievementMode('player1')).toBe('none');
        expect(editor._editedDTOs.player1.characterAchievements).toEqual([]);
    });

    test('TLA046-14b: the full "Reset to Current" button reapplies every player\'s scenario', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING, player2: FULL_BLAZING });
        editor.setAchievementMode('player1', 'none');
        editor.setAchievementMode('player2', 'custom');
        editor.toggleCustomAchievementCompletion('player2', '/achievements/dmg_a', false);
        editor.renderEditor();

        const resetBtn = editor._editorEl.querySelector('#mwi-csim-reset');
        resetBtn.dispatchEvent(new Event('click'));

        expect(editor._editedDTOs.player1.characterAchievements).toEqual([]);
        expect(
            editor._editedDTOs.player2.characterAchievements.find((a) => a.achievementHrid === '/achievements/dmg_a')
                .isCompleted
        ).toBe(false);
    });

    test('TLA046-15: imported/external DTOs initialize Current from their own supplied evidence', () => {
        const editor = new SimEditor({ editorEl: document.createElement('div') });
        editor.openWithExternalDTO(minimalDto(FULL_BLAZING), 'Imported Player');

        expect(editor.getAchievementMode('player1')).toBe('current');
        expect(editor._editedDTOs.player1.characterAchievements).toEqual(FULL_BLAZING);
    });

    test('TLA046-16: removing a player clears its stale Achievement scenario state', () => {
        const editor = editorWithPlayers({ player1: FULL_BLAZING, player2: FULL_BLAZING });
        editor.setAchievementMode('player1', 'custom');
        editor.renderEditor();

        const removeBtn = editor._editorEl.querySelector('[data-remove-player="player1"]');
        removeBtn.dispatchEvent(new Event('click', { bubbles: true }));

        expect(editor._achievementScenarioByPlayer.has('player1')).toBe(false);
    });

    test('TLA046-17: missing/malformed source evidence stays fail-closed in Current', () => {
        const editor = editorWithPlayers({
            player1: [{ achievementHrid: null, isCompleted: true }, null, undefined],
        });
        expect(editor.getAchievementMode('player1')).toBe('current');
        setGameData(gameData());
        const achievement = new Achievement(editor._editedDTOs.player1.characterAchievements);
        expect(achievement.buffs).toHaveLength(0);
    });

    test('TLA046-17b: Custom never invents an unknown tier/buff for a malformed hrid', () => {
        const editor = editorWithPlayers({
            player1: [{ achievementHrid: '/achievements/unknown', isCompleted: true }],
        });
        editor.setAchievementMode('player1', 'custom');

        const resolved = editor._editedDTOs.player1.characterAchievements;
        expect(resolved.find((a) => a.achievementHrid === '/achievements/unknown')).toEqual({
            achievementHrid: '/achievements/unknown',
            isCompleted: true,
        });
    });

    test('TLA046-18: a non-skilling editor (Combat Sim or Lab Sim combat context) renders the Achievements control', () => {
        const editor = editorWithPlayers({ player1: [] });
        editor.labMode = true; // mirrors lab-sim-ui.js's non-skilling combat SimEditor instantiation
        editor.renderEditor();

        expect(editor._editorEl.querySelector('[data-achievement-mode="current"]')).not.toBeNull();
    });

    test('TLA046-18b: a skilling-mode editor never renders or applies the Achievements control', () => {
        const editorEl = document.createElement('div');
        const editor = new SimEditor({ editorEl, skillingMode: true });
        editor._editedDTOs = { player1: minimalDto(FULL_BLAZING) };
        editor._originalDTOs = { player1: minimalDto(FULL_BLAZING) };
        editor._editedPlayerInfo = [{ hrid: 'player1', name: 'Player 1' }];
        editor._activeEditPlayer = 'player1';
        editor._editorInitialized = true;

        editor.renderEditor();

        expect(editor._editorEl.querySelector('[data-achievement-mode]')).toBeNull();
    });

    test('TLA046-19: changing mode changes what the existing engine resolves, with no parallel result formula', () => {
        const editor = editorWithPlayers({ player1: [] });
        setGameData(gameData());

        expect(new Achievement(editor._editedDTOs.player1.characterAchievements).buffs).toHaveLength(0);

        editor.setAchievementMode('player1', 'custom');
        editor.toggleCustomAchievementCompletion('player1', '/achievements/dmg_a', true);
        editor.toggleCustomAchievementCompletion('player1', '/achievements/dmg_b', true);

        const achievement = new Achievement(editor._editedDTOs.player1.characterAchievements);
        expect(achievement.buffs).toHaveLength(1);
        expect(achievement.buffs[0].ratioBoost).toBeCloseTo(0.07);
    });

    test('Custom UI shows tier completion progress and a checkbox per achievement', () => {
        const editor = editorWithPlayers({ player1: [FULL_BLAZING[0]] });
        editor.setAchievementMode('player1', 'custom');
        editor.renderEditor();

        expect(editor._editorEl.innerHTML).toContain('1 / 2');
        const checkboxes = editor._editorEl.querySelectorAll('[data-achievement-hrid]');
        expect(checkboxes.length).toBeGreaterThanOrEqual(3);
    });

    test('checking an achievement checkbox in the DOM toggles simulated completion', () => {
        const editor = editorWithPlayers({ player1: [] });
        editor.setAchievementMode('player1', 'custom');
        editor.renderEditor();

        const checkbox = editor._editorEl.querySelector('[data-achievement-hrid="/achievements/dmg_a"]');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(
            editor._editedDTOs.player1.characterAchievements.find((a) => a.achievementHrid === '/achievements/dmg_a')
                .isCompleted
        ).toBe(true);
    });
});
