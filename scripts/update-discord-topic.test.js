import { describe, expect, test, vi } from 'vitest';
import { buildTopic, setChannelTopic } from './update-discord-topic.js';

describe('buildTopic', () => {
    test('puts the version and release link in the topic', () => {
        expect(buildTopic('3.18.1', 'Celasha/Toolasha')).toBe(
            'Toolasha v3.18.1 — latest release: https://github.com/Celasha/Toolasha/releases/tag/v3.18.1'
        );
    });

    test('does not double the v when the version already has one', () => {
        expect(buildTopic('v3.18.1', 'Celasha/Toolasha')).toBe(buildTopic('3.18.1', 'Celasha/Toolasha'));
    });

    test('rejects an empty version and an over-long topic', () => {
        expect(() => buildTopic('  ', 'Celasha/Toolasha')).toThrow('VERSION is empty');
        expect(() => buildTopic('1.0.0', 'a'.repeat(2000))).toThrow('1024');
    });
});

describe('setChannelTopic', () => {
    function fetchReturning(status) {
        return vi.fn(async () => ({ ok: status >= 200 && status < 300, status }));
    }

    test('PATCHes the channel with the topic and a bot authorization header', async () => {
        const fetchImpl = fetchReturning(200);
        await setChannelTopic({ token: 'secret', channelId: '123', topic: 'hello', fetchImpl });

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://discord.com/api/v10/channels/123');
        expect(init.method).toBe('PATCH');
        expect(init.headers.Authorization).toBe('Bot secret');
        expect(JSON.parse(init.body)).toEqual({ topic: 'hello' });
    });

    test.each([
        [401, 'token was rejected'],
        [403, 'Manage Channels'],
        [404, 'channel was not found'],
        [500, 'unexpected response'],
    ])('explains a %i response without leaking the token', async (status, text) => {
        const promise = setChannelTopic({
            token: 'secret',
            channelId: '123',
            topic: 'hello',
            fetchImpl: fetchReturning(status),
        });
        await expect(promise).rejects.toThrow(text);
        await expect(promise).rejects.not.toThrow('secret');
    });
});
