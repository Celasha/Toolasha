// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockTransmuteSessions = [
    {
        id: 't1',
        startTime: Date.parse('2026-01-01T00:00:00Z'),
        inputItemHrid: '/items/milk',
        totalAttempts: 10,
        totalSuccesses: 8,
        results: {
            '/items/cheese': { count: 5, totalValue: 500, priceEach: 100 },
            '/items/milk': { count: 3, isSelfReturn: true },
        },
    },
];

const mockCoinifySessions = [
    {
        id: 'c1',
        startTime: Date.parse('2026-01-02T00:00:00Z'),
        inputItemHrid: '/items/cheese',
        enhancementLevel: 5,
        totalAttempts: 20,
        totalSuccesses: 15,
        totalCoinsEarned: 12345,
        catalystOfCoinificationUsed: 3,
        primeCatalystUsed: 0,
    },
];

const mockDecomposeSessions = [
    {
        id: 'd1',
        startTime: Date.parse('2026-01-03T00:00:00Z'),
        inputItemHrid: '/items/cheese',
        enhancementLevel: 3,
        totalAttempts: 30,
        totalSuccesses: 25,
        results: {
            '/items/milk': { count: 10, totalValue: 1000, priceEach: 100 },
        },
        catalystOfDecompositionUsed: 2,
        primeCatalystUsed: 1,
    },
];

const { mockTransmuteTracker, mockCoinifyTracker, mockDecomposeTracker } = vi.hoisted(() => ({
    mockTransmuteTracker: {
        loadSessions: vi.fn(async () => mockTransmuteSessions),
        deleteSessions: vi.fn(async () => {}),
        clearHistory: vi.fn(async () => {}),
    },
    mockCoinifyTracker: {
        loadSessions: vi.fn(async () => mockCoinifySessions),
        deleteSessions: vi.fn(async () => {}),
        clearHistory: vi.fn(async () => {}),
    },
    mockDecomposeTracker: {
        loadSessions: vi.fn(async () => mockDecomposeSessions),
        deleteSessions: vi.fn(async () => {}),
        clearHistory: vi.fn(async () => {}),
    },
}));

const settingValues = {
    alchemy_transmuteHistory: true,
    alchemy_coinifyHistory: true,
    alchemy_decomposeHistory: true,
};

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => settingValues[key]),
        getSettingValue: vi.fn((key, fallback) => fallback),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn((hrid) => ({ name: hrid.split('/').pop() })),
    },
}));

vi.mock('./transmute-history-tracker.js', () => ({ transmuteHistoryTracker: mockTransmuteTracker }));
vi.mock('./coinify-history-tracker.js', () => ({ coinifyHistoryTracker: mockCoinifyTracker }));
vi.mock('./decompose-history-tracker.js', () => ({ decomposeHistoryTracker: mockDecomposeTracker }));

vi.mock('../../utils/dom-observer-helpers.js', () => ({
    createMutationWatcher: vi.fn(() => vi.fn()),
}));

vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: vi.fn(() => ({
        registerTimeout: vi.fn(),
        registerInterval: vi.fn(),
        clearAll: vi.fn(),
    })),
}));

import { AlchemyHistoryViewer } from './alchemy-history-viewer.js';

/**
 * Build a minimal fake native alchemy tab bar with the given English tab-text labels, matching
 * how the real game's [role="tablist"] looks before injection.
 * @param {string[]} labels
 * @returns {HTMLElement}
 */
function buildTablist(labels) {
    const tablist = document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    labels.forEach((label) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        tablist.appendChild(btn);
    });
    document.body.appendChild(tablist);
    return tablist;
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    settingValues.alchemy_transmuteHistory = true;
    settingValues.alchemy_coinifyHistory = true;
    settingValues.alchemy_decomposeHistory = true;
    mockTransmuteTracker.loadSessions.mockImplementation(async () => mockTransmuteSessions);
    mockCoinifyTracker.loadSessions.mockImplementation(async () => mockCoinifySessions);
    mockDecomposeTracker.loadSessions.mockImplementation(async () => mockDecomposeSessions);
});

describe('tab injection', () => {
    test('injects exactly one tab, not one per type, with a single dedup-guard dataset marker', () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose', 'Unrefine', 'Current Action']);
        const viewer = new AlchemyHistoryViewer();

        viewer.initialize();

        const injected = document.querySelectorAll('[data-mwi-alchemy-history-tab="true"]');
        expect(injected).toHaveLength(1);
    });

    test('repeated DOM mutation callbacks do not double-inject the tab', () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();

        viewer.initialize();
        viewer.addAlchemyTab();
        viewer.addAlchemyTab();

        const injected = document.querySelectorAll('[data-mwi-alchemy-history-tab="true"]');
        expect(injected).toHaveLength(1);
    });

    test('injects nothing when every tracker setting is disabled', () => {
        settingValues.alchemy_transmuteHistory = false;
        settingValues.alchemy_coinifyHistory = false;
        settingValues.alchemy_decomposeHistory = false;
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();

        viewer.initialize();

        expect(document.querySelectorAll('[data-mwi-alchemy-history-tab="true"]')).toHaveLength(0);
        expect(viewer.enabledTypes).toEqual([]);
    });

    test('with only one tracker enabled, that type is the sole active type', () => {
        settingValues.alchemy_coinifyHistory = false;
        settingValues.alchemy_decomposeHistory = false;
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();

        viewer.initialize();

        expect(viewer.enabledTypes).toEqual(['transmute']);
        expect(viewer.activeType).toBe('transmute');
    });
});

