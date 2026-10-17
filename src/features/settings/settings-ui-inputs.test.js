// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/storage.js', () => ({
    default: { setJSON: vi.fn(async () => {}), getJSON: vi.fn(async () => null), get: vi.fn(async () => null) },
}));
vi.mock('../../core/data-manager.js', () => ({
    default: { getCurrentCharacterId: vi.fn(() => 'char-1'), on: vi.fn() },
}));
vi.mock('../../core/settings-storage.js', () => ({
    default: { setSetting: vi.fn(async () => true) },
}));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => false),
        setSetting: vi.fn(),
        setSettingValue: vi.fn(),
        applyColorSettings: vi.fn(),
    },
}));

import settingsStorage from '../../core/settings-storage.js';
import config from '../../core/config.js';
import settingsUI, { normalizeHexColor, clampToInputRange } from './settings-ui.js';

describe('normalizeHexColor', () => {
    test('accepts 6-digit hex with or without #', () => {
        expect(normalizeHexColor('#FF8800')).toBe('#ff8800');
        expect(normalizeHexColor(' ff8800 ')).toBe('#ff8800');
    });

    test('expands 3-digit shorthand', () => {
        expect(normalizeHexColor('#f80')).toBe('#ff8800');
    });

    test('rejects invalid input', () => {
        expect(normalizeHexColor('')).toBeNull();
        expect(normalizeHexColor('#ff88')).toBeNull();
        expect(normalizeHexColor('#gg0000')).toBeNull();
        expect(normalizeHexColor('#ff880000')).toBeNull();
    });
});

describe('SettingsUI typed hex color', () => {
    let picker;
    let text;

    beforeEach(() => {
        vi.clearAllMocks();
        settingsUI.currentSettings = {};
        const inputHTML = settingsUI.generateSettingInput('color_accent', { type: 'color', default: '#112233' });
        document.body.innerHTML = `<div class="toolasha-setting" data-type="color">${inputHTML}</div>`;
        picker = document.getElementById('color_accent');
        text = document.getElementById('color_accent_text');
        settingsUI.config = config;
        settingsUI.currentSettings = {};
    });

    test('the hex box is editable', () => {
        expect(text.readOnly).toBe(false);
    });

    test('a typed valid color is saved and applied', async () => {
        text.value = 'F80';
        await settingsUI.handleSettingChange({ target: text });

        expect(picker.value).toBe('#ff8800');
        expect(text.value).toBe('#ff8800');
        expect(settingsStorage.setSetting).toHaveBeenCalledWith('color_accent', '#ff8800');
        expect(config.applyColorSettings).toHaveBeenCalled();
    });

    test('an invalid color reverts the box and saves nothing', async () => {
        text.value = 'nope';
        await settingsUI.handleSettingChange({ target: text });

        expect(text.value).toBe('#112233');
        expect(picker.value).toBe('#112233');
        expect(settingsStorage.setSetting).not.toHaveBeenCalled();
    });
});

describe('number setting range clamping', () => {
    const def = { type: 'number', default: 5, min: 1, max: 100, step: 1 };
    let input;

    beforeEach(() => {
        vi.clearAllMocks();
        settingsUI.currentSettings = {};
        const inputHTML = settingsUI.generateSettingInput('labyrinthRecommendSimHours', def);
        document.body.innerHTML = `<div class="toolasha-setting" data-type="number">${inputHTML}</div>`;
        input = document.getElementById('labyrinthRecommendSimHours');
        settingsUI.config = config;
    });

    test('clampToInputRange applies whichever bounds are present', () => {
        expect(clampToInputRange(2000, '1', '100')).toBe(100);
        expect(clampToInputRange(-5, '1', '100')).toBe(1);
        expect(clampToInputRange(50, '1', '100')).toBe(50);
        expect(clampToInputRange(2000, '', '')).toBe(2000);
        expect(clampToInputRange(0, '1', '')).toBe(1);
        expect(clampToInputRange(2000, '', '100')).toBe(100);
    });

    test('a typed value above max is saved as max and the box is corrected', async () => {
        input.value = '2000';
        await settingsUI.handleSettingChange({ target: input });

        expect(settingsStorage.setSetting).toHaveBeenCalledWith('labyrinthRecommendSimHours', 100);
        expect(input.value).toBe('100');
    });

    test('a typed value below min (or empty) is saved as min', async () => {
        input.value = '0';
        await settingsUI.handleSettingChange({ target: input });
        expect(settingsStorage.setSetting).toHaveBeenLastCalledWith('labyrinthRecommendSimHours', 1);
        expect(input.value).toBe('1');

        input.value = '';
        await settingsUI.handleSettingChange({ target: input });
        expect(settingsStorage.setSetting).toHaveBeenLastCalledWith('labyrinthRecommendSimHours', 1);
    });

    test('an in-range value is saved unchanged', async () => {
        input.value = '25';
        await settingsUI.handleSettingChange({ target: input });
        expect(settingsStorage.setSetting).toHaveBeenCalledWith('labyrinthRecommendSimHours', 25);
        expect(input.value).toBe('25');
    });
});
