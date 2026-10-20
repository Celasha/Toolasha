import { describe, expect, test } from 'vitest';
import { ConsumableDebugRecorder } from './combat-stats-consumable-debug.js';

const COFFEE = '/items/ultimate_magic_coffee';

describe('ConsumableDebugRecorder', () => {
    test('counts accepted and de-duplicated events separately', () => {
        const recorder = new ConsumableDebugRecorder();
        recorder.recordEvent(COFFEE, true, 100);
        recorder.recordEvent(COFFEE, false);

        expect(recorder.items[COFFEE]).toMatchObject({ eventsAccepted: 1, eventsDedupSkipped: 1 });
    });

    test('a payload count that drops by more than one reveals missed events', () => {
        const recorder = new ConsumableDebugRecorder();
        recorder.recordEvent(COFFEE, true, 100);
        recorder.recordEvent(COFFEE, true, 99);
        recorder.recordEvent(COFFEE, true, 96); // two events never arrived

        expect(recorder.items[COFFEE]).toMatchObject({
            eventsAccepted: 3,
            payloadCountDrop: 4,
            payloadMissedEvents: 2,
        });
    });

    test('new_battle snapshot drops accumulate, ignoring jumps larger than 5', () => {
        const recorder = new ConsumableDebugRecorder();
        recorder.recordNewBattle([{ itemHrid: COFFEE, count: 100 }]);
        recorder.recordNewBattle([{ itemHrid: COFFEE, count: 98 }]);
        recorder.recordNewBattle([{ itemHrid: COFFEE, count: 80 }]);
        recorder.recordNewBattle([{ itemHrid: COFFEE, count: 79 }]);

        expect(recorder.items[COFFEE]).toMatchObject({
            firstSnapshotCount: 100,
            lastSnapshotCount: 79,
            snapshotDrop: 3,
            snapshotLargeDropIgnored: 1,
        });
    });

    test('tracks new_battle gaps and context in the report', () => {
        const recorder = new ConsumableDebugRecorder();
        recorder.recordNewBattle([], 1000);
        recorder.recordNewBattle([], 1000 + 90000);
        recorder.recordSocketClose(5000);
        recorder.recordTrackingReset('battleId decreased', 6000);

        const report = recorder.getReport({ trackedHours: 1.5 });

        expect(report).toMatchObject({
            newBattleMessages: 2,
            longestNewBattleGapSeconds: 90,
            newBattleGapsOver60s: 1,
            trackedHours: 1.5,
        });
        expect(report.socketCloses).toHaveLength(1);
        expect(report.trackingResets[0].reason).toBe('battleId decreased');
    });
});
