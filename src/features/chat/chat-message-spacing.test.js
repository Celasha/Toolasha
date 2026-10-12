/**
 * Tests for Chat Message Spacing: injects a CSS rule adding margin after the native chat
 * username element, gated by the chat_messageSpacing setting.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const settingValues = { chat_messageSpacing: true };

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => settingValues[key]),
    },
}));

describe('Chat Message Spacing', () => {
    let feature;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        document.head.innerHTML = '';
        Object.assign(settingValues, { chat_messageSpacing: true });
        feature = (await import('./chat-message-spacing.js')).default;
    });

    test('initialize() injects a CSS rule targeting the native username element', () => {
        feature.initialize();

        const style = document.getElementById('mwi-chat-message-spacing-css');
        expect(style).not.toBeNull();
        expect(style.textContent).toContain('ChatMessage_username');
        expect(style.textContent).toContain('margin-right');
    });

    test('initialize() is a no-op when the setting is off', () => {
        settingValues.chat_messageSpacing = false;

        feature.initialize();

        expect(document.getElementById('mwi-chat-message-spacing-css')).toBeNull();
    });

    test('initialize() is idempotent when called twice', () => {
        feature.initialize();
        feature.initialize();

        expect(document.querySelectorAll('#mwi-chat-message-spacing-css')).toHaveLength(1);
    });

    test('disable() removes the injected stylesheet', () => {
        feature.initialize();
        feature.disable();

        expect(document.getElementById('mwi-chat-message-spacing-css')).toBeNull();
    });

    test('disable() before initialize() does not throw', () => {
        expect(() => feature.disable()).not.toThrow();
    });
});
