/**
 * Openable Analytics Import Parsers
 * Parses pasted/uploaded historical container-opening data from other tools into the same
 * `{containerHrid, containerCount, itemTotals}` shape the data collector's live tracking uses,
 * so recomputation always goes through Toolasha's own pricing/EV stack rather than trusting a
 * source tool's own stored numbers.
 *
 * Historical import is a baseline/migration feature, not a synchronization engine: supported
 * external exports are cumulative totals with no reliable per-opening identities/timestamps, so
 * Toolasha cannot prove a newer import doesn't already include live-tracked openings, or that two
 * imported sources don't cover the same historical period. Same-source replacement only prevents
 * stacking two old snapshots of the same source - it does not prove no overlap with anything else.
 */

import dataManager from '../../../core/data-manager.js';
import { shouldTrackImportedOpenable } from './openable-analytics-eligibility.js';

const ITEM_HRID_PATTERN = /^\/items\/[a-z0-9_]+$/;

/**
 * @param {*} value
 * @returns {boolean} True only for a real, non-negative, finite safe-integer count - never a
 *      coerced string, negative, fractional, or unsafe number.
 */
function isValidCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {*} value
 * @returns {boolean} True for a plain object (map-like), explicitly excluding arrays and null -
 *      import sources describe maps, and an array in that position is a malformed export.
 */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
 * Detect which supported import format a pasted/uploaded text matches, from its validated JSON
 * shape alone - the source-select dropdown is intentionally removed (section 16).
 * @param {string} rawText
 * @returns {{source: 'edible'|'mwi-combat-suite'|null, error?: string}}
 */
export function detectImportSource(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return { source: null, error: 'Could not parse this text as JSON.' };
    }

    if (!isPlainObject(parsed)) {
        return { source: null, error: 'This does not look like a supported export.' };
    }

    const hasCombatSuiteShape = isPlainObject(parsed.chests);
    const hasEdibleShape = isPlainObject(parsed.Chest_Open_Data);

    if (hasCombatSuiteShape && hasEdibleShape) {
        return { source: null, error: 'This data matches more than one supported format and cannot be imported.' };
    }
    if (hasCombatSuiteShape) return { source: 'mwi-combat-suite' };
    if (hasEdibleShape) return { source: 'edible' };
    return { source: null, error: 'This does not match a supported Edible Tools or MWI Combat Suite export.' };
}

/**
 * Parse an MWI Combat Suite export (a downloaded/pasted JSON file, already HRID-keyed). Only
 * cumulative `total.opened` / `total.loot` counts are read - the source's own
 * actualValue/expectedValue/luck fields are intentionally ignored so the import is recomputed
 * under Toolasha's own valuation.
 * @param {string} rawText - Raw JSON text (file contents or pasted text)
 * @returns {{status: 'invalid'|'empty'|'ready', message?: string, containers: Array, warnings: Array<string>, ownerName: string|null, ownerMismatch: boolean|null}}
 */
