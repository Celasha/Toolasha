// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest';
import dataManager from '../../core/data-manager.js';
import { InventoryCountDisplay } from './inventory-count-display.js';

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('InventoryCountDisplay tile registration', () => {
    test('does not rebuild the inventory map when a registered tile is only reordered', () => {
        const feature = new InventoryCountDisplay();
        const panel = document.createElement('div');
        panel.innerHTML = '<div class="SkillAction_name__test">Test Action</div>';
        document.body.appendChild(panel);

        vi.spyOn(feature, '_getActionHridFromTile').mockReturnValue('/actions/test_action');
        vi.spyOn(dataManager, 'getActionDetails').mockReturnValue({
            type: '/action_types/crafting',
            outputItems: [{ itemHrid: '/items/test_item' }],
        });
        const inventorySpy = vi.spyOn(dataManager, 'getInventory').mockReturnValue([]);

        feature._injectTile(panel);
        feature._injectTile(panel);

        expect(inventorySpy).toHaveBeenCalledTimes(1);
        expect(panel.querySelectorAll('.mwi-inv-count-tile')).toHaveLength(1);
    });
});
