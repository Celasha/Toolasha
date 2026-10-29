/**
 * Saved combat loadouts for the Metz Combat Simulator export
 *
 * Metz's importer reads an optional `loadouts` array on your own character (server/zoneImport.mjs
 * `loadoutsOf` in metzlii/metz-combat-simulator) and offers each loadout in a picker. The pure
 * builder below was written by Metz against that parser and adapted to repo style; its input is
 * Core Loadout State's resolved snapshots, so exact/highest enhancement semantics stay in Core.
 *
 * The "Import from Toolasha" button runs on the Metz site, where Loadout State is never populated
 * (it only listens on the game's WebSocket). So on the game page a small publisher stores the
 * built array in GM storage whenever loadout state changes, and the export reads it back there,
 * the same cross-domain route init_character_data already takes.
 */

import dataManager from '../../core/data-manager.js';
import loadoutState from '../../core/loadout-state.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const COMBAT_ACTION_TYPE = '/action_types/combat';
const TOOL_SLOT_PATTERN = /_tool$/;
const GM_LOADOUTS_KEY = 'toolasha_metz_loadouts';
const PUBLISH_DEBOUNCE_MS = 2000;

const timerRegistry = createTimerRegistry();
let publishTimeout = null;
let lastPublished = null;
let updateListener = null;

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const finiteOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const stringOr = (value, fallback) => (value == null || value === '' ? fallback : String(value));

function cleanTrigger(trigger) {
    if (!isObject(trigger) || !trigger.dependencyHrid || !trigger.conditionHrid || !trigger.comparatorHrid) {
        return null;
    }
    return {
        dependencyHrid: String(trigger.dependencyHrid),
        conditionHrid: String(trigger.conditionHrid),
        comparatorHrid: String(trigger.comparatorHrid),
        value: finiteOrNull(trigger.value) ?? 0,
    };
}

function cleanEquipment(list) {
    const equipment = [];
    for (const entry of Array.isArray(list) ? list : []) {
        if (!isObject(entry) || !entry.itemHrid) continue;
        const slot = stringOr(entry.itemLocationHrid, '');
        if (TOOL_SLOT_PATTERN.test(slot)) continue;
        if (entry.isAvailable === false) continue;
        // null: the character does not own it (Core's resolution), so it cannot be worn
        const level = finiteOrNull(entry.enhancementLevel);
        if (level === null) continue;
        equipment.push({
            itemLocationHrid: slot,
            itemHrid: String(entry.itemHrid),
            enhancementLevel: Math.max(0, Math.floor(level)),
        });
    }
    return equipment;
}

function cleanAbilities(list, abilityLevels) {
    const rows = (Array.isArray(list) ? list : [])
        .filter((ability) => isObject(ability) && ability.abilityHrid)
        .map((ability, index) => ({
            hrid: String(ability.abilityHrid),
            slot: finiteOrNull(ability.slot) ?? Number.MAX_SAFE_INTEGER,
            index,
        }))
        .sort((a, b) => a.slot - b.slot || a.index - b.index);

    const abilities = [];
    const seen = new Set();
    for (const { hrid } of rows) {
        if (seen.has(hrid)) continue;
        seen.add(hrid);
        const level = finiteOrNull(isObject(abilityLevels) ? abilityLevels[hrid] : null);
        abilities.push({ abilityHrid: hrid, level: level !== null && level >= 1 ? Math.floor(level) : 1 });
    }
    return abilities;
}

function cleanConsumables(list) {
    const consumables = [];
    const seen = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
        const hrid = isObject(entry) ? entry.itemHrid : typeof entry === 'string' ? entry : '';
        if (!hrid || seen.has(hrid)) continue;
        seen.add(hrid);
        consumables.push({ itemHrid: String(hrid) });
    }
    return consumables;
}

function triggersFor(map, hrid) {
    // null is the game's "activate whenever ready". The site needs it said: a hrid the map omits
    // gets the ability's default triggers instead, and Core drops null lists before we get here.
    return Array.isArray(map[hrid]) ? map[hrid].map(cleanTrigger).filter(Boolean) : null;
}

/**
 * Build the `loadouts` array Metz's importer accepts from resolved loadout snapshots.
 * Combat loadouts only, ordered by `ordinal`; tool slots and unowned gear are left out; a loadout
 * with no gear and no abilities is left out. `triggerMap` holds exactly the hrids the loadout carries.
 * @param {Array<Object>} snapshots - Resolved snapshots from loadoutState
 * @param {Object<string, number>} [abilityLevels] - Learned ability levels by hrid
 * @returns {Array<Object>}
 */
