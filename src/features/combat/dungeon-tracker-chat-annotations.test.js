/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('./dungeon-tracker-storage.js', () => ({
    default: { getDungeonInfo: vi.fn() },
}));

vi.mock('./dungeon-tracker.js', () => ({
    default: {},
}));

vi.mock('../../core/config.js', () => ({
    default: { isFeatureEnabled: vi.fn(() => true) },
}));

const { default: dungeonTrackerChatAnnotations } = await import('./dungeon-tracker-chat-annotations.js');

function buildTabsContainer(labels) {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'Chat_tabsComponentContainer__3ZoKe';
    for (const label of labels) {
        const button = document.createElement('button');
        button.className = 'MuiButtonBase-root';
        button.textContent = label;
        container.appendChild(button);
    }
    document.body.appendChild(container);
    return container;
}

describe('DungeonTrackerChatAnnotations — tab click handler tracking (memory leak fix)', () => {
    beforeEach(() => {
        dungeonTrackerChatAnnotations.tabClickHandlers.clear();
        document.body.innerHTML = '';
    });

    test('observeTabSwitches wires a click handler onto the Party tab button', () => {
        buildTabsContainer(['General', 'Party']);

        dungeonTrackerChatAnnotations.observeTabSwitches();

        expect(dungeonTrackerChatAnnotations.tabClickHandlers.size).toBe(1);
        const [button] = dungeonTrackerChatAnnotations.tabClickHandlers.keys();
        expect(button.textContent).toBe('Party');
    });

    test('re-running observeTabSwitches on a rebuilt tabs bar drops the stale button entry', () => {
        buildTabsContainer(['General', 'Party']);
        dungeonTrackerChatAnnotations.observeTabSwitches();
        const [staleButton] = dungeonTrackerChatAnnotations.tabClickHandlers.keys();

        // Simulate the game rebuilding the whole tabs bar with brand-new button elements
        buildTabsContainer(['General', 'Party']);
        dungeonTrackerChatAnnotations.observeTabSwitches();

        expect(dungeonTrackerChatAnnotations.tabClickHandlers.has(staleButton)).toBe(false);
        expect(dungeonTrackerChatAnnotations.tabClickHandlers.size).toBe(1);
    });

    test('_pruneDetachedTabHandlers removes only buttons no longer connected to the document', () => {
        const container = buildTabsContainer(['Party']);
        const connectedButton = container.querySelector('button');
        const detachedButton = document.createElement('button'); // never appended

        dungeonTrackerChatAnnotations.tabClickHandlers.set(connectedButton, vi.fn());
        dungeonTrackerChatAnnotations.tabClickHandlers.set(detachedButton, vi.fn());

        dungeonTrackerChatAnnotations._pruneDetachedTabHandlers();

        expect(dungeonTrackerChatAnnotations.tabClickHandlers.has(connectedButton)).toBe(true);
        expect(dungeonTrackerChatAnnotations.tabClickHandlers.has(detachedButton)).toBe(false);
    });

    test('cleanup() removes listeners from and clears every tracked button', () => {
        const container = buildTabsContainer(['Party']);
        const button = container.querySelector('button');
        const handler = vi.fn();
        button.addEventListener('click', handler);
        dungeonTrackerChatAnnotations.tabClickHandlers.set(button, handler);

        dungeonTrackerChatAnnotations.cleanup();

        button.dispatchEvent(new Event('click'));
        expect(handler).not.toHaveBeenCalled();
        expect(dungeonTrackerChatAnnotations.tabClickHandlers.size).toBe(0);
    });
});

function msgWithText(text) {
    return { textContent: text };
}

