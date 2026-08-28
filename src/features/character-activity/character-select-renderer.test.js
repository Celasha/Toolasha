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
    default: { getSpriteUrl: vi.fn(async () => mocks.spriteUrl) },
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
                    { actionName: 'First', startAt: 0, endAt: 1000, queuedIndex: 0 },
                    { actionName: 'Second', startAt: 1000, endAt: 2000, queuedIndex: 1 },
                    { actionName: 'Third', startAt: 2000, endAt: 3000, queuedIndex: 2 },
                ],
                terminalCause: 'queue',
                terminalAt: 3000,
            },
        });

        const state = computeSlotDisplayState(rec, character(), PREFS, 1500); // mid-way through segment 2

        expect(state.firstLineText).toBe('Second +1 queued');
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
});
