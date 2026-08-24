/**
 * Stateless helpers for Lab Simulator skilling loadout selections.
 * LoadoutState remains the sole owner of saved-loadout semantics; these helpers consume
 * only already-resolved/usable snapshots.
 */

/**
 * Preserve the semantic identity of a native Labyrinth loadout assignment even when the
 * referenced saved loadout no longer exists or cannot currently be resolved. Returning an
 * empty string is reserved for an explicit Current Gear assignment.
 *
 * @param {string|number|null|undefined} loadoutId
 * @param {(id: string|number) => Object|null} getSnapshotById
 * @returns {string}
 */
export function resolveConfiguredLoadoutName(loadoutId, getSnapshotById) {
    if (!loadoutId) return '';
    const snapshot = getSnapshotById(loadoutId);
    return snapshot?.name || `Saved loadout #${loadoutId}`;
}

/**
 * Sanitize persisted assignment value types without changing the meaning of a user selection.
 * A named loadout that is currently unavailable/missing must remain selected so callers can
 * surface that state and fail closed. Silently rewriting it to Current Gear would turn a
 * manual/persistent selection into a different simulation configuration.
 *
 * @param {Object<string, unknown>} assignments
 * @param {Array<string>} skillHrids
 * @returns {{ assignments: Object<string, string>, changed: boolean }}
 */
export function sanitizeSkillLoadoutAssignments(assignments, skillHrids) {
    const next = { ...(assignments || {}) };
    let changed = false;

    for (const skillHrid of skillHrids || []) {
        if (!Object.prototype.hasOwnProperty.call(next, skillHrid)) continue;
        const selectedName = next[skillHrid];
        if (typeof selectedName !== 'string') {
            next[skillHrid] = '';
            changed = true;
        }
    }

    return { assignments: next, changed };
}

/**
 * Convert explicit Lab Simulator skilling loadout selections into simulator equipment maps.
 * A valid loadout with zero equipment produces an empty object so the simulator does not
 * accidentally fall back to the editor's current gear. A selected loadout that has become
 * unavailable is reported explicitly so callers can fail closed rather than silently switch gear.
 *
 * @param {Object<string, string>} assignments
 * @param {Object} itemDetailMap
 * @param {(name: string) => Object|null} getUsableSnapshotByName
 * @returns {{ equipmentMap: Object, unavailableSelections: Array<{skillHrid: string, loadoutName: string}> }}
 */
export function buildSkillEquipmentResolution(assignments, itemDetailMap, getUsableSnapshotByName) {
    const equipmentMap = {};
    const unavailableSelections = [];

    for (const [skillHrid, loadoutName] of Object.entries(assignments || {})) {
        if (!loadoutName) continue;

        const snapshot = getUsableSnapshotByName(loadoutName);
        if (!snapshot) {
            unavailableSelections.push({ skillHrid, loadoutName });
            continue;
        }

        const equipment = {};
        let hasInvalidResolvedEquipment = false;
        for (const equip of snapshot.equipment || []) {
            // A usable Core snapshot is contractually numeric. Keep the consumer boundary
            // fail-closed too so a future resolver regression cannot become simulator +0/NaN.
            if (!equip?.itemHrid || !Number.isFinite(equip.enhancementLevel)) {
                hasInvalidResolvedEquipment = true;
                break;
            }
            const itemDetail = itemDetailMap?.[equip.itemHrid];
            const equipType = itemDetail?.equipmentDetail?.type;
            if (!equipType) {
                hasInvalidResolvedEquipment = true;
                break;
            }
            equipment[equipType] = {
                hrid: equip.itemHrid,
                enhancementLevel: equip.enhancementLevel,
            };
        }
        if (hasInvalidResolvedEquipment) {
            unavailableSelections.push({ skillHrid, loadoutName });
            continue;
        }

        // Deliberately retain `{}` for a valid empty-equipment loadout. In the simulation
        // pipeline an absent key means "use current editor gear", while an empty object means
        // "this saved loadout intentionally equips nothing".
        equipmentMap[skillHrid] = equipment;
    }

    return { equipmentMap, unavailableSelections };
}
