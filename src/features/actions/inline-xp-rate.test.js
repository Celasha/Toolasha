// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { COLOR_XP_RATE: '#ffffff' },
}));

import { findNativeExperienceRow, removeInlineXpRate, renderInlineXpRate } from './inline-xp-rate.js';

function makePanel({ rowCount = 1 } = {}) {
    const panel = document.createElement('div');
    panel.className = 'SkillActionDetail_skillActionDetail__test';
    for (let i = 0; i < rowCount; i += 1) {
        const row = document.createElement('div');
        row.className = `SkillActionDetail_expOnSuccess__test_${i}`;
        row.innerHTML = '<span>32 505</span><svg aria-label="XP"></svg>';
        panel.appendChild(row);
    }
    document.body.appendChild(panel);
    return panel;
}

describe('inline-xp-rate', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('finds only one unambiguous native Experience row', () => {
        expect(findNativeExperienceRow(makePanel())).not.toBeNull();
        expect(findNativeExperienceRow(makePanel({ rowCount: 2 }))).toBeNull();
    });

    test('renders compact K/M output and exposes the full value in title and aria-label', () => {
        const panel = makePanel();
        const rate = renderInlineXpRate(panel, 49332, { owner: 'alchemy' });

        expect(rate.textContent).toBe('· 49.3K XP/hr');
        expect(rate.title).toBe(`${new Intl.NumberFormat().format(49332)} XP/hr`);
        expect(rate.getAttribute('aria-label')).toBe(rate.title);
    });

    test('marks Enhancing as expected while retaining a full exact tooltip value', () => {
        const panel = makePanel();
        const rate = renderInlineXpRate(panel, 1250000, { approximate: true, owner: 'enhancing' });

        expect(rate.textContent).toBe('· ~1.25M XP/hr');
        expect(rate.title).toBe(`Expected: ${new Intl.NumberFormat().format(1250000)} XP/hr`);
    });

    test('updates one existing node rather than duplicating it', () => {
        const panel = makePanel();
        const first = renderInlineXpRate(panel, 1000, { owner: 'alchemy' });
        const second = renderInlineXpRate(panel, 2000, { owner: 'alchemy' });

        expect(second).toBe(first);
        expect(second.textContent).toBe('· 2.00K XP/hr');
        expect(panel.querySelectorAll('[data-mwi-inline-xp-rate]')).toHaveLength(1);
    });

    test('moves the rate to a replacement native row after a React rerender', () => {
        const panel = makePanel();
        const oldRow = findNativeExperienceRow(panel);
        renderInlineXpRate(panel, 1000, { owner: 'enhancing', approximate: true });

        const replacement = document.createElement('div');
        replacement.className = 'SkillActionDetail_expOnSuccess__replacement';
        replacement.textContent = '18 946';
        oldRow.replaceWith(replacement);

        const rate = renderInlineXpRate(panel, 2000, { owner: 'enhancing', approximate: true });

        expect(rate.parentElement).toBe(replacement);
        expect(panel.querySelectorAll('[data-mwi-inline-xp-rate]')).toHaveLength(1);
    });

    test('removes stale output when the rate becomes unavailable', () => {
        const panel = makePanel();
        renderInlineXpRate(panel, 1000, { owner: 'alchemy' });

        expect(renderInlineXpRate(panel, 0, { owner: 'alchemy' })).toBeNull();
        expect(panel.querySelector('[data-mwi-inline-xp-rate]')).toBeNull();
    });

    test('removes only the requested feature owner', () => {
        const panel = makePanel();
        renderInlineXpRate(panel, 1000, { owner: 'alchemy' });
        const enhancing = document.createElement('span');
        enhancing.setAttribute('data-mwi-inline-xp-rate', 'true');
        enhancing.setAttribute('data-mwi-inline-xp-owner', 'enhancing');
        panel.appendChild(enhancing);

        removeInlineXpRate(panel, 'alchemy');

        expect(panel.querySelector('[data-mwi-inline-xp-owner="alchemy"]')).toBeNull();
        expect(panel.querySelector('[data-mwi-inline-xp-owner="enhancing"]')).toBe(enhancing);
    });
});
