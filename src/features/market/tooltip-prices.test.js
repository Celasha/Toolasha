/* @vitest-environment jsdom */

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_TOOLTIP_INFO: '#2563eb',
        COLOR_TEXT_SECONDARY: '#999',
        COLOR_WARNING: '#ffa500',
        getSetting: vi.fn(() => false),
        getSettingValue: vi.fn((key, fallback) => (key === 'formatting_useKMBFormat' ? 'full' : fallback)),
    },
}));

vi.mock('../../core/i18n.js', () => ({
    default: { getLocale: vi.fn(() => 'en') },
    t: vi.fn((key, params = {}) => {
        if (key === 'tooltipPrices.priceLine') {
            return `Price: ${params.ask} / ${params.bid}${params.total}`;
        }
        if (key === 'marketData.outlierPriceWarningTooltip') {
            return 'outlier-tooltip';
        }
        return key;
    }),
}));

vi.mock('../../core/data-manager.js', () => ({ default: {} }));
vi.mock('../../core/dom-observer.js', () => ({ default: { onClass: vi.fn(() => () => {}) } }));
vi.mock('./profit-calculator.js', () => ({ default: {} }));
vi.mock('./alchemy-profit-calculator.js', () => ({ default: {} }));
vi.mock('./expected-value-calculator.js', () => ({ default: { isInitialized: false } }));
vi.mock('../../api/marketplace.js', () => ({ default: { getPrice: vi.fn(() => null), on: vi.fn() } }));
vi.mock('../../utils/market-data.js', () => ({ getItemPrices: vi.fn() }));
vi.mock('../../utils/profit-helpers.js', () => ({
    resolveItemPrice: vi.fn(),
    calculatePriceAfterTax: vi.fn((price) => price),
}));
vi.mock('../../utils/dungeon-key-cost.js', () => ({ getKeyPrice: vi.fn(() => 0) }));
vi.mock('../../utils/material-calculator.js', () => ({ calculateArtisanBonus: vi.fn(() => 0) }));

import tooltipPrices from './tooltip-prices.js';

function buildTooltipElement() {
    const tooltipElement = document.createElement('div');
    const tooltipText = document.createElement('div');
    tooltipText.className = 'ItemTooltipText_itemTooltipText__zFq3A';
    tooltipElement.appendChild(tooltipText);
    document.body.appendChild(tooltipElement);
    return tooltipElement;
}

describe('TooltipPrices.injectPriceDisplay outlier warning icons', () => {
    test('flags only the ask side when askOutlier is true', () => {
        const tooltipElement = buildTooltipElement();
        tooltipPrices.injectPriceDisplay(
            tooltipElement,
            { ask: 1000, bid: 900, askOutlier: true, bidOutlier: false },
            1
        );

        const priceDiv = tooltipElement.querySelector('.market-price-injected');
        expect(priceDiv.innerHTML).toContain(
            '1,000 <span style="color: #ffa500;" title="outlier-tooltip">⚠</span> / 900'
        );
    });

    test('flags only the bid side when bidOutlier is true', () => {
        const tooltipElement = buildTooltipElement();
        tooltipPrices.injectPriceDisplay(
            tooltipElement,
            { ask: 1000, bid: 900, askOutlier: false, bidOutlier: true },
            1
        );

        const priceDiv = tooltipElement.querySelector('.market-price-injected');
        expect(priceDiv.innerHTML).toContain(
            '1,000 / 900 <span style="color: #ffa500;" title="outlier-tooltip">⚠</span>'
        );
    });

    test('no icon markup when neither side was flagged', () => {
        const tooltipElement = buildTooltipElement();
        tooltipPrices.injectPriceDisplay(
            tooltipElement,
            { ask: 1000, bid: 900, askOutlier: false, bidOutlier: false },
            1
        );

        const priceDiv = tooltipElement.querySelector('.market-price-injected');
        expect(priceDiv.innerHTML).not.toContain('⚠');
    });
});
