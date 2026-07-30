/**
 * Static regression test: Config color members must be defined (TLA-009)
 */

import { describe, test, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

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

function collectJsFiles(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            collectJsFiles(full, files);
        } else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
            files.push(full);
        }
    }
    return files;
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

    test('config.SCRIPT_COLOR_PRIMARY is not defined', () => {
        expect(config.SCRIPT_COLOR_PRIMARY).toBeUndefined();
    });

    test('config.SCRIPT_COLOR_SECONDARY is not defined', () => {
        expect(config.SCRIPT_COLOR_SECONDARY).toBeUndefined();
    });
});

describe('Config — forbidden source references (TLA-009 regression)', () => {
    const srcDir = resolve(new URL('.', import.meta.url).pathname, '..');
    const forbidden = ['config.SCRIPT_COLOR_PRIMARY', 'config.SCRIPT_COLOR_SECONDARY'];

    test('no source file references config.SCRIPT_COLOR_PRIMARY or config.SCRIPT_COLOR_SECONDARY', () => {
        const violations = [];
        for (const file of collectJsFiles(srcDir)) {
            const content = readFileSync(file, 'utf8');
            for (const name of forbidden) {
                if (content.includes(name)) {
                    violations.push(`${file}: ${name}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
