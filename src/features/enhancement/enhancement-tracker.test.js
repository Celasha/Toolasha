import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentCharacterId: 'character-a',
    loadEnhancementState: vi.fn(),
    saveSessions: vi.fn(async () => true),
    saveCurrentSessionId: vi.fn(async () => true),
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => mocks.currentCharacterId),
        getIsCharacterSwitching: vi.fn(() => false),
        getInitClientData: vi.fn(() => ({
            itemDetailMap: {
                '/items/sword': { name: 'Sword' },
            },
        })),
    },
}));

vi.mock('../../api/marketplace.js', () => ({
    default: { getPrice: vi.fn(() => ({ ask: 100 })) },
}));

vi.mock('./enhancement-storage.js', () => ({
    loadEnhancementState: mocks.loadEnhancementState,
    saveSessions: mocks.saveSessions,
    saveCurrentSessionId: mocks.saveCurrentSessionId,
}));

vi.mock('./enhancement-xp.js', () => ({
    calculateEnhancementPredictions: vi.fn(() => null),
}));

import { createSession } from './enhancement-session.js';
import { EnhancementTracker } from './enhancement-tracker.js';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentCharacterId = 'character-a';
    mocks.loadEnhancementState.mockResolvedValue({ sessions: {}, currentSessionId: null });
});

describe('EnhancementTracker character lifecycle', () => {
    test('loads only the active character state', async () => {
        const session = createSession('/items/sword', 'Sword', 0, 5, 0);
        mocks.loadEnhancementState.mockResolvedValue({
            sessions: { [session.id]: session },
            currentSessionId: session.id,
        });
        const tracker = new EnhancementTracker();

        await tracker.initialize();

        expect(mocks.loadEnhancementState).toHaveBeenCalledWith('character-a');
        expect(tracker.characterId).toBe('character-a');
        expect(tracker.getCurrentSession()).toBe(session);
    });

    test('rejects a stale initialization after character cleanup and reinitialization', async () => {
        let resolveCharacterA;
        mocks.loadEnhancementState
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveCharacterA = resolve;
                    })
            )
            .mockResolvedValueOnce({ sessions: {}, currentSessionId: null });

        const tracker = new EnhancementTracker();
        const staleInitialization = tracker.initialize();
        tracker.disable();

        mocks.currentCharacterId = 'character-b';
        await tracker.initialize();
        resolveCharacterA({
            sessions: { stale: createSession('/items/sword', 'Sword', 0, 5, 0) },
            currentSessionId: 'stale',
        });
        await staleInitialization;

        expect(tracker.characterId).toBe('character-b');
        expect(tracker.getAllSessions()).toEqual({});
        expect(tracker.isInitialized).toBe(true);
    });

    test('rejects loaded state when the active character changed before cleanup reached the feature', async () => {
        let resolveCharacterA;
        mocks.loadEnhancementState.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveCharacterA = resolve;
                })
        );
        const tracker = new EnhancementTracker();
        const pending = tracker.initialize();

        mocks.currentCharacterId = 'character-b';
        resolveCharacterA({ sessions: {}, currentSessionId: null });
        await pending;

        expect(tracker.isInitialized).toBe(false);
        expect(tracker.characterId).toBeNull();
    });

    test('persists an in-flight operation under the captured character ID', async () => {
        let resolveSave;
        mocks.saveSessions.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveSave = resolve;
                })
        );

        const tracker = new EnhancementTracker();
        await tracker.initialize();
        const startPromise = tracker.startSession('/items/sword', 0, 5, 0);

        tracker.disable();
        mocks.currentCharacterId = 'character-b';
        await tracker.initialize();
        resolveSave(true);
        await startPromise;

        expect(mocks.saveSessions.mock.calls[0][1]).toBe('character-a');
        expect(mocks.saveCurrentSessionId.mock.calls[0][1]).toBe('character-a');
        expect(tracker.characterId).toBe('character-b');
        expect(tracker.getAllSessions()).toEqual({});
    });

    test('clears active-session persistence for the captured character when a target completes', async () => {
        const session = createSession('/items/sword', 'Sword', 0, 1, 0);
        mocks.loadEnhancementState.mockResolvedValue({
            sessions: { [session.id]: session },
            currentSessionId: session.id,
        });
        const tracker = new EnhancementTracker();
        await tracker.initialize();

        await tracker.recordSuccess(0, 1);

        expect(tracker.currentSessionId).toBeNull();
        expect(mocks.saveSessions).toHaveBeenCalledWith(tracker.sessions, 'character-a');
        expect(mocks.saveCurrentSessionId).toHaveBeenCalledWith(null, 'character-a');
    });

    test('passes wasBlessed through to the session so a +2 success is tracked as Blessed', async () => {
        const session = createSession('/items/sword', 'Sword', 0, 10, 0);
        mocks.loadEnhancementState.mockResolvedValue({
            sessions: { [session.id]: session },
            currentSessionId: session.id,
        });
        const tracker = new EnhancementTracker();
        await tracker.initialize();

        await tracker.recordSuccess(0, 2, true);

        expect(tracker.getCurrentSession().totalBlessed).toBe(1);
    });

    test('normalizes an older session loaded without a Blessed field to zero, not undefined', async () => {
        const legacySession = createSession('/items/sword', 'Sword', 0, 5, 0);
        delete legacySession.totalBlessed;
        mocks.loadEnhancementState.mockResolvedValue({
            sessions: { [legacySession.id]: legacySession },
            currentSessionId: legacySession.id,
        });
        const tracker = new EnhancementTracker();

        await tracker.initialize();

        expect(tracker.getCurrentSession().totalBlessed).toBe(0);
    });
});
