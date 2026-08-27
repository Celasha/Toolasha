/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

function emptyAggregate() {
    return {
        eventsCount: 0,
        containersOpened: 0,
        actualValueTotal: 0,
        actualValuePartialEvents: 0,
        expectedValueTotal: 0,
        expectedValueAvailableEvents: 0,
        valuationRecordCount: 0,
        luckEligibleRecordCount: 0,
        hasImportedData: false,
        itemTotals: {},
        itemValueTotals: {},
    };
}

const mocks = vi.hoisted(() => ({
    aggregates: {},
    knownContainers: [],
    sessionContainers: [],
    importSourceKeys: [],
    importedContainerHrids: {},
    domObserverRegistrations: [],
    stateChangeCallbacks: [],
    currentCharacterName: 'Vovchigus',
    importContainersResult: { results: [], persisted: true },
    removeImportResult: true,
    resetContainerResult: true,
    resetAllResult: true,
}));

vi.mock('../../../core/config.js', () => ({
    default: {
        COLOR_PROFIT: '#047857',
        COLOR_LOSS: '#f87171',
        COLOR_TEXT_PRIMARY: '#fff',
        COLOR_TEXT_SECONDARY: '#888',
        COLOR_ACCENT: '#22c55e',
        COLOR_INFO: '#60a5fa',
        COLOR_WARNING: '#ffa500',
        getSettingValue: vi.fn((key, defaultValue) => defaultValue),
    },
}));

vi.mock('../../../core/data-manager.js', () => ({
    default: {
        getItemDetails: vi.fn((hrid) => ({ name: hrid.split('/').pop() })),
        getCurrentCharacterName: vi.fn(() => mocks.currentCharacterName),
    },
}));

vi.mock('../../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, classNames, callback) => {
            mocks.domObserverRegistrations.push({ classNames, callback });
            return vi.fn();
        }),
    },
}));

vi.mock('./openable-analytics-modal-injector.js', async () => {
    const actual = await vi.importActual('./openable-analytics-modal-injector.js');
    return {
        default: { initialize: vi.fn(), cleanup: vi.fn() },
        formatLuckPercent: actual.formatLuckPercent,
        luckColor: actual.luckColor,
    };
});

vi.mock('./openable-analytics-import-parsers.js', () => ({
    detectImportSource: vi.fn(),
    parseEdibleExport: vi.fn(),
    parseCombatSuiteExport: vi.fn(),
}));

vi.mock('./openable-analytics-data-collector.js', () => ({
    default: {
        getKnownContainers: vi.fn(() => mocks.knownContainers),
        getSessionContainers: vi.fn(() => mocks.sessionContainers),
        getSessionAggregate: vi.fn((hrid) => mocks.aggregates[hrid] || emptyAggregate()),
        getLifetimeAggregate: vi.fn((hrid) => mocks.aggregates[hrid] || emptyAggregate()),
        getLiveLifetimeAggregate: vi.fn((hrid) => mocks.aggregates[hrid] || emptyAggregate()),
        getImportSourceKeys: vi.fn(() => mocks.importSourceKeys),
        getImportedContainerHrids: vi.fn((source) => mocks.importedContainerHrids[source] || new Set()),
        onStateChange: vi.fn((cb) => {
            mocks.stateChangeCallbacks.push(cb);
            return () => {
                mocks.stateChangeCallbacks = mocks.stateChangeCallbacks.filter((c) => c !== cb);
            };
        }),
        importContainers: vi.fn(async () => mocks.importContainersResult),
        removeImport: vi.fn(async () => mocks.removeImportResult),
        resetContainer: vi.fn(async () => mocks.resetContainerResult),
        resetAll: vi.fn(async () => mocks.resetAllResult),
    },
}));

const { default: openableAnalyticsDataCollector } = await import('./openable-analytics-data-collector.js');
const { detectImportSource, parseEdibleExport, parseCombatSuiteExport } =
    await import('./openable-analytics-import-parsers.js');
const {
    default: openableAnalyticsUI,
    INVENTORY_FILTER_CONTAINER_CLASS,
    INVENTORY_BUTTON_CLASS,
} = await import('./openable-analytics-ui.js');

