/**
 * Action context resolver
 *
 * Returns the equipment and active drinks to use when predicting an action's
 * outcome (XP, time, profit, materials). When the loadoutSnapshot feature is
 * enabled and a saved loadout matches the action type, that snapshot is used
 * — so predictions reflect the gear the user would auto-equip rather than
 * whatever happens to be on their character right now.
 *
 * Resolution priority (handled inside loadoutSnapshot._findSnapshot):
 *   1. Skill-specific default loadout
 *   2. All-skills default loadout
 *   3. Skill-specific non-default
 *   4. All-skills non-default
 *   5. Fall back to currently-equipped gear / current drinks
 *
 * Equipment and drinks are resolved independently — it's valid to inherit the
 * snapshot's equipment while no snapshot drinks exist, in which case the
 * current drinks are used (and vice-versa).
 */

import dataManager from '../core/data-manager.js';
import loadoutSnapshot from '../features/combat/loadout-snapshot.js';

/**
 * @param {string} actionTypeHrid - e.g. "/action_types/cooking"
 * @returns {{equipment: Map, drinks: Array}}
 */
export function resolveActionContext(actionTypeHrid) {
    const rawDrinks =
        loadoutSnapshot.getSnapshotDrinksForSkill(actionTypeHrid) ?? dataManager.getActionDrinkSlots(actionTypeHrid);

    // Only include drinks that are actually in stock — slotted-but-empty teas give no buff
    const inventory = dataManager.getInventory();
    const drinks = (rawDrinks || []).filter(
        (d) => d?.itemHrid && inventory.some((i) => i.itemHrid === d.itemHrid && (i.count || 0) > 0)
    );

    return {
        equipment: loadoutSnapshot.getSnapshotForSkill(actionTypeHrid) ?? dataManager.getEquipment(),
        drinks,
    };
}

export default { resolveActionContext };
