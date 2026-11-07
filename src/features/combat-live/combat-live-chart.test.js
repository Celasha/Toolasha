import { describe, expect, test, vi } from 'vitest';
import config from '../../core/config.js';
import {
    OTHER_KEY,
    abilityColor,
    buildAbilityBar,
    PLAYER_PALETTE,
    buildGraphModel,
    niceInterval,
    buildPaceModel,
    buildRankingBars,
    buildSparkModel,
    buildTapeModel,
    drawHitTape,
    drawDpsGraph,
    drawSparkline,
    playerColor,
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

describe('buildSparkModel', () => {
    test('puts the newest point at the right and scales against the highest of the line and the average', () => {
        const { points, averageY } = buildSparkModel([10, 20, 40], 20, 3);

        expect(points).toHaveLength(3);
        expect(points[2]).toBeCloseTo(40 / (40 * 1.05), 5);
        expect(points[0]).toBeCloseTo(10 / (40 * 1.05), 5);
        expect(averageY).toBeCloseTo(20 / (40 * 1.05), 5);
    });

    test('an average above the whole line raises the scale so it still fits', () => {
        const { points, averageY } = buildSparkModel([10, 10], 100, 2);

        expect(averageY).toBeLessThanOrEqual(1);
        expect(points[0]).toBeLessThan(0.2);
    });

    test('squeezes a long series into the width, keeping the first and last steps', () => {
        const series = Array.from({ length: 150 }, (_, i) => i);
        const { points } = buildSparkModel(series, 75, 50);

        expect(points).toHaveLength(50);
        expect(points[0]).toBe(0);
        expect(points[49]).toBeCloseTo(149 / (149 * 1.05), 5);
    });

    test('a short series is not stretched to fill the width', () => {
        expect(buildSparkModel([5, 6, 7], 6, 50).points).toHaveLength(3);
    });

    test('is empty when there is no series yet', () => {
        expect(buildSparkModel([], 0)).toEqual({ points: [], averageY: 0 });
    });
});

describe('drawSparkline', () => {
    test('does nothing without canvas support', () => {
        expect(() => drawSparkline({ getContext: () => null }, { points: [0.5], averageY: 0.5 })).not.toThrow();
    });
});

describe('playerColor', () => {
    test('hands colours out in the order players are first seen and keeps them', () => {
        const assigned = new Map();
        const first = playerColor(assigned, 'Alice');
        const second = playerColor(assigned, 'Bob');

        expect(first).not.toBe(second);
        expect(playerColor(assigned, 'Alice')).toBe(first);
        expect(playerColor(assigned, 'Bob')).toBe(second);
    });

    test('uses the colour set for that slot in the colour settings', () => {
        const spy = vi
            .spyOn(config, 'getSettingValue')
            .mockImplementation((key) => (key === 'color_player_2' ? '#123456' : null));
        const assigned = new Map();
        playerColor(assigned, 'Alice');

        expect(playerColor(assigned, 'Bob')).toBe('#123456');
        spy.mockRestore();
    });

    test('wraps around after the palette runs out', () => {
        const assigned = new Map();
        const colors = Array.from({ length: PLAYER_PALETTE.length + 1 }, (_, i) => playerColor(assigned, `P${i}`));

        expect(colors[PLAYER_PALETTE.length]).toBe(colors[0]);
    });
});

describe('buildRankingBars', () => {
    test('ranks largest first, scales against the leader and drops zeros', () => {
        const bars = buildRankingBars([
            { name: 'Bob', value: 50 },
            { name: 'Idle', value: 0 },
            { name: 'Alice', value: 200 },
        ]);

        expect(bars.map((bar) => bar.name)).toEqual(['Alice', 'Bob']);
        expect(bars.map((bar) => bar.width)).toEqual([1, 0.25]);
    });

    test('is empty with nothing to rank', () => {
        expect(buildRankingBars([{ name: 'Idle', value: 0 }])).toEqual([]);
    });
});

describe('niceInterval', () => {
    test('snaps to 1, 2, 5 or 10 times a power of ten', () => {
        expect(niceInterval(300, 3)).toBe(100);
        expect(niceInterval(1800, 3)).toBe(500);
        expect(niceInterval(95, 3)).toBe(20);
        expect(niceInterval(7, 3)).toBe(2);
    });

    test('has a sane value for nothing', () => {
        expect(niceInterval(0)).toBe(1);
    });
});

describe('buildGraphModel', () => {
    const graph = (series, boss = []) => ({ stepMs: 2000, boss, lines: [{ name: 'Alice', series }] });

    test('is null until there are a couple of steps', () => {
        expect(buildGraphModel(graph([]))).toBeNull();
        expect(buildGraphModel(graph([100]))).toBeNull();
    });

    test('the scale starts at 0 and tops out on a round number above the peak', () => {
        const model = buildGraphModel(graph([100, 480, 250]));

        expect(model.ticks[0].value).toBe(0);
        expect(model.yMax).toBe(600);
        expect(model.ticks.map((tick) => tick.value)).toEqual([0, 200, 400, 600]);
    });

    test('the newest point is at the right edge, and a short fight leaves room on the left', () => {
        const model = buildGraphModel(graph([10, 20, 30]));
        const points = model.lines[0].points;

        expect(points[2].x).toBe(model.right);
        expect(points[0].x).toBeGreaterThan(model.left + 100);
    });

    test('a higher value is drawn higher up, and the average line sits on the same scale', () => {
        const model = buildGraphModel(graph([0, 400]), 200);

        expect(model.lines[0].points[1].y).toBeLessThan(model.lines[0].points[0].y);
        expect(model.averageY).toBeGreaterThan(model.lines[0].points[1].y);
        expect(model.averageY).toBeLessThan(model.lines[0].points[0].y);
    });

    test('runs of boss steps become bands', () => {
        const model = buildGraphModel(graph([1, 2, 3, 4, 5, 6], [false, true, true, false, true, true]));

        expect(model.bossSpans).toHaveLength(2);
        expect(model.bossSpans[0].x0).toBeLessThan(model.bossSpans[0].x1);
    });

    test('time labels step by 15s for a short fight and by a minute for a long one', () => {
        expect(buildGraphModel(graph(Array(20).fill(5))).xTicks.map((tick) => tick.seconds)).toEqual([
            0, 15, 30, 45, 60,
        ]);
        expect(buildGraphModel(graph(Array(150).fill(5))).xTicks.map((tick) => tick.seconds)).toEqual([
            0, 60, 120, 180, 240, 300,
        ]);
    });
});

describe('drawDpsGraph', () => {
    test('does nothing without canvas support or a model', () => {
        const options = { colorFor: () => '#fff', selfName: null, formatValue: String, formatTime: String };
        expect(() => drawDpsGraph({ getContext: () => null }, {}, options)).not.toThrow();
        expect(() => drawDpsGraph({ getContext: () => ({}) }, null, options)).not.toThrow();
    });
});