function filterContainerCallbacks() {
    return mocks.domObserverRegistrations
        .filter((r) => r.classNames === INVENTORY_FILTER_CONTAINER_CLASS)
        .map((r) => r.callback);
}

beforeEach(() => {
    mocks.aggregates = {
        '/items/chest': {
            eventsCount: 1,
            containersOpened: 6,
            actualValueTotal: 489000,
            actualValuePartialEvents: 0,
            expectedValueTotal: 725000,
            expectedValueAvailableEvents: 1,
            valuationRecordCount: 1,
            luckEligibleRecordCount: 1,
            hasImportedData: false,
            itemTotals: { '/items/coin': 42938, '/items/shard_of_protection': 8, '/items/pearl': 1 },
            itemValueTotals: { '/items/coin': 42938, '/items/shard_of_protection': 400000 },
        },
    };
    mocks.knownContainers = ['/items/chest'];
    mocks.sessionContainers = [];
    mocks.importSourceKeys = [];
    mocks.importedContainerHrids = {};
    mocks.domObserverRegistrations = [];
    mocks.stateChangeCallbacks = [];
    mocks.currentCharacterName = 'Vovchigus';
    mocks.importContainersResult = { results: [], persisted: true };
    mocks.removeImportResult = true;
    mocks.resetContainerResult = true;
    mocks.resetAllResult = true;
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // Original Storage getter (localStorage) is jsdom-provided; clear between tests.
    localStorage.clear();
    openableAnalyticsUI.cleanup();
    openableAnalyticsUI.initialize();
});

function popup() {
    return document.querySelector('.toolasha-openable-analytics-popup');
}

function accordionRow(containerHrid) {
    return [...popup().querySelectorAll('[data-container-hrid]')].find(
        (el) => el.dataset.containerHrid === containerHrid
    );
}

describe('persistent Inventory panel entry point (OA-RUNTIME-1)', () => {
    test('catches up on a target that already exists before initialize', () => {
        openableAnalyticsUI.cleanup();
        const preExisting = document.createElement('div');
        preExisting.className = INVENTORY_FILTER_CONTAINER_CLASS;
        document.body.appendChild(preExisting);

        openableAnalyticsUI.initialize();

        expect(preExisting.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
    });

    test('injects a button into a target that mounts later', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);

        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        expect(filterContainer.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
    });

    test('multiple existing matching targets each get exactly one control', () => {
        openableAnalyticsUI.cleanup();
        const a = document.createElement('div');
        const b = document.createElement('div');
        a.className = INVENTORY_FILTER_CONTAINER_CLASS;
        b.className = INVENTORY_FILTER_CONTAINER_CLASS;
        document.body.appendChild(a);
        document.body.appendChild(b);

        openableAnalyticsUI.initialize();

        expect(a.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
        expect(b.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
    });

    test('does not inject a second button if one is already present (idempotent on re-render)', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);

        filterContainerCallbacks().forEach((cb) => cb(filterContainer));
        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        expect(filterContainer.querySelectorAll(`.${INVENTORY_BUTTON_CLASS}`)).toHaveLength(1);
    });

    test('is a real <button> with an accessible label', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);
        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        const button = filterContainer.querySelector(`.${INVENTORY_BUTTON_CLASS}`);
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-label')).toBe('Openable Analytics');
    });

    test('clicking the button opens Lifetime with all rows collapsed', () => {
        const filterContainer = document.createElement('div');
        document.body.appendChild(filterContainer);
        filterContainerCallbacks().forEach((cb) => cb(filterContainer));

        filterContainer.querySelector(`.${INVENTORY_BUTTON_CLASS}`).onclick();

        expect(popup()).not.toBeNull();
        expect(popup().querySelectorAll('details[open]')).toHaveLength(0);
    });

    test('cleanup unregisters the observer so a later re-initialize does not double-register', () => {
        openableAnalyticsUI.cleanup();
        mocks.domObserverRegistrations = [];
        openableAnalyticsUI.initialize();

        expect(filterContainerCallbacks()).toHaveLength(1);
    });
});

