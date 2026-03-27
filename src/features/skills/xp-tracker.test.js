import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        getSetting: vi.fn(() => true),
        COLOR_XP_RATE: '#00ff00',
    },
    dataManager: {
        on: vi.fn(),
        off: vi.fn(),
        getCurrentActions: vi.fn(() => []),
        getActionDetails: vi.fn(() => null),
        characterData: null,
        characterSkills: [],
    },
    domObserver: {
        onClass: vi.fn(() => vi.fn()),
    },
    formatKMB: vi.fn((value) => String(Math.round(value))),
    storage: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
    },
    timerRegistry: {
        clearAll: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({ default: mocks.dataManager }));
vi.mock('../../core/storage.js', () => ({ default: mocks.storage }));
vi.mock('../../core/dom-observer.js', () => ({ default: mocks.domObserver }));
vi.mock('../../core/config.js', () => ({ default: mocks.config }));
vi.mock('../../utils/formatters.js', () => ({ formatKMB: mocks.formatKMB }));
vi.mock('../../utils/timer-registry.js', () => ({
    createTimerRegistry: () => mocks.timerRegistry,
}));

import {
    XPTracker,
    calcStats,
    calcXPH,
    downsampleEvenly,
    isActiveSkill,
    removeOwnedRemainingXPIfEmpty,
} from './xp-tracker.js';

describe('xp-tracker helpers', () => {
    it('returns 0 xp/h for invalid or zero timestamp deltas', () => {
        expect(calcXPH({ t: 1000, xp: 100 }, { t: 1000, xp: 200 })).toBe(0);
        expect(calcXPH({ t: 2000, xp: 200 }, { t: 1000, xp: 300 })).toBe(0);
    });

    it('downsamples evenly while preserving first and last points', () => {
        const input = [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }, { i: 6 }];

        const result = downsampleEvenly(input, 4);

        expect(result).toHaveLength(4);
        expect(result[0]).toBe(input[0]);
        expect(result[result.length - 1]).toBe(input[input.length - 1]);
    });

    it('calculates a rolling xp/h rate from the last 10 minutes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));

        const now = Date.now();
        const history = [
            { t: now - 9 * 60 * 1000, xp: 100 },
            { t: now - 5 * 60 * 1000, xp: 180 },
            { t: now - 1 * 60 * 1000, xp: 260 },
        ];

        expect(calcStats(history)).toBeCloseTo(1200, 6);

        vi.useRealTimers();
    });

    it('identifies whether a skill is currently active', () => {
        expect(isActiveSkill('milking', 'milking')).toBe(true);
        expect(isActiveSkill('foraging', 'milking')).toBe(false);
        expect(isActiveSkill('milking', null)).toBe(false);
    });
});

describe('XPTracker', () => {
    beforeEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        mocks.config.getSetting.mockReturnValue(true);
        mocks.dataManager.getCurrentActions.mockReturnValue([]);
        mocks.dataManager.getActionDetails.mockReturnValue(null);
        mocks.dataManager.characterData = null;
        mocks.dataManager.characterSkills = [];
        mocks.storage.get.mockResolvedValue({});
        mocks.storage.set.mockResolvedValue(undefined);
    });

    it('preserves stored history on reload while initialising the active action', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));

        const tracker = new XPTracker();
        tracker._updateNavBars = vi.fn();
        const now = Date.now();
        mocks.storage.get.mockResolvedValue({
            milking: [
                { t: now - 9 * 60 * 1000, xp: 100 },
                { t: now - 5 * 60 * 1000, xp: 150 },
            ],
        });
        mocks.dataManager.getActionDetails.mockReturnValue({
            experienceGain: { skillHrid: '/skills/milking' },
        });

        await tracker._onCharacterInit({
            character: { id: 'char-1' },
            currentTimestamp: '2026-03-12T12:00:00Z',
            characterActions: [{ actionHrid: '/actions/milk_cow' }],
            characterSkills: [{ skillHrid: '/skills/milking', experience: 200 }],
        });

        expect(tracker.currentActionHrid).toBe('/actions/milk_cow');
        expect(tracker.currentSkillHrid).toBe('/skills/milking');
        expect(tracker.xpHistory.milking).toHaveLength(3);
        expect(tracker._getRateForSkill('milking')).toBeGreaterThan(0);

        vi.useRealTimers();
    });

    it('seeds a baseline snapshot immediately when the action changes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));

        const tracker = new XPTracker();
        tracker.characterId = 'char-1';
        tracker.currentActionHrid = '/actions/milk_cow';
        tracker.xpHistory.foraging = [{ t: Date.now() - 60_000, xp: 400 }];

        mocks.dataManager.getCurrentActions.mockReturnValue([{ actionHrid: '/actions/forage_tree' }]);
        mocks.dataManager.getActionDetails.mockReturnValue({
            experienceGain: { skillHrid: '/skills/foraging' },
        });
        mocks.dataManager.characterSkills = [{ skillHrid: '/skills/foraging', experience: 500 }];

        tracker._syncCurrentAction();

        expect(tracker.currentActionHrid).toBe('/actions/forage_tree');
        expect(tracker.currentSkillHrid).toBe('/skills/foraging');
        expect(tracker.xpHistory.foraging).toEqual([{ t: Date.now(), xp: 500 }]);
        expect(mocks.storage.set).toHaveBeenCalledWith('xpHistory_char-1', tracker.xpHistory, 'xpHistory');

        vi.useRealTimers();
    });
});

describe('removeOwnedRemainingXPIfEmpty', () => {
    it('removes tracker-owned containers only when they are empty', () => {
        const remove = vi.fn();
        const ownedEmpty = {
            dataset: { xpTrackerOwned: '1' },
            childElementCount: 0,
            textContent: '   ',
            remove,
        };

        removeOwnedRemainingXPIfEmpty(ownedEmpty);

        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('preserves non-owned containers', () => {
        const remove = vi.fn();

        removeOwnedRemainingXPIfEmpty({
            dataset: {},
            childElementCount: 0,
            textContent: '',
            remove,
        });

        expect(remove).not.toHaveBeenCalled();
    });
});
