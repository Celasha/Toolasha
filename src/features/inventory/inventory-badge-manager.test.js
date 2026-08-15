/* @vitest-environment jsdom */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: vi.fn(() => true), getSettingValue: vi.fn() } }));
vi.mock('../../api/marketplace.js', () => ({ default: { getPricesBatch: vi.fn(() => ({})), getPrice: vi.fn() } }));
vi.mock('../../core/data-manager.js', () => ({
    default: { getInitClientData: vi.fn(() => ({})), getInventory: vi.fn(() => []) },
}));
vi.mock('../enhancement/tooltip-enhancement.js', () => ({ calculateEnhancementPath: vi.fn() }));
vi.mock('../../utils/enhancement-config.js', () => ({ getEnhancingParams: vi.fn(() => ({})) }));
vi.mock('../networth/networth-cache.js', () => ({ default: {} }));
vi.mock('../market/expected-value-calculator.js', () => ({ default: { getDropPrice: vi.fn() } }));
vi.mock('../../utils/market-data.js', () => ({ getItemPrice: vi.fn() }));
vi.mock('../../utils/number-parser.js', () => ({ parseItemCount: vi.fn() }));
vi.mock('../combat-stats/combat-stats-calculator.js', () => ({ DUNGEON_CHEST_CHEST_KEYS: {} }));
vi.mock('../../utils/dom-observer-helpers.js', () => ({ createMutationWatcher: vi.fn() }));

const { default: inventoryBadgeManager } = await import('./inventory-badge-manager.js');

function buildItemContainer({ ariaLabel, href }) {
    const container = document.createElement('div');
    container.innerHTML = `<svg aria-label="${ariaLabel}">${href ? `<use href="${href}"></use>` : ''}</svg>`;
    return container;
}

describe('InventoryBadgeManager.getItemHridFromContainer', () => {
    test('resolves the HRID from the sprite href, ignoring the translated aria-label', () => {
        // Regression coverage for a locale bug: a French client renders aria-label="Bûche de
        // Séquoia" for the same item whose sprite href is always the stable, untranslated HRID.
        // The old implementation matched on aria-label text against an English name map and
        // failed for every item on any non-English locale.
        const container = buildItemContainer({ ariaLabel: 'Bûche de Séquoia', href: '#redwood_log' });

        expect(inventoryBadgeManager.getItemHridFromContainer(container)).toBe('/items/redwood_log');
    });

    test('resolves correctly regardless of the aria-label language', () => {
        const container = buildItemContainer({ ariaLabel: 'Redwood Log', href: '#redwood_log' });

        expect(inventoryBadgeManager.getItemHridFromContainer(container)).toBe('/items/redwood_log');
    });

    test('returns null when the container has no <use> sprite element', () => {
        const container = buildItemContainer({ ariaLabel: 'Redwood Log', href: null });

        expect(inventoryBadgeManager.getItemHridFromContainer(container)).toBeNull();
    });

    test('returns null when the href has no fragment to extract', () => {
        const container = document.createElement('div');
        container.innerHTML = '<svg><use href="sprite.svg"></use></svg>';

        expect(inventoryBadgeManager.getItemHridFromContainer(container)).toBeNull();
    });
});
