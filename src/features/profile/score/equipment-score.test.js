import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    itemDetailMap: {},
    resolveEquipmentItemCost: vi.fn(),
    classifyEquipmentItem: vi.fn(),
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => ({ itemDetailMap: mocks.itemDetailMap })) },
}));

vi.mock('./equipment-resolver.js', () => ({ resolveEquipmentItemCost: mocks.resolveEquipmentItemCost }));
vi.mock('./equipment-classifier.js', () => ({ classifyEquipmentItem: mocks.classifyEquipmentItem }));

import { calculateEquipmentScore } from './equipment-score.js';

const resolveEquipmentItemCost = mocks.resolveEquipmentItemCost;
const classifyEquipmentItem = mocks.classifyEquipmentItem;

function resetMocks() {
    mocks.itemDetailMap = {};
    resolveEquipmentItemCost.mockReset();
    classifyEquipmentItem.mockReset();
}

describe('calculateEquipmentScore - value-once-fan-out (TLA-041 / PB-19, PB-20)', () => {
    beforeEach(resetMocks);

    test('same itemHrid+level equipped in two slots, classified both combat+skiller, is priced exactly once and contributes to both totals', async () => {
        mocks.itemDetailMap['/items/ring'] = { name: 'Ring', equipmentDetail: {} };
        resolveEquipmentItemCost.mockResolvedValue({ cost: 10_000_000, complete: true });
        classifyEquipmentItem.mockReturnValue({ combat: true, skiller: true });

        const profileData = {
            profile: {
                wearableItemMap: {
                    '/item_locations/ring1': { itemHrid: '/items/ring', enhancementLevel: 3 },
                    '/item_locations/ring2': { itemHrid: '/items/ring', enhancementLevel: 3 },
                },
            },
        };

        const result = await calculateEquipmentScore(profileData, {});

        expect(resolveEquipmentItemCost).toHaveBeenCalledTimes(1); // priced once, not twice
        expect(result.combat.score).toBeCloseTo(10);
        expect(result.skiller.score).toBeCloseTo(10); // same computed cost fans into both (PB-19)
    });

    test('combat-only and skiller-only items each contribute to only their own domain', async () => {
        mocks.itemDetailMap['/items/sword'] = { name: 'Sword', equipmentDetail: {} };
        mocks.itemDetailMap['/items/hoe'] = { name: 'Hoe', equipmentDetail: {} };
        resolveEquipmentItemCost.mockImplementation((itemHrid) =>
            Promise.resolve(
                itemHrid === '/items/sword' ? { cost: 5_000_000, complete: true } : { cost: 2_000_000, complete: true }
            )
        );
        classifyEquipmentItem.mockImplementation((equipmentDetail) =>
            equipmentDetail === mocks.itemDetailMap['/items/sword'].equipmentDetail
                ? { combat: true, skiller: false }
                : { combat: false, skiller: true }
        );

        const profileData = {
            profile: {
                wearableItemMap: {
                    '/item_locations/main_hand': { itemHrid: '/items/sword', enhancementLevel: 0 },
                    '/item_locations/tool': { itemHrid: '/items/hoe', enhancementLevel: 0 },
                },
            },
        };

        const result = await calculateEquipmentScore(profileData, {});
        expect(result.combat.score).toBeCloseTo(5);
        expect(result.skiller.score).toBeCloseTo(2);
    });

    test('two different itemHrids are each priced once (dedup key is itemHrid+level, not just level)', async () => {
        mocks.itemDetailMap['/items/a'] = { name: 'A', equipmentDetail: {} };
        mocks.itemDetailMap['/items/b'] = { name: 'B', equipmentDetail: {} };
        resolveEquipmentItemCost.mockResolvedValue({ cost: 1_000_000, complete: true });
        classifyEquipmentItem.mockReturnValue({ combat: true, skiller: false });

        const profileData = {
            profile: {
                wearableItemMap: {
                    slotA: { itemHrid: '/items/a', enhancementLevel: 0 },
                    slotB: { itemHrid: '/items/b', enhancementLevel: 0 },
                },
            },
        };

        await calculateEquipmentScore(profileData, {});
        expect(resolveEquipmentItemCost).toHaveBeenCalledTimes(2);
    });

    test('an incomplete leaf marks its category incomplete without discarding priced leaves', async () => {
        mocks.itemDetailMap['/items/priced'] = { name: 'Priced', equipmentDetail: {} };
        mocks.itemDetailMap['/items/unpriced'] = { name: 'Unpriced', equipmentDetail: {} };
        resolveEquipmentItemCost.mockImplementation((itemHrid) =>
            Promise.resolve(
                itemHrid === '/items/priced' ? { cost: 3_000_000, complete: true } : { cost: null, complete: false }
            )
        );
        classifyEquipmentItem.mockReturnValue({ combat: true, skiller: false });

        const profileData = {
            profile: {
                wearableItemMap: {
                    slotA: { itemHrid: '/items/priced', enhancementLevel: 0 },
                    slotB: { itemHrid: '/items/unpriced', enhancementLevel: 0 },
                },
            },
        };

        const result = await calculateEquipmentScore(profileData, {});
        expect(result.combat.complete).toBe(false);
        expect(result.combat.score).toBeCloseTo(3);
    });
});

