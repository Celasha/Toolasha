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
import settingsUI, { normalizeHexColor } from './settings-ui.js';

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