describe('DungeonTrackerChatAnnotations — getTimestampFromMessage', () => {
    test('parses a hyphen date combined with a 12-hour AM/PM suffix (real reported format)', () => {
        const msg = msgWithText('[10-10 7:34:50 PM] Key counts: [Smelly - 172]');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg, true);

        expect(result).not.toBeNull();
        expect(result.getMonth()).toBe(9); // October, 0-indexed
        expect(result.getDate()).toBe(10);
        expect(result.getHours()).toBe(19); // 7 PM -> 19:00
        expect(result.getMinutes()).toBe(34);
        expect(result.getSeconds()).toBe(50);
    });

    test('still parses the American slash format with AM/PM', () => {
        const msg = msgWithText('[10/15 2:30:05 PM] Battle started: Pirate Cove');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg);

        expect(result.getMonth()).toBe(9); // October
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(14);
        expect(result.getMinutes()).toBe(30);
        expect(result.getSeconds()).toBe(5);
    });

    test('swaps month/day for the American format when the first part cannot be a month', () => {
        const msg = msgWithText('[16/07 09:00:00] Battle started: Pirate Cove');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg);

        expect(result.getMonth()).toBe(6); // July
        expect(result.getDate()).toBe(16);
    });

    test('still parses the international hyphen format with a 24-hour clock (no AM/PM)', () => {
        const msg = msgWithText('[15-10 14:30:00] Battle started: Pirate Cove');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg);

        expect(result.getMonth()).toBe(9); // October
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(14);
    });

    test('still parses the European dot format with an optional trailing dot', () => {
        const msg = msgWithText('[15.10. 14:30:00] Battle started: Pirate Cove');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg);

        expect(result.getMonth()).toBe(9); // October
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(14);
    });

    test('returns null and warns on request for text with no recognizable timestamp', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const msg = msgWithText('Key counts: [Smelly - 172]');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg, true);

        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test('resolves an ambiguous hyphen date toward the reference date instead of a hard-coded day-month order (real reported bug)', () => {
        // Real reported sequence: a run ending "[10-10 11:48:26 PM]" followed by the next run's
        // start "[10-11 12:05:07 AM]" - both digits of "10-11" are <=12, so the old hard-coded
        // "hyphen always means day-month" assumption misread it as November 10th, producing a
        // ~30-day diff instead of the real ~17 minutes.
        const reference = new Date(2026, 9, 10, 23, 48, 26); // Oct 10, 2026, 11:48:26 PM
        const msg = msgWithText('[10-11 12:05:07 AM] Key counts: [Smelly - 156]');

        const result = dungeonTrackerChatAnnotations.getTimestampFromMessage(msg, true, reference);

        expect(result.getMonth()).toBe(9); // October, not November
        expect(result.getDate()).toBe(11);
        expect(result.getTime() - reference.getTime()).toBeLessThan(60 * 60 * 1000); // under an hour apart
    });
});

describe('DungeonTrackerChatAnnotations — _isOutlierDiff (live average corruption guard)', () => {
    test('never flags an outlier before there is enough history to trust the average', () => {
        const dungeonStats = { runCount: 2, totalTime: 2 * 16 * 60 * 1000 };
        // Even a huge diff shouldn't be flagged yet - too little history to call it anomalous.
        expect(dungeonTrackerChatAnnotations._isOutlierDiff(60 * 60 * 1000, dungeonStats)).toBe(false);
    });

    test('does not flag a normal run close to the running average', () => {
        const dungeonStats = { runCount: 10, totalTime: 10 * 16 * 60 * 1000 }; // avg = 16m
        expect(dungeonTrackerChatAnnotations._isOutlierDiff(17 * 60 * 1000, dungeonStats)).toBe(false);
    });

    test('flags a diff more than 3x the running average once there is enough history', () => {
        const dungeonStats = { runCount: 10, totalTime: 10 * 16 * 60 * 1000 }; // avg = 16m
        // The exact reported case: ~43276 minutes against a ~16m38s average.
        expect(dungeonTrackerChatAnnotations._isOutlierDiff(43276 * 60 * 1000, dungeonStats)).toBe(true);
    });
});
