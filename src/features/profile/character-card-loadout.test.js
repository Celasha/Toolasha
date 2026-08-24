/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    snapshot: null,
    characterData: null,
    buildCharacterSheetLink: vi.fn(() => 'https://example.invalid/card'),
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        get characterData() {
            return mocks.characterData;
        },
        getInitClientData: vi.fn(() => ({})),
    },
}));

vi.mock('../../core/loadout-state.js', () => ({
    default: {
        getUsableSnapshotByName: vi.fn(() => mocks.snapshot),
    },
}));

vi.mock('./character-sheet.js', () => ({
    buildCharacterSheetLink: (...args) => mocks.buildCharacterSheetLink(...args),
}));

vi.mock('./score-calculator.js', () => ({
    calculateCombatScore: vi.fn(async () => ({ total: 123 })),
}));

import { handleViewCardFromSnapshot } from './character-card-button.js';

beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
    mocks.characterData = {
        characterItems: [],
        characterAbilities: [
            { abilityHrid: '/abilities/currently_equipped', level: 9 },
            { abilityHrid: '/abilities/saved_but_not_equipped', level: 17 },
        ],
        combatUnit: {
            combatAbilities: [{ abilityHrid: '/abilities/currently_equipped', level: 9 }],
        },
    };
    mocks.snapshot = {
        name: 'Saved Combat',
        equipment: [
            {
                itemLocationHrid: '/item_locations/main_hand',
                itemHrid: '/items/sword',
                enhancementLevel: 10,
                isAvailable: true,
            },
        ],
        abilities: [{ abilityHrid: '/abilities/saved_but_not_equipped', slot: 2 }],
        food: [],
        drinks: [],
    };
});

describe('Character Card saved-loadout parity', () => {
    test('uses canonical resolved equipment and all learned ability levels', async () => {
        await handleViewCardFromSnapshot('Saved Combat');

        expect(mocks.buildCharacterSheetLink).toHaveBeenCalledTimes(1);
        const syntheticCharacterData = mocks.buildCharacterSheetLink.mock.calls[0][2];

        expect(syntheticCharacterData.wearableItemMap['/item_locations/main_hand']).toMatchObject({
            itemHrid: '/items/sword',
            enhancementLevel: 10,
        });
        expect(syntheticCharacterData.equippedAbilities).toEqual([
            { abilityHrid: '/abilities/saved_but_not_equipped', level: 17 },
        ]);
        expect(window.open).toHaveBeenCalledWith('https://example.invalid/card', '_blank');
    });
    test('fails closed instead of coercing an unresolved saved enhancement to +0', async () => {
        mocks.snapshot.equipment[0].enhancementLevel = null;

        await handleViewCardFromSnapshot('Saved Combat');

        expect(mocks.buildCharacterSheetLink).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
    });
});