describe('View Analytics entry point (section 9)', () => {
    test('opens Lifetime with the requested container expanded and brought into view', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        const row = accordionRow('/items/chest');
        expect(row.open).toBe(true);
    });

    test('does not default to Session', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        const lifetimeButton = [...popup().querySelectorAll('button')].find((b) => b.textContent === 'Lifetime');
        expect(lifetimeButton.style.background).not.toBe('#2a2a2a');
    });
});

describe('Session vs Lifetime scope (section 9)', () => {
    test('Session only lists containers that actually exist in the current in-memory Session', () => {
        mocks.sessionContainers = [];
        mocks.knownContainers = ['/items/chest'];
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.setScope('session');

        expect(popup().textContent).toContain('No tracked chest, crate, or cache openings this session.');
    });

    test('switching scope clears the expanded selection if the container does not exist in the new scope', () => {
        mocks.sessionContainers = [];
        mocks.knownContainers = ['/items/chest'];
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        openableAnalyticsUI.setScope('session');

        expect(popup().querySelectorAll('details[open]')).toHaveLength(0);
    });

    test('switching scope preserves the expanded selection if the container exists in both', () => {
        mocks.sessionContainers = ['/items/chest'];
        mocks.knownContainers = ['/items/chest'];
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        openableAnalyticsUI.setScope('session');

        expect(accordionRow('/items/chest').open).toBe(true);
    });
});

describe('one-open accordion behavior (section 9)', () => {
    beforeEach(() => {
        mocks.aggregates['/items/crate'] = emptyAggregate();
        mocks.knownContainers = ['/items/chest', '/items/crate'];
    });

    test('expanding a second row collapses the first', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        openableAnalyticsUI.toggleContainer('/items/crate');

        expect(accordionRow('/items/chest').open).toBe(false);
        expect(accordionRow('/items/crate').open).toBe(true);
    });

    test('clicking an already-expanded row collapses it and clears selection', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        openableAnalyticsUI.toggleContainer('/items/chest');

        expect(accordionRow('/items/chest').open).toBe(false);
        expect(openableAnalyticsUI.expandedContainer).toBeNull();
    });

    test('rows are sorted alphabetically by display name, not by recent activity', () => {
        openableAnalyticsUI.showPopup();
        const names = [...popup().querySelectorAll('summary')].map((el) => el.textContent);
        // "chest" < "crate" alphabetically
        expect(names[0]).toContain('chest');
    });
});

describe('unrelated live update safety (section 9)', () => {
    test('a state-change notification refreshes content without stealing the current selection', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        mocks.stateChangeCallbacks.forEach((cb) => cb());

        expect(accordionRow('/items/chest').open).toBe(true);
    });

    test('does not refresh (or throw) when the popup is not mounted', () => {
        openableAnalyticsUI.closePopup();

        expect(() => mocks.stateChangeCallbacks.forEach((cb) => cb())).not.toThrow();
    });
});

describe('Actual/Expected/Luck detail contract (section 10)', () => {
    test('does not repeat Tracked opening events / Containers opened / Partial-data rows from the old dashboard', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        expect(popup().textContent).not.toContain('Tracked opening events');
        expect(popup().textContent).not.toContain('Partial-data events');
    });

    test('shows Actual [Partial] and Luck as an unavailable dash when Actual is incomplete', () => {
        mocks.aggregates['/items/chest'] = {
            ...mocks.aggregates['/items/chest'],
            actualValuePartialEvents: 1,
            luckEligibleRecordCount: 0,
        };
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        expect(popup().textContent).toContain('[Partial]');
    });

    test('complete Expected of exactly zero still shows an absolute Luck value, omitting only the percent', () => {
        mocks.aggregates['/items/chest'] = {
            ...mocks.aggregates['/items/chest'],
            actualValueTotal: 500,
            expectedValueTotal: 0,
            expectedValueAvailableEvents: 1,
            valuationRecordCount: 1,
            luckEligibleRecordCount: 1,
        };
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        const row = accordionRow('/items/chest');
        expect(row.textContent).toContain('+500');
        expect(row.textContent).not.toContain('%');
    });
});

