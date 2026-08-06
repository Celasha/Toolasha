// @vitest-environment jsdom

import { describe, expect, test } from 'vitest';
import { areInjectedLayoutElementsAttached, mutationTouchesCustomTabsLayout } from './custom-tabs-layout-guards.js';

describe('custom tabs layout guards', () => {
    test('detects when only the trailing Unorganized header was removed', () => {
        const container = document.createElement('div');
        const topbar = document.createElement('div');
        const unorganized = document.createElement('div');
        unorganized.className = 'toolasha-ct-unorg-header';
        container.append(topbar, unorganized);

        expect(areInjectedLayoutElementsAttached([topbar, unorganized], container)).toBe(true);

        unorganized.remove();

        expect(areInjectedLayoutElementsAttached([topbar, unorganized], container)).toBe(false);
    });

    test('treats removal of an injected header as a relevant layout mutation', () => {
        const unorganized = document.createElement('div');
        unorganized.className = 'toolasha-ct-unorg-header';

        expect(
            mutationTouchesCustomTabsLayout({
                addedNodes: [],
                removedNodes: [unorganized],
            })
        ).toBe(true);
    });

    test('ignores unrelated text and elements', () => {
        expect(
            mutationTouchesCustomTabsLayout({
                addedNodes: [document.createTextNode('unrelated')],
                removedNodes: [document.createElement('span')],
            })
        ).toBe(false);
    });
});
