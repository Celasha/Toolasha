// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((_key, def) => def),
        getSettingValue: vi.fn((_key, def) => def),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: { getCurrentCharacterName: vi.fn(() => null) },
}));

vi.mock('./guild-xp-tracker.js', () => ({
    guildXPTracker: {
        getOwnGuildName: vi.fn(() => 'My Guild'),
        getGuildStats: vi.fn(() => ({ lastHourXPH: 0, lastXPH: 0, lastDayXPH: 0, chart: [] })),
        getMemberList: vi.fn(() => []),
        lastMembersUpdateTime: null,
        getTimeToLevel: vi.fn(() => null),
        getNextMemberSlotETA: vi.fn(() => null),
    },
}));

import { guildXPTracker } from './guild-xp-tracker.js';
import { GuildXPDisplay } from './guild-xp-display.js';

/**
 * Build a fixture matching the native Guild Overview data grid: an "Exp to Level Up" block
 * (the one Toolasha expands/appends into) and one unrelated sibling block, using the same
 * class names `_renderOverview()` selects on.
 * @returns {{dataGridEl: HTMLElement, expBlock: HTMLElement, siblingBlock: HTMLElement}}
 */
function buildDataGridFixture() {
    const dataGridEl = document.createElement('div');
    dataGridEl.className = 'GuildPanel_dataGrid';

    const makeBlock = (labelText) => {
        const block = document.createElement('div');
        block.className = 'GuildPanel_dataBlock__3qVhK';
        const label = document.createElement('div');
        label.className = 'GuildPanel_label__-A63g';
        label.textContent = labelText;
        block.appendChild(label);
        const value = document.createElement('div');
        value.className = 'GuildPanel_value__Hm2I9';
        value.textContent = '1,234';
        block.appendChild(value);
        return block;
    };

    const expBlock = makeBlock('Exp to Level Up');
    const siblingBlock = makeBlock('Guild Level');
    dataGridEl.appendChild(expBlock);
    dataGridEl.appendChild(siblingBlock);
    return { dataGridEl, expBlock, siblingBlock };
}

describe('GuildXPDisplay - Next Guild Level Slot card layout', () => {
    let display;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ height: '64px' });
        display = new GuildXPDisplay();
        guildXPTracker.getOwnGuildName.mockReturnValue('My Guild');
        guildXPTracker.getGuildStats.mockReturnValue({ lastHourXPH: 0, lastXPH: 0, lastDayXPH: 0, chart: [] });
        guildXPTracker.getMemberList.mockReturnValue([]);
        guildXPTracker.getTimeToLevel.mockReturnValue(null);
    });

    test('renders the compact three-line slot block and never the old "XP remaining" phrasing', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 7 * 86400000 + 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        const slotBlock = expBlock.querySelector(`.mwi-guild-xp`);
        expect(slotBlock).not.toBeNull();
        expect(slotBlock.textContent).not.toContain('XP remaining');

        const lines = Array.from(slotBlock.children).map((el) => el.textContent);
        expect(lines).toEqual(['Next Guild Level Slot (+1)', 'To Lv 114 · 5,679,629 XP', 'ETA: 1 week 1 day']);
    });

    test('preserves the existing ETA tooltip/rate basis for the ok state', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 3600000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        const slotBlock = expBlock.querySelector(`.mwi-guild-xp[title]`);
        expect(slotBlock.title).toBe('ETA based on 24h average: 26,602 XP/h');
    });

    test('renders "collecting data" when the tracker reports insufficient sample', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'collecting-data',
        });

        const { dataGridEl, expBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        expect(expBlock.textContent).toContain('ETA: collecting data');
    });

    test('renders "no recent gains" when the tracker reports a zero recent rate', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'zero-rate',
            rateBasis: '24h',
        });

        const { dataGridEl, expBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        expect(expBlock.textContent).toContain('ETA: no recent gains');
    });

    test('only the native "Exp to Level Up" card receives the expansion marker/style', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock, siblingBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(true);
        expect(expBlock.style.height).toBe('auto');
        expect(expBlock.style.minHeight).toBe('64px');

        expect(siblingBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(false);
        expect(siblingBlock.style.height).toBe('');
        expect(siblingBlock.style.minHeight).toBe('');
    });

    test('rerender is idempotent - no duplicate slot content and no style/class accumulation', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);
        display._renderOverview(dataGridEl);
        display._renderOverview(dataGridEl);

        expect(expBlock.querySelectorAll('.mwi-guild-xp').length).toBe(1);
        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(true);
        // getComputedStyle is only consulted the first time the block is marked, never re-measured.
        expect(window.getComputedStyle).toHaveBeenCalledTimes(1);
    });

    test('cleanup removes injected content and restores the native card class/style', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock } = buildDataGridFixture();
        document.body.appendChild(dataGridEl);
        display._renderOverview(dataGridEl);
        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(true);

        display.disable();

        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(false);
        expect(expBlock.style.height).toBe('');
        expect(expBlock.style.minHeight).toBe('');
        expect(expBlock.querySelector('.mwi-guild-xp')).toBeNull();

        document.body.removeChild(dataGridEl);
    });

    test('a remounted (fresh) card is measured again rather than leaking stale styling', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const first = buildDataGridFixture();
        display._renderOverview(first.dataGridEl);
        expect(window.getComputedStyle).toHaveBeenCalledTimes(1);

        // Simulate leaving/remounting Guild: a brand-new native card element, no marker class yet.
        const second = buildDataGridFixture();
        display._renderOverview(second.dataGridEl);

        expect(window.getComputedStyle).toHaveBeenCalledTimes(2);
        expect(second.expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(true);
    });
});
