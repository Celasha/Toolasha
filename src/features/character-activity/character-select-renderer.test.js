/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    onClassRegistrations: [],
    onReadyRegistrations: [],
    domReady: false,
    resolvedSlots: null,
    accountPrefs: { enabled: true, dateFormat: 'MM-DD', timeFormat: '24hour' },
    activityRecords: new Map(),
    spriteUrl: 'https://example.com/skills_sprite.svg',
    miscSpriteUrl: 'https://example.com/misc_sprite.svg',
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        // Mirrors the real dom-observer's node-level class match (ignoring its descendant-scan
        // branch, which isn't exercised here since tests invoke the callback with the exact
        // matched element) so a registration that doesn't watch a given class genuinely never
        // fires for it, the same as production - this is what makes the TLA-025 regression below
        // actually fail against the pre-fix single-class registration.
        onClass: vi.fn((_name, classNames, callback) => {
            const classArray = Array.isArray(classNames) ? classNames : [classNames];
            const registration = {
                classNames: classArray,
                callback: (node) => {
                    const className = typeof node.className === 'string' ? node.className : '';
                    if (classArray.some((targetClass) => className.includes(targetClass))) {
                        return callback(node);
                    }
                },
            };
            mocks.onClassRegistrations.push(registration);
            return vi.fn();
        }),
        onReady: vi.fn((_name, callback) => {
            const registration = { callback, active: true };
            mocks.onReadyRegistrations.push(registration);
            if (mocks.domReady) callback();
            return vi.fn(() => {
                registration.active = false;
            });
        }),
    },
}));

vi.mock('../../utils/asset-manifest.js', () => ({
    default: { getSpriteUrl: vi.fn(async (key) => (key === 'misc' ? mocks.miscSpriteUrl : mocks.spriteUrl)) },
}));

vi.mock('./character-select-resolver.js', () => ({
    resolveCharacterSelectSlots: vi.fn(() => mocks.resolvedSlots),
}));

vi.mock('./character-activity-storage.js', () => ({
    loadCharacterActivity: vi.fn(async (characterId) => mocks.activityRecords.get(characterId) || null),
    loadAccountPreferences: vi.fn(async () => mocks.accountPrefs),
}));

const characterSelectRendererModule = await import('./character-select-renderer.js');
const { default: characterSelectRenderer, computeSlotDisplayState } = characterSelectRendererModule;

const PREFS = { dateFormat: 'MM-DD', timeFormat: '24hour' };

function record(overrides = {}) {
    return {
        characterId: 'char-a',
        observedAt: 1000,
        offline: { hourCap: 10, mooPassExpireTime: null },
        projection: { segments: [], terminalCause: 'idle', terminalAt: 1000 },
        ...overrides,
    };
}

function character(overrides = {}) {
    return { id: 'char-a', name: 'Alice', isOnline: false, lastOfflineTime: 1000, ...overrides };
}

