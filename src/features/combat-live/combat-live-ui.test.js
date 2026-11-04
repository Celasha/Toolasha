// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({ default: { Z_FLOATING_PANEL: 1000, Z_HUD: 50, getSetting: vi.fn() } }));
vi.mock('../../core/storage.js', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../core/i18n.js', () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
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
        expect(model.info).toBe('combatLive.partyNote');
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
        expect(model.headers).toEqual([
            'combatLive.colAbility',
            'combatLive.colSpent',
            'combatLive.colGained',
            'combatLive.colPerSecond',
        ]);
        expect(model.rows[0].cells).toEqual(['Alice', '120', '10', '12.0']);
        expect(model.rows[1].cells).toEqual(['Fireball', '120', '', '12.0']);
    });

    test('the refused column and its explanation appear once a cast has been refused', () => {
        const base = summary();
        expect(buildTabModel(base, 'mana').headers).not.toContain('combatLive.colRefused');

        base.players[0].refusedCasts = 7;
        base.players[0].abilityMana[0].refused = 4;
        const model = buildTabModel(base, 'mana');

        expect(model.headers[model.headers.length - 1]).toBe('combatLive.colRefused');
        expect(model.rows[0].cells[model.rows[0].cells.length - 1]).toBe('7');
        expect(model.rows[1].cells[model.rows[1].cells.length - 1]).toBe('4');
        expect(model.info).toBe('combatLive.refusedInfo');
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
            expect(model.info).toBe('combatLive.partyNote');
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
            expect(model.info).toBe('combatLive.attributionNote');
            expect(model.note).toBe(
                'combatLive.unattributedBreakdown:{"overTime":"60","reflected":"30","unclear":"10"}'
            );
        });

        test('has no breakdown line when everything was assigned', () => {
            const model = buildTabModel(
                party({ damage: 0, hits: 0, share: 0, overTime: 0, reflected: 0, unclear: 0 }),
                'damage',
                { showPartyDamage: true }
            );

            expect(model.info).toBe('combatLive.attributionNote');
            expect(model.note).toBe('');
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
        const chart = {
            player: 'Alice',
            now: 1_000_000,
            hits: [],
            currentDps: 100,
            bestDps: 150,
            averageDps: 120,
            series: [80, 100, 120, 100],
        };
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

            expect(ids).toEqual([
                CHART_SECTION,
                'damage.chart.graph',
                'damage.totals',
                'damage.secondary',
                'damage.main',
            ]);
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
        const chart = {
            player: 'Alice',
            now: 1_000_000,
            hits: [],
            currentDps: 100,
            bestDps: 150,
            averageDps: 120,
            series: [80, 100, 120, 100],
        };
        await combatLiveUI.initialize({
            getSummary: () =>
                summary({
                    attributionExact: false,
                    dealt: [alice, bob],
                    chart,
                    charts: [chart, { ...chart, player: 'Bob', bestDps: 0 }],
                }),
            getLastMessageAt: () => Date.now(),
            onReset: vi.fn(),
            isRecording: () => false,
            getRecording: () => null,
        });
        combatLiveUI.refresh();
        return document.getElementById('toolasha-combat-live');
    }

    const header = (panel, id) => panel.querySelector(`[data-section="${id}"]`);
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

    const chartTitles = (panel) =>
        [...panel.querySelectorAll('[data-section^="damage.chart.player."]')].map((el) => el.dataset.section);

    test('in a party each member gets their own foldable chart, and the single chart steps aside', async () => {
        const panel = await openParty();

        expect(chartTitles(panel)).toEqual(['damage.chart.player.Alice', 'damage.chart.player.Bob']);
        // The bar's sparkline, the single chart's tape, the DPS graph, and one tape per member
        expect(panel.querySelectorAll('canvas')).toHaveLength(5);
        expect(header(panel, CHART_SECTION).nextElementSibling.firstChild.style.display).toBe('none');
    });

    test("folding one member's chart leaves the others and remembers it", async () => {
        const panel = await openParty();

        header(panel, 'damage.chart.player.Bob').click();

        const bob = header(combatLiveUI.panel, 'damage.chart.player.Bob');
        expect(bob.getAttribute('aria-expanded')).toBe('false');
        expect(bob.nextElementSibling.style.display).toBe('none');
        expect(header(combatLiveUI.panel, 'damage.chart.player.Alice').nextElementSibling.style.display).toBe('block');
        expect(storage.set).toHaveBeenCalledWith(SECTIONS_KEY, ['damage.chart.player.Bob'], 'settings');
    });

    test('with per-player damage off, a party gets the single chart', async () => {
        HTMLCanvasElement.prototype.getContext = () => null;
        const panel = await openParty();
        config.getSetting.mockImplementation((key) => key !== 'combatLive_estimateParty');
        combatLiveUI.refresh();

        expect(header(panel, CHART_SECTION).nextElementSibling.firstChild.style.display).toBe('block');
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

    test('the bar shows your session average DPS and how your recent pace compares, not the party total', async () => {
        const panel = await openParty();

        const bar = panel.firstElementChild;
        expect(bar.textContent).toContain('combatLive.headerSummary:{"dps":"120.0"}');
        expect(bar.textContent).not.toContain('150.0');
        expect(bar.textContent).toContain('▼ 17%');
        expect(bar.querySelector('canvas').style.display).toBe('block');
        expect(bar.querySelector('[title]').title).toContain('"party":"150.0"');
    });

    test('sits on the HUD layer, under game popups and the floating panels, and does not jump on click', async () => {
        const panel = await openParty();

        expect(panel.style.zIndex).toBe('50');
        panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(panel.style.zIndex).toBe('50');
    });

    test('the attribution explanation opens from an info button and is not shown until then', async () => {
        const panel = await openParty();
        expect(panel.textContent).not.toContain('combatLive.attributionNote');

        section(panel, 'damage.secondary').querySelector('button[title="combatLive.infoTooltip"]').click();

        expect(combatLiveUI.panel.textContent).toContain('combatLive.attributionNote');
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

describe('past runs and copy results', () => {
    let history;
    let entries;

    async function openWithHistory() {
        HTMLCanvasElement.prototype.getContext = () => null;
        config.getSetting.mockImplementation(() => true);
        storage.get.mockImplementation(async (_key, _store, fallback) => fallback);
        entries = [
            {
                id: 'a',
                date: Date.UTC(2026, 10, 3, 12, 0),
                label: '',
                favorite: false,
                summary: {
                    ...summary(),
                    seconds: 300,
                    party: { damage: 9000, dps: 30, hits: 1, crits: 0, misses: 0, kills: 9 },
                },
            },
            {
                id: 'b',
                date: Date.UTC(2026, 10, 2, 12, 0),
                label: 'Boss night',
                favorite: true,
                summary: {
                    ...summary(),
                    seconds: 600,
                    party: { damage: 50000, dps: 83, hits: 1, crits: 0, misses: 0, kills: 20 },
                },
            },
        ];
        history = {
            load: vi.fn(async () => {}),
            onChange: vi.fn(() => () => {}),
            list: vi.fn(() => entries),
            toggleFavorite: vi.fn(),
            rename: vi.fn(),
            clearPlain: vi.fn(),
        };
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: vi.fn(async () => {}) },
            configurable: true,
        });
        await combatLiveUI.initialize({
            getSummary: () => summary(),
            getLastMessageAt: () => Date.now(),
            onReset: vi.fn(),
            isRecording: () => false,
            getRecording: () => null,
            history,
        });
        combatLiveUI.refresh();
        return document.getElementById('toolasha-combat-live');
    }

    const buttonWith = (panel, text) => [...panel.querySelectorAll('button')].find((b) => b.textContent.includes(text));

    afterEach(() => {
        combatLiveUI.cleanup();
        document.body.innerHTML = '';
    });

    test('the footer offers copy results and a count of past runs, with the list folded', async () => {
        const panel = await openWithHistory();

        expect(buttonWith(panel, 'combatLive.copyResults')).toBeTruthy();
        expect(buttonWith(panel, 'combatLive.pastRuns:{"count":2}')).toBeTruthy();
        expect(panel.textContent).not.toContain('Boss night');
    });

    test('copy results puts the current session on the clipboard as text', async () => {
        const panel = await openWithHistory();

        buttonWith(panel, 'combatLive.copyResults').click();
        await Promise.resolve();

        const text = navigator.clipboard.writeText.mock.calls[0][0];
        expect(text).toContain('=== Combat Live');
        expect(text).toContain('Party:');
    });

    test('opening the list shows each past run; a name replaces the date', async () => {
        const panel = await openWithHistory();

        buttonWith(panel, 'combatLive.pastRuns').click();

        expect(panel.textContent).toContain('Boss night');
        expect(panel.textContent).toContain('83.0 DPS');
        expect(panel.textContent).toContain('30.0 DPS');
    });

    test('star, rename and clear go to the history', async () => {
        const panel = await openWithHistory();
        buttonWith(panel, 'combatLive.pastRuns').click();
        vi.spyOn(window, 'prompt').mockReturnValue('  Zone 5  ');

        buttonWith(panel, '☆').click();
        buttonWith(panel, '✎').click();
        buttonWith(panel, 'combatLive.clearPlain').click();

        expect(history.toggleFavorite).toHaveBeenCalledWith('a');
        expect(history.rename).toHaveBeenCalledWith('a', 'Zone 5');
        expect(history.clearPlain).toHaveBeenCalled();
    });

    test('clicking a past run shows that session with a banner, and back to live returns', async () => {
        const panel = await openWithHistory();
        buttonWith(panel, 'combatLive.pastRuns').click();

        const title = [...panel.querySelectorAll('span')].find((el) => el.textContent.includes('Boss night'));
        title.click();

        expect(panel.textContent).toContain('combatLive.viewingPast:{"when":"Boss night"}');
        buttonWith(panel, 'combatLive.backToLive').click();
        expect(panel.textContent).not.toContain('combatLive.viewingPast');
    });
});

describe('healing tab', () => {
    const withHealing = (healers) => ({ ...summary(), healers });

    test('lists healers by healing with their abilities nested, and the party totals', () => {
        const model = buildTabModel(
            withHealing([
                { name: 'Bob', healing: 300, hps: 3, abilities: [{ key: 'auto', healing: 300, hps: 3, share: 1 }] },
                {
                    name: 'Alice',
                    healing: 700,
                    hps: 7,
                    abilities: [
                        { key: '/abilities/heal', healing: 600, hps: 6, share: 600 / 700 },
                        { key: 'auto', healing: 100, hps: 1, share: 100 / 700 },
                    ],
                },
            ]),
            'healing'
        );

        expect(model.stats).toEqual([
            ['combatLive.partyHps', '10.0'],
            ['combatLive.totalHealing', '1000'],
        ]);
        expect(model.rows.map((row) => row.kind)).toEqual(['player', 'ability', 'ability', 'player', 'ability']);
        expect(model.rows[0].cells).toEqual(['Alice', '700', '7.0', '70%']);
        expect(model.rows[3].cells[0]).toBe('Bob');
    });

    test('says there is no healing yet instead of an empty table', () => {
        const model = buildTabModel(withHealing([{ name: 'Alice', healing: 0, hps: 0, abilities: [] }]), 'healing');

        expect(model.rows).toEqual([]);
        expect(model.note).toBe('combatLive.noHealing');
    });

    test('an older saved session without healing data still opens', () => {
        const old = summary();
        delete old.healers;

        expect(() => buildTabModel(old, 'healing')).not.toThrow();
    });
});

describe('party ranking', () => {
    const party = () => {
        const base = summary();
        base.attributionExact = false;
        base.dealt = [
            { ...base.dealt[0], name: 'Alice', damage: 600, dps: 60 },
            { ...base.dealt[0], name: 'Bob', damage: 300, dps: 30 },
        ];
        base.party = { ...base.party, damage: 900 };
        return base;
    };

    test('the damage tab ranks the party when each member is shown', () => {
        const model = buildTabModel(party(), 'damage', { showPartyDamage: true });

        expect(model.ranking.map((row) => [row.name, row.valueText, row.rateText])).toEqual([
            ['Alice', '600', '60.0/s'],
            ['Bob', '300', '30.0/s'],
        ]);
        expect(model.ranking[0].share).toBeCloseTo(2 / 3, 5);
    });

    test('there is no ranking alone, or when members are not split out', () => {
        expect(buildTabModel(summary(), 'damage', { showPartyDamage: true }).ranking).toBeNull();
        expect(buildTabModel(party(), 'damage', { showPartyDamage: false }).ranking).toBeNull();
    });

    test('damage taken ranks players too once there are several', () => {
        const base = summary();
        base.players = [
            { ...base.players[0], name: 'Alice', damage: 400 },
            { ...base.players[0], name: 'Bob', damage: 100 },
        ];

        expect(buildTabModel(base, 'taken').ranking.map((row) => row.name)).toEqual(['Alice', 'Bob']);
    });
});