describe('calculateEquipmentScore - TLA-041E: one shared acquisition context per Score generation', () => {
    beforeEach(resetMocks);

    test('every equipped item is resolved with the SAME acquisition context object (TLA041E-27/28/30)', async () => {
        mocks.itemDetailMap['/items/a'] = { name: 'A', equipmentDetail: {} };
        mocks.itemDetailMap['/items/b'] = { name: 'B', equipmentDetail: {} };
        resolveEquipmentItemCost.mockResolvedValue({ cost: 1_000_000, complete: true });
        classifyEquipmentItem.mockReturnValue({ combat: true, skiller: false });

        const profileData = {
            profile: {
                wearableItemMap: {
                    slotA: { itemHrid: '/items/a', enhancementLevel: 0 },
                    slotB: { itemHrid: '/items/b', enhancementLevel: 0 },
                },
            },
        };

        await calculateEquipmentScore(profileData, {});

        expect(resolveEquipmentItemCost).toHaveBeenCalledTimes(2);
        const contextA = resolveEquipmentItemCost.mock.calls[0][4];
        const contextB = resolveEquipmentItemCost.mock.calls[1][4];
        expect(contextA).toBeDefined();
        expect(contextA).toBe(contextB); // one context shared across every item this generation
    });

    test('two separate calculateEquipmentScore calls (two Score generations) each get their own fresh context', async () => {
        mocks.itemDetailMap['/items/a'] = { name: 'A', equipmentDetail: {} };
        resolveEquipmentItemCost.mockResolvedValue({ cost: 1_000_000, complete: true });
        classifyEquipmentItem.mockReturnValue({ combat: true, skiller: false });

        const profileData = {
            profile: { wearableItemMap: { slotA: { itemHrid: '/items/a', enhancementLevel: 0 } } },
        };

        await calculateEquipmentScore(profileData, {});
        await calculateEquipmentScore(profileData, {});

        const firstContext = resolveEquipmentItemCost.mock.calls[0][4];
        const secondContext = resolveEquipmentItemCost.mock.calls[1][4];
        expect(firstContext).not.toBe(secondContext);
    });
});

describe('calculateEquipmentScore - hidden equipment (PB-48, PB-49)', () => {
    beforeEach(resetMocks);

    test('hidden with no wearable payload yields a lower-bound result, not a deceptively exact 0', async () => {
        const profileData = { profile: { hideWearableItems: true, wearableItemMap: {} } };
        const result = await calculateEquipmentScore(profileData, {});
        expect(result.hasEquipmentData).toBe(false);
        expect(result.combat.complete).toBe(false);
        expect(result.skiller.complete).toBe(false);
        expect(result.combat.score).toBe(0);
    });

    test('hidden flag does not force partial when the payload actually contains wearable data (party member case)', async () => {
        mocks.itemDetailMap['/items/ring'] = { name: 'Ring', equipmentDetail: {} };
        resolveEquipmentItemCost.mockResolvedValue({ cost: 1_000_000, complete: true });
        classifyEquipmentItem.mockReturnValue({ combat: true, skiller: false });

        const profileData = {
            profile: {
                hideWearableItems: true,
                wearableItemMap: { slot: { itemHrid: '/items/ring', enhancementLevel: 0 } },
            },
        };

        const result = await calculateEquipmentScore(profileData, {});
        expect(result.hasEquipmentData).toBe(true);
        expect(result.combat.complete).toBe(true);
        expect(result.combat.score).toBeCloseTo(1);
    });
});
