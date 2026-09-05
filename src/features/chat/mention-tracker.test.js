/**
 * Tests for Mention Tracker: existing @mention detection/badge behavior stays intact, and a
 * detected mention is also mirrored into the Log tab (notification-log.js) via logMention().
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterName: vi.fn(() => 'You'),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('./mention-popup.js', () => ({
    default: { open: vi.fn(), close: vi.fn() },
}));

vi.mock('./notification-log.js', () => ({
    default: { logMention: vi.fn() },
}));

function chatMessage(overrides = {}) {
    return {
        message: {
            sName: 'Someone',
            m: 'hey @You check this out',
            chan: '/chat_channel_types/guild',
            t: '2026-09-04T12:00:00.000Z',
            ...overrides,
        },
    };
}

describe('MentionTracker - existing detection/badge behavior', () => {
    let MentionTracker;
    let feature;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterName.mockReturnValue('You');

        ({ default: MentionTracker } = await import('./mention-tracker.js'));
        feature = MentionTracker;
        await feature.initialize();
    });

    test('a message mentioning the character is recorded in the per-channel mention log', () => {
        feature.onChatMessage(chatMessage());

        const log = feature.mentionLog.get('/chat_channel_types/guild');
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ sName: 'Someone', m: 'hey @You check this out' });
    });

    test('a message not mentioning the character is not recorded', () => {
        feature.onChatMessage(chatMessage({ m: 'no mention here' }));

        expect(feature.mentionLog.get('/chat_channel_types/guild')).toBeUndefined();
    });

    test('a system message is ignored even if it contains the mention text', () => {
        feature.onChatMessage(chatMessage({ isSystemMessage: true }));

        expect(feature.mentionLog.get('/chat_channel_types/guild')).toBeUndefined();
    });
});

describe('MentionTracker - mirrors detected mentions into the Log tab', () => {
    let feature;
    let notificationLog;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterName.mockReturnValue('You');
        notificationLog = (await import('./notification-log.js')).default;

        ({ default: feature } = await import('./mention-tracker.js'));
        await feature.initialize();
    });

    test('a detected mention is forwarded to notificationLog.logMention with resolved channel name and timestamp', () => {
        feature.onChatMessage(chatMessage());

        expect(notificationLog.logMention).toHaveBeenCalledTimes(1);
        expect(notificationLog.logMention).toHaveBeenCalledWith({
            channel: '/chat_channel_types/guild',
            channelName: 'Guild',
            sName: 'Someone',
            text: 'hey @You check this out',
            timestamp: new Date('2026-09-04T12:00:00.000Z').getTime(),
        });
    });

    test('a message not mentioning the character never reaches logMention', () => {
        feature.onChatMessage(chatMessage({ m: 'no mention here' }));

        expect(notificationLog.logMention).not.toHaveBeenCalled();
    });

    test('a missing message timestamp falls back to the current time rather than being omitted', () => {
        feature.onChatMessage(chatMessage({ t: undefined }));

        expect(notificationLog.logMention).toHaveBeenCalledTimes(1);
        const { timestamp } = notificationLog.logMention.mock.calls[0][0];
        expect(typeof timestamp).toBe('number');
        expect(timestamp).toBeGreaterThan(0);
    });
});
