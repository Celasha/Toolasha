/* @vitest-environment jsdom */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import storage from '../../core/storage.js';
import tracker from './dungeon-tracker.js';
import trackerStorage from './dungeon-tracker-storage.js';
import DungeonTrackerUIChart from './dungeon-tracker-ui-chart.js';
import ui from './dungeon-tracker-ui.js';

vi.mock('../../core/storage.js', () => ({ default: { getJSON: vi.fn(), setJSON: vi.fn() } }));
vi.mock('../../core/config.js', () => ({ default: { isFeatureEnabled: () => true, getSettingValue: () => null } }));
vi.mock('../../core/data-manager.js', () => ({ default: { characterData: { character: { name: 'Alice' } } } }));
vi.mock('../../utils/game-i18n.js', () => ({ getActionName: (_id, name) => name }));
vi.mock('./dungeon-tracker.js', () => ({
    default: { getCurrentRun: vi.fn(), onUpdate: vi.fn(), offUpdate: vi.fn(), hibernationDetected: false },
}));
vi.mock('./dungeon-tracker-chat-annotations.js', () => ({ default: { annotateAllMessages: vi.fn() } }));
vi.mock('./dungeon-tracker-storage.js', () => ({
    default: {
        getAllRuns: vi.fn(),
        getTeamKey: (team) => team.join('|'),
        deleteRunByTimestamp: vi.fn(),
    },
}));

const select = (id) => ui.container.querySelector(`#mwi-dt-${id}`);
const flush = () => vi.advanceTimersByTimeAsync(0);
const updateFromTracker = (run, completedRun) => {
    tracker.getCurrentRun.mockReturnValue(run);
    tracker.onUpdate.mock.lastCall[0](run, completedRun);
};

const caveRun = { timestamp: '2025-01-01T00:00:00.000Z', duration: 60_000, dungeonName: 'Cave', teamKey: 'Alice' };
const towerRun = { ...caveRun, timestamp: '2025-01-02T00:00:00.000Z', duration: 120_000, dungeonName: 'Tower' };
let render;
let createChart;
let destroyChart;

