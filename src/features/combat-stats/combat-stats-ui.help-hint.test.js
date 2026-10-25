// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        getSettingValue: vi.fn((_key, def) => def),
        onSettingChange: vi.fn(),
    },
}));
vi.mock('../../core/data-manager.js', () => ({ default: { getInitClientData: vi.fn(() => ({})) } }));
vi.mock('../../api/marketplace.js', () => ({ default: { on: vi.fn(), getPrice: vi.fn() } }));
vi.mock('./combat-stats-data-collector.js', () => ({ default: {} }));
vi.mock('../market/expected-value-calculator.js', () => ({ default: { resolveSellSideValue: vi.fn(() => null) } }));

import { createHelpHint } from './combat-stats-ui.js';

describe('createHelpHint', () => {
    test('is a small "?" whose hover text is the explanation', () => {
        const hint = createHelpHint('What z means');

        expect(hint.textContent).toBe('?');
        expect(hint.title).toBe('What z means');
        expect(hint.style.cursor).toBe('help');
    });
});
