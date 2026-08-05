import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map(),
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        get: vi.fn(async (key, _store, defaultValue = null) =>
            mocks.values.has(key) ? mocks.values.get(key) : defaultValue
        ),
        getJSON: vi.fn(async (key, _store, defaultValue = null) =>
            mocks.values.has(key) ? mocks.values.get(key) : defaultValue
        ),
        set: vi.fn(async (key, value) => {
            mocks.values.set(key, value);
            return true;
        }),
        setJSON: vi.fn(async (key, value) => {
            mocks.values.set(key, value);
            return true;
        }),
        delete: vi.fn(async (key) => {
            mocks.values.delete(key);
            return true;
        }),
    },
}));

import storage from '../../core/storage.js';
import {
    getCharacterStorageKey,
    loadEnhancementState,
    saveCurrentSessionId,
    saveSessions,
} from './enhancement-storage.js';

beforeEach(() => {
    mocks.values.clear();
    vi.clearAllMocks();
});

describe('Enhancement storage character scoping', () => {
    test('migrates legacy sessions once to the active character', async () => {
        const sessions = {
            session_1: { id: 'session_1', itemHrid: '/items/sword' },
        };
        mocks.values.set('enhancementTracker_sessions', sessions);
        mocks.values.set('enhancementTracker_currentSession', 'session_1');

        const state = await loadEnhancementState('character-a');

        expect(state).toEqual({ sessions, currentSessionId: 'session_1' });
        expect(mocks.values.get('enhancementTracker_sessions:character-a')).toBe(sessions);
        expect(mocks.values.get('enhancementTracker_currentSession:character-a')).toBe('session_1');
        expect(mocks.values.has('enhancementTracker_sessions')).toBe(false);
        expect(mocks.values.has('enhancementTracker_currentSession')).toBe(false);

        const otherCharacter = await loadEnhancementState('character-b');
        expect(otherCharacter).toEqual({ sessions: {}, currentSessionId: null });
    });

    test('does not migrate an orphan current-session pointer', async () => {
        mocks.values.set('enhancementTracker_sessions', {
            session_1: { id: 'session_1', itemHrid: '/items/sword' },
        });
        mocks.values.set('enhancementTracker_currentSession', 'missing_session');

        const state = await loadEnhancementState('character-a');

        expect(state.currentSessionId).toBeNull();
        expect(mocks.values.get('enhancementTracker_currentSession:character-a')).toBeNull();
    });

    test('removes stale legacy leftovers when scoped state already exists', async () => {
        const scopedSessions = { scoped: { id: 'scoped' } };
        mocks.values.set('enhancementTracker_sessions:character-a', scopedSessions);
        mocks.values.set('enhancementTracker_currentSession:character-a', null);
        mocks.values.set('enhancementTracker_sessions', { legacy: { id: 'legacy' } });
        mocks.values.set('enhancementTracker_currentSession', 'legacy');

        const state = await loadEnhancementState('character-a');

        expect(state.sessions).toBe(scopedSessions);
        expect(mocks.values.has('enhancementTracker_sessions')).toBe(false);
        expect(mocks.values.has('enhancementTracker_currentSession')).toBe(false);
    });

    test('writes sessions and active pointers only under explicit character keys', async () => {
        await saveSessions({ session_1: {} }, 'character-a');
        await saveCurrentSessionId('session_1', 'character-a');

        expect(storage.setJSON).toHaveBeenCalledWith(
            getCharacterStorageKey('enhancementTracker_sessions', 'character-a'),
            { session_1: {} },
            'settings',
            true
        );
        expect(storage.set).toHaveBeenCalledWith(
            getCharacterStorageKey('enhancementTracker_currentSession', 'character-a'),
            'session_1',
            'settings',
            true
        );
    });

    test('keeps legacy data when a scoped migration write fails', async () => {
        const sessions = {
            session_1: { id: 'session_1', itemHrid: '/items/sword' },
        };
        mocks.values.set('enhancementTracker_sessions', sessions);
        mocks.values.set('enhancementTracker_currentSession', 'session_1');
        storage.setJSON.mockResolvedValueOnce(false);

        const state = await loadEnhancementState('character-a');

        expect(state).toEqual({ sessions, currentSessionId: 'session_1' });
        expect(mocks.values.has('enhancementTracker_sessions')).toBe(true);
        expect(mocks.values.has('enhancementTracker_currentSession')).toBe(true);
    });
});