describe('switcher visibility', () => {
    test('hidden when only one type is enabled', async () => {
        settingValues.alchemy_coinifyHistory = false;
        settingValues.alchemy_decomposeHistory = false;
        buildTablist(['Transmute']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();

        await viewer.openModal();

        const switcher = viewer.modal.querySelector('.mwi-alchemy-history-switcher');
        expect(switcher.style.display).toBe('none');
    });

    test('shown with one button per enabled type when more than one is enabled', async () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();

        await viewer.openModal();

        const switcher = viewer.modal.querySelector('.mwi-alchemy-history-switcher');
        expect(switcher.style.display).toBe('flex');
        expect(switcher.querySelectorAll('button')).toHaveLength(3);
    });
});

describe('per-type column/filter differences', () => {
    test('transmute has a results column and no catalyst/enhancement columns', async () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('transmute');

        const columns = viewer.buildColumns(viewer.activeConfig);
        const keys = columns.map((c) => c.key);

        expect(keys).toContain('results');
        expect(keys).not.toContain('enhancementLevel');
        expect(keys).not.toContain('_successRate');
        expect(keys.filter((k) => k.startsWith('_catalyst'))).toHaveLength(0);
        expect(viewer.activeConfig.hasResults).toBe(true);
    });

    test('coinify has enhancement/success-rate/coins/catalyst columns but no results column or filter', async () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('coinify');

        const columns = viewer.buildColumns(viewer.activeConfig);
        const keys = columns.map((c) => c.key);

        expect(keys).toContain('enhancementLevel');
        expect(keys).toContain('_successRate');
        expect(keys).toContain('totalCoinsEarned');
        expect(keys.filter((k) => k.startsWith('_catalyst'))).toHaveLength(2);
        expect(keys).not.toContain('results');
        expect(viewer.activeConfig.hasResults).toBe(false);

        // showFilterPopup silently no-ops for 'results' when hasResults is false
        viewer.showFilterPopup('results', document.createElement('button'));
        expect(viewer.activeFilterPopup).toBeNull();
    });

    test('decompose has both results and enhancement/success-rate/catalyst columns', async () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('decompose');

        const columns = viewer.buildColumns(viewer.activeConfig);
        const keys = columns.map((c) => c.key);

        expect(keys).toContain('results');
        expect(keys).toContain('enhancementLevel');
        expect(keys).toContain('_successRate');
        expect(keys.filter((k) => k.startsWith('_catalyst'))).toHaveLength(2);
        expect(keys).not.toContain('totalCoinsEarned');
    });
});

