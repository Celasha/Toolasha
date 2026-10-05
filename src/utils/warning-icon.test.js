import { describe, expect, test, vi } from 'vitest';

vi.mock('../core/config.js', () => ({
    default: { COLOR_WARNING: '#ffa500' },
}));

vi.mock('../core/i18n.js', () => ({
    t: vi.fn((key) => `translated:${key}`),
}));

import { buildWarningIcon, buildOutlierPriceWarningIcon } from './warning-icon.js';

describe('buildWarningIcon', () => {
    test('builds a span with the warning color and the given tooltip text', () => {
        expect(buildWarningIcon('some tooltip')).toBe('<span style="color: #ffa500;" title="some tooltip">⚠</span>');
    });
});

describe('buildOutlierPriceWarningIcon', () => {
    test('returns empty string when not an outlier', () => {
        expect(buildOutlierPriceWarningIcon(false)).toBe('');
    });

    test('returns a leading-space-prefixed warning icon with the shared outlier tooltip when true', () => {
        expect(buildOutlierPriceWarningIcon(true)).toBe(
            ' <span style="color: #ffa500;" title="translated:marketData.outlierPriceWarningTooltip">⚠</span>'
        );
    });
});
