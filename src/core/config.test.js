/**
 * Static regression test: Config color members must be defined (TLA-009)
 */

import { describe, test, expect, vi } from 'vitest';

vi.mock('./settings-storage.js', () => ({
    default: { getSetting: vi.fn(() => null), onSettingChange: vi.fn() },
}));
vi.mock('./settings-schema.js', () => ({ settingsGroups: [] }));
vi.mock('./data-manager.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

const { default: config } = await import('./config.js');

const CSS_COLOR = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^[a-z]+$/;

function isValidColor(value) {
    return typeof value === 'string' && CSS_COLOR.test(value.trim());
}

describe('Config — color constants', () => {
    const colorMembers = [
        'COLOR_PROFIT',
        'COLOR_LOSS',
        'COLOR_WARNING',
        'COLOR_INFO',
        'COLOR_ESSENCE',
        'COLOR_TOOLTIP_PROFIT',
        'COLOR_TOOLTIP_LOSS',
        'COLOR_TOOLTIP_INFO',
        'COLOR_TOOLTIP_WARNING',
        'COLOR_TEXT_PRIMARY',
        'COLOR_TEXT_SECONDARY',
        'COLOR_BORDER',
        'COLOR_GOLD',
        'COLOR_MIRROR',
        'COLOR_ACCENT',
        'SCRIPT_COLOR_MAIN',
        'SCRIPT_COLOR_TOOLTIP',
        'SCRIPT_COLOR_ALERT',
    ];

    for (const member of colorMembers) {
        test(`config.${member} is a valid CSS color`, () => {
            expect(config[member]).toBeDefined();
            expect(isValidColor(config[member])).toBe(true);
        });
    }

    test('config.SCRIPT_COLOR_PRIMARY is not defined (was undefined, now removed from callers)', () => {
        // Regression guard: if someone re-adds SCRIPT_COLOR_PRIMARY to config,
        // the corresponding call sites should use the semantic constant instead.
        expect(config.SCRIPT_COLOR_PRIMARY).toBeUndefined();
    });

    test('config.SCRIPT_COLOR_SECONDARY is not defined (was undefined, now removed from callers)', () => {
        expect(config.SCRIPT_COLOR_SECONDARY).toBeUndefined();
    });
});
