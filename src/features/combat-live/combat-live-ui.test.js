// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({ default: { Z_FLOATING_PANEL: 1000, getSetting: vi.fn() } }));
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

const { buildTabModel, pruneEmptyColumns, default: combatLiveUI, CHART_SECTION } = await import('./combat-live-ui.js');
const { default: storage } = await import('../../core/storage.js');
const { default: config } = await import('../../core/config.js');

const summary = (overrides = {}) => ({
    seconds: 10,
    attributionExact: true,
    party: { damage: 1500, dps: 150, hits: 8, crits: 2, misses: 1, kills: 3, trueDps: 120 },
    monsters: [{ hrid: '/monsters/giant_fly', damage: 1500, kills: 3, dps: 120, killTime: 6.5 }],
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

        expect(model.rows[0].cells).toEqual(['Giant Fly', '1500', '120.0', 'combatLive.seconds:{"value":"6.5"}', '3']);
    });

    describe('columns appear as data arrives', () => {
        const fly = (overrides = {}) => ({
            hrid: '/monsters/giant_fly',
            damage: 300,
            kills: 0,
            dps: 0,
            killTime: null,
            ...overrides,
        });

        test('the enemy table is just damage until something has been killed', () => {
            const base = summary();
            base.monsters = [fly()];

            const model = buildTabModel(base, 'damage');

            expect(model.headers).toEqual(['combatLive.colEnemy', 'combatLive.colDamage']);
            expect(model.rows).toEqual([{ kind: 'row', cells: ['Giant Fly', '300'] }]);
        });

        test('DPS, kill time and kills all appear with the first kill', () => {
            const base = summary();
            base.monsters = [fly({ kills: 1, dps: 75, killTime: 4 })];

            const model = buildTabModel(base, 'damage');

            expect(model.headers).toHaveLength(5);
            expect(model.rows[0].cells).toEqual([
                'Giant Fly',
                '300',
                '75.0',
                'combatLive.seconds:{"value":"4.0"}',
                '1',
            ]);
        });

        test('a column stays for every row once any row has data, with a dash where one has none', () => {
            const base = summary();
            base.monsters = [fly({ kills: 1, dps: 75, killTime: 4 }), fly({ hrid: '/monsters/giant_bee' })];

            const model = buildTabModel(base, 'damage');

            expect(model.headers).toHaveLength(5);
            expect(model.rows[1].cells).toEqual(['Giant Bee', '300', '–', '–', '0']);
        });

        test('damage taken has no death or healing columns until there has been a death or a heal', () => {
            const base = summary();
            base.players = [{ ...base.players[0], healed: 0, deaths: 0, deathsPerHour: 0 }];

            const model = buildTabModel(base, 'taken');

            expect(model.headers).toEqual(['combatLive.colPlayer', 'combatLive.colTaken', 'combatLive.colPerSecond']);
            expect(model.rows[0].cells).toEqual(['Alice', '400', '40.0']);
        });

        test('the death columns come in with the first death', () => {
            const base = summary();
            base.players = [{ ...base.players[0], healed: 0, deaths: 1, deathsPerHour: 360 }];

            const model = buildTabModel(base, 'taken');

            expect(model.headers).toEqual([
                'combatLive.colPlayer',
                'combatLive.colTaken',
                'combatLive.colPerSecond',
                'combatLive.colDeaths',
                'combatLive.colDeathsPerHour',
            ]);
        });

        test('no table at all when nothing but names would be left', () => {
            const base = summary();
            base.players = [
                { ...base.players[0], damage: 0, damageTakenPerSecond: 0, healed: 0, deaths: 0, deathsPerHour: 0 },
            ];

            const model = buildTabModel(base, 'taken');

            expect(model.headers).toEqual([]);
            expect(model.rows).toEqual([]);
        });

        test('pruneEmptyColumns always keeps the name column and treats rows without flags as data', () => {
            const result = pruneEmptyColumns(
                ['name', 'a', 'b'],
                [
                    { kind: 'row', cells: ['x', '1', '2'], blank: [true, true, false] },
                    { kind: 'row', cells: ['y', '3', '4'] },
                ]
            );

            expect(result.headers).toEqual(['name', 'a', 'b']);
            expect(result.rows[1].cells).toEqual(['y', '3', '4']);
        });
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

        expect(model.rows[1].cells[0]).toBe('combatLive.unknownAbility');
    });

    test('alone, the damage tab lists your damage by ability, with auto attack and over-time labelled', () => {
        const model = buildTabModel(summary(), 'damage');

        expect(model.secondary.title).toBe('combatLive.byAbilityTitle');
        expect(model.secondary.rows).toEqual([
            { kind: 'ability', cells: ['Fireball', '1000', '100.0', '67%', '100%'] },
            { kind: 'ability', cells: ['combatLive.autoAttack', '500', '50.0', '33%', '75%'] },
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
                            {
                                key: '/abilities/fireball',
                                damage: 700,
                                hits: 3,
                                crits: 1,
                                misses: 0,
                                dps: 70,
                                share: 0.7,
                            },
                            { key: 'auto', damage: 300, hits: 2, crits: 0, misses: 0, dps: 30, share: 0.3 },
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
                        abilities: [{ key: 'auto', damage: 400, hits: 3, crits: 0, misses: 1, dps: 40, share: 1 }],
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
                { kind: 'player', cells: ['Alice', '1000', '100.0', '67%', '100%'] },
                { kind: 'ability', cells: ['Fireball', '700', '70.0', '70%', '100%'] },
                { kind: 'ability', cells: ['combatLive.autoAttack', '300', '30.0', '30%', '100%'] },
                { kind: 'player', cells: ['Bob', '400', '40.0', '27%', '67%'] },
                { kind: 'ability', cells: ['combatLive.autoAttack', '400', '40.0', '100%', '67%'] },
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

describe('foldable sections', () => {
    const SECTIONS_KEY = 'combatLive_collapsedSections';

    async function openPanel(saved = []) {
        HTMLCanvasElement.prototype.getContext = () => null;
        storage.get.mockImplementation(async (key, _store, fallback) => (key === SECTIONS_KEY ? saved : fallback));
        storage.set.mockClear();
        const chart = { player: 'Alice', now: 1_000_000, hits: [], currentDps: 100, bestDps: 150, averageDps: 120 };
        await combatLiveUI.initialize({
            getSummary: () => summary({ chart }),
            getLastMessageAt: () => Date.now(),
            onReset: vi.fn(),
            isRecording: () => false,
            getRecording: () => null,
        });
        combatLiveUI.refresh();
        return document.getElementById('toolasha-combat-live');
    }

    const header = (panel, id) => panel.querySelector(`[data-section="${id}"]`);
    const open = (headerEl) => headerEl.getAttribute('aria-expanded') === 'true';

    afterEach(() => {
        combatLiveUI.cleanup();
        document.body.innerHTML = '';
    });

    test('every part of the damage tab is a section with its own title', () => {
        return openPanel().then((panel) => {
            const ids = [...panel.querySelectorAll('[data-section]')].map((el) => el.dataset.section);

            expect(ids).toEqual([CHART_SECTION, 'damage.totals', 'damage.secondary', 'damage.main']);
        });
    });

    test('clicking a title folds that section away and remembers it', async () => {
        const panel = await openPanel();
        const title = header(panel, 'damage.main');
        const section = title.parentElement;
        expect(section.children).toHaveLength(2);

        title.click();

        const folded = header(panel, 'damage.main');
        expect(open(folded)).toBe(false);
        expect(folded.parentElement.children).toHaveLength(1);
        expect(storage.set).toHaveBeenCalledWith(SECTIONS_KEY, ['damage.main'], 'settings');
    });

    test('folding one section leaves the others open', async () => {
        const panel = await openPanel();

        header(panel, 'damage.totals').click();

        expect(open(header(panel, 'damage.totals'))).toBe(false);
        expect(open(header(panel, 'damage.secondary'))).toBe(true);
        expect(open(header(panel, 'damage.main'))).toBe(true);
    });

    test('clicking a folded title opens it again', async () => {
        const panel = await openPanel();
        header(panel, 'damage.main').click();

        header(panel, 'damage.main').click();

        expect(open(header(panel, 'damage.main'))).toBe(true);
        expect(header(panel, 'damage.main').parentElement.children).toHaveLength(2);
        expect(storage.set).toHaveBeenLastCalledWith(SECTIONS_KEY, [], 'settings');
    });

    test('a section folded earlier is still folded when the panel opens', async () => {
        const panel = await openPanel(['damage.secondary']);

        expect(open(header(panel, 'damage.secondary'))).toBe(false);
        expect(header(panel, 'damage.secondary').parentElement.children).toHaveLength(1);
        expect(open(header(panel, 'damage.totals'))).toBe(true);
    });

    test('folding the chart hides its content but keeps its title', async () => {
        const panel = await openPanel();
        const chartHeader = header(panel, CHART_SECTION);
        const content = chartHeader.nextElementSibling;
        expect(content.style.display).toBe('block');

        chartHeader.click();

        expect(content.style.display).toBe('none');
        expect(open(chartHeader)).toBe(false);
        expect(storage.set).toHaveBeenCalledWith(SECTIONS_KEY, [CHART_SECTION], 'settings');
    });

    test('Enter and Space fold a section from the keyboard', async () => {
        const panel = await openPanel();
        const title = header(panel, 'damage.main');

        title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(open(header(panel, 'damage.main'))).toBe(false);

        header(panel, 'damage.main').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(open(header(panel, 'damage.main'))).toBe(true);
    });

    test('the other tabs are foldable too', async () => {
        const panel = await openPanel();
        [...panel.querySelectorAll('button')].find((button) => button.textContent === 'combatLive.tab_taken').click();

        expect(header(panel, 'taken.main')).not.toBeNull();
        [...panel.querySelectorAll('button')].find((button) => button.textContent === 'combatLive.tab_mana').click();
        expect(header(panel, 'mana.main')).not.toBeNull();
    });
});

describe('party panel', () => {
    const SECTIONS_KEY = 'combatLive_collapsedSections';
    const COLUMNS_KEY = 'combatLive_hiddenColumns';

    async function openParty(saved = {}) {
        HTMLCanvasElement.prototype.getContext = () => null;
        config.getSetting.mockImplementation(() => true);
        storage.get.mockImplementation(async (key, _store, fallback) => saved[key] ?? fallback);
        storage.set.mockClear();
        const base = summary();
        const alice = base.dealt[0];
        const bob = { ...alice, name: 'Bob', dps: 40, abilities: [alice.abilities[1]] };
        const chart = { player: 'Alice', now: 1_000_000, hits: [], currentDps: 100, bestDps: 150, averageDps: 120 };
        await combatLiveUI.initialize({
            getSummary: () => summary({ attributionExact: false, dealt: [alice, bob], chart }),
            getLastMessageAt: () => Date.now(),
            onReset: vi.fn(),
            isRecording: () => false,
            getRecording: () => null,
        });
        combatLiveUI.refresh();
        return document.getElementById('toolasha-combat-live');
    }

    const section = (panel, id) => panel.querySelector(`[data-section="${id}"]`).parentElement;
    const tableOf = (panel, id) =>
        [...section(panel, id).children].find((el) => el.style.cssText.includes('margin-bottom: 6px'));
    const headerCells = (panel, id) => [...tableOf(panel, id).children[0].children].map((el) => el.textContent);
    const rowNames = (panel, id) => {
        const table = tableOf(panel, id);
        return [...table.children].slice(1).map((row) => row.firstChild.textContent);
    };

    afterEach(() => {
        combatLiveUI.cleanup();
        document.body.innerHTML = '';
    });

    test('the chart shows each party member with their DPS', async () => {
        const panel = await openParty();

        const rows = [...panel.querySelectorAll('div')].filter(
            (el) =>
                el.style.cssText.includes('margin-bottom: 4px') && el.lastChild?.style?.cssText.includes('height: 5px')
        );
        expect(rows.map((row) => row.firstChild.textContent)).toEqual(['Alice150.0', 'Bob40.0']);
    });

    test('clicking a player folds their abilities away and remembers it', async () => {
        const panel = await openParty();
        expect(rowNames(panel, 'damage.secondary')).toHaveLength(5);

        const alice = [...section(panel, 'damage.secondary').querySelectorAll('div')].find((el) =>
            el.textContent.startsWith('▾ Alice')
        );
        alice.click();

        expect(rowNames(combatLiveUI.panel, 'damage.secondary')).toEqual(['▸ Alice', '▾ Bob', 'combatLive.autoAttack']);
        expect(storage.set).toHaveBeenCalledWith(SECTIONS_KEY, ['damage.secondary.player.Alice'], 'settings');
    });

    test('a column can be hidden from its picker and the choice is remembered', async () => {
        const panel = await openParty();
        expect(headerCells(panel, 'damage.secondary')).toContain('combatLive.colAccuracy');

        const picker = section(panel, 'damage.secondary').querySelector('button[title="combatLive.columnsTooltip"]');
        picker.click();
        const chip = [...combatLiveUI.panel.querySelectorAll('button')].find(
            (button) => button.textContent === '✓ combatLive.colAccuracy'
        );
        chip.click();

        expect(headerCells(combatLiveUI.panel, 'damage.secondary')).not.toContain('combatLive.colAccuracy');
        expect(storage.set).toHaveBeenCalledWith(COLUMNS_KEY, ['damage.secondary.accuracy'], 'settings');
    });

    test('hidden columns stay hidden when the panel opens', async () => {
        const panel = await openParty({ [COLUMNS_KEY]: ['damage.secondary.dps'] });

        expect(headerCells(panel, 'damage.secondary')).not.toContain('combatLive.colDps');
    });
});