export function buildMetzLoadouts(snapshots, abilityLevels = {}) {
    const combat = (Array.isArray(snapshots) ? snapshots : [])
        .map((snapshot, index) => ({ snapshot, index }))
        .filter(({ snapshot }) => isObject(snapshot) && snapshot.actionTypeHrid === COMBAT_ACTION_TYPE)
        .sort(
            (a, b) =>
                (finiteOrNull(a.snapshot.ordinal) ?? Number.MAX_SAFE_INTEGER) -
                    (finiteOrNull(b.snapshot.ordinal) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index
        );

    const loadouts = [];
    for (const { snapshot } of combat) {
        const equipment = cleanEquipment(snapshot.equipment);
        const abilities = cleanAbilities(snapshot.abilities, abilityLevels);
        if (!equipment.length && !abilities.length) continue;

        const food = cleanConsumables(snapshot.food);
        const drinks = cleanConsumables(snapshot.drinks);
        const abilityMap = isObject(snapshot.abilityCombatTriggersMap) ? snapshot.abilityCombatTriggersMap : {};
        const consumableMap = isObject(snapshot.consumableCombatTriggersMap)
            ? snapshot.consumableCombatTriggersMap
            : {};

        const triggerMap = {};
        for (const ability of abilities) {
            triggerMap[ability.abilityHrid] = triggersFor(abilityMap, ability.abilityHrid);
        }
        for (const consumable of [...food, ...drinks]) {
            triggerMap[consumable.itemHrid] = triggersFor(consumableMap, consumable.itemHrid);
        }

        loadouts.push({
            id: stringOr(snapshot.snapshotId, String(loadouts.length + 1)),
            name: stringOr(snapshot.name, `Loadout ${loadouts.length + 1}`),
            equipment,
            abilities,
            food,
            drinks,
            triggerMap,
        });
    }
    return loadouts;
}

/**
 * Build the loadouts from the live Core Loadout State (game page only). Loadouts that need gear
 * the character no longer owns are skipped, since the sim would otherwise rate a set the
 * character cannot actually equip.
 * @returns {Array<Object>}
 */
export function collectMetzLoadouts() {
    const snapshots = loadoutState.getAllSnapshots().filter((snapshot) => snapshot.isUsableForCalculation);
    if (!snapshots.length) {
        return [];
    }

    const abilityLevels = {};
    for (const ability of dataManager.characterData?.characterAbilities || []) {
        if (ability?.abilityHrid) abilityLevels[ability.abilityHrid] = ability.level || 1;
    }
    return buildMetzLoadouts(snapshots, abilityLevels);
}

function publish() {
    if (typeof GM_setValue === 'undefined') {
        return;
    }
    try {
        const characterId = dataManager.getCurrentCharacterId?.() ?? null;
        const serialized = JSON.stringify({ characterId, loadouts: collectMetzLoadouts() });
        if (serialized === lastPublished) {
            return;
        }
        GM_setValue(GM_LOADOUTS_KEY, serialized);
        lastPublished = serialized;
    } catch (error) {
        console.error('[MetzLoadouts] Failed to publish loadouts:', error);
    }
}

function schedulePublish() {
    if (publishTimeout) {
        return;
    }
    publishTimeout = setTimeout(() => {
        publishTimeout = null;
        publish();
    }, PUBLISH_DEBOUNCE_MS);
    timerRegistry.registerTimeout(publishTimeout);
}

/**
 * Game page only: keep the GM-stored copy of the loadouts current so the Metz site can read it.
 */
export function startMetzLoadoutPublisher() {
    stopMetzLoadoutPublisher();
    updateListener = () => schedulePublish();
    loadoutState.onUpdate(updateListener);
    schedulePublish();
}

export function stopMetzLoadoutPublisher() {
    if (updateListener) {
        loadoutState.offUpdate(updateListener);
        updateListener = null;
    }
    timerRegistry.clearAll();
    publishTimeout = null;
    lastPublished = null;
}

/**
 * Loadouts for the export: live on the game page, otherwise the GM-stored copy (the Metz site).
 * The stored copy is used only when it belongs to the character being exported.
 * @param {string|number|null} characterId - Character being exported
 * @returns {Array<Object>}
 */
export function getMetzLoadouts(characterId) {
    const live = collectMetzLoadouts();
    if (live.length) {
        return live;
    }
    if (typeof GM_getValue === 'undefined') {
        return [];
    }
    try {
        const raw = GM_getValue(GM_LOADOUTS_KEY, null);
        const stored = raw ? JSON.parse(raw) : null;
        if (stored && Array.isArray(stored.loadouts) && String(stored.characterId) === String(characterId)) {
            return stored.loadouts;
        }
    } catch (error) {
        console.error('[MetzLoadouts] Failed to read stored loadouts:', error);
    }
    return [];
}
