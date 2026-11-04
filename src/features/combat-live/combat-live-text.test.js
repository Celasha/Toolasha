import { describe, expect, test, vi } from 'vitest';

vi.mock('../../utils/formatters.js', () => ({
    formatLargeNumber: (value, decimals) => (decimals ? Number(value).toFixed(decimals) : String(value)),
    timeReadable: (seconds) => `${seconds}s`,
}));

const { summaryToText } = await import('./combat-live-text.js');

const summary = {
    seconds: 600,
    party: { dps: 150, damage: 90000, kills: 40 },
    dealt: [
        { name: 'Bob', damage: 30000, dps: 50 },
        { name: 'Alice', damage: 60000, dps: 100 },
        { name: 'Idle', damage: 0, dps: 0 },
    ],
    unattributed: { damage: 900, share: 0.01 },
    healers: [{ name: 'Alice', healing: 5000, hps: 8.3 }],
    players: [{ name: 'Bob', damage: 4000, deaths: 2 }],
};

describe('summaryToText', () => {
    const text = summaryToText(summary, { date: Date.UTC(2026, 10, 3, 14, 2) });
    const lines = text.split('\n');

    test('starts with the date and the session time, then the party totals', () => {
        expect(lines[0]).toBe('=== Combat Live | 2026-11-03 14:02 | 600s ===');
        expect(lines[1]).toBe('Party: 150.0 dps | 90000 damage | 40 kills');
    });

    test('ranks players by damage with their share, and leaves out anyone who did nothing', () => {
        expect(lines[2]).toContain('1. Alice');
        expect(lines[2]).toContain('67%');
        expect(lines[3]).toContain('2. Bob');
        expect(text).not.toContain('Idle');
    });

    test('says how much was not assigned, and lists healing and damage taken when there is some', () => {
        expect(text).toContain('Not assigned to a player: 1%');
        expect(text).toContain('Healing:');
        expect(text).toContain('Damage taken:');
        expect(text).toContain('deaths 2');
    });

    test('a label goes in the title, and sections with nothing to say are left out', () => {
        const bare = summaryToText(
            { seconds: 60, party: { dps: 1, damage: 10, kills: 1 }, dealt: [] },
            { label: 'Zone 9' }
        );
        expect(bare.split('\n')[0]).toContain('Combat Live - Zone 9');
        expect(bare).not.toContain('Healing:');
        expect(bare).not.toContain('Damage taken:');
    });
});
