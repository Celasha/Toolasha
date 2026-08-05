// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest';
import { MarketplaceShortcuts } from './marketplace-shortcuts.js';

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function createActionMenu() {
    const menu = document.createElement('div');
    menu.innerHTML = '<button type="button">Existing action</button>';
    return menu;
}

describe('MarketplaceShortcuts dropdown lifecycle', () => {
    test('buildDropdown does not add a document listener per action menu', () => {
        const feature = new MarketplaceShortcuts();
        const addListenerSpy = vi.spyOn(document, 'addEventListener');

        feature.buildDropdown(createActionMenu(), '/items/test_item', 0);
        feature.buildDropdown(createActionMenu(), '/items/other_item', 0);

        expect(addListenerSpy).not.toHaveBeenCalledWith('click', expect.any(Function));
    });

    test('one shared close handler closes every rendered dropdown', () => {
        const feature = new MarketplaceShortcuts();
        const first = feature.buildDropdown(createActionMenu(), '/items/test_item', 0);
        const second = feature.buildDropdown(createActionMenu(), '/items/other_item', 0);
        document.body.append(first, second);

        first.querySelector('.mwi-marketplace-dropdown-toggle').click();
        second.querySelector('.mwi-marketplace-dropdown-toggle').click();
        expect(first.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('flex');
        expect(second.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('flex');

        feature.closeAllDropdowns();

        expect(first.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('none');
        expect(second.querySelector('.mwi-marketplace-dropdown-panel').style.display).toBe('none');
    });
});
