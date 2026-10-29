/**
 * Tests for the level-aware filter in Alchemy Best Items: max-level filtering, the lookahead
 * shortcut, the pre-fill setting, and the per-row availability coloring against the player's
 * real current Alchemy level.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    settingValues: { alchemyBestItems_prefillLevelFilter: true },
    skills: [{ skillHrid: '/skills/alchemy', level: 40 }],
    itemDetailMap: {},
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => mocks.settingValues[key]),
        COLOR_ACCENT: '#60a5fa',
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap: mocks.itemDetailMap })),
        getSkills: vi.fn(() => mocks.skills),
        getItemDetails: vi.fn((hrid) => mocks.itemDetailMap[hrid] ?? null),
    },
}));

vi.mock('../enhancement/untradable-cape-value.js', () => ({
    getUntradableCapeValue: vi.fn(() => 12345),
}));

vi.mock('../../core/i18n.js', () => ({ t: (key, params) => (params?.value ? `${key}:${params.value}` : key) }));

vi.mock('../market/alchemy-profit-calculator.js', () => ({
    default: {
        calculateCoinifyProfit: vi.fn(() => ({
            profitPerHour: 100,
            actionsPerHour: 10,
            successRate: 1,
            winningCatalystHrid: null,
            hasOutlierPrices: false,
        })),
        calculateDecomposeProfit: vi.fn(),
        calculateTransmuteProfit: vi.fn(),
    },
}));

vi.mock('../../utils/experience-parser.js', () => ({
    calculateExperienceMultiplier: vi.fn(() => ({ totalMultiplier: 1 })),
}));

vi.mock('../../utils/formatters.js', () => ({
    formatKMB: vi.fn((n) => String(n)),
    formatWithSeparator: vi.fn((n) => String(n)),
    formatPercentage: vi.fn((n) => String(n)),
}));

vi.mock('../../utils/market-data.js', () => ({
    getItemPrice: vi.fn(() => 100),
}));

vi.mock('../../utils/game-i18n.js', () => ({
    getItemName: vi.fn((hrid, fallback) => fallback),
    getActionName: vi.fn((hrid, fallback) => fallback),
}));

vi.mock('../../utils/warning-icon.js', () => ({
    buildOutlierPriceWarningIcon: vi.fn(() => ''),
}));

vi.mock('../../utils/asset-manifest.js', () => ({
    default: { getSpriteUrl: vi.fn(async () => 'sprite-url') },
}));

vi.mock('../../utils/dom-observer-helpers.js', () => ({
    createMutationWatcher: vi.fn(() => vi.fn()),
}));

vi.mock('../../utils/marketplace-tabs.js', () => ({
    navigateToMarketplace: vi.fn(),
}));

import { AlchemyBestItems } from './alchemy-best-items.js';

function buildItem(hrid, { itemLevel, name = hrid }) {
    mocks.itemDetailMap[hrid] = {
        name,
        itemLevel,
        alchemyDetail: { isCoinifiable: true },
    };
}

describe('AlchemyBestItems level-aware filter (player-level accounting)', () => {
    let instance;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settingValues = { alchemyBestItems_prefillLevelFilter: true };
        mocks.skills = [{ skillHrid: '/skills/alchemy', level: 40 }];
        mocks.itemDetailMap = {};
        instance = new AlchemyBestItems();
    });

    function levelMaxInput() {
        return instance.modal.querySelector('[data-mwi-level-max]');
    }

    function lookaheadInput() {
        return instance.modal.querySelector('[data-mwi-lookahead]');
    }

    function levelCells() {
        return [...instance.modal.querySelectorAll('[data-mwi-best-table] tbody tr td:nth-child(3)')];
    }

    test('the max level filter is pre-filled from the player current Alchemy level when the setting is on', async () => {
        buildItem('/items/a', { itemLevel: 10 });
        await instance.openModal();

        expect(levelMaxInput().value).toBe('40');
        expect(instance.filterLevelMax).toBe(40);
    });

    test('the max level filter stays empty when the pre-fill setting is off', async () => {
        mocks.settingValues.alchemyBestItems_prefillLevelFilter = false;
        buildItem('/items/a', { itemLevel: 10 });
        await instance.openModal();

        expect(levelMaxInput().value).toBe('');
        expect(instance.filterLevelMax).toBeNull();
    });

    test('rows above the max level filter are excluded from the rendered table', async () => {
        buildItem('/items/low', { itemLevel: 10, name: 'Low Item' });
        buildItem('/items/high', { itemLevel: 80, name: 'High Item' });
        await instance.openModal();

        const names = [...instance.modal.querySelectorAll('[data-mwi-best-table] tbody tr td:nth-child(2)')].map(
            (td) => td.textContent
        );
        expect(names).toContain('Low Item');
        expect(names).not.toContain('High Item');
    });

    test('the lookahead field raises the max level filter above the real current level without changing it', async () => {
        buildItem('/items/a', { itemLevel: 10 });
        await instance.openModal();

        const lookahead = lookaheadInput();
        lookahead.value = '15';
        lookahead.dispatchEvent(new Event('change'));

        expect(levelMaxInput().value).toBe('55'); // 40 (player level) + 15
        expect(instance.filterLevelMax).toBe(55);
        expect(mocks.skills[0].level).toBe(40); // lookahead never mutates the real skill level
    });

    test('a row revealed only via lookahead still renders with the not-yet-unlocked (red) color, not green', async () => {
        buildItem('/items/preview', { itemLevel: 50, name: 'Preview Item' });
        await instance.openModal(); // pre-filled max is 40, so this row starts filtered out

        const lookahead = lookaheadInput();
        lookahead.value = '20';
        lookahead.dispatchEvent(new Event('change'));

        const cells = levelCells();
        expect(cells).toHaveLength(1);
        expect(cells[0].style.color).toBe('rgb(248, 113, 113)'); // #f87171 - not unlocked
    });

    test('a row at or below the real current level renders with the unlocked (green) color', async () => {
        buildItem('/items/ready', { itemLevel: 40, name: 'Ready Item' });
        await instance.openModal();

        const cells = levelCells();
        expect(cells).toHaveLength(1);
        expect(cells[0].style.color).toBe('rgb(74, 222, 128)'); // #4ade80 - unlocked
    });

    test('availability coloring compares the player real level, not the filter value, when the filter is raised manually', async () => {
        buildItem('/items/above', { itemLevel: 45, name: 'Above Item' });
        await instance.openModal();

        const levelInput = levelMaxInput();
        levelInput.value = '100'; // user manually widens the filter well past their real level
        levelInput.dispatchEvent(new Event('change'));

        const cells = levelCells();
        expect(cells).toHaveLength(1);
        expect(cells[0].style.color).toBe('rgb(248, 113, 113)'); // still red - player is level 40, item needs 45
    });
});

describe('AlchemyBestItems untradable items', () => {
    let instance;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settingValues = { alchemyBestItems_prefillLevelFilter: false };
        mocks.skills = [{ skillHrid: '/skills/alchemy', level: 100 }];
        mocks.itemDetailMap = {};
        instance = new AlchemyBestItems();
    });

    function nameCells() {
        return [...instance.modal.querySelectorAll('[data-mwi-best-table] tbody tr td:nth-child(2)')];
    }

    test('an untradable cape gets an asterisk and a tooltip with its assumed value', async () => {
        buildItem('/items/chance_cape', { itemLevel: 80, name: 'Chance Cape' });
        await instance.openModal();

        const [cell] = nameCells();
        expect(cell.textContent).toBe('Chance Cape*');
        expect(cell.title).toBe('alchemyBestItems.untradeableTooltip:12345');
    });

    test('a tradable item gets no asterisk or tooltip', async () => {
        buildItem('/items/iron_bar', { itemLevel: 10, name: 'Iron Bar' });
        await instance.openModal();

        const [cell] = nameCells();
        expect(cell.textContent).toBe('Iron Bar');
        expect(cell.title).toBe('');
    });
});
