/* @vitest-environment jsdom */

/**
 * Tests for Combat Consumable Timer: setting-toggle wiring, and injecting a per-icon runway
 * caption for active combat food/drinks (read from the live battle grid's rendered icons)
 * using Combat Stats' own consumption-rate tracker.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    enabled: true,
    settingChangeHandlers: {},
    latestData: null,
    newBattleHandlers: [],
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => (key === 'combatConsumableTimer' ? mocks.enabled : false)),
        getSettingValue: vi.fn((key, fallback) => (key === 'combatStats_runwayWarningThreshold' ? 12 : fallback)),
        onSettingChange: vi.fn((key, callback) => {
            mocks.settingChangeHandlers[key] = callback;
        }),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/websocket.js', () => ({
    default: {
        on: vi.fn((event, handler) => {
            if (event === 'new_battle') mocks.newBattleHandlers.push(handler);
        }),
        off: vi.fn((event, handler) => {
            if (event === 'new_battle') {
                mocks.newBattleHandlers = mocks.newBattleHandlers.filter((h) => h !== handler);
            }
        }),
    },
}));

vi.mock('../combat-stats/combat-stats-data-collector.js', () => ({
    default: {
        loadLatestData: vi.fn(async () => mocks.latestData),
        getLatestData: vi.fn(() => mocks.latestData),
    },
}));

vi.mock('../combat-stats/combat-stats-ui.js', () => ({
    formatRunway: (seconds) => (Number.isFinite(seconds) ? `~${Math.round(seconds / 3600)}h` : 'No usage observed'),
    getRunwayColor: (seconds) => (!Number.isFinite(seconds) ? '#888' : seconds < 3600 ? '#ef4444' : '#f0a830'),
}));

import config from '../../core/config.js';
import combatConsumableTimerFeature from './combat-consumable-timer.js';

function makeConsumablesContainer(itemSlugs) {
    const container = document.createElement('div');
    container.className = 'BattlePanel_combatConsumables__3Za2n';

    const grid = document.createElement('div');
    grid.className = 'BattlePanel_combatConsumableGrid__1cC4g';
    const itemEls = itemSlugs.map((slug) => {
        const cell = document.createElement('div');
        const item = document.createElement('div');
        item.className = 'CombatConsumable_combatConsumable__am-2-';
        item.innerHTML = `<svg><use href="/static/media/items_sprite.f58c9476.svg#${slug}"></use></svg>`;
        cell.appendChild(item);
        grid.appendChild(cell);
        return item;
    });
    container.appendChild(grid);
    document.body.appendChild(container);
    return { container, itemEls };
}

describe('CombatConsumableTimer feature toggle', () => {
    beforeEach(() => {
        mocks.enabled = true;
        mocks.latestData = null;
        mocks.newBattleHandlers = [];
        document.body.innerHTML = '';
    });

    afterEach(() => {
        combatConsumableTimerFeature.cleanup();
    });

    test('registers a live setting listener for the combatConsumableTimer toggle at module load', () => {
        expect(config.onSettingChange).toHaveBeenCalledWith('combatConsumableTimer', expect.any(Function));
        expect(mocks.settingChangeHandlers.combatConsumableTimer).toBeTypeOf('function');
    });

    test('initialize() is a no-op when the combatConsumableTimer setting is disabled', () => {
        mocks.enabled = false;
        combatConsumableTimerFeature.initialize();

        expect(config.getSetting).toHaveBeenCalledWith('combatConsumableTimer');
    });

    test('toggling the setting off removes injected timers, and back on re-initializes', () => {
        const { container } = makeConsumablesContainer([]);
        const marker = document.createElement('div');
        marker.className = 'mwi-combat-consumable-timer';
        container.appendChild(marker);

        mocks.settingChangeHandlers.combatConsumableTimer(false);
        expect(document.querySelector('.mwi-combat-consumable-timer')).toBeNull();

        mocks.enabled = true;
        mocks.settingChangeHandlers.combatConsumableTimer(true);
        expect(config.getSetting).toHaveBeenCalledWith('combatConsumableTimer');
    });

    test('registers a new_battle listener to refresh runway as combat progresses', () => {
        combatConsumableTimerFeature.initialize();
        expect(mocks.newBattleHandlers.length).toBe(1);

        combatConsumableTimerFeature.cleanup();
        expect(mocks.newBattleHandlers.length).toBe(0);
    });
});

describe('CombatConsumableTimer runway injection', () => {
    beforeEach(() => {
        mocks.enabled = true;
        mocks.newBattleHandlers = [];
        document.body.innerHTML = '';
    });

    afterEach(() => {
        combatConsumableTimerFeature.cleanup();
    });

    test('shows nothing when Combat Stats has no data at all', () => {
        mocks.latestData = null;
        makeConsumablesContainer(['attack_coffee']);

        combatConsumableTimerFeature.initialize();

        expect(document.querySelector('.mwi-combat-consumable-timer')).toBeNull();
    });

    test('places a caption directly under each tracked icon, omitting untracked ones', () => {
        mocks.latestData = {
            players: [
                {
                    isCurrentPlayer: true,
                    consumables: [{ itemHrid: '/items/attack_coffee', timeToZeroSeconds: 1800 }],
                },
            ],
        };
        const { itemEls } = makeConsumablesContainer(['attack_coffee', 'blackberry_donut']);

        combatConsumableTimerFeature.initialize();

        const labels = document.querySelectorAll('.mwi-combat-consumable-timer');
        expect(labels.length).toBe(1);
        expect(itemEls[0].nextElementSibling).toBe(labels[0]);
        expect(labels[0].textContent).toBe('⚠ ~1h');
        expect(itemEls[1].nextElementSibling).toBeNull();
    });

    test('gives each rendered slot its own caption, even when the same item is slotted twice', () => {
        mocks.latestData = {
            players: [
                {
                    isCurrentPlayer: true,
                    consumables: [{ itemHrid: '/items/attack_coffee', timeToZeroSeconds: 1800 }],
                },
            ],
        };
        makeConsumablesContainer(['attack_coffee', 'attack_coffee']);

        combatConsumableTimerFeature.initialize();

        const labels = document.querySelectorAll('.mwi-combat-consumable-timer');
        expect(labels.length).toBe(2);
        expect(labels[0].textContent).toBe('⚠ ~1h');
        expect(labels[1].textContent).toBe('⚠ ~1h');
    });

    test('refreshes the displayed runway when a new_battle event fires mid-combat', () => {
        mocks.latestData = {
            players: [
                {
                    isCurrentPlayer: true,
                    consumables: [{ itemHrid: '/items/attack_coffee', timeToZeroSeconds: 36000 }],
                },
            ],
        };
        makeConsumablesContainer(['attack_coffee']);

        combatConsumableTimerFeature.initialize();
        expect(document.querySelector('.mwi-combat-consumable-timer').textContent).toBe('⚠ ~10h');

        mocks.latestData = {
            players: [
                {
                    isCurrentPlayer: true,
                    consumables: [{ itemHrid: '/items/attack_coffee', timeToZeroSeconds: 1800 }],
                },
            ],
        };
        mocks.newBattleHandlers.forEach((handler) => handler());

        expect(document.querySelector('.mwi-combat-consumable-timer').textContent).toBe('⚠ ~1h');
    });
});
