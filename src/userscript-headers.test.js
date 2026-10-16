import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function readMatches(relativePath) {
    return readFileSync(join(root, relativePath), 'utf-8')
        .split('\n')
        .filter((line) => line.startsWith('// @match'))
        .map((line) => line.replace('// @match', '').trim());
}

describe('userscript headers', () => {
    const standalone = readMatches('userscript-header.txt');
    const entrypoint = readMatches('library-headers/entrypoint.txt');

    test('the production entrypoint matches the same pages as the standalone header', () => {
        expect([...entrypoint].sort()).toEqual([...standalone].sort());
    });

    test.each(['milkywayidle.com', 'milkywayidlecn.com'])('loads on the apex domain %s (without www)', (domain) => {
        expect(entrypoint).toContain(`https://${domain}/*`);
    });
});
