/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const PRICING_LABELS = {
    conservative: 'Buy: Ask / Sell: Bid',
    hybrid: 'Buy: Ask / Sell: Ask',
    optimistic: 'Buy: Bid / Sell: Ask',
    patientBuy: 'Buy: Bid / Sell: Bid',
};

const mocks = vi.hoisted(() => ({
    settingsLoadedHandlers: [],
    settings: {
        actionPanel_showFilter: true,
        actionPanel_showSort: true,
        actionPanel_showPricingMode: true,
        actionPanel_showCraftToggle: true,
        profitCalc_craftUpgradeItems: false,
    },
    pricingMode: 'hybrid',
    titleCallback: null,
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => mocks.settings[key] ?? false),
        getSettingValue: vi.fn((key, fallback) => (key === 'profitCalc_pricingMode' ? mocks.pricingMode : fallback)),
        setSettingValue: vi.fn(),
        setSetting: vi.fn(),
        getPricingModeLabel: vi.fn((mode) => PRICING_LABELS[mode] || PRICING_LABELS.hybrid),
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
        onSettingsLoaded: vi.fn((cb) => mocks.settingsLoadedHandlers.push(cb)),
        offSettingsLoaded: vi.fn((cb) => {
            mocks.settingsLoadedHandlers = mocks.settingsLoadedHandlers.filter((h) => h !== cb);
        }),
        COLOR_ACCENT: '#22c55e',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, _cls, cb) => {
            mocks.titleCallback = cb;
            return () => {};
        }),
    },
}));

vi.mock('./action-panel-sort.js', () => ({
    default: {
        getSortMode: vi.fn(() => 'default'),
        onSortModeChange: vi.fn(() => () => {}),
        setSortMode: vi.fn(),
        sortPanelsByProfit: vi.fn(),
    },
}));

vi.mock('./profit-display.js', () => ({
    displayGatheringProfit: vi.fn(async () => {}),
    displayProductionProfit: vi.fn(async () => {}),
}));

import config from '../../core/config.js';
import actionFilter from './action-filter.js';
import { displayProductionProfit } from './profit-display.js';

function makeTitle() {
    const title = document.createElement('h1');
    title.className = 'GatheringProductionSkillPanel_title__3VihQ';
    const nameDiv = document.createElement('div');
    nameDiv.textContent = 'Cooking';
    title.appendChild(nameDiv);
    document.body.appendChild(title);
    return title;
}

function fireSettingsLoaded() {
    mocks.settingsLoadedHandlers.slice().forEach((cb) => cb());
}

