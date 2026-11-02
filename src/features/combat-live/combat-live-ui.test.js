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
    dealt: [
        {
            name: 'Alice',
            damage: 1500,
            hits: 8,
            crits: 2,
            misses: 1,
            dps: 150,
            share: 1,
            abilities: [
                {
                    key: '/abilities/fireball',
                    damage: 1000,
                    hits: 4,
                    crits: 1,
                    misses: 0,
                    dps: 100,
                    share: 1000 / 1500,
                },
                { key: 'auto', damage: 500, hits: 4, crits: 1, misses: 1, dps: 50, share: 500 / 1500 },
            ],
        },
    ],
    unattributed: { damage: 0, hits: 0, share: 0, overTime: 0, reflected: 0, unclear: 0 },
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

    test('alone, the damage tab lists your damage by ability, with auto attack and over-time labelled', () => {
        const model = buildTabModel(summary(), 'damage');

        expect(model.secondary.title).toBe('combatLive.byAbilityTitle');
        expect(model.secondary.rows).toEqual([
            { kind: 'ability', cells: ['Fireball', '1000', '67%', '4'] },
            { kind: 'ability', cells: ['combatLive.autoAttack', '500', '33%', '4'] },
        ]);
    });

    test('over-time and reflected damage get their own labels, not an ability name', () => {
        const base = summary();
        base.dealt[0].abilities = [
            { key: 'over-time', damage: 30, hits: 3, crits: 0, misses: 0, dps: 3, share: 0.5 },
            { key: 'reflect', damage: 30, hits: 1, crits: 0, misses: 0, dps: 3, share: 0.5 },
        ];

        const labels = buildTabModel(base, 'damage').secondary.rows.map((row) => row.cells[0]);

        expect(labels).toEqual(['combatLive.overTime', 'combatLive.reflected']);
    });

    describe('party damage', () => {
        const party = (
            unattributed = { damage: 100, hits: 1, share: 100 / 1500, overTime: 60, reflected: 30, unclear: 10 }
        ) =>
            summary({
                attributionExact: false,
                dealt: [
                    {
                        name: 'Alice',
                        damage: 1000,
                        hits: 5,
                        crits: 1,
                        misses: 0,
                        dps: 100,
                        share: 1000 / 1500,
                        abilities: [
                            { key: '/abilities/fireball', damage: 700, hits: 3, crits: 1, misses: 0, share: 0.7 },
                            { key: 'auto', damage: 300, hits: 2, crits: 0, misses: 0, share: 0.3 },
                        ],
                    },
                    {
                        name: 'Bob',
                        damage: 400,
                        hits: 3,
                        crits: 0,
                        misses: 1,
                        dps: 40,
                        share: 400 / 1500,
                        abilities: [{ key: 'auto', damage: 400, hits: 3, crits: 0, misses: 1, share: 1 }],
                    },
                ],
                unattributed,
            });

        test('is a plain party total, with a hint how to split it, unless the setting is on', () => {
            const model = buildTabModel(party(), 'damage');

            expect(model.stats[0][0]).toBe('combatLive.partyDps');
            expect(model.secondary).toBeNull();
            expect(model.note).toBe('combatLive.partyNote');
        });

        test('splits damage per player with each ability nested under its player', () => {
            const model = buildTabModel(party(), 'damage', { showPartyDamage: true });

            expect(model.secondary.title).toBe('combatLive.byPlayerTitle');
            expect(model.secondary.rows).toEqual([
                { kind: 'player', cells: ['Alice', '1000', '67%', '5'] },
                { kind: 'ability', cells: ['Fireball', '700', '70%', '3'] },
                { kind: 'ability', cells: ['combatLive.autoAttack', '300', '30%', '2'] },
                { kind: 'player', cells: ['Bob', '400', '27%', '3'] },
                { kind: 'ability', cells: ['combatLive.autoAttack', '400', '100%', '3'] },
            ]);
        });

        test('shows how much was not assigned to a player, and why', () => {
            const model = buildTabModel(party(), 'damage', { showPartyDamage: true });

            expect(model.stats.at(-1)).toEqual(['combatLive.unattributed', '7%']);
            expect(model.note).toBe(
                'combatLive.attributionNote combatLive.unattributedBreakdown:{"overTime":"60","reflected":"30","unclear":"10"}'
            );
        });

        test('has no breakdown line when everything was assigned', () => {
            const model = buildTabModel(
                party({ damage: 0, hits: 0, share: 0, overTime: 0, reflected: 0, unclear: 0 }),
                'damage',
                { showPartyDamage: true }
            );

            expect(model.note).toBe('combatLive.attributionNote');
        });

        test('is ignored when alone: your own damage is always shown by ability', () => {
            const model = buildTabModel(summary(), 'damage', { showPartyDamage: true });

            expect(model.secondary.title).toBe('combatLive.byAbilityTitle');
            expect(model.note).toBe('');
        });
    });
});
