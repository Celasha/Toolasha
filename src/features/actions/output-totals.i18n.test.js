/**
 * Chinese-locale regression tests for output-totals essence detection.
 *
 * BUG #21: the essence-drop detection used a hardcoded English literal
 * ("essence"), which breaks under a Chinese client where item/drop-table
 * text is localized. The fix detects essences by item HRID (via each drop's
 * icon sprite href), which is locale-independent — item display text never
 * needs to be read or translated at all.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi } from 'vitest';

const itemDetailMap = {
    '/items/abyssal_essence': { hrid: '/items/abyssal_essence', categoryHrid: '/item_categories/resource' },
    '/items/flax': { hrid: '/items/flax', categoryHrid: '/item_categories/resource' },
};

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ itemDetailMap })),
        getItemDetails: vi.fn((hrid) => itemDetailMap[hrid] || null),
    },
}));

const { containerHasEssenceItem } = await import('./output-totals.js');

function containerWithIcon(iconFragment) {
    const container = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/static/media/items_sprite.abc123.svg#${iconFragment}`);
    svg.appendChild(use);
    container.appendChild(svg);
    return container;
}

describe('containerHasEssenceItem (BUG #21)', () => {
    test('detects an essence item by icon HRID, regardless of displayed (localized) text', () => {
        const container = containerWithIcon('abyssal_essence');
        // Simulate a Chinese client: the rendered item name is Chinese, not "Essence".
        container.querySelector('svg').insertAdjacentHTML('afterend', '<span>深渊精华</span>');
        expect(containerHasEssenceItem(container)).toBe(true);
    });

    test('returns false for a non-essence resource item', () => {
        const container = containerWithIcon('flax');
        expect(containerHasEssenceItem(container)).toBe(false);
    });

    test('returns false when the icon href does not resolve to a known item', () => {
        const container = containerWithIcon('unknown_item');
        expect(containerHasEssenceItem(container)).toBe(false);
    });

    test('returns false for a container with no icons', () => {
        expect(containerHasEssenceItem(document.createElement('div'))).toBe(false);
    });

    test('returns false for null/undefined input', () => {
        expect(containerHasEssenceItem(null)).toBe(false);
        expect(containerHasEssenceItem(undefined)).toBe(false);
    });
});
