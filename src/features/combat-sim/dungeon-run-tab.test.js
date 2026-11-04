// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../utils/formatters.js', () => ({
    formatKMB: (value) => String(value),
    formatWithSeparator: (value, decimals = 0) => Number(value).toFixed(decimals),
}));
vi.mock('../../utils/game-i18n.js', () => ({
    getActionName: (hrid, fallback) => fallback,
    getItemName: (hrid, fallback) => fallback,
}));
vi.mock('./dungeon-run-planner.js', () => ({ planDungeonRuns: (...args) => mocks.plan(...args) }));

const { createDungeonTab } = await import('./dungeon-run-tab.js');

const zones = [
    { hrid: '/actions/combat/swamp', name: 'Swamp', isDungeon: false },
    { hrid: '/actions/combat/den', name: 'Chimerical Den', isDungeon: true },
    { hrid: '/actions/combat/mines', name: 'Sinister Mines', isDungeon: true },
];

const PLAN = {
    runsPerDay: 48,
    keysPerDay: 96,
    chestValuePerDay: 24000,
    keyCostPerDay: 2400,
    consumablesPerDay: 0,
    netPerDay: 21600,
    hasMissingPrices: false,
    drops: [{ name: 'Chimerical Chest', countPerDay: 48, valuePerDay: 24000 }],
    keys: [{ itemHrid: '/items/den_entry_key', name: 'Entry Key', count: 48, unitCost: 25, totalCost: 1200 }],
};

function open(overrides = {}) {
    const tab = createDungeonTab({
        getZones: () => zones,
        getGameData: () => ({ marker: true }),
        getDefaultDropQuantity: () => 0.295,
        getDefaultMinutes: () => 30,
        ...overrides,
    });
    document.body.append(tab.element);
    tab.refresh();
    return tab;
}

const inputs = (tab) => [...tab.element.querySelectorAll('input')];
const change = (input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('change'));
};

describe('Dungeon tab', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.plan.mockReset();
        mocks.plan.mockReturnValue(PLAN);
    });

    test('lists only dungeons, and starts from the average clear time and the community drop bonus', () => {
        const tab = open();

        const options = [...tab.element.querySelectorAll('select')[0].options].map((option) => option.textContent);
        expect(options).toEqual(['Chimerical Den', 'Sinister Mines']);
        // players, minutes, drop quantity (percent), food
        expect(inputs(tab).map((input) => input.value)).toEqual(['1', '30', '29.5', '0']);
        expect(mocks.plan).toHaveBeenLastCalledWith(
            expect.objectContaining({
                dungeonHrid: '/actions/combat/den',
                tier: 0,
                players: 1,
                minutesPerRun: 30,
                dropQuantity: 0.295,
                consumablesPerDay: 0,
            })
        );
    });

    test('shows the plan: runs, keys, chest value, key costs and the net', () => {
        const tab = open();
        const text = tab.element.textContent;

        expect(text).toContain('combatSimUi.dungeonRunsPerDay');
        expect(text).toContain('48.0');
        expect(text).toContain('24000');
        expect(text).toContain('-2400');
        expect(text).toContain('21600');
        expect(text).toContain('Chimerical Chest');
    });

    test('changing an input works it out again, with the drop box read as a percent', () => {
        const tab = open();

        change(inputs(tab)[2], 40);
        expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({ dropQuantity: 0.4 }));

        change(inputs(tab)[1], 20);
        expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({ minutesPerRun: 20 }));

        change(inputs(tab)[3], 5000);
        expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({ consumablesPerDay: 5000 }));
    });

    test('picking another dungeon or tier works it out for that', () => {
        const tab = open();
        const [dungeon, tier] = tab.element.querySelectorAll('select');

        dungeon.value = '/actions/combat/mines';
        dungeon.dispatchEvent(new Event('change'));
        tier.value = '2';
        tier.dispatchEvent(new Event('change'));

        expect(mocks.plan).toHaveBeenLastCalledWith(
            expect.objectContaining({ dungeonHrid: '/actions/combat/mines', tier: 2 })
        );
    });

    test('falls back to 15 minutes with no sim to take a clear time from', () => {
        const tab = open({ getDefaultMinutes: () => null });

        expect(inputs(tab)[1].value).toBe('15');
    });

    test('asks for a run length when the plan cannot be made', () => {
        mocks.plan.mockReturnValue(null);
        const tab = open();

        expect(tab.element.textContent).toContain('combatSimUi.dungeonBadMinutes');
    });

    test('says so when the game data has no dungeons yet, and mentions missing prices', () => {
        expect(open({ getZones: () => [] }).element.textContent).toContain('combatSimUi.dungeonNoData');

        document.body.innerHTML = '';
        mocks.plan.mockReturnValue({ ...PLAN, hasMissingPrices: true });
        expect(open().element.textContent).toContain('combatSimUi.dungeonMissingPrices');
    });

    test('shows the food cost only when one is entered', () => {
        expect(open().element.textContent).not.toContain('dungeonConsumablesCost');

        document.body.innerHTML = '';
        mocks.plan.mockReturnValue({ ...PLAN, consumablesPerDay: 5000 });
        expect(open().element.textContent).toContain('combatSimUi.dungeonConsumablesCost');
    });
});