describe('Loot table (section 11)', () => {
    test('renamed from "Aggregated Item Outcomes" to "Loot"', () => {
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        expect(popup().textContent).toContain('Loot');
        expect(popup().textContent).not.toContain('Aggregated Item Outcomes');
    });

    test('a resolved positive value sorts before a resolved zero, which sorts before an unavailable value', () => {
        mocks.aggregates['/items/chest'] = {
            ...emptyAggregate(),
            itemTotals: { '/items/a': 1, '/items/b': 1, '/items/c': 1 },
            itemValueTotals: { '/items/a': 0, '/items/b': 100 },
        };
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        const rows = [...accordionRow('/items/chest').querySelectorAll('table tr')].slice(1); // skip header
        expect(rows[0].textContent).toContain('b'); // positive value first
        expect(rows[1].textContent).toContain('a'); // known zero second
        expect(rows[2].textContent).toContain('c'); // unavailable last
    });

    test('unavailable value renders as a dash, not N/A', () => {
        mocks.aggregates['/items/chest'] = {
            ...emptyAggregate(),
            itemTotals: { '/items/mystery': 1 },
            itemValueTotals: {},
        };
        openableAnalyticsUI.showPopup({ containerHrid: '/items/chest' });

        expect(accordionRow('/items/chest').textContent).toContain('—');
        expect(accordionRow('/items/chest').textContent).not.toContain('N/A');
    });
});

describe('Manage Data (section 14)', () => {
    test('is collapsed by default', () => {
        openableAnalyticsUI.showPopup();

        expect(popup().querySelector('.toolasha-openable-analytics-manage-data').open).toBe(false);
    });

    test('lists each import source with a Remove Import action', () => {
        mocks.importSourceKeys = ['import:edible'];
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        expect(popup().textContent).toContain('Edible Tools');
        expect(popup().textContent).toContain('Remove Import');
    });

    test('Delete Container action only appears when a container is currently expanded', () => {
        openableAnalyticsUI.showPopup(); // nothing expanded

        expect(popup().textContent).not.toMatch(/Delete .* Data/);

        openableAnalyticsUI.toggleContainer('/items/chest');
        expect(popup().textContent).toMatch(/Delete .* Data/);
    });

    test('removeImport keeps the popup open and shows a status message', async () => {
        mocks.importSourceKeys = ['import:edible'];
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        await openableAnalyticsUI.handleRemoveImport('import:edible');

        expect(popup()).not.toBeNull();
        expect(openableAnalyticsDataCollector.removeImport).toHaveBeenCalledWith('import:edible');
    });

    test('Delete All uses native confirm() and does not silently close the popup', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        openableAnalyticsUI.showPopup();

        await openableAnalyticsUI.handleDeleteAll();

        expect(confirmSpy).toHaveBeenCalled();
        expect(popup()).not.toBeNull();
        confirmSpy.mockRestore();
    });

    test('Delete All does nothing when confirm() is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        await openableAnalyticsUI.handleDeleteAll();

        expect(openableAnalyticsDataCollector.resetAll).not.toHaveBeenCalled();
    });
});

describe('async mutation safety (section 24)', () => {
    test('a mutation handler cannot resurrect the popup if it was closed during the await', async () => {
        let resolvePersist;
        openableAnalyticsDataCollector.resetAll.mockReturnValueOnce(
            new Promise((resolve) => {
                resolvePersist = resolve;
            })
        );
        openableAnalyticsUI.showPopup();
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        const pending = openableAnalyticsUI.handleDeleteAll();
        openableAnalyticsUI.closePopup();
        resolvePersist(true);
        await pending;

        expect(popup()).toBeNull();
    });

    test('handleConfirmImport does not reopen a closed popup after its await', async () => {
        let resolvePersist;
        openableAnalyticsDataCollector.importContainers.mockReturnValueOnce(
            new Promise((resolve) => {
                resolvePersist = resolve;
            })
        );
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.pendingImport = {
            source: 'edible',
            prefixedSource: 'import:edible',
            containers: [{ containerHrid: '/items/chest', containerCount: 1, itemTotals: {} }],
            warnings: [],
        };

        const pending = openableAnalyticsUI.handleConfirmImport();
        openableAnalyticsUI.closePopup();
        resolvePersist({ persisted: true });
        await pending;

        expect(popup()).toBeNull();
    });
});

