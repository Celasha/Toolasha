/**
 * Tests for Chat 24hr Timestamps: rewrites native chat timestamp text per the
 * market_listingTimeFormat / market_listingDateFormat settings instead of the browser locale.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const settingValues = {
    chat_24hrTimestamps: true,
    market_listingTimeFormat: '24hour',
    market_listingDateFormat: 'MM-DD',
};

const settingChangeCallbacks = {};

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => settingValues[key]),
        getSettingValue: vi.fn((key, fallback) => settingValues[key] ?? fallback),
        onSettingChange: vi.fn((key, cb) => {
            (settingChangeCallbacks[key] ||= []).push(cb);
        }),
        offSettingChange: vi.fn((key, cb) => {
            if (!settingChangeCallbacks[key]) return;
            settingChangeCallbacks[key] = settingChangeCallbacks[key].filter((fn) => fn !== cb);
        }),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

function makeTimestampSpan(text) {
    const span = document.createElement('span');
    span.className = 'ChatMessage_timestamp__1iRZO';
    span.textContent = text;
    document.body.appendChild(span);
    return span;
}

describe('Chat 24hr Timestamps', () => {
    let feature;
    let config;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        Object.keys(settingChangeCallbacks).forEach((k) => delete settingChangeCallbacks[k]);
        Object.assign(settingValues, {
            chat_24hrTimestamps: true,
            market_listingTimeFormat: '24hour',
            market_listingDateFormat: 'MM-DD',
        });
        config = (await import('../../core/config.js')).default;
        feature = (await import('./chat-24hr-timestamps.js')).default;
    });

    // The live client builds the span's own text as `"[" + time + "] "` (see
    // ChatMessage.render in the client bundle) - the trailing space after `]` is baked into the
    // DOM text itself, not separate markup/CSS spacing. Fixtures below use that real format;
    // a regex anchored on `\]$` (no trailing-space allowance) would never match it, which was
    // the actual bug: the feature silently did nothing against real chat messages.
    test('converts a time-only PM timestamp to 24-hour format', () => {
        const span = makeTimestampSpan('[9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[21:31:23] ');
    });

    test('converts a time-only AM timestamp, including 12 AM -> 00', () => {
        const span = makeTimestampSpan('[12:05:09 AM] ');
        feature.initialize();
        expect(span.textContent).toBe('[00:05:09] ');
    });

    test('preserves and reorders the date prefix for Guild/Party/Whisper/Moderator messages', () => {
        const span = makeTimestampSpan('[5/22 9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[05/22 21:31:23] ');
    });

    test('respects DD-MM date format setting', () => {
        settingValues.market_listingDateFormat = 'DD-MM';
        const span = makeTimestampSpan('[5/22 9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[22/05 21:31:23] ');
    });

    test('keeps 12-hour format when market_listingTimeFormat is 12hour, just normalizing padding', () => {
        settingValues.market_listingTimeFormat = '12hour';
        const span = makeTimestampSpan('[9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[9:31:23 PM] ');
    });

    test('is idempotent: already-converted 24-hour text is left untouched on a second pass', () => {
        const span = makeTimestampSpan('[9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[21:31:23] ');
        feature.disable();
        feature.initialize();
        expect(span.textContent).toBe('[21:31:23] ');
    });

    test('does nothing when the feature setting is disabled', () => {
        settingValues.chat_24hrTimestamps = false;
        const span = makeTimestampSpan('[9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[9:31:23 PM] ');
    });

    test('re-sweeps visible timestamps when the time format setting changes', () => {
        const span = makeTimestampSpan('[9:31:23 PM] ');
        feature.initialize();
        expect(span.textContent).toBe('[21:31:23] ');

        settingValues.market_listingTimeFormat = '12hour';
        settingChangeCallbacks['market_listingTimeFormat'].forEach((cb) => cb());

        // Already-24h text has no AM/PM token, so the regex no-ops; this documents that
        // switching back to 12-hour does not retroactively "un-convert" already-rewritten text.
        expect(span.textContent).toBe('[21:31:23] ');
    });

    test('disable() unregisters the dom observer and setting-change listeners', () => {
        feature.initialize();
        feature.disable();
        expect(config.offSettingChange).toHaveBeenCalledWith('market_listingTimeFormat', expect.any(Function));
        expect(config.offSettingChange).toHaveBeenCalledWith('market_listingDateFormat', expect.any(Function));
    });

    test('ignores spans whose text does not match the expected timestamp pattern', () => {
        const span = makeTimestampSpan('[invalid]');
        feature.initialize();
        expect(span.textContent).toBe('[invalid]');
    });
});