describe('computeSlotDisplayState', () => {
    test('never observed -> neutral onboarding state', () => {
        const state = computeSlotDisplayState(null, character(), PREFS, 2000);

        expect(state.firstLineText).toBe('No activity data yet');
        expect(state.limiterColor).toBe('neutral');
        expect(state.limiterText).toBe('Open character once to enable status');
    });

    test('native evidence of later activity invalidates the snapshot as outdated', () => {
        const rec = record({ observedAt: 1000 });
        const char = character({ lastOfflineTime: 50000 }); // well after observedAt

        const state = computeSlotDisplayState(rec, char, PREFS, 60000);

        expect(state.firstLineText).toBe('Activity status outdated');
        expect(state.limiterColor).toBe('neutral');
        expect(state.limiterText).toBe('Open character to refresh');
    });

    test('a small jitter between native lastOfflineTime and observedAt does not falsely mark stale', () => {
        const rec = record({ observedAt: 1000 });
        const char = character({ lastOfflineTime: 1002 }); // well within tolerance

        const state = computeSlotDisplayState(rec, char, PREFS, 60000);

        expect(state.limiterText).not.toBe('Open character to refresh');
    });

    test('idle -> "No active action" / "Character is idle"', () => {
        const rec = record({ projection: { segments: [], terminalCause: 'idle', terminalAt: 1000 } });

        const state = computeSlotDisplayState(rec, character(), PREFS, 2000);

        expect(state.firstLineText).toBe('No active action');
        expect(state.limiterColor).toBe('red');
        expect(state.limiterText).toBe('Character is idle');
    });

    test('uncertain (e.g. Combat) -> shows the action name, neutral End time unavailable', () => {
        const rec = record({
            projection: {
                segments: [
                    { actionName: 'Aqua Planet', startAt: 1000, endAt: null, queuedIndex: 0, certainty: 'uncertain' },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 2000);

        expect(state.firstLineText).toBe('Aqua Planet');
        expect(state.limiterColor).toBe('neutral');
        expect(state.limiterText).toBe('End time unavailable');
    });

    test.each([
        ['combat', 'Variable duration · ETA unavailable'],
        ['labyrinth', 'Variable duration · ETA unavailable'],
        ['enhancing', 'Stochastic outcome · ETA unavailable'],
        ['special', 'Waiting for party · ETA unavailable'],
    ])('TLA-025: approved locked copy for stopCause=%s includes the ETA-unavailable suffix', (stopCause, expected) => {
        const rec = record({
            projection: {
                segments: [
                    {
                        actionName: 'X',
                        startAt: 1000,
                        endAt: null,
                        queuedIndex: 0,
                        certainty: 'uncertain',
                        stopCause,
                    },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 2000);

        expect(state.limiterText).toBe(expected);
    });

    test('TLA-025 item 4/5: a currently-running trustworthy segment stays on line 1 even though the queue later becomes uncertain', () => {
        const rec = record({
            projection: {
                segments: [
                    {
                        actionName: 'Crafting',
                        actionTypeHrid: '/action_types/crafting',
                        startAt: 0,
                        endAt: 10_000,
                        queuedIndex: 0,
                        certainty: 'trustworthy',
                        stopCause: 'count',
                        remainingQueuedCount: 1,
                    },
                    {
                        actionName: 'Explore Labyrinth',
                        actionTypeHrid: '/action_types/labyrinth',
                        startAt: 10_000,
                        endAt: null,
                        queuedIndex: 1,
                        certainty: 'uncertain',
                        stopCause: 'labyrinth',
                        remainingQueuedCount: 0,
                    },
                ],
                terminalCause: 'unknown',
                terminalAt: null,
            },
        });

        // now = 5000, still inside the Crafting segment - Labyrinth hasn't started yet.
        const state = computeSlotDisplayState(rec, character(), PREFS, 5000);

        expect(state.firstLineText).toBe('Crafting +1 queued');
        expect(state.limiterText).toBe('Queue duration uncertain · ETA unavailable');
        expect(state.activeSegment.actionName).toBe('Crafting');

        // Once time actually reaches the Labyrinth segment, line 1 switches to it.
        const laterState = computeSlotDisplayState(rec, character(), PREFS, 15_000);
        expect(laterState.firstLineText).toBe('Explore Labyrinth');
        expect(laterState.limiterText).toBe('Variable duration · ETA unavailable');
        expect(laterState.activeSegment.actionName).toBe('Explore Labyrinth');
    });

    test('one finite action not yet ended, more than 1h away -> green Action ends', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'Redwood Tree', startAt: 1000, endAt: 1000 + 7200_000, queuedIndex: 0 }],
                terminalCause: 'action',
                terminalAt: 1000 + 7200_000, // 2h away
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 1000);

        expect(state.firstLineText).toBe('Redwood Tree');
        expect(state.limiterColor).toBe('green');
        expect(state.limiterText).toContain('Action ends');
    });

    test('queue not yet ended, 1h or less away -> yellow Queue ends, with +N queued', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [
                    { actionName: 'Swiftness Coffee', startAt: 1000, endAt: 1000 + 1000, queuedIndex: 0 },
                    { actionName: 'Second', startAt: 2000, endAt: 1000 + 1800_000, queuedIndex: 1 },
                ],
                terminalCause: 'queue',
                terminalAt: 1000 + 1800_000, // 30 min away
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 2000); // now = 2000, first segment already elapsed

        expect(state.firstLineText).toBe('Second');
        expect(state.limiterColor).toBe('yellow');
        expect(state.limiterText).toContain('Queue ends');
    });

    test('materials not yet exhausted -> Materials run out label', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'Cheese', startAt: 1000, endAt: 1000 + 7200_000, queuedIndex: 0 }],
                terminalCause: 'materials',
                terminalAt: 1000 + 7200_000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 1000);

        expect(state.limiterText).toContain('Materials run out');
    });

    test('past action -> "No active action expected" / red "Action ended"', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'Redwood Tree', startAt: 1000, endAt: 5000, queuedIndex: 0 }],
                terminalCause: 'action',
                terminalAt: 5000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 10000);

        expect(state.firstLineText).toBe('No active action expected');
        expect(state.limiterColor).toBe('red');
        expect(state.limiterText).toContain('Action ended');
    });

    test('past queue -> "No active action expected" / red "Queue ended"', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'X', startAt: 1000, endAt: 5000, queuedIndex: 1 }],
                terminalCause: 'queue',
                terminalAt: 5000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 10000);

        expect(state.limiterText).toContain('Queue ended');
    });

    test('past materials -> red "Materials ran out"', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'Cheese', startAt: 1000, endAt: 5000, queuedIndex: 0 }],
                terminalCause: 'materials',
                terminalAt: 5000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 10000);

        expect(state.limiterText).toContain('Materials ran out');
    });

    test('offline cap already passed -> action name + pause icon + queued count preserved, red Offline progress stopped', () => {
        const rec = record({
            offline: { hourCap: 1, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'Cheese', startAt: 1000, endAt: null, queuedIndex: 0, stopCause: 'infinite' }],
                terminalCause: 'infinite',
                terminalAt: null,
            },
        });
        const char = character({ lastOfflineTime: 1000 });
        const offlineLimitAt = 1000 + 1 * 3600 * 1000;

        const state = computeSlotDisplayState(rec, char, PREFS, offlineLimitAt + 10000);

        expect(state.firstLineText).toBe('Cheese ⏸');
        expect(state.limiterColor).toBe('red');
        expect(state.limiterText).toContain('Offline progress stopped');
    });

    test('offline cap not yet passed for a truly continuous action -> green/yellow Offline limit, no pause icon', () => {
        const rec = record({
            offline: { hourCap: 10, mooPassExpireTime: null },
            projection: {
                segments: [{ actionName: 'Redwood Tree', startAt: 1000, endAt: null, queuedIndex: 0 }],
                terminalCause: 'infinite',
                terminalAt: null,
            },
        });
        const char = character({ lastOfflineTime: 1000 });

        const state = computeSlotDisplayState(rec, char, PREFS, 1000);

        expect(state.firstLineText).toBe('Redwood Tree');
        expect(state.limiterText).toContain('Offline limit');
    });

    test('timeline advancement: after segment 1 ends, the active segment moves to segment 2 and queue count decrements', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [
                    { actionName: 'First', startAt: 0, endAt: 1000, queuedIndex: 0, remainingQueuedCount: 2 },
                    { actionName: 'Second', startAt: 1000, endAt: 2000, queuedIndex: 1, remainingQueuedCount: 1 },
                    { actionName: 'Third', startAt: 2000, endAt: 3000, queuedIndex: 2, remainingQueuedCount: 0 },
                ],
                terminalCause: 'queue',
                terminalAt: 3000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 1500); // mid-way through segment 2

        expect(state.firstLineText).toBe('Second +1 queued');
    });

    test('the active segment (not always segment 0) is returned for icon resolution', () => {
        const rec = record({
            offline: { hourCap: null, mooPassExpireTime: null },
            projection: {
                segments: [
                    {
                        actionName: 'First',
                        actionTypeHrid: '/action_types/woodcutting',
                        startAt: 0,
                        endAt: 1000,
                        queuedIndex: 0,
                    },
                    {
                        actionName: 'Second',
                        actionTypeHrid: '/action_types/combat',
                        startAt: 1000,
                        endAt: 2000,
                        queuedIndex: 1,
                    },
                ],
                terminalCause: 'queue',
                terminalAt: 2000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 1500);

        expect(state.activeSegment.actionTypeHrid).toBe('/action_types/combat');
    });

    test('an online character never receives an offline-cap deadline derived from a stale lastOfflineTime', () => {
        const rec = record({
            offline: { hourCap: 1, mooPassExpireTime: null },
            projection: {
                segments: [
                    {
                        actionName: 'Cheese',
                        startAt: 1000,
                        endAt: null,
                        queuedIndex: 0,
                        certainty: 'trustworthy',
                        stopCause: 'infinite',
                    },
                ],
                terminalCause: 'infinite',
                terminalAt: null,
            },
        });
        const char = character({ isOnline: true, lastOfflineTime: 1000 }); // stale offline stretch, but online now
        const offlineLimitAt = 1000 + 1 * 3600 * 1000;

        const state = computeSlotDisplayState(rec, char, PREFS, offlineLimitAt + 10000);

        expect(state.limiterText).not.toContain('Offline progress stopped');
    });

    test('an offline character with the same lastOfflineTime does get the offline-cap deadline', () => {
        const rec = record({
            offline: { hourCap: 1, mooPassExpireTime: null },
            projection: {
                segments: [
                    {
                        actionName: 'Cheese',
                        startAt: 1000,
                        endAt: null,
                        queuedIndex: 0,
                        certainty: 'trustworthy',
                        stopCause: 'infinite',
                    },
                ],
                terminalCause: 'infinite',
                terminalAt: null,
            },
        });
        const char = character({ isOnline: false, lastOfflineTime: 1000 });
        const offlineLimitAt = 1000 + 1 * 3600 * 1000;

        const state = computeSlotDisplayState(rec, char, PREFS, offlineLimitAt + 10000);

        expect(state.limiterText).toContain('Offline progress stopped');
    });
});