beforeEach(() => {
    vi.useFakeTimers();
    storage.getJSON.mockResolvedValue({});
    trackerStorage.getAllRuns.mockResolvedValue([towerRun, caveRun]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    render = vi.spyOn(DungeonTrackerUIChart.prototype, 'render');
    destroyChart = vi.fn();
    createChart = vi.fn(function () {
        this.destroy = destroyChart;
    });
    vi.stubGlobal('Chart', createChart);
});

afterEach(() => {
    ui.cleanup();
    tracker.hibernationDetected = false;
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

test('startup does no chart work until the uncollapsed panel is shown', async () => {
    await ui.initialize();
    await vi.advanceTimersByTimeAsync(1500);
    expect(ui.container.style.display).toBe('none');
    expect(render).not.toHaveBeenCalled();
    expect(trackerStorage.getAllRuns).not.toHaveBeenCalled();

    ui.show();
    expect(render).toHaveBeenCalledOnce();
    await flush();
    expect(createChart).toHaveBeenCalledOnce();

    ui.hide();
    ui.show();
    expect(render).toHaveBeenCalledOnce();
    ui.cleanup();
    expect(destroyChart).toHaveBeenCalledOnce();
});

test('a collapsed panel waits for expansion even when shown', async () => {
    storage.getJSON.mockResolvedValue({ isCollapsed: true });
    await ui.initialize();
    select('collapse-btn').click();
    expect(ui.container.style.display).toBe('none');
    expect(render).not.toHaveBeenCalled();

    select('collapse-btn').click();
    ui.show();
    expect(select('content').style.display).toBe('none');
    expect(render).not.toHaveBeenCalled();

    select('collapse-btn').click();
    expect(render).toHaveBeenCalledOnce();
    await flush();
});

test('saved chart collapse is applied and visible chart expansion renders without a timeout', async () => {
    storage.getJSON.mockResolvedValue({ isChartExpanded: false });
    await ui.initialize();
    ui.show();
    expect(select('chart-container').style.display).toBe('none');
    expect(render).not.toHaveBeenCalled();

    select('chart-header').click();
    expect(select('chart-container').style.display).toBe('block');
    expect(render).toHaveBeenCalledOnce();
    await flush();

    select('chart-header').click();
    expect(select('chart-container').style.display).toBe('none');
    expect(render).toHaveBeenCalledOnce();
});

test('a visible filter or grouping change refreshes the chart, and a hidden change waits for show', async () => {
    await ui.initialize();
    ui.show();
    await ui.updateRunHistory();
    await flush();
    const dungeonSelect = select('filter-dungeon');
    dungeonSelect.value = 'Cave';
    dungeonSelect.dispatchEvent(new Event('change'));
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(createChart.mock.lastCall[1].data.datasets[0].data).toEqual([1]);

    select('group-by').value = 'dungeon';
    select('group-by').dispatchEvent(new Event('change'));
    await flush();
    expect(render).toHaveBeenCalledTimes(3);

    ui.hide();
    dungeonSelect.value = 'Tower';
    dungeonSelect.dispatchEvent(new Event('change'));
    await flush();
    expect(render).toHaveBeenCalledTimes(3);

    ui.show();
    await flush();
    expect(render).toHaveBeenCalledTimes(4);
    expect(createChart.mock.lastCall[1].data.datasets[0].data).toEqual([2]);
});

test('a pending render skips Chart.js if the panel is hidden before the read finishes', async () => {
    let resolveRuns;
    trackerStorage.getAllRuns.mockReturnValueOnce(new Promise((resolve) => (resolveRuns = resolve)));
    await ui.initialize();
    ui.show();
    ui.hide();
    resolveRuns([caveRun]);
    await flush();
    expect(createChart).not.toHaveBeenCalled();

    ui.show();
    await flush();
    expect(createChart).toHaveBeenCalledOnce();
});

test('timer ticks update progress and hibernation without rereading or rebuilding run history', async () => {
    await ui.initialize();
    const run = {
        dungeonName: 'Cave',
        tier: 0,
        currentWave: 1,
        maxWaves: 10,
        totalElapsed: 1000,
        keyCountsMap: { Alice: 2 },
    };
    const history = vi.spyOn(ui.history, 'update');
    updateFromTracker(run);
    await flush();
    expect(select('header-runs').textContent).toBe('2');
    expect(select('header-last').textContent).toBe('02:00');
    expect(select('header-keys').textContent).toBe('2');
    expect(select('self-keys').textContent).toBe('2');
    expect(history).toHaveBeenCalledOnce();
    const reads = trackerStorage.getAllRuns.mock.calls.length;

    tracker.hibernationDetected = true;
    tracker.getCurrentRun.mockReturnValue({ ...run, totalElapsed: 5000, currentWave: 3 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(select('current-time').textContent).toBe('00:05');
    expect(select('wave-counter').textContent).toContain('3');
    expect(select('progress-bar').style.width).toBe('30%');
    expect(select('time-label').textContent.trim()).toBe('Chat:');
    expect(history).toHaveBeenCalledOnce();
    expect(trackerStorage.getAllRuns).toHaveBeenCalledTimes(reads);

    updateFromTracker({ ...run, keyCountsMap: { Alice: 1 } });
    await flush();
    expect(select('header-keys').textContent).toBe('1');
    expect(select('self-keys').textContent).toBe('1');
    expect(trackerStorage.getAllRuns).toHaveBeenCalledTimes(reads + 1);

    updateFromTracker(null, { dungeonName: 'Cave' });
    expect(ui.container.style.display).toBe('none');
    expect(render).toHaveBeenCalledOnce();
    updateFromTracker(run);
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
});

test('deleting a run refreshes both stats and the visible chart', async () => {
    await ui.initialize();
    updateFromTracker({ dungeonName: 'Cave', tier: 0 });
    await flush();
    trackerStorage.deleteRunByTimestamp.mockImplementation(async () => {
        trackerStorage.getAllRuns.mockResolvedValue([caveRun]);
    });

    ui.container.querySelector('.mwi-dt-delete-run').click();
    await flush();
    expect(trackerStorage.deleteRunByTimestamp).toHaveBeenCalledWith(towerRun.timestamp);
    expect(select('header-runs').textContent).toBe('1');
    expect(createChart.mock.lastCall[1].data.datasets[0].data).toEqual([1]);
});
