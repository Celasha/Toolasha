import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const entrypointSource = readFileSync(resolve(ROOT, 'entrypoint.js'), 'utf8');

/**
 * OA-RUNTIME-2 regression: the Expected Value Calculator is shared infrastructure consumed by
 * both the tooltip feature and Openable Analytics. FeatureRegistry only initializes a feature
 * when its customCheck (or config.isFeatureEnabled fallback) returns true, so gating solely on
 * `itemTooltip_expectedValue` would leave Openable Analytics without Expected/Luck after any
 * character switch where that tooltip setting is off. This is a static source assertion (rather
 * than an executed FeatureRegistry test) because entrypoint.js reads its dependencies from
 * `window.Toolasha.*` globals rather than ES imports and isn't meant to run standalone.
 */
describe('Expected Value Calculator feature registration (OA-RUNTIME-2)', () => {
    function extractFeatureBlock(key) {
        const keyIndex = entrypointSource.indexOf(`key: '${key}'`);
        expect(keyIndex).toBeGreaterThan(-1);
        const blockEnd = entrypointSource.indexOf('},', keyIndex);
        return entrypointSource.slice(keyIndex, blockEnd);
    }

    test('has a customCheck rather than relying only on the tooltip feature toggle', () => {
        const block = extractFeatureBlock('expectedValueCalculator');

        expect(block).toContain('customCheck');
    });

    test('customCheck references both consumer settings', () => {
        const block = extractFeatureBlock('expectedValueCalculator');

        expect(block).toContain('itemTooltip_expectedValue');
        expect(block).toContain('openableAnalytics');
    });
});

/**
 * Features that are not in config.features default to "enabled" in config.isFeatureEnabled(), so
 * a registry entry with no customCheck would start even when its own setting is off. These
 * entries need an explicit customCheck that reads their setting.
 */
describe('Registry entries gated on their own setting', () => {
    function extractBlock(key) {
        const keyIndex = entrypointSource.indexOf(`key: '${key}'`);
        expect(keyIndex).toBeGreaterThan(-1);
        return entrypointSource.slice(keyIndex, entrypointSource.indexOf('},', keyIndex));
    }

    test('openableAnalytics has a customCheck on the openableAnalytics setting', () => {
        const block = extractBlock('openableAnalytics');

        expect(block).toContain('customCheck');
        expect(block).toContain("getSetting('openableAnalytics')");
    });
});