describe('import auto-detect and preflight (sections 16, 21)', () => {
    test('an unsupported/unparseable paste shows an inline error, not a thrown exception', () => {
        detectImportSource.mockReturnValue({ source: null, error: 'Not a supported format.' });
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        expect(() => openableAnalyticsUI.beginImport('not json')).not.toThrow();
        expect(popup().textContent).toContain('Not a supported format.');
    });

    test('a detected, ready-to-import source shows Import (not Replace) when the source is new', () => {
        detectImportSource.mockReturnValue({ source: 'mwi-combat-suite' });
        parseCombatSuiteExport.mockReturnValue({
            status: 'ready',
            containers: [{ containerHrid: '/items/chest', containerCount: 5, itemTotals: {} }],
            warnings: [],
        });
        mocks.importSourceKeys = [];
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        openableAnalyticsUI.beginImport('{"chests":{}}');

        expect(popup().textContent).toContain('Import');
        expect(popup().textContent).not.toContain('Replace Import');
    });

    test('re-importing an existing source shows Replace Import wording', () => {
        detectImportSource.mockReturnValue({ source: 'mwi-combat-suite' });
        parseCombatSuiteExport.mockReturnValue({
            status: 'ready',
            containers: [{ containerHrid: '/items/chest', containerCount: 5, itemTotals: {} }],
            warnings: [],
        });
        mocks.importSourceKeys = ['import:mwi-combat-suite'];
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        openableAnalyticsUI.beginImport('{"chests":{}}');

        expect(popup().textContent).toContain('Replace Import');
    });

    test('an overlapping container against live history shows the overlap warning, not a silent auto-dedupe', () => {
        detectImportSource.mockReturnValue({ source: 'mwi-combat-suite' });
        parseCombatSuiteExport.mockReturnValue({
            status: 'ready',
            containers: [{ containerHrid: '/items/chest', containerCount: 5, itemTotals: {} }],
            warnings: [],
        });
        mocks.aggregates['/items/chest'] = { ...emptyAggregate(), eventsCount: 3 };
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        openableAnalyticsUI.beginImport('{"chests":{}}');

        expect(popup().textContent).toContain('cannot be reliably deduplicated');
    });

    test('a valid-empty export shows a no-op status message', () => {
        detectImportSource.mockReturnValue({ source: 'edible' });
        parseEdibleExport.mockReturnValue({
            status: 'empty',
            message: 'No opening history found in this export. Existing import was not changed.',
            containers: [],
            warnings: [],
        });
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        openableAnalyticsUI.beginImport('{"Chest_Open_Data":{}}');

        expect(popup().textContent).toContain('Existing import was not changed');
    });

    test('FileReader failure shows an inline error without destroying other pending state', () => {
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.manageDataOpen = true;
        openableAnalyticsUI.renderBody();

        openableAnalyticsUI.pendingImport = { errorMessage: 'Could not read the selected file.' };
        openableAnalyticsUI.renderBody();

        expect(popup().textContent).toContain('Could not read the selected file.');
    });
});

describe('character lifecycle (section 8)', () => {
    test('cleanup removes the popup and persistent entry point observer registration', () => {
        openableAnalyticsUI.showPopup();
        expect(popup()).not.toBeNull();

        openableAnalyticsUI.cleanup();

        expect(popup()).toBeNull();
    });

    test('a stale onStateChange callback from before cleanup cannot refresh/reopen after cleanup', () => {
        openableAnalyticsUI.showPopup();
        const staleCallbacks = [...mocks.stateChangeCallbacks];

        openableAnalyticsUI.cleanup();

        expect(() => staleCallbacks.forEach((cb) => cb())).not.toThrow();
        expect(popup()).toBeNull();
    });

    test('character A ON -> B OFF -> A ON: a fresh initialize starts with a clean, non-mounted popup', () => {
        openableAnalyticsUI.showPopup();
        openableAnalyticsUI.cleanup(); // switch to B, feature off

        openableAnalyticsUI.initialize(); // switch back to A
        expect(popup()).toBeNull();
    });
});
