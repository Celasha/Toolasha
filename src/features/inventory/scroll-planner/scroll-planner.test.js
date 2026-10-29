/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSetting: vi.fn(),
    onClass: vi.fn(),
    unregister: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    storageGetJSON: vi.fn(),
    storageSetJSON: vi.fn(),
    characterItems: [],
}));

vi.mock('../../../core/config.js', () => ({ default: { getSetting: mocks.getSetting } }));
vi.mock('../../../core/i18n.js', () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('../../../core/dom-observer.js', () => ({ default: { onClass: mocks.onClass } }));
vi.mock('../../../utils/game-i18n.js', () => ({ getItemName: (hrid, fallback) => fallback }));
vi.mock('../../../core/storage.js', () => ({
    default: { getJSON: mocks.storageGetJSON, setJSON: mocks.storageSetJSON },
}));
vi.mock('../../../core/data-manager.js', () => ({
    default: {
        on: mocks.on,
        off: mocks.off,
        get characterItems() {
            return mocks.characterItems;
        },
        getCurrentCharacterId: () => 'char-1',
        getInitClientData: () => ({
            itemDetailMap: {
                '/items/seal_of_damage': {
                    name: 'Scroll Of Damage',
                    categoryHrid: '/item_categories/scroll',
                    isOpenable: true,
                    sortIndex: 1,
                },
                '/items/seal_of_gathering': {
                    name: 'Scroll Of Gathering',
                    categoryHrid: '/item_categories/scroll',
                    isOpenable: true,
                    sortIndex: 2,
                },
            },
        }),
        getItemDetails: (hrid) =>
            ({
                '/items/seal_of_damage': { name: 'Scroll Of Damage' },
                '/items/seal_of_gathering': { name: 'Scroll Of Gathering' },
            })[hrid],
    },
}));

import { ScrollPlanner } from './scroll-planner.js';
import { isScrollRunActive } from './scroll-planner-state.js';

const inv = (itemHrid, count) => ({
    itemHrid,
    count,
    itemLocationHrid: '/item_locations/inventory',
    enhancementLevel: 0,
});

function buildMenu(name) {
    const menu = document.createElement('div');
    menu.className = 'Item_actionMenu__x';
    menu.innerHTML = `
        <div><span class="Item_name__x">${name}</span></div>
        <div class="Item_amountInputContainer__x"><div><input type="number" value="1"></div></div>
        <button class="Button_button__x">Open 1</button>
        <button class="Button_button__x">Alchemize</button>
    `;
    document.body.appendChild(menu);
    // Mimic the game's label following the quantity field
    const input = menu.querySelector('input');
    input.addEventListener('input', () => {
        menu.querySelector('button').textContent = `Open ${input.value}`;
    });
    return menu;
}

describe('ScrollPlanner', () => {
    let planner;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        Object.values(mocks).forEach((m) => m.mockReset?.());
        mocks.getSetting.mockReturnValue(true);
        mocks.onClass.mockReturnValue(mocks.unregister);
        mocks.storageGetJSON.mockResolvedValue(null);
        mocks.storageSetJSON.mockResolvedValue(true);
        mocks.characterItems = [inv('/items/seal_of_damage', 5), inv('/items/seal_of_gathering', 8)];
        planner = new ScrollPlanner();
    });

    afterEach(() => {
        planner.cleanup();
        vi.useRealTimers();
    });

    it('does nothing when the setting is off', async () => {
        mocks.getSetting.mockReturnValue(false);
        await planner.initialize();
        expect(mocks.onClass).not.toHaveBeenCalled();
    });

    it('adds a Plan scrolls button to a scroll menu only', async () => {
        await planner.initialize();
        const scrollMenu = buildMenu('Scroll Of Damage');
        const otherMenu = buildMenu('Cheese');
        planner.handleActionMenu(scrollMenu);
        planner.handleActionMenu(otherMenu);
        expect(scrollMenu.querySelector('.toolasha-scroll-planner-btn')).not.toBeNull();
        expect(otherMenu.querySelector('.toolasha-scroll-planner-btn')).toBeNull();

        planner.handleActionMenu(scrollMenu);
        expect(scrollMenu.querySelectorAll('.toolasha-scroll-planner-btn')).toHaveLength(1);
    });

    it('rejects an empty plan', async () => {
        await planner.initialize();
        const result = await planner.startRun({});
        expect(result.error).toBe('scrollPlanner.nothingPlanned');
        expect(isScrollRunActive()).toBe(false);
    });

    it('starts a run, saves the last plan, fills the quantity and highlights Open', async () => {
        await planner.initialize();
        const result = await planner.startRun({ '/items/seal_of_damage': 3, '/items/seal_of_gathering': 2 });
        expect(result.error).toBeNull();
        expect(isScrollRunActive()).toBe(true);
        expect(mocks.storageSetJSON).toHaveBeenCalledWith(
            'scrollPlanner_lastPlan',
            { '/items/seal_of_damage': 3, '/items/seal_of_gathering': 2 },
            'settings',
            true
        );

        const menu = buildMenu('Scroll Of Damage');
        planner.handleActionMenu(menu);
        expect(menu.querySelector('input').value).toBe('3');
        expect(menu.querySelector('button').style.outline).toContain('solid');
        vi.advanceTimersByTime(300);
        expect(document.querySelector('.toolasha-scroll-planner-bar').textContent).not.toContain('barPrefillFailed');
    });

    it('does not touch a menu that is not the current step', async () => {
        await planner.initialize();
        await planner.startRun({ '/items/seal_of_damage': 3 });
        const menu = buildMenu('Scroll Of Gathering');
        planner.handleActionMenu(menu);
        expect(menu.querySelector('input').value).toBe('1');
    });

    it('advances when the inventory drops and finishes the run', async () => {
        await planner.initialize();
        await planner.startRun({ '/items/seal_of_damage': 3, '/items/seal_of_gathering': 2 });

        mocks.characterItems = [inv('/items/seal_of_damage', 2), inv('/items/seal_of_gathering', 8)];
        planner.handleInventoryChange();
        expect(document.querySelector('.toolasha-scroll-planner-bar').textContent).toContain('"index":2');

        mocks.characterItems = [inv('/items/seal_of_damage', 2), inv('/items/seal_of_gathering', 6)];
        planner.handleInventoryChange();
        await vi.runAllTimersAsync();
        expect(isScrollRunActive()).toBe(false);
        expect(document.querySelector('.toolasha-scroll-planner-bar').textContent).toContain('doneTitle');
    });

    it('skips the current step', async () => {
        await planner.initialize();
        await planner.startRun({ '/items/seal_of_damage': 3 });
        await planner.skipCurrentStep();
        await vi.runAllTimersAsync();
        expect(isScrollRunActive()).toBe(false);
        expect(document.querySelector('.toolasha-scroll-planner-bar').textContent).toContain('doneSkipped');
    });

    it('stop clears the run and the Auto All suppression', async () => {
        await planner.initialize();
        await planner.startRun({ '/items/seal_of_damage': 3 });
        await planner.stopRun();
        expect(isScrollRunActive()).toBe(false);
        expect(document.querySelector('.toolasha-scroll-planner-bar')).toBeNull();
        expect(mocks.storageSetJSON).toHaveBeenLastCalledWith('scrollPlanner_run:char-1', null, 'settings', true);
    });

    it('resumes a fresh saved run and ignores a stale one', async () => {
        const steps = [{ itemHrid: '/items/seal_of_damage', quantity: 3, planned: 3, targetCount: 2, skipped: false }];
        mocks.storageGetJSON.mockResolvedValueOnce({ startedAt: Date.now(), steps });
        await planner.initialize();
        expect(isScrollRunActive()).toBe(true);
        planner.cleanup();

        mocks.storageGetJSON.mockResolvedValueOnce({ startedAt: Date.now() - 13 * 3600 * 1000, steps });
        await planner.initialize();
        expect(isScrollRunActive()).toBe(false);
    });

    it('loads the last plan into the modal', async () => {
        await planner.initialize();
        mocks.storageGetJSON.mockResolvedValueOnce({ '/items/seal_of_damage': 4, '/items/nope': 9 });
        planner.openModal();
        await planner.loadLastIntoDraft();
        expect(planner.draft).toEqual({ '/items/seal_of_damage': 4 });
        const input = document.querySelector('.toolasha-scroll-planner-modal input');
        expect(input.value).toBe('4');
    });
});
