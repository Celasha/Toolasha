import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({ default: { Z_FLOATING_PANEL: 1000 } }));
vi.mock('../../core/storage.js', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../core/i18n.js', () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('../../utils/panel-z-index.js', () => ({
    registerFloatingPanel: vi.fn(),
    unregisterFloatingPanel: vi.fn(),
    bringPanelToFront: vi.fn(),
}));
vi.mock('../../utils/formatters.js', () => ({
    formatLargeNumber: (value, decimals) => (decimals ? Number(value).toFixed(decimals) : String(value)),
    timeReadable: (seconds) => `${seconds}s`,
}));
vi.mock('../../utils/game-i18n.js', () => ({
    getMonsterName: (hrid, fallback) => fallback,
    getAbilityName: (hrid, fallback) => fallback,
}));

const { buildTabModel } = await import('./combat-live-ui.js');

const summary = (overrides = {}) => ({
    seconds: 10,
    attributionExact: true,
    party: { damage: 1500, dps: 150, hits: 8, crits: 2, misses: 1, kills: 3, trueDps: 120 },
    monsters: [{ hrid: '/monsters/giant_fly', damage: 1500, kills: 3 }],
    dealt: [{ name: 'Alice', damage: 1500, hits: 8, crits: 2, misses: 1, dps: 150 }],
    unattributed: { damage: 0, hits: 0, share: 0 },
    players: [
        {
            name: 'Alice',
            damage: 400,
            healed: 50,
            deaths: 1,
            damageTakenPerSecond: 40,
            deathsPerHour: 360,
            manaSpent: 120,
            manaGained: 10,
            manaSpentPerSecond: 12,
            abilityMana: [{ abilityHrid: '/abilities/fireball', mana: 120, events: 2, perSecond: 12 }],
        },
    ],
    ...overrides,
});

describe('buildTabModel', () => {
    test('damage tab shows DPS for the player when fighting alone, with no party note', () => {
        const model = buildTabModel(summary(), 'damage');

        expect(model.stats[0]).toEqual(['combatLive.dpsFor:{"name":"Alice"}', '150.0']);
        expect(model.note).toBe('');
    });

    test('damage tab labels the figure as a party total, and says why, when several players fight', () => {
        const model = buildTabModel(summary({ attributionExact: false }), 'damage');

        expect(model.stats[0][0]).toBe('combatLive.partyDps');
        expect(model.note).toBe('combatLive.partyNote');
    });

    test('damage tab lists enemies with a readable name fallback', () => {
        const model = buildTabModel(summary(), 'damage');

        expect(model.rows[0].cells).toEqual(['Giant Fly', '1500', '3']);
    });

    test('damage taken tab has one row per player', () => {
        const model = buildTabModel(summary(), 'taken');

        expect(model.rows).toEqual([{ kind: 'row', cells: ['Alice', '400', '40.0', '50', '1', '360.0'] }]);
    });

    test('mana tab nests each ability under its player', () => {
        const model = buildTabModel(summary(), 'mana');

        expect(model.rows.map((row) => row.kind)).toEqual(['player', 'ability']);
        expect(model.rows[1].cells).toEqual(['Fireball', '120', '12.0']);
    });

    test('an unnamed spend is labelled rather than shown blank', () => {
        const base = summary();
        base.players[0].abilityMana = [{ abilityHrid: '', mana: 5, events: 1, perSecond: 0.5 }];

        const model = buildTabModel(base, 'mana');

        expect(model.rows[1].cells[0]).toBe('combatLive.noAbility');
    });

    describe('party damage estimate', () => {
        const party = () =>
            summary({
                attributionExact: false,
                dealt: [
                    { name: 'Alice', damage: 1000, hits: 5, crits: 1, misses: 0, dps: 100 },
                    { name: 'Bob', damage: 400, hits: 3, crits: 0, misses: 1, dps: 40 },
                ],
                unattributed: { damage: 100, hits: 1, share: 100 / 1500 },
            });

        test('is hidden unless the setting is on', () => {
            const model = buildTabModel(party(), 'damage');

            expect(model.secondary).toBeNull();
            expect(model.note).toBe('combatLive.partyNote');
        });

        test('marks every per-player figure as an estimate and shows the unattributed share', () => {
            const model = buildTabModel(party(), 'damage', { estimateParty: true });

            expect(model.secondary.rows.map((row) => row.cells)).toEqual([
                ['Alice', '~1000', '~100.0', '~67%'],
                ['Bob', '~400', '~40.0', '~27%'],
            ]);
            expect(model.stats.at(-1)).toEqual(['combatLive.unattributed', '7%']);
            expect(model.note).toBe('combatLive.estimateNote');
        });

        test('is not shown when alone, because the figure is exact there', () => {
            const model = buildTabModel(summary(), 'damage', { estimateParty: true });

            expect(model.secondary).toBeNull();
            expect(model.note).toBe('');
        });
    });
});