describe('idempotent Character Select injection and lifecycle', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.onClassRegistrations = [];
        mocks.onReadyRegistrations = [];
        mocks.domReady = true;
        mocks.resolvedSlots = null;
        mocks.accountPrefs = { enabled: true, dateFormat: 'MM-DD', timeFormat: '24hour' };
        mocks.activityRecords = new Map();
        characterSelectRenderer.stopWatching();
    });

    function buildRoot() {
        const root = document.createElement('div');
        root.className = 'CharacterSelectPage_characterSelectPage__test';
        document.body.appendChild(root);
        return root;
    }

    function buildSlot(root = buildRoot()) {
        const slot = document.createElement('div');
        root.appendChild(slot);
        return slot;
    }

    test('startWatching registers one shared observer for both the Character Select root and async slots container', () => {
        characterSelectRenderer.startWatching();

        expect(mocks.onClassRegistrations).toHaveLength(1);
        expect(mocks.onClassRegistrations[0].classNames).toEqual([
            'CharacterSelectPage_characterSelectPage',
            'CharacterSelectPage_characterSlots',
        ]);
    });

    test('injects exactly one block per resolved slot, and updates it in place on a second render pass rather than duplicating', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({ projection: { segments: [], terminalCause: 'idle', terminalAt: 1000 } })
        );

        characterSelectRenderer.startWatching();
        const callback = mocks.onClassRegistrations[0].callback;
        await callback(root);
        await callback(root);

        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
        expect(slot.textContent).toContain('Character is idle');
    });

    test('does not inject anything when the account-level preference mirror says disabled', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.accountPrefs = { enabled: false, dateFormat: 'MM-DD', timeFormat: '24hour' };

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);

        expect(slot.querySelector('.toolasha-character-activity-status')).toBeNull();
    });

    test('TLA-025 DEV4 fix: refreshNow() removes blocks immediately when the mirror flips to disabled, without waiting for the timer/an action event', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set('char-a', record());

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);
        expect(slot.querySelector('.toolasha-character-activity-status')).not.toBeNull();

        mocks.accountPrefs = { enabled: false, dateFormat: 'MM-DD', timeFormat: '24hour' };
        await characterSelectRenderer.refreshNow();

        expect(slot.querySelector('.toolasha-character-activity-status')).toBeNull();
    });

    test('TLA-025 DEV4 fix: refreshNow() restores blocks immediately when the mirror flips back to enabled', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set('char-a', record());
        mocks.accountPrefs = { enabled: false, dateFormat: 'MM-DD', timeFormat: '24hour' };

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);
        expect(slot.querySelector('.toolasha-character-activity-status')).toBeNull();

        mocks.accountPrefs = { enabled: true, dateFormat: 'MM-DD', timeFormat: '24hour' };
        await characterSelectRenderer.refreshNow();

        expect(slot.querySelector('.toolasha-character-activity-status')).not.toBeNull();
        expect(slot.textContent).toContain('Character is idle');
    });

    test('TLA-025 DEV4 fix: refreshNow() re-renders with a newly changed date/time format, and never duplicates the block', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({
                offline: { hourCap: null, mooPassExpireTime: null },
                projection: {
                    segments: [{ actionName: 'Redwood Tree', startAt: 1000, endAt: 1000 + 7200_000, queuedIndex: 0 }],
                    terminalCause: 'action',
                    terminalAt: 1000 + 7200_000,
                },
            })
        );

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);
        const firstText = slot.querySelector('.toolasha-character-activity-status').textContent;

        mocks.accountPrefs = { enabled: true, dateFormat: 'DD-MM', timeFormat: '12hour' };
        await characterSelectRenderer.refreshNow();

        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
        // The limiter line embeds the formatted deadline, which depends on the prefs just changed.
        expect(slot.querySelector('.toolasha-character-activity-status').textContent).not.toBe(firstText);
    });

    test('TLA-025 DEV4 fix: refreshNow() is a no-op before startWatching() / after stopWatching()', async () => {
        characterSelectRenderer.stopWatching();
        await expect(characterSelectRenderer.refreshNow()).resolves.toBeUndefined();
    });

    test('stopWatching removes injected blocks and unregisters the observer', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set('char-a', record());

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);
        expect(slot.querySelector('.toolasha-character-activity-status')).not.toBeNull();

        characterSelectRenderer.stopWatching();

        expect(slot.querySelector('.toolasha-character-activity-status')).toBeNull();
    });

    test('when the resolver cannot validate an owner, nothing is injected (fails closed, no crash)', async () => {
        mocks.resolvedSlots = null;
        const root = buildRoot();

        characterSelectRenderer.startWatching();
        await expect(mocks.onClassRegistrations[0].callback(root)).resolves.not.toThrow();
    });

    // TLA-025: native Character Select mounts its root with isLoading=true/characters=[] first,
    // then inserts the characterSlots container inside that same root once loadCharacters()
    // resolves asynchronously. The renderer must rescan on that later insertion rather than only
    // discovering slots at the original root mount.
    test('rescans when native character slots arrive after the already-mounted loading root', async () => {
        const root = buildRoot();
        mocks.resolvedSlots = [];

        characterSelectRenderer.startWatching();
        const callback = mocks.onClassRegistrations[0].callback;

        // Native MWI mounts Character Select with isLoading=true / characters=[] first.
        await callback(root);
        expect(root.querySelector('.toolasha-character-activity-status')).toBeNull();

        // loadCharacters() resolves later and React inserts the slots container under the same root.
        const slotsContainer = document.createElement('div');
        slotsContainer.className = 'CharacterSelectPage_characterSlots__test';
        root.appendChild(slotsContainer);
        const slot = buildSlot(slotsContainer);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set('char-a', record());

        await callback(slotsContainer);

        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
        expect(slot.textContent).toContain('Character is idle');

        // Repeated matching mutations must only update the same owned block, never duplicate it.
        await callback(slotsContainer);
        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
    });

    // TLA-025: the userscript can attach after Character Select has already finished loading (the
    // root mounted and slots resolved before startWatching() ever registered the observer).
    test('performs a bounded catch-up scan when Character Select is already mounted before startWatching()', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set('char-a', record());

        characterSelectRenderer.startWatching();
        for (let i = 0; i < 5; i++) await Promise.resolve();

        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
        expect(slot.textContent).toContain('Character is idle');
    });

    // TLA-025 REOPEN: at @run-at document-start the shared observer may not be attached yet
    // because document.body does not exist. Character Select can fully mount during that gap,
    // producing no observable mutation after the observer finally attaches. Readiness must trigger
    // a bounded catch-up at the moment observing actually becomes active.
    test('catches up when Character Select fully mounts before the shared observer becomes ready', async () => {
        characterSelectRenderer.stopWatching();
        mocks.domReady = false;
        document.body.innerHTML = '';

        characterSelectRenderer.startWatching();
        expect(mocks.onReadyRegistrations).toHaveLength(1);

        // Native UI fully mounts while the central observer is still waiting for body/readiness.
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set('char-a', record());
        expect(slot.querySelector('.toolasha-character-activity-status')).toBeNull();

        // The real DOMObserver emits readiness only after it actually attaches to document.body.
        mocks.domReady = true;
        await mocks.onReadyRegistrations[0].callback();

        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
        expect(slot.textContent).toContain('Character is idle');

        // Re-notification/remount catch-up remains idempotent.
        await mocks.onReadyRegistrations[0].callback();
        expect(slot.querySelectorAll('.toolasha-character-activity-status')).toHaveLength(1);
    });

    test('TLA-025 item 6: text renders immediately even when sprite resolution hangs - icons are non-blocking', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({ projection: { segments: [], terminalCause: 'idle', terminalAt: 1000 } })
        );

        const { default: assetManifest } = await import('../../utils/asset-manifest.js');
        let releaseSprites;
        const spriteGate = new Promise((resolve) => {
            releaseSprites = resolve;
        });
        assetManifest.getSpriteUrl.mockImplementation(() => spriteGate.then(() => mocks.spriteUrl));

        characterSelectRenderer.startWatching();
        const mountPromise = mocks.onClassRegistrations[0].callback(root);
        // Flush the per-slot record load (not sprite-gated) without resolving the sprite gate.
        await Promise.resolve();
        await Promise.resolve();

        expect(slot.textContent).toContain('Character is idle');
        expect(slot.querySelector('svg')).toBeNull();

        releaseSprites();
        await mountPromise;
        expect(slot.textContent).toContain('Character is idle');

        // Restore the default implementation so later tests in this file aren't affected.
        assetManifest.getSpriteUrl.mockImplementation(async (key) =>
            key === 'misc' ? mocks.miscSpriteUrl : mocks.spriteUrl
        );
    });

    test('CA-46: sprite lookup failure/empty sprite leaves already-rendered status text correct and visible', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({ projection: { segments: [], terminalCause: 'idle', terminalAt: 1000 } })
        );

        const { default: assetManifest } = await import('../../utils/asset-manifest.js');
        // getSpriteUrl never actually rejects in production (asset-manifest.js swallows fetch
        // errors internally) - the observable failure mode is an empty/null resolved URL.
        assetManifest.getSpriteUrl.mockImplementation(async () => null);

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);

        expect(slot.textContent).toContain('Character is idle');
        expect(slot.querySelector('svg')).toBeNull();

        // Restore the default implementation so later tests in this file aren't affected.
        assetManifest.getSpriteUrl.mockImplementation(async (key) =>
            key === 'misc' ? mocks.miscSpriteUrl : mocks.spriteUrl
        );
    });

    test('TLA-025 item 1: Combat/Labyrinth icons resolve from the misc sprite sheet, not skills', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({
                projection: {
                    segments: [
                        {
                            actionName: 'Aqua Planet',
                            actionTypeHrid: '/action_types/combat',
                            startAt: 1000,
                            endAt: null,
                            queuedIndex: 0,
                            certainty: 'uncertain',
                            stopCause: 'combat',
                        },
                    ],
                    terminalCause: 'unknown',
                    terminalAt: null,
                },
            })
        );

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);

        expect(slot.innerHTML).toContain(`${mocks.miscSpriteUrl}#combat`);
        expect(slot.innerHTML).not.toContain(`${mocks.spriteUrl}#combat`);
    });

    test('TLA-025 item 1: an ordinary skilling type still resolves from the skills sprite sheet', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({
                projection: {
                    segments: [
                        {
                            actionName: 'Redwood Tree',
                            actionTypeHrid: '/action_types/woodcutting',
                            startAt: 1000,
                            endAt: null,
                            queuedIndex: 0,
                            certainty: 'trustworthy',
                            stopCause: 'infinite',
                        },
                    ],
                    terminalCause: 'infinite',
                    terminalAt: null,
                },
            })
        );

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);

        expect(slot.innerHTML).toContain(`${mocks.spriteUrl}#woodcutting`);
    });

    test('TLA-025 item 1: Special (Party Ready) never renders an icon, matching native behavior', async () => {
        const root = buildRoot();
        const slot = buildSlot(root);
        mocks.resolvedSlots = [{ slotElement: slot, character: character() }];
        mocks.activityRecords.set(
            'char-a',
            record({
                projection: {
                    segments: [
                        {
                            actionName: 'Party Ready',
                            actionTypeHrid: '/action_types/special',
                            startAt: 1000,
                            endAt: null,
                            queuedIndex: 0,
                            certainty: 'uncertain',
                            stopCause: 'special',
                        },
                    ],
                    terminalCause: 'unknown',
                    terminalAt: null,
                },
            })
        );

        characterSelectRenderer.startWatching();
        await mocks.onClassRegistrations[0].callback(root);

        expect(slot.innerHTML).not.toContain('<svg');
        expect(slot.textContent).toContain('Waiting for party');
    });

    test('TLA-025 item 18: a stale async render from an earlier mount cannot overwrite a newer mount', async () => {
        const rootA = buildRoot();
        const slotA = buildSlot(rootA);
        const rootB = buildRoot();
        const slotB = buildSlot(rootB);

        let releaseFirstLoad;
        const firstLoadGate = new Promise((resolve) => {
            releaseFirstLoad = resolve;
        });

        mocks.resolvedSlots = [{ slotElement: slotA, character: character({ id: 'char-a', name: 'Alice' }) }];
        mocks.activityRecords.set('char-a', record());

        const { loadAccountPreferences } = await import('./character-activity-storage.js');
        // The FIRST mount's preferences load hangs until explicitly released, simulating a slow
        // async continuation that resolves only after a second, newer mount has already rendered.
        loadAccountPreferences.mockImplementationOnce(() => firstLoadGate.then(() => mocks.accountPrefs));

        characterSelectRenderer.startWatching();
        const firstMountPromise = mocks.onClassRegistrations[0].callback(rootA);

        // A second, newer mount arrives and completes fully before the first one's gate opens.
        mocks.resolvedSlots = [{ slotElement: slotB, character: character({ id: 'char-b', name: 'Bob' }) }];
        mocks.activityRecords.set('char-b', record());
        await mocks.onClassRegistrations[0].callback(rootB);

        expect(slotB.querySelector('.toolasha-character-activity-status')).not.toBeNull();
        expect(slotA.querySelector('.toolasha-character-activity-status')).toBeNull();

        // Now let the first mount's stale continuation resolve - it must be a no-op.
        releaseFirstLoad();
        await firstMountPromise;
        await Promise.resolve();

        expect(slotA.querySelector('.toolasha-character-activity-status')).toBeNull();
        expect(slotB.querySelector('.toolasha-character-activity-status')).not.toBeNull();
    });
});
