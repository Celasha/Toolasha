/* @vitest-environment jsdom */

import Chart from 'chart.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import i18n from '../../core/i18n.js';
import DungeonTrackerUIChart from './dungeon-tracker-ui-chart.js';
import trackerStorage from './dungeon-tracker-storage.js';

vi.mock('./dungeon-tracker-storage.js', () => ({ default: { getAllRuns: vi.fn() } }));

const run = (index, fields) => ({ timestamp: index, duration: index * 60_000, ...fields });
let trackerChart;
let container;
let canvas;
let createChart;

beforeEach(() => {
    trackerChart = new DungeonTrackerUIChart({ filterDungeon: 'all', filterTeam: 'all' });
    container = document.createElement('div');
    container.innerHTML = '<canvas id="mwi-dt-chart-canvas" width="720" height="300"></canvas>';
    document.body.appendChild(container);
    canvas = container.firstElementChild;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    createChart = vi.fn(function (_ctx, config) {
        this.config = config;
        this.destroy = vi.fn();
    });
    vi.stubGlobal('Chart', createChart);
});

afterEach(() => {
    trackerChart.cleanup();
    container.remove();
    window.localStorage.removeItem('i18nextLng');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

test.each([
    ['en', ['Run 1', 'Run 2', 'Run 3']],
    ['zh', ['第 1 次', '第 2 次', '第 3 次']],
])('preserves %s run labels in both charts with one translation lookup per chart', async (locale, labels) => {
    window.localStorage.setItem('i18nextLng', locale);
    const translate = vi.spyOn(i18n, 't');
    const runs = [run(3), run(1), run(2)];
    trackerStorage.getAllRuns.mockResolvedValue(runs);
    const labelLookups = () => translate.mock.calls.filter(([key]) => key === 'dungeonTrackerUi.chartRunLabel');

    await trackerChart.render(container);
    expect(trackerChart.chartInstance.config.data.labels).toEqual(labels);
    expect(trackerChart.chartInstance.config.data.datasets[0].data).toEqual([1, 2, 3]);
    expect(trackerChart.chartInstance.config.data.datasets[0].pointRadius).toBe(3);
    expect(labelLookups()).toHaveLength(1);

    trackerChart.createPopoutModal();
    await Promise.resolve();
    expect(trackerChart.modalChartInstance.config.data.labels).toEqual([...labels].reverse());
    expect(trackerChart.modalChartInstance.config.data.datasets[0].data).toEqual([1, 2, 3]);
    expect(labelLookups()).toHaveLength(2);
    expect(runs.map(({ timestamp }) => timestamp)).toEqual([3, 1, 2]);
});

test('keeps chart filters and excludes failed, canceled, and unvalidated hibernated runs', async () => {
    trackerChart.state = { filterDungeon: 'Cave', filterTeam: 'Alice' };
    const fields = { dungeonName: 'Cave', teamKey: 'Alice' };
    trackerStorage.getAllRuns.mockResolvedValue([
        run(3, { ...fields, hibernationDetected: true, validated: true }),
        run(1, fields),
        run(2, { ...fields, duration: undefined, totalTime: 120_000 }),
        run(4, { ...fields, result: 'fail' }),
        run(5, { ...fields, result: 'cancel' }),
        run(6, { ...fields, hibernationDetected: true }),
        run(7, { ...fields, dungeonName: 'Tower' }),
        run(8, { ...fields, teamKey: 'Bob' }),
    ]);

    await trackerChart.render(container);
    const { datasets } = trackerChart.chartInstance.config.data;
    expect(datasets.map((dataset) => dataset.data)).toEqual([
        [1, 2, 3],
        [2, 2, 2],
        [1, 1, 1],
        [3, 3, 3],
    ]);

    trackerChart.state.filterTeam = 'Neither';
    const { destroy } = trackerChart.chartInstance;
    await trackerChart.render(container);
    expect(destroy).toHaveBeenCalledOnce();
    expect(trackerChart.chartInstance).toBeNull();
});

test('parses each timestamp only once even when sorting an unordered history', async () => {
    const timestamps = Array.from({ length: 4096 }, (_, i) => new Date(i * 1000).toISOString());
    const runs = timestamps.map((_, i) => {
        const index = (i * 71) % timestamps.length;
        return run(index, { timestamp: timestamps[index] });
    });
    const parse = vi.spyOn(Date, 'parse');
    trackerStorage.getAllRuns.mockResolvedValue(runs);
    await trackerChart.render(container);
    expect(parse).toHaveBeenCalledTimes(runs.length);
    expect(trackerChart.chartInstance.config.data.datasets[0].data).toEqual(timestamps.map((_, i) => i));
});

test('calculates extrema without spreading a large array and uses the lightweight config', async () => {
    const count = 150_000;
    trackerStorage.getAllRuns.mockResolvedValue(Array.from({ length: count }, (_, i) => run(count - i)));
    await trackerChart.render(container);
    const { data, options } = trackerChart.chartInstance.config;
    const [durations, avg, fastest, slowest] = data.datasets;
    expect(durations.data).toHaveLength(count);
    expect([durations.data[0], durations.data[count - 1]]).toEqual([1, count]);
    expect([avg.data[count - 1], fastest.data[count - 1], slowest.data[count - 1]]).toEqual([
        (count + 1) / 2,
        1,
        count,
    ]);
    expect(durations).toMatchObject({ pointRadius: 0, tension: 0 });
    expect(options.animation).toBe(false);
    expect(options.scales.x.ticks).toMatchObject({ autoSkip: true, maxTicksLimit: 12, sampleSize: 12 });
});

test('Chart.js 3.7 keeps reference lines in index tooltips and the legend can toggle them', async () => {
    // Use Chart.js itself for layout and hit testing; only stub the canvas drawing calls.
    const ctx = new Proxy(
        { canvas, measureText: (label) => ({ width: String(label).length * 7 }) },
        {
            get: (target, key) => target[key] ?? (() => {}),
        }
    );
    canvas.getContext.mockReturnValue(ctx);
    vi.stubGlobal(
        'Chart',
        class extends Chart {
            constructor(context, config) {
                super(context.canvas, { ...config, platform: Chart.BasicPlatform });
            }
        }
    );
    trackerStorage.getAllRuns.mockResolvedValue(Array.from({ length: 5000 }, (_, i) => run(i + 1)));
    await trackerChart.render(container);
    const chart = trackerChart.chartInstance;
    expect(chart.scales.x.ticks.length).toBeLessThanOrEqual(12);
    expect(chart.data.labels).toHaveLength(5000);

    const index = 2678;
    const itemsAtRun = () => {
        const { x } = chart.getDatasetMeta(0).data[index];
        return chart.getElementsAtEventForMode(
            { native: true, x, y: (chart.chartArea.top + chart.chartArea.bottom) / 2 },
            'index',
            { intersect: false },
            false
        );
    };
    expect(itemsAtRun().map((item) => [item.datasetIndex, item.index])).toEqual([
        [0, index],
        [1, index],
        [2, index],
        [3, index],
    ]);
    const averageLegendItem = chart.legend.legendItems.find((item) => item.datasetIndex === 1);
    chart.legend.options.onClick({}, averageLegendItem, chart.legend);
    expect(chart.isDatasetVisible(1)).toBe(false);
    expect(itemsAtRun().map((item) => item.datasetIndex)).toEqual([0, 2, 3]);
    chart.legend.options.onClick({}, averageLegendItem, chart.legend);
    expect(chart.isDatasetVisible(1)).toBe(true);
});

test('closing the pop-out during its storage read does not construct a chart on the detached canvas', async () => {
    let resolveRuns;
    trackerStorage.getAllRuns.mockReturnValueOnce(new Promise((resolve) => (resolveRuns = resolve)));
    trackerChart.createPopoutModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('mwi-dt-chart-modal')).toBeNull();
    resolveRuns([run(1)]);
    await Promise.resolve();
    expect(createChart).not.toHaveBeenCalled();
});
