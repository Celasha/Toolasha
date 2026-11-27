/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../core/i18n.js', () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    default: { getLocale: () => 'en' },
}));
vi.mock('../../../core/config.js', () => ({
    default: { getSettingValue: (_key, fallback) => fallback },
}));

const { buildChartPoints, summarizeSeries, WishlistChart, GAP_THRESHOLD_MS } = await import('./wishlist-chart.js');

const HOUR = 60 * 60 * 1000;

describe('buildChartPoints', () => {
    const now = 100 * HOUR;

    test('turns each recorded point into an x/y point and flags estimated prices', () => {
        const points = buildChartPoints(
            [
                [now - 2 * HOUR, 100, 0],
                [now - HOUR, 120, 1],
            ],
            { now }
        );

        expect(points).toEqual([
            { x: now - 2 * HOUR, y: 100, estimated: false },
            { x: now - HOUR, y: 120, estimated: true },
        ]);
    });

    test('limits to the range', () => {
        const series = [
            [now - 50 * HOUR, 1, 0],
            [now - 5 * HOUR, 2, 0],
            [now - HOUR, 3, 0],
        ];

        const points = buildChartPoints(series, { rangeMs: 24 * HOUR, now, connectGaps: true });

        expect(points.map((p) => p.y)).toEqual([2, 3]);
    });

    test('breaks the line across a gap, and joins it when asked to', () => {
        const series = [
            [now - 10 * HOUR, 100, 0],
            [now - 9 * HOUR, 110, 0],
            [now - 2 * HOUR, 120, 0],
        ];

        const broken = buildChartPoints(series, { now });
        expect(broken.map((p) => (Number.isNaN(p.y) ? 'gap' : p.y))).toEqual([100, 110, 'gap', 120]);
        expect(broken[2].x).toBe(now - 9 * HOUR + 1);

        const joined = buildChartPoints(series, { now, connectGaps: true });
        expect(joined.map((p) => p.y)).toEqual([100, 110, 120]);
    });

    test('a gap of exactly the threshold does not break the line', () => {
        const series = [
            [now - 5 * HOUR, 100, 0],
            [now - 5 * HOUR + GAP_THRESHOLD_MS, 110, 0],
        ];

        expect(buildChartPoints(series, { now })).toHaveLength(2);
    });

    test('an empty series gives no points', () => {
        expect(buildChartPoints([], { now })).toEqual([]);
    });
});

describe('summarizeSeries', () => {
    test('reports first, last, lowest, highest and the change since the first point', () => {
        const summary = summarizeSeries([
            [1, 200, 0],
            [2, 150, 0],
            [3, 300, 1],
            [4, 250, 0],
        ]);

        expect(summary).toEqual({
            first: 200,
            last: 250,
            lowest: 150,
            highest: 300,
            change: 50,
            changePercent: 25,
        });
    });

    test('is null for an empty series', () => {
        expect(summarizeSeries([])).toBeNull();
    });
});

describe('WishlistChart modal', () => {
    let chart;
    let charts;

    beforeEach(() => {
        document.body.innerHTML = '';
        charts = [];
        vi.stubGlobal(
            'Chart',
            class {
                constructor(ctx, config) {
                    this.config = config;
                    this.destroy = vi.fn();
                    charts.push(this);
                }
            }
        );
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
        chart = new WishlistChart();
    });

    afterEach(() => {
        chart.close();
        vi.unstubAllGlobals();
    });

    const now = Date.now();
    const series = [
        [now - 3 * HOUR, 1000, 0],
        [now - 2 * HOUR, 1200, 1],
        [now - HOUR, 900, 0],
    ];
    const modal = () => document.getElementById('mwi-wishlist-chart-modal');

    test('opens with the title, stats and a chart of the whole history', () => {
        chart.open({ title: 'Torch +3', series, currentPrice: 950 });

        expect(modal().querySelector('h3').textContent).toContain('"name":"Torch +3"');
        const stats = modal().querySelector('.mwi-wishlist-chart-stats').textContent;
        expect(stats).toContain('marketWishlist.trackingSince');
        expect(stats).toContain('"value":"950"'); // current
        expect(stats).toContain('"value":"900"'); // lowest
        expect(stats).toContain('"value":"1,200"'); // highest
        expect(stats).toContain('-100 (-10.0%)'); // change since the first point
        expect(charts).toHaveLength(1);
        expect(charts[0].config.data.datasets[0].data).toHaveLength(3);
    });

    test('colours estimated points differently and labels them in the tooltip', () => {
        chart.open({ title: 'Torch', series });
        const dataset = charts[0].config.data.datasets[0];

        expect(dataset.pointBackgroundColor({ raw: { estimated: false } })).not.toBe(
            dataset.pointBackgroundColor({ raw: { estimated: true } })
        );
        const label = charts[0].config.options.plugins.tooltip.callbacks.label;
        expect(label({ raw: { y: 1200, estimated: true } })).toContain('marketWishlist.estimatedPoint');
        expect(label({ raw: { y: 1200, estimated: false } })).toBe('1,200');
    });

    test('a range button redraws with only that range', () => {
        const old = [[now - 40 * 24 * HOUR, 500, 0], ...series];
        chart.open({ title: 'Torch', series: old });
        // The 40 day old point plus a break before the recent three
        expect(charts[0].config.data.datasets[0].data).toHaveLength(5);

        modal().querySelector('[data-range="24h"]').click();

        expect(charts[0].destroy).toHaveBeenCalled();
        expect(charts[1].config.data.datasets[0].data).toHaveLength(3);
    });

    test('the connect gaps toggle redraws with the line joined', () => {
        const gappy = [
            [now - 20 * HOUR, 100, 0],
            [now - HOUR, 110, 0],
        ];
        chart.open({ title: 'Torch', series: gappy });
        expect(charts[0].config.data.datasets[0].data).toHaveLength(3);

        const toggle = modal().querySelector('.mwi-wishlist-connect-gaps');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(charts[1].config.data.datasets[0].data).toHaveLength(2);
    });

    test('with no recorded history it says so instead of drawing a chart', () => {
        chart.open({ title: 'Torch', series: [] });

        expect(charts).toHaveLength(0);
        expect(modal().querySelector('.mwi-wishlist-chart-message').textContent).toBe('marketWishlist.noHistoryYet');
    });

    test('with a single point it asks for more history', () => {
        chart.open({ title: 'Torch', series: [[now - HOUR, 1000, 0]] });

        expect(charts).toHaveLength(0);
        expect(modal().querySelector('.mwi-wishlist-chart-message').textContent).toBe(
            'marketWishlist.notEnoughHistory'
        );
    });

    test('says so when the chart library is missing', () => {
        vi.unstubAllGlobals();

        chart.open({ title: 'Torch', series });

        expect(modal().querySelector('.mwi-wishlist-chart-message').textContent).toBe(
            'marketWishlist.chartUnavailable'
        );
    });

    test('closes with the button, Escape, or a click outside, and destroys the chart', async () => {
        chart.open({ title: 'Torch', series });
        modal().querySelector('button').click();
        expect(modal()).toBeNull();
        expect(charts[0].destroy).toHaveBeenCalled();

        chart.open({ title: 'Torch', series });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(modal()).toBeNull();

        chart.open({ title: 'Torch', series });
        await new Promise((resolve) => setTimeout(resolve, 0));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(modal()).toBeNull();
    });

    test('opening again replaces the modal rather than stacking', () => {
        chart.open({ title: 'A', series });
        chart.open({ title: 'B', series });

        expect(document.querySelectorAll('#mwi-wishlist-chart-modal')).toHaveLength(1);
    });
});
