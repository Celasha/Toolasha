import { execFileSync } from 'child_process';
import { copyFileSync, mkdtempSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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

describe('running the script directly', () => {
    test('runs even when invoked through a symlinked path', () => {
        const realDir = mkdtempSync(join(tmpdir(), 'topic-real-'));
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'update-discord-topic.js'), join(realDir, 'run.js'));
        const linkDir = join(mkdtempSync(join(tmpdir(), 'topic-link-')), 'linked');
        symlinkSync(realDir, linkDir);

        const output = execFileSync('node', [join(linkDir, 'run.js'), '--dry-run'], {
            env: { ...process.env, VERSION: '3.20.0', GITHUB_REPOSITORY: 'Celasha/Toolasha' },
            encoding: 'utf8',
        });
        expect(output).toContain('[dry run] would set the topic to: Toolasha v3.20.0');
    });
});