describe('ActionFilter mode/profit synchronization after a character-switch settings reload', () => {
    beforeEach(async () => {
        document.body.innerHTML = '';
        mocks.settingsLoadedHandlers = [];
        mocks.pricingMode = 'hybrid';
        mocks.titleCallback = null;
        vi.clearAllMocks();
        await actionFilter.initialize();
    });

    afterEach(() => {
        actionFilter.cleanup();
    });

    test('registers a settings-loaded listener at initialize, separate from the per-setting pricing mode callback', () => {
        expect(config.onSettingsLoaded).toHaveBeenCalledWith(expect.any(Function));
    });

    test('mode button resyncs to the loaded pricing mode once settings finish loading, without a click', () => {
        const title = makeTitle();
        mocks.titleCallback(title);

        const modeBtn = document.getElementById('mwi-action-profit-mode');
        // Injected while the config cache was still empty, so it shows the fallback mode.
        expect(modeBtn.textContent).toBe(`Mode: ${PRICING_LABELS.hybrid}`);

        // The new character's saved mode is optimistic; settings finish loading.
        mocks.pricingMode = 'optimistic';
        fireSettingsLoaded();

        expect(modeBtn.textContent).toBe(`Mode: ${PRICING_LABELS.optimistic}`);
    });

    test('does not write a fallback mode back to storage merely from the settings-loaded resync', () => {
        const title = makeTitle();
        mocks.titleCallback(title);

        mocks.pricingMode = 'optimistic';
        fireSettingsLoaded();

        expect(config.setSettingValue).not.toHaveBeenCalled();
        expect(config.setSetting).not.toHaveBeenCalled();
    });

    test('an already-rendered production profit section recomputes exactly once from the loaded mode', async () => {
        const title = makeTitle();
        mocks.titleCallback(title);

        // A profit section rendered while the mode lookup would still fall back to hybrid.
        const panel = document.createElement('div');
        panel.className = 'SkillActionDetail_regularComponent__3oCgr';
        const section = document.createElement('div');
        section.dataset.mwiActionHrid = '/actions/cooking/yogurt_can';
        section.dataset.mwiActionType = 'production';
        panel.appendChild(section);
        document.body.appendChild(panel);

        mocks.pricingMode = 'optimistic';
        fireSettingsLoaded();
        await Promise.resolve();
        await Promise.resolve();

        expect(displayProductionProfit).toHaveBeenCalledTimes(1);
        expect(displayProductionProfit).toHaveBeenCalledWith(
            panel,
            '/actions/cooking/yogurt_can',
            'div.SkillActionDetail_dropTable__3ViVp'
        );
    });

    test('re-initializing an already-initialized filter does not register a duplicate settings-loaded listener', async () => {
        // beforeEach already called initialize() once (count 1); a second call must be a no-op.
        await actionFilter.initialize();

        expect(config.onSettingsLoaded).toHaveBeenCalledTimes(1);
    });
});

describe('ActionFilter stale filterValue must not leak into non-filterable pages (e.g. Combat Zones)', () => {
    beforeEach(async () => {
        document.body.innerHTML = '';
        mocks.settingsLoadedHandlers = [];
        mocks.pricingMode = 'hybrid';
        mocks.titleCallback = null;
        vi.clearAllMocks();
        await actionFilter.initialize();
    });

    afterEach(() => {
        actionFilter.cleanup();
    });

    function makeTile(name) {
        const tile = document.createElement('div');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        nameDiv.textContent = name;
        tile.appendChild(nameDiv);
        document.body.appendChild(tile);
        return tile;
    }

    test('a tile registering after the filtered title bar is removed from the DOM is not hidden by the stale filter', () => {
        const title = makeTitle();
        mocks.titleCallback(title);
        actionFilter.filterValue = 'milk';

        // Simulate navigating away from the filterable skill page (e.g. to Combat Zones): the
        // title bar's React node is unmounted, but no new filterable title appears to replace it.
        title.remove();

        const zoneTile = makeTile('Aqua Planet');
        actionFilter.registerPanel(zoneTile, 'Aqua Planet');

        expect(actionFilter.filterValue).toBe('');
        expect(zoneTile.dataset.mwiFilterHidden).not.toBe('true');
        expect(zoneTile.style.display).not.toBe('none');
    });

    test('multiple tiles registering after navigating away all stay visible, not just the first', () => {
        const title = makeTitle();
        mocks.titleCallback(title);
        actionFilter.filterValue = 'milk';
        title.remove();

        const tileA = makeTile('Smelly Planet');
        const tileB = makeTile('Aqua Planet');
        actionFilter.registerPanel(tileA, 'Smelly Planet');
        actionFilter.registerPanel(tileB, 'Aqua Planet');

        expect(tileA.style.display).not.toBe('none');
        expect(tileB.style.display).not.toBe('none');
    });

    test('a live filter on the same page still applies normally (no regression to in-page filtering)', () => {
        const title = makeTitle();
        mocks.titleCallback(title);
        actionFilter.filterValue = 'milk';

        // Title stays connected — this is a normal filter on the current page, not a navigation.
        const tile = makeTile('Aqua Planet');
        actionFilter.registerPanel(tile, 'Aqua Planet');

        expect(tile.dataset.mwiFilterHidden).toBe('true');
        expect(tile.style.display).toBe('none');
    });
});
