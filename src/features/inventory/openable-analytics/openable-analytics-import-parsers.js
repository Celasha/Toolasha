/**
 * Openable Analytics Import Parsers
 * Parses pasted/uploaded historical container-opening data from other tools into the same
 * `{containerHrid, containerCount, itemTotals}` shape the data collector's live tracking uses,
 * so recomputation always goes through Toolasha's own pricing/EV stack rather than trusting a
 * source tool's own stored numbers. Adding a future third source only means adding one more
 * parser here that returns this same shape - no other module needs to change.
 */

import dataManager from '../../../core/data-manager.js';

/**
 * Build a lowercased item/container display-name -> HRID map from the current game data, for
 * resolving name-keyed import sources (Edible Tools) back to HRIDs. Sources that are already
 * HRID-keyed (MWI Combat Suite) don't need this.
 * @returns {Object} Map of lowercased name -> item HRID
 */
export function buildItemNameToHridMap() {
    const initData = dataManager.getInitClientData();
    const itemDetailMap = initData?.itemDetailMap || {};
    const map = {};
    for (const [itemHrid, details] of Object.entries(itemDetailMap)) {
        if (details?.name) {
            map[details.name.toLowerCase()] = itemHrid;
        }
    }
    return map;
}

/**
 * Parse an MWI Combat Suite export (a downloaded/pasted JSON file, already HRID-keyed). Only
 * cumulative `total.opened` / `total.loot` counts are read - the source's own
 * actualValue/expectedValue/luck fields are intentionally ignored so the import is recomputed
 * under Toolasha's own valuation.
 * @param {string} rawText - Raw JSON text (file contents or pasted text)
 * @returns {{containers: Array<{containerHrid: string, containerCount: number, itemTotals: Object}>, warnings: Array<string>}}
 */
export function parseCombatSuiteExport(rawText) {
    const warnings = [];
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return { containers: [], warnings: ['Could not parse the pasted/uploaded text as JSON.'] };
    }

    const chests = parsed?.chests;
    if (!chests || typeof chests !== 'object') {
        return { containers: [], warnings: ['No "chests" data found in this export.'] };
    }

    const containers = [];
    for (const [containerHrid, chest] of Object.entries(chests)) {
        const containerCount = chest?.total?.opened;
        if (!(containerCount > 0)) {
            warnings.push(`Skipped ${chest?.name || containerHrid}: no openings recorded.`);
            continue;
        }

        const itemTotals = {};
        for (const [itemHrid, item] of Object.entries(chest?.total?.loot || {})) {
            if (item?.count > 0) {
                itemTotals[itemHrid] = item.count;
            }
        }

        // MWI Combat Suite is already HRID-keyed, so nothing here is dropped for being
        // unresolvable - this source's Actual is always as complete as its own raw counts.
        containers.push({ containerHrid, containerCount, itemTotals, sourceDataComplete: true });
    }

    return { containers, warnings };
}

/**
 * Parse an Edible Tools `Edible_Tools` localStorage value (pasted as text). Edible only retains
 * cumulative totals per chest, keyed by localized display name rather than HRID, so this
 * resolves names against the current game's item list and reports anything it can't match
 * rather than silently dropping it.
 * @param {string} rawText - Raw JSON text pasted from `localStorage.getItem('Edible_Tools')`
 * @param {Object} [options]
 * @param {string} [options.playerId] - Which player's data to import, if the export has more than one
 * @returns {{containers: Array, warnings: Array<string>, needsPlayerSelection?: boolean, players?: Array<{id: string, name: string}>}}
 */
export function parseEdibleExport(rawText, { playerId } = {}) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return { containers: [], warnings: ['Could not parse the pasted text as JSON.'] };
    }

    const chestOpenData = parsed?.Chest_Open_Data;
    if (!chestOpenData || typeof chestOpenData !== 'object') {
        return { containers: [], warnings: ['No "Chest_Open_Data" found in this Edible Tools data.'] };
    }

    const players = Object.entries(chestOpenData).map(([id, playerData]) => ({
        id,
        name: playerData?.['玩家昵称'] || id,
    }));

    if (!playerId) {
        if (players.length > 1) {
            return { containers: [], warnings: [], needsPlayerSelection: true, players };
        }
        if (players.length === 0) {
            return { containers: [], warnings: ['No player data found in this Edible Tools data.'] };
        }
        playerId = players[0].id;
    }

    const playerData = chestOpenData[playerId];
    const chestData = playerData?.['开箱数据'];
    if (!chestData || typeof chestData !== 'object') {
        return { containers: [], warnings: [`No chest data found for ${playerData?.['玩家昵称'] || playerId}.`] };
    }

    const nameToHrid = buildItemNameToHridMap();
    const warnings = [];
    const containers = [];

    for (const [chestName, chest] of Object.entries(chestData)) {
        const containerHrid = nameToHrid[chestName.toLowerCase()];
        const containerCount = chest?.['总计开箱数量'];

        if (!containerHrid) {
            warnings.push(`Skipped "${chestName}": could not match to a known item.`);
            continue;
        }
        if (!(containerCount > 0)) {
            warnings.push(`Skipped ${chestName}: no openings recorded.`);
            continue;
        }

        const itemTotals = {};
        let unmatchedItemCount = 0;
        for (const [itemName, itemData] of Object.entries(chest?.['获得物品'] || {})) {
            const itemHrid = nameToHrid[itemName.toLowerCase()];
            if (!itemHrid) {
                unmatchedItemCount++;
                continue;
            }
            if (itemData?.['数量'] > 0) {
                itemTotals[itemHrid] = itemData['数量'];
            }
        }

        if (unmatchedItemCount > 0) {
            warnings.push(`${chestName}: ${unmatchedItemCount} gained item(s) could not be matched and were excluded.`);
        }

        // Do not let a warning-only path turn into a falsely precise imported Luck value: an
        // unmatched gained item means this container's Actual is only a subtotal of the real
        // source data, not the complete picture.
        containers.push({ containerHrid, containerCount, itemTotals, sourceDataComplete: unmatchedItemCount === 0 });
    }

    return { containers, warnings };
}