export function parseCombatSuiteExport(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return invalidResult('Could not parse the pasted/uploaded text as JSON.');
    }

    const chests = parsed?.chests;
    if (!isPlainObject(chests)) {
        return invalidResult('No "chests" data found in this export.');
    }

    const ownerName = typeof parsed?.player === 'string' ? parsed.player : null;
    const currentCharacterName = dataManager.getCurrentCharacterName?.() ?? null;
    const ownerMismatch = ownerName === null ? null : ownerName !== currentCharacterName;

    const warnings = [];
    const containers = [];

    for (const [containerHrid, chest] of Object.entries(chests)) {
        if (!ITEM_HRID_PATTERN.test(containerHrid)) {
            warnings.push(`Skipped an entry with an invalid item id: "${containerHrid}".`);
            continue;
        }

        const containerCount = chest?.total?.opened;
        if (containerCount === undefined || containerCount === 0) {
            continue; // no openings recorded - silently ignored, not a warning
        }
        if (!isValidCount(containerCount) || containerCount === 0) {
            warnings.push(`Skipped ${chest?.name || containerHrid}: invalid opened count.`);
            continue;
        }

        // Distinguish a missing/malformed loot block (corrupted data) from an explicitly present
        // empty one (a real record of "opened N times, gained nothing"). Importing the former as
        // if it were the latter would silently fabricate Actual 0 / a huge Expected / Luck -100%.
        const total = chest?.total || {};
        if (!('loot' in total)) {
            warnings.push(`Skipped ${chest?.name || containerHrid}: opening count present but loot data is missing.`);
            continue;
        }
        if (!isPlainObject(total.loot)) {
            warnings.push(`Skipped ${chest?.name || containerHrid}: loot data is malformed.`);
            continue;
        }

        const itemTotals = {};
        let hadInvalidItem = false;
        for (const [itemHrid, item] of Object.entries(total.loot)) {
            if (!ITEM_HRID_PATTERN.test(itemHrid)) {
                hadInvalidItem = true;
                continue;
            }
            const count = item?.count;
            if (count === undefined || count === 0) continue; // zero/absent - silently ignored
            if (!isValidCount(count)) {
                hadInvalidItem = true;
                continue;
            }
            itemTotals[itemHrid] = count;
        }

        if (hadInvalidItem) {
            warnings.push(
                `${chest?.name || containerHrid}: one or more gained items had invalid data and were excluded.`
            );
        }

        if (!shouldTrackImportedOpenable(containerHrid, containerCount, itemTotals)) continue;

        // MWI Combat Suite is already HRID-keyed and validated above, so nothing here is dropped
        // for being unresolvable - this source's Actual is only marked partial when validation
        // itself excluded something.
        containers.push({ containerHrid, containerCount, itemTotals, sourceDataComplete: !hadInvalidItem });
    }

    if (containers.length === 0) {
        return { ...emptyResult(), warnings, ownerName, ownerMismatch };
    }

    return { status: 'ready', containers, warnings, ownerName, ownerMismatch };
}

/**
 * Parse an Edible Tools `Edible_Tools` localStorage value (pasted as text, or read directly from
 * `localStorage.getItem('Edible_Tools')` when same-origin). Edible only retains cumulative totals
 * per chest, keyed by localized display name rather than HRID, so this resolves names against the
 * current game's item list and reports anything it can't match rather than silently dropping it.
 * @param {string} rawText - Raw JSON text
 * @param {Object} [options]
 * @param {string} [options.playerId] - Which player's data to import, if the export has more than one
 * @returns {{status: 'invalid'|'empty'|'ready', message?: string, containers: Array, warnings: Array<string>, needsPlayerSelection?: boolean, players?: Array<{id: string, name: string}>}}
 */
