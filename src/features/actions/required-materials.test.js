// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_LOSS: '#f00',
        COLOR_PROFIT: '#0f0',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({ default: {} }));
vi.mock('../../utils/material-calculator.js', () => ({
    calculateMaterialRequirements: vi.fn(),
    isArtisanTeaOutOfStock: vi.fn(),
}));
vi.mock('../../utils/action-panel-helper.js', () => ({
    findActionInput: vi.fn(),
    attachInputListeners: vi.fn(),
    performInitialUpdate: vi.fn(),
}));
vi.mock('../../utils/game-lookups.js', () => ({ getActionHridFromName: vi.fn() }));
vi.mock('../../utils/formatters.js', () => ({
    numberFormatter: vi.fn((value) => new Intl.NumberFormat('en-US').format(value)),
}));

import { formatRequiredMaterialStatus } from './required-materials.js';

describe('formatRequiredMaterialStatus', () => {
    test('shows the queued reservation once and keeps Missing compact', () => {
        expect(
            formatRequiredMaterialStatus({
                required: 1800,
                queued: 3496,
                missing: 2,
            })
        ).toBe("Required: 1,800 (3,496 Q'd) | Missing: 2");
    });

    test('omits queue and Missing parts when they are not applicable', () => {
        expect(formatRequiredMaterialStatus({ required: 900, queued: 0, missing: 0 })).toBe('Required: 900');
    });
});
