import { describe, expect, test, vi } from 'vitest';
import { extractJsDelivrGithubUrls, warmUrl } from './warm-jsdelivr-cache.js';

const SAMPLE = `// ==UserScript==
// @name         Toolasha
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@abc123/dist/libraries/toolasha-core.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@abc123/dist/libraries/toolasha-utils.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@abc123/dist/libraries/toolasha-core.js
// ==/UserScript==
const x = '// @require https://cdn.jsdelivr.net/gh/not/a/header.js';`;

describe('extractJsDelivrGithubUrls', () => {
    test('returns only the GitHub-hosted jsDelivr requires, once each, in order', () => {
        expect(extractJsDelivrGithubUrls(SAMPLE)).toEqual([
            'https://cdn.jsdelivr.net/gh/Celasha/Toolasha@abc123/dist/libraries/toolasha-core.js',
            'https://cdn.jsdelivr.net/gh/Celasha/Toolasha@abc123/dist/libraries/toolasha-utils.js',
        ]);
    });

    test('finds nothing in an unpinned header', () => {
        expect(extractJsDelivrGithubUrls('// @require https://UPDATE-THIS-URL/toolasha-core.js')).toEqual([]);
    });
});

describe('warmUrl', () => {
    const ok = (body = 'code') => ({ ok: true, status: 200, text: async () => body });
    const bad = (status) => ({ ok: false, status, text: async () => '' });

    test('returns true as soon as the URL is served', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(ok());
        expect(await warmUrl('u', { fetchImpl, attempts: 3, delayMs: 0, log: () => {} })).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('retries through errors, bad statuses and empty bodies until it is served', async () => {
        const fetchImpl = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'TimeoutError' }))
            .mockResolvedValueOnce(bad(502))
            .mockResolvedValueOnce(ok(''))
            .mockResolvedValueOnce(ok());
        expect(await warmUrl('u', { fetchImpl, attempts: 5, delayMs: 0, log: () => {} })).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    test('gives up after the attempt limit and reports failure', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(bad(404));
        expect(await warmUrl('u', { fetchImpl, attempts: 3, delayMs: 0, log: () => {} })).toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
});