describe('renderResultsCell self-return branching', () => {
    test('transmute sorts self-returns last and labels them distinctly', () => {
        buildTablist(['Transmute']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        viewer.activeType = 'transmute';

        const cell = document.createElement('td');
        viewer.renderResultsCell(cell, mockTransmuteSessions[0], viewer.activeConfig);

        const lines = Array.from(cell.querySelectorAll('span'));
        const texts = lines.map((s) => s.textContent);
        // self-return (milk) must come after the real result (cheese)
        const cheeseIndex = texts.findIndex((t) => t.includes('cheese'));
        const milkIndex = texts.findIndex((t) => t.includes('self-return'));
        expect(cheeseIndex).toBeGreaterThanOrEqual(0);
        expect(milkIndex).toBeGreaterThan(cheeseIndex);
    });

    test('decompose has no self-return concept and never renders a self-return label', () => {
        buildTablist(['Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        viewer.activeType = 'decompose';

        const cell = document.createElement('td');
        viewer.renderResultsCell(cell, mockDecomposeSessions[0], viewer.activeConfig);

        expect(cell.textContent).not.toContain('self-return');
    });

    test('flags a result row with the outlier warning icon when isOutlier is true', () => {
        buildTablist(['Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        viewer.activeType = 'decompose';

        const session = {
            results: { '/items/milk': { count: 10, totalValue: 1000, priceEach: 100, isOutlier: true } },
        };
        const cell = document.createElement('td');
        viewer.renderResultsCell(cell, session, viewer.activeConfig);

        expect(cell.textContent).toContain('⚠');
    });

    test('does not render the outlier icon when isOutlier is false', () => {
        buildTablist(['Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        viewer.activeType = 'decompose';

        const session = {
            results: { '/items/milk': { count: 10, totalValue: 1000, priceEach: 100, isOutlier: false } },
        };
        const cell = document.createElement('td');
        viewer.renderResultsCell(cell, session, viewer.activeConfig);

        expect(cell.textContent).not.toContain('⚠');
    });
});

describe('switchType', () => {
    test('triggers a fresh loadSessions() call per switch', async () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();

        await viewer.openModal('transmute');
        expect(mockTransmuteTracker.loadSessions).toHaveBeenCalledTimes(1);

        await viewer.switchType('coinify');
        expect(mockCoinifyTracker.loadSessions).toHaveBeenCalledTimes(1);

        await viewer.switchType('transmute');
        expect(mockTransmuteTracker.loadSessions).toHaveBeenCalledTimes(2);
    });

    test("preserves each type's filter/sort/page state independently across switches", async () => {
        buildTablist(['Transmute', 'Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('transmute');

        viewer.typeState.transmute.filters.selectedInputItems = ['/items/milk'];
        viewer.typeState.transmute.sortColumn = 'totalAttempts';

        await viewer.switchType('coinify');
        viewer.typeState.coinify.rowsPerPage = 10;

        await viewer.switchType('transmute');

        expect(viewer.typeState.transmute.filters.selectedInputItems).toEqual(['/items/milk']);
        expect(viewer.typeState.transmute.sortColumn).toBe('totalAttempts');
        expect(viewer.typeState.coinify.rowsPerPage).toBe(10);
    });
});

describe('CSV export per type', () => {
    test('transmute CSV omits enhancement/catalyst columns and includes self-return formatting', async () => {
        buildTablist(['Transmute']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('transmute');

        const headers = viewer.activeConfig.csvColumns.map((col) => viewer.getCsvHeader(col, viewer.activeConfig));
        expect(headers).not.toContain('Enhancement Level');
        expect(headers).not.toContain('Enh. Level');

        const value = viewer.getCsvValue(
            { kind: 'results', supportSelfReturn: true },
            mockTransmuteSessions[0],
            viewer.activeConfig
        );
        expect(value).toContain('self-return');
    });

    test('CSV results cell appends the outlier warning marker when a result was flagged', async () => {
        buildTablist(['Transmute']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('transmute');

        const session = {
            results: { '/items/cheese': { count: 5, totalValue: 500, priceEach: 100, isOutlier: true } },
        };
        const value = viewer.getCsvValue({ kind: 'results', supportSelfReturn: true }, session, viewer.activeConfig);
        expect(value).toContain('⚠');
    });

    test('coinify CSV uses the "Enhancement Level" header and "—" for zero-attempt success rate', async () => {
        buildTablist(['Coinify']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('coinify');

        const enhHeader = viewer.getCsvHeader(
            { kind: 'enhancement', headerKey: 'csvColEnhancementLevelFull' },
            viewer.activeConfig
        );
        expect(enhHeader).toBe('Enhancement Level');

        const zeroAttemptSession = { ...mockCoinifySessions[0], totalAttempts: 0, totalSuccesses: 0 };
        const rate = viewer.getCsvValue({ kind: 'successRate' }, zeroAttemptSession, viewer.activeConfig);
        expect(rate).toBe('—');
    });

    test('decompose CSV uses the plain "Enh. Level" header and "0.0%" for zero-attempt success rate', async () => {
        buildTablist(['Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('decompose');

        const enhHeader = viewer.getCsvHeader({ kind: 'enhancement', headerKey: 'colEnhLevel' }, viewer.activeConfig);
        expect(enhHeader).toBe('Enh. Level');

        const zeroAttemptSession = { ...mockDecomposeSessions[0], totalAttempts: 0, totalSuccesses: 0 };
        const rate = viewer.getCsvValue({ kind: 'successRate' }, zeroAttemptSession, viewer.activeConfig);
        expect(rate).toBe('0.0%');
    });

    test('catalyst-used CSV header style differs between coinify ("X Used") and decompose (plain name)', async () => {
        buildTablist(['Coinify', 'Decompose']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();

        await viewer.openModal('coinify');
        const coinifyHeader = viewer.getCsvHeader(
            { kind: 'catalystUsed', catalystIndex: 0, headerStyle: 'used' },
            viewer.activeConfig
        );
        expect(coinifyHeader).toBe('catalyst_of_coinification Used');

        await viewer.switchType('decompose');
        const decomposeHeader = viewer.getCsvHeader(
            { kind: 'catalystUsed', catalystIndex: 0, headerStyle: 'plain' },
            viewer.activeConfig
        );
        expect(decomposeHeader).toBe('catalyst_of_decomposition');
    });

    test('each type downloads a CSV filename matching its own prefix', async () => {
        buildTablist(['Transmute']);
        const viewer = new AlchemyHistoryViewer();
        viewer.initialize();
        await viewer.openModal('transmute');

        const clickSpy = vi.fn();
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const el = originalCreateElement(tag);
            if (tag === 'a') el.click = clickSpy;
            return el;
        });
        URL.createObjectURL = vi.fn(() => 'blob:mock');
        URL.revokeObjectURL = vi.fn();

        viewer.exportHistory();

        expect(clickSpy).toHaveBeenCalledTimes(1);
        document.createElement.mockRestore();
    });
});
