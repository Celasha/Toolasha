/**
 * Action context resolver
 *
 * Returns the equipment and active drinks to use when predicting an action's
 * outcome (XP, time, profit, materials). When automatic saved-loadout use is
 * enabled and a saved loadout matches the action type, the canonical Core
 * loadout state is resolved against current ownership at read time.
 *
 * Resolution priority (handled inside loadoutState.findSnapshotForActionType):
 *   1. Skill-specific default loadout
 *   2. All-skills default loadout
 *   3. Skill-specific non-default
 *   4. All-skills non-default
 *   5. Fall back to currently-equipped gear / current drinks
 *
 * Intentional empty state is preserved: a matching skill-specific saved loadout with no
 * equipment or no drinks resolves to an empty Map/array rather than falling through to the
 * character's currently equipped setup. An All Skills loadout (actionTypeHrid === '') is the one
 * exception for drinks: the game never lets that loadout type carry drink slots at all, so its
 * always-blank drinks are a structural void, not a player choice, and fall back to the
 * character's current drinks for that action type instead.
 *
 * resolveCurrentActionContext() is the separate live-state counterpart: it always ignores
 * saved-loadout prediction and returns the character's actual current setup, for surfaces (like
 * the Current Action Bar) that describe what is actually running now rather than a prediction.
 */

import config from '../core/config.js';
import dataManager from '../core/data-manager.js';
import loadoutState from '../core/loadout-state.js';

/**
 * Resolve the character's proven current live setup, ignoring saved-loadout prediction settings.
 * Equipment and drinks are returned as one atomic context so callers cannot accidentally mix
 * current equipment with saved-loadout consumables (or vice versa). Used by live-state surfaces
 * (e.g. the Current Action Bar) that describe the action actually running now, as opposed to
 * predictive action cards/future queue entries which use resolveActionContext().
 * @param {string} actionTypeHrid - e.g. "/action_types/cooking"
 * @returns {{equipment: Map, drinks: Array, source: string, loadoutSelection: null}}
 */
export function resolveCurrentActionContext(actionTypeHrid) {
    const rawDrinks = dataManager.getActionDrinkSlots(actionTypeHrid);
    const inventory = dataManager.getInventory();
    const drinks = (rawDrinks || []).filter(
        (drink) => drink?.itemHrid && inventory?.some((item) => item.itemHrid === drink.itemHrid && item.count !== 0)
    );

    return {
        equipment: dataManager.getEquipment(),
        drinks,
        source: 'current',
        loadoutSelection: null,
    };
}

/**
 * @param {string} actionTypeHrid - e.g. "/action_types/cooking"
 * @returns {{equipment: Map, drinks: Array, source: string, loadoutSelection: Object|null}}
 */
export function resolveActionContext(actionTypeHrid) {
    const selection = config.getSetting('loadoutSnapshot')
        ? loadoutState.findCalculationSelectionForActionType(actionTypeHrid)
        : { status: 'disabled', snapshot: null };
    const snapshot = selection.status === 'usable' ? selection.snapshot : null;

    // A matching-but-unavailable saved loadout is not equivalent to "no loadout" semantically.
    // We fail closed to the character's proven current setup rather than inventing how the MWI
    // server would execute missing loadout items. The returned selection metadata lets UIs make
    // that fallback visible instead of silently claiming the saved loadout was used.
    let drinks;
    if (snapshot && snapshot.drinksApplicable) {
        // Core already resolved saved consumables against live inventory and blanked unavailable
        // slots. Do not rescan the full inventory again on every action calculation.
        drinks = (snapshot.drinks || []).filter((entry) => entry.itemHrid);
    } else {
        drinks = resolveCurrentActionContext(actionTypeHrid).drinks;
    }

    return {
        equipment: snapshot
            ? new Map((snapshot.equipment || []).map((entry) => [entry.itemLocationHrid, entry]))
            : dataManager.getEquipment(),
        drinks,
        source: snapshot ? 'saved-loadout' : 'current',
        loadoutSelection: selection,
    };
}

export default { resolveActionContext, resolveCurrentActionContext };
