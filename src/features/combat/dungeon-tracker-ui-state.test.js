import { afterEach, expect, test, vi } from 'vitest';
import storage from '../../core/storage.js';
import state from './dungeon-tracker-ui-state.js';

vi.mock('../../core/storage.js', () => ({ default: { getJSON: vi.fn(), setJSON: vi.fn() } }));

afterEach(() => {
    state.isChartExpanded = true;
    vi.resetAllMocks();
});

test('saves and reloads a collapsed chart', async () => {
    state.isChartExpanded = false;
    await state.save();
    expect(storage.setJSON).toHaveBeenCalledWith(
        'dungeonTracker_uiState',
        expect.objectContaining({ isChartExpanded: false }),
        'settings',
        true
    );

    storage.getJSON.mockResolvedValue(storage.setJSON.mock.calls[0][1]);
    state.isChartExpanded = true;
    await state.load();
    expect(state.isChartExpanded).toBe(false);
});

test('older settings without the chart flag default to expanded', async () => {
    state.isChartExpanded = false;
    storage.getJSON.mockResolvedValue({ isCollapsed: false });
    await state.load();
    expect(state.isChartExpanded).toBe(true);
});