export function parseEdibleExport(rawText, { playerId } = {}) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return invalidResult('Could not parse the pasted text as JSON.');
    }

    const chestOpenData = parsed?.Chest_Open_Data;
    if (!isPlainObject(chestOpenData)) {
        return invalidResult('No "Chest_Open_Data" found in this Edible Tools data.');
    }

    const players = Object.entries(chestOpenData).map(([id, playerData]) => ({
        id,
        name: playerData?.['玩家昵称'] || id,
    }));

    if (!playerId) {
        if (players.length === 0) {
            return invalidResult('No player data found in this Edible Tools data.');
        }
        if (players.length === 1) {
            playerId = players[0].id;
        } else {
            // Never silently guess among multiple players: try an exact current-character-ID key
            // match, then a unique exact current-character-name match, before asking explicitly.
            const currentCharacterId = dataManager.getCurrentCharacterId?.() ?? null;
            const currentCharacterName = dataManager.getCurrentCharacterName?.() ?? null;

            if (currentCharacterId && chestOpenData[String(currentCharacterId)]) {
                playerId = String(currentCharacterId);
            } else if (currentCharacterName) {
                const nameMatches = players.filter((player) => player.name === currentCharacterName);
                if (nameMatches.length === 1) {
                    playerId = nameMatches[0].id;
                }
            }

            if (!playerId) {
                return { status: 'empty', containers: [], warnings: [], needsPlayerSelection: true, players };
            }
        }
    }

    const playerData = chestOpenData[playerId];
    const chestData = playerData?.['开箱数据'];
    if (!isPlainObject(chestData)) {
        return invalidResult(`No chest data found for ${playerData?.['玩家昵称'] || playerId}.`);
    }

    // Same ownership preflight contract as parseCombatSuiteExport: the strongest available
    // evidence is an exact resolved-player-ID match, then an exact nickname/character-name
    // match, then explicit unknown - never a silent omission that skips the mismatch warning.
    const ownerName = typeof playerData?.['玩家昵称'] === 'string' ? playerData['玩家昵称'] : null;
    const currentCharacterId = dataManager.getCurrentCharacterId?.() ?? null;
    const currentCharacterName = dataManager.getCurrentCharacterName?.() ?? null;
    let ownerMismatch;
    if (currentCharacterId !== null && String(playerId) === String(currentCharacterId)) {
        ownerMismatch = false;
    } else if (ownerName && currentCharacterName) {
        ownerMismatch = ownerName !== currentCharacterName;
    } else {
        ownerMismatch = null;
    }

    const nameToHrid = buildItemNameToHridMap();
    const warnings = [];
    const containers = [];
    let anyChestNameResolved = false;

    for (const [chestName, chest] of Object.entries(chestData)) {
        const containerHrid = nameToHrid[chestName.toLowerCase()];

        if (!containerHrid) {
            warnings.push(`Skipped "${chestName}": could not match to a known item.`);
            continue;
        }
        anyChestNameResolved = true;

        const containerCount = chest?.['总计开箱数量'];
        if (containerCount === undefined || containerCount === 0) {
            continue; // no openings recorded - silently ignored, not a warning
        }
        if (!isValidCount(containerCount)) {
            warnings.push(`Skipped ${chestName}: invalid opened count.`);
            continue;
        }

        if (!('获得物品' in (chest || {}))) {
            warnings.push(`Skipped ${chestName}: opening count present but gained-item data is missing.`);
            continue;
        }
        if (!isPlainObject(chest['获得物品'])) {
            warnings.push(`Skipped ${chestName}: gained-item data is malformed.`);
            continue;
        }

        const itemTotals = {};
        let unmatchedItemCount = 0;
        let hadInvalidCount = false;
        for (const [itemName, itemData] of Object.entries(chest['获得物品'])) {
            const itemHrid = nameToHrid[itemName.toLowerCase()];
            if (!itemHrid) {
                unmatchedItemCount++;
                continue;
            }
            const count = itemData?.['数量'];
            if (count === undefined || count === 0) continue;
            if (!isValidCount(count)) {
                hadInvalidCount = true;
                continue;
            }
            itemTotals[itemHrid] = count;
        }

        if (unmatchedItemCount > 0) {
            warnings.push(`${chestName}: ${unmatchedItemCount} gained item(s) could not be matched and were excluded.`);
        }
        if (hadInvalidCount) {
            warnings.push(`${chestName}: one or more gained items had invalid counts and were excluded.`);
        }

        if (!shouldTrackImportedOpenable(containerHrid, containerCount, itemTotals)) continue;

        // Do not let a warning-only path turn into a falsely precise imported Luck value: an
        // unmatched/invalid gained item means this container's Actual is only a subtotal of the
        // real source data, not the complete picture.
        containers.push({
            containerHrid,
            containerCount,
            itemTotals,
            sourceDataComplete: unmatchedItemCount === 0 && !hadInvalidCount,
        });
    }

    // Edible is name-keyed/localized. If nothing at all could be resolved, this isn't legitimate
    // valid-empty history - it's a locale/format the current item list can't match against.
    if (!anyChestNameResolved && Object.keys(chestData).length > 0) {
        return { ...invalidResult('None of the chest names in this export could be matched to a known item.') };
    }

    if (containers.length === 0) {
        return { ...emptyResult(), warnings, ownerName, ownerMismatch };
    }

    return { status: 'ready', containers, warnings, ownerName, ownerMismatch };
}

function invalidResult(message) {
    return { status: 'invalid', message, containers: [], warnings: [] };
}

function emptyResult() {
    return {
        status: 'empty',
        message: 'No opening history found in this export. Existing import was not changed.',
        containers: [],
        warnings: [],
    };
}
