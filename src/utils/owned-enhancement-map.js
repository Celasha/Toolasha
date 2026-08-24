/**
 * Build the current highest-owned enhancement map for UI features that explicitly need a
 * highest-owned item lookup (for example the optimizer's hypothetical equipment picker).
 * Saved-loadout semantics remain exclusively owned by Core LoadoutState.
 */

import dataManager from '../core/data-manager.js';
import loadoutState from '../core/loadout-state.js';

/**
 * @returns {Map<string, number>} itemHrid -> current highest owned enhancement level
 */
export function buildOwnedEnhancementLevelMap() {
    const result = new Map();
    for (const [itemHrid, owned] of loadoutState.getOwnedEnhancementIndex(dataManager.getInventory())) {
        result.set(itemHrid, owned.highestEnhancementLevel);
    }
    return result;
}
