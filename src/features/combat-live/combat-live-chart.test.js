import { describe, expect, test, vi } from 'vitest';
import {
    OTHER_KEY,
    abilityColor,
    buildAbilityBar,
    buildPaceModel,
    buildTapeModel,
    drawHitTape,
} from './combat-live-chart.js';

describe('buildPaceModel', () => {
    test('above the average is up, with the percentage', () => {
        expect(buildPaceModel({ currentDps: 336, averageDps: 300 })).toEqual({
            direction: 'up',
            arrow: '▲',
            percent: 12,
        });
    });

    test('below the average is down, with a positive percentage', () => {
        expect(buildPaceModel({ currentDps: 240, averageDps: 300 })).toEqual({
            direction: 'down',
            arrow: '▼',
            percent: 20,
        });
    });

    test('within a few percent of the average counts as steady', () => {
        expect(buildPaceModel({ currentDps: 302, averageDps: 300 }).direction).toBe('flat');
    });

    test('with no average yet there is nothing to compare', () => {
        expect(buildPaceModel({ currentDps: 100, averageDps: 0 })).toEqual({
            direction: 'flat',
            arrow: '•',
            percent: 0,
        });
    });
});

describe('buildTapeModel', () => {
    const hit = (t, amount, extra = {}) => ({ t, amount, crit: false, miss: false, key: 'auto', ...extra });

    test('puts the newest hit at the right edge and older hits further left', () => {
        const { bars } = buildTapeModel([hit(30000, 10), hit(60000, 10)], 60000, 300, 60000);

        expect(bars.map((bar) => bar.x)).toEqual([150, 299]);
    });

    test('scales bar height to the biggest hit on the tape, with a visible minimum', () => {
        const { bars, max } = buildTapeModel([hit(10000, 1000), hit(20000, 500), hit(30000, 1)], 60000, 300, 60000);

        expect(max).toBe(1000);
        expect(bars.map((bar) => bar.height)).toEqual([1, 0.5, 0.08]);
    });

    test('marks crits and shows misses as short hollow ticks that do not set the scale', () => {
        const { bars, max } = buildTapeModel(
            [hit(10000, 400, { crit: true }), hit(20000, 0, { miss: true }), hit(30000, 200)],
            60000
        );

        expect(bars.map((bar) => bar.kind)).toEqual(['crit', 'miss', 'hit']);
        expect(max).toBe(400);
        expect(bars[1].height).toBe(0.12);
    });

    test('leaves out hits older than the window', () => {
        const { bars } = buildTapeModel([hit(1000, 10), hit(50000, 10)], 70000, 300, 60000);

        expect(bars).toHaveLength(1);
    });

    test('an empty tape is fine', () => {
        expect(buildTapeModel([], 60000)).toEqual({ bars: [], max: 1 });
    });
});

describe('buildAbilityBar', () => {
    test('orders segments largest first and their shares add up to one', () => {
        const bar = buildAbilityBar([
            { key: '/abilities/b', damage: 300 },
            { key: '/abilities/a', damage: 700 },
        ]);

        expect(bar.map((segment) => segment.key)).toEqual(['/abilities/a', '/abilities/b']);
        expect(bar.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1, 10);
    });

    test('folds tiny abilities into one "other" segment', () => {
        const bar = buildAbilityBar([
            { key: '/abilities/a', damage: 970 },
            { key: '/abilities/b', damage: 20 },
            { key: '/abilities/c', damage: 10 },
        ]);

        expect(bar.map((segment) => segment.key)).toEqual(['/abilities/a', OTHER_KEY]);
        expect(bar[1].share).toBeCloseTo(0.03, 10);
    });

    test('no damage means no bar', () => {
        expect(buildAbilityBar([])).toEqual([]);
        expect(buildAbilityBar([{ key: 'auto', damage: 0 }])).toEqual([]);
    });
});

describe('abilityColor', () => {
    test('is stable for the same ability, so it does not flicker between redraws', () => {
        expect(abilityColor('/abilities/entangle')).toBe(abilityColor('/abilities/entangle'));
    });

    test('gives auto attack, over time and reflected their own fixed colors', () => {
        const fixed = ['auto', 'over-time', 'reflect'].map(abilityColor);

        expect(new Set(fixed).size).toBe(3);
    });
});

describe('drawHitTape', () => {
    test('does nothing when the canvas has no 2d context', () => {
        expect(() => drawHitTape({ getContext: () => null }, { bars: [] })).not.toThrow();
    });

    test('draws a bar per hit, a gold cap on a crit, and an outline for a miss', () => {
        const context = {
            scale: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
        };
        const canvas = { getContext: () => context, width: 0, height: 0 };

        drawHitTape(canvas, {
            bars: [
                { x: 10, height: 0.5, kind: 'hit', key: 'auto' },
                { x: 20, height: 1, kind: 'crit', key: 'auto' },
                { x: 30, height: 0.12, kind: 'miss', key: 'auto' },
            ],
        });

        // background + baseline, then hit (1), crit (2: bar + cap)
        expect(context.fillRect).toHaveBeenCalledTimes(2 + 1 + 2);
        expect(context.strokeRect).toHaveBeenCalledTimes(1);
        expect(canvas.width).toBeGreaterThan(0);
    });

    test('bars are 3 px wide, centred on their time, and never run off the edge of the tape', () => {
        const context = {
            scale: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
        };
        const canvas = { getContext: () => context, width: 0, height: 0 };

        drawHitTape(
            canvas,
            {
                bars: [
                    { x: 100, height: 0.5, kind: 'hit', key: 'auto' },
                    { x: 0, height: 0.5, kind: 'hit', key: 'auto' },
                    { x: 295, height: 0.5, kind: 'hit', key: 'auto' },
                ],
            },
            296,
            44
        );

        // calls 0 and 1 are the background and baseline; then one bar each
        const bars = context.fillRect.mock.calls.slice(2);
        expect(bars.map(([x, , w]) => [x, w])).toEqual([
            [99, 3],
            [0, 3],
            [293, 3],
        ]);
    });
});
