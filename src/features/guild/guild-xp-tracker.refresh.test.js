/**
 * Regression tests for the real guild_updated refresh lifecycle (not pure math).
 * Uses the real webSocketHook singleton (not mocked) so a fix that lives in
 * src/core/websocket.js's content-hash dedup is actually exercised end to end.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';

const LEVEL_EXPERIENCE_TABLE = [
    0, 100, 220, 360, 520, 700, 900, 1120, 1360, 1620, 1900, 2200, 2520, 2860, 3220, 3600, 4000, 4420, 4860, 5320, 5800,
];

let characterInitHandler;

vi.mock('../../core/data-manager.js', () => ({
    default: {
        characterData: null,
        on: vi.fn((event, handler) => {
            if (event === 'character_initialized') characterInitHandler = handler;
        }),
        off: vi.fn(),
        getInitClientData: vi.fn(() => ({ levelExperienceTable: LEVEL_EXPERIENCE_TABLE })),
    },
}));

vi.mock('../../core/storage.js', () => ({
    default: { get: vi.fn(() => ({})), set: vi.fn() },
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

// A real guild_updated payload's `id`/`name` alone occupy the first 100 raw chars, so two
// consecutive updates differing only in a field further into the object (experience, level)
// hash identically under websocket.js's dedup-by-first-100-chars optimization.
function guildUpdatedMessage({ level = 10, experience }) {
    const guild = {
        id: 'b6f1a2e4-8c3d-4a11-9f2b-7d5e6a8c9b10',
        name: 'Testers',
        level,
        createdAt: '2024-01-01T00:00:00.000Z',
        guildType: 'standard',
        currentWeekStartAt: '2026-08-01T00:00:00.000Z',
        experience,
    };
    return JSON.stringify({ type: 'guild_updated', guild });
}

describe('GuildXPTracker — Next Guild Level Slot stays fresh across real guild_updated refreshes', () => {
    let webSocketHook;
    let guildXPTracker;

    beforeEach(async () => {
        vi.resetModules();
        characterInitHandler = undefined;

        const wsModule = await import('../../core/websocket.js');
        webSocketHook = wsModule.default;

        const trackerModule = await import('./guild-xp-tracker.js');
        guildXPTracker = trackerModule.guildXPTracker;

        await trackerModule.default.initialize();
        await characterInitHandler({
            guild: {
                name: 'Testers',
                experience: 1000,
                level: 10,
                createdAt: '2024-01-01T00:00:00.000Z',
                guildType: 'standard',
                currentWeekStartAt: '2026-08-01T00:00:00.000Z',
            },
            guildCharacterMap: {},
            guildSharableCharacterMap: {},
            currentTimestamp: '2026-08-01T00:00:00.000Z',
        });
    });

    test('current XP and XP remaining reflect the newest guild_updated, not a stale snapshot', () => {
        webSocketHook.processMessage(guildUpdatedMessage({ experience: 2000 }));

        const afterFirst = guildXPTracker.getNextMemberSlotETA('Testers');
        expect(guildXPTracker.getCurrentGuildXP('Testers')).toBe(2000);
        expect(afterFirst.targetLevel).toBe(12);
        expect(afterFirst.xpRemaining).toBe(LEVEL_EXPERIENCE_TABLE[12] - 2000);

        // Same id/name/level/etc as a real second refresh — only experience changed, and it
        // collides on the first 100 raw chars with the message above.
        webSocketHook.processMessage(guildUpdatedMessage({ experience: 2500 }));

        const afterSecond = guildXPTracker.getNextMemberSlotETA('Testers');
        expect(guildXPTracker.getCurrentGuildXP('Testers')).toBe(2500);
        expect(afterSecond.xpRemaining).toBe(LEVEL_EXPERIENCE_TABLE[12] - 2500);
        expect(afterSecond.xpRemaining).toBeLessThan(afterFirst.xpRemaining);
    });

    test('target level recalculates when a colliding-hash refresh crosses a slot boundary', () => {
        webSocketHook.processMessage(guildUpdatedMessage({ level: 11, experience: 2600 }));
        expect(guildXPTracker.getNextMemberSlotETA('Testers').targetLevel).toBe(12);

        // Same id/name/createdAt/guildType/currentWeekStartAt as above; level+experience both
        // changed but stay behind the 100-char dedup cutoff.
        webSocketHook.processMessage(guildUpdatedMessage({ level: 12, experience: 2900 }));

        const eta = guildXPTracker.getNextMemberSlotETA('Testers');
        expect(guildXPTracker.getCurrentGuildXP('Testers')).toBe(2900);
        expect(eta.targetLevel).toBe(15);
    });

    test('returning to Overview does not preserve a stale rendered line (repeated refresh calls are idempotent-safe)', () => {
        webSocketHook.processMessage(guildUpdatedMessage({ experience: 3000 }));
        webSocketHook.processMessage(guildUpdatedMessage({ experience: 3400 }));
        webSocketHook.processMessage(guildUpdatedMessage({ experience: 3900 }));

        expect(guildXPTracker.getCurrentGuildXP('Testers')).toBe(3900);
    });
});
