/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { assertLibrariesLoaded, findMissingLibraries, showLibrariesWarning } from './entrypoint-guard.js';

const allLibraries = { Core: {}, Utils: {}, Market: {}, Sim: {}, Actions: {}, Combat: {}, UI: {} };

describe('findMissingLibraries', () => {
    test('reports everything when the namespace is absent', () => {
        expect(findMissingLibraries(undefined)).toEqual(['Core', 'Utils', 'Market', 'Sim', 'Actions', 'Combat', 'UI']);
    });

    test('reports only the libraries that are missing', () => {
        expect(findMissingLibraries({ ...allLibraries, Combat: undefined, UI: undefined })).toEqual(['Combat', 'UI']);
        expect(findMissingLibraries(allLibraries)).toEqual([]);
        expect(findMissingLibraries({ ...allLibraries, Sim: undefined })).toEqual(['Sim']);
    });
});

describe('assertLibrariesLoaded', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('does nothing and shows no banner when every library loaded', () => {
        expect(() => assertLibrariesLoaded(allLibraries)).not.toThrow();
        expect(document.getElementById('mwi-libraries-warning')).toBeNull();
    });

    test('shows the banner and throws a clear error naming the missing libraries', () => {
        expect(() => assertLibrariesLoaded(undefined)).toThrow(/Libraries failed to load \(missing: Core/);
        expect(document.getElementById('mwi-libraries-warning')).not.toBeNull();
    });

    test('a partial load still stops and reports what is missing', () => {
        expect(() => assertLibrariesLoaded({ ...allLibraries, Market: undefined })).toThrow(/missing: Market/);
    });
});

describe('showLibrariesWarning', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('shows one banner with a working dismiss button, even if called twice', () => {
        showLibrariesWarning();
        showLibrariesWarning();
        expect(document.querySelectorAll('#mwi-libraries-warning')).toHaveLength(1);

        document.querySelector('#mwi-libraries-warning button[aria-label]').click();
        expect(document.getElementById('mwi-libraries-warning')).toBeNull();
    });

    test('uses Chinese text for a zh browser', () => {
        Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });
        showLibrariesWarning();
        expect(document.getElementById('mwi-libraries-warning').textContent).toContain('刷新页面');
        Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
    });
});
