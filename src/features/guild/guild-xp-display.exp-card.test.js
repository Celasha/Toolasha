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
 * (the one Toolasha expands/appends into) plus native row-1 siblings, using the same class
 * names `_renderOverview()` selects on. The Exp block is a direct child of the grid, matching
 * the simplest possible native nesting.
 * @returns {{dataGridEl: HTMLElement, expBlock: HTMLElement, siblingBlock: HTMLElement, membersBlock: HTMLElement}}
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
    const membersBlock = makeBlock('Guild Members');
    dataGridEl.appendChild(siblingBlock);
    dataGridEl.appendChild(expBlock);
    dataGridEl.appendChild(membersBlock);
    return { dataGridEl, expBlock, siblingBlock, membersBlock };
}

/**
 * Build a fixture where the native "Exp to Level Up" block is wrapped in an intermediate
 * group element before reaching the grid container - representing native markup that groups
 * data blocks (e.g. `.GuildPanel_dataBlockGroup__1d2rR`) rather than placing them directly as
 * grid children. Proves the two-row span is applied to the actual grid item (the wrapper),
 * not to an arbitrary/wrong ancestor.
 * @returns {{dataGridEl: HTMLElement, expBlock: HTMLElement, groupEl: HTMLElement}}
 */
function buildWrappedDataGridFixture() {
    const dataGridEl = document.createElement('div');
    dataGridEl.className = 'GuildPanel_dataGrid';

    const groupEl = document.createElement('div');
    groupEl.className = 'GuildPanel_dataBlockGroup__1d2rR';

    const expBlock = document.createElement('div');
    expBlock.className = 'GuildPanel_dataBlock__3qVhK';
    const label = document.createElement('div');
    label.className = 'GuildPanel_label__-A63g';
    label.textContent = 'Exp to Level Up';
    expBlock.appendChild(label);

    groupEl.appendChild(expBlock);
    dataGridEl.appendChild(groupEl);
    return { dataGridEl, expBlock, groupEl };
}

describe('GuildXPDisplay - Next Guild Level Slot card layout', () => {
    let display;

    beforeEach(() => {
        vi.clearAllMocks();
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

    test('the Exp card spans two grid rows instead of growing row 1 via height:auto', () => {
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

        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(true);
        // The old row-expansion contract (height:auto participating in row-1 track sizing)
        // must not reappear.
        expect(expBlock.style.height).not.toBe('auto');
        expect(expBlock.style.height).toBe('100%');

        // In this fixture the block is a direct grid child, so it is also the grid item that
        // must carry the two-row span.
        expect(expBlock.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(true);
        expect(expBlock.style.gridRow).toBe('span 2');
    });

    test('only the Exp card/grid item receives layout treatment - siblings keep normal geometry', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, siblingBlock, membersBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        for (const el of [siblingBlock, membersBlock]) {
            expect(el.classList.contains('mwi-guild-xp__exp-card')).toBe(false);
            expect(el.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(false);
            expect(el.style.height).toBe('');
            expect(el.style.gridRow).toBe('');
        }
    });

    test('the two-row span is applied to the actual grid item, not an arbitrary ancestor', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock, groupEl } = buildWrappedDataGridFixture();
        display._renderOverview(dataGridEl);

        // The span belongs on the group (the direct child of the grid container)...
        expect(groupEl.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(true);
        expect(groupEl.style.gridRow).toBe('span 2');
        // ...while the inner card fills the spanned area's height without spanning itself.
        expect(expBlock.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(false);
        expect(expBlock.style.height).toBe('100%');
    });

    test('the Toolasha Last hour/Last day XP/h group keeps normal (unset) row placement', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue(null);

        const { dataGridEl } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        const statsGroup = dataGridEl.querySelector('.GuildPanel_dataBlockGroup__1d2rR.mwi-guild-xp');
        expect(statsGroup).not.toBeNull();
        expect(statsGroup.style.gridRow).toBe('');
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
        expect(Array.from(expBlock.classList).filter((c) => c === 'mwi-guild-xp__exp-grid-item').length).toBe(1);
        expect(expBlock.style.gridRow).toBe('span 2');
        expect(expBlock.style.height).toBe('100%');
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
        expect(expBlock.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(true);

        display.disable();

        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(false);
        expect(expBlock.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(false);
        expect(expBlock.style.height).toBe('');
        expect(expBlock.style.gridRow).toBe('');
        expect(expBlock.querySelector('.mwi-guild-xp')).toBeNull();

        document.body.removeChild(dataGridEl);
    });

    test('cleanup restores the wrapper grid item separately from the inner card', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });

        const { dataGridEl, expBlock, groupEl } = buildWrappedDataGridFixture();
        document.body.appendChild(dataGridEl);
        display._renderOverview(dataGridEl);

        display.disable();

        expect(groupEl.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(false);
        expect(groupEl.style.gridRow).toBe('');
        expect(expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(false);
        expect(expBlock.style.height).toBe('');

        document.body.removeChild(dataGridEl);
    });

    test('a remounted (fresh) card is set up again rather than leaking stale styling', () => {
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
        expect(first.expBlock.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(true);

        // Simulate leaving/remounting Guild: a brand-new native card element, no marker class yet.
        const second = buildDataGridFixture();
        display._renderOverview(second.dataGridEl);

        expect(second.expBlock.classList.contains('mwi-guild-xp__exp-card')).toBe(true);
        expect(second.expBlock.classList.contains('mwi-guild-xp__exp-grid-item')).toBe(true);
        expect(second.expBlock.style.gridRow).toBe('span 2');
    });

    test('does not change Guild slot/XP/ETA math - only layout style changed', () => {
        guildXPTracker.getNextMemberSlotETA.mockReturnValue({
            targetLevel: 114,
            xpRemaining: 5679629,
            status: 'ok',
            etaMs: 7 * 86400000 + 86400000,
            rateBasis: '24h',
            rateValue: 26602,
        });
        guildXPTracker.getTimeToLevel.mockReturnValue(3600000);

        const { dataGridEl, expBlock } = buildDataGridFixture();
        display._renderOverview(dataGridEl);

        expect(guildXPTracker.getNextMemberSlotETA).toHaveBeenCalledWith('My Guild');
        expect(guildXPTracker.getTimeToLevel).toHaveBeenCalledWith('My Guild');
        expect(expBlock.textContent).toContain('To Lv 114 · 5,679,629 XP');
        expect(expBlock.textContent).toContain('ETA: 1 week 1 day');
    });
});
