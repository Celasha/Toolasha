/**
 * Equipment Domain Classifier
 *
 * Classifies an equipped item into Combat/Skiller domains using its actual
 * `combatStats`/`noncombatStats` data, not skill-requirement names. Verified against the live
 * Game Reference: 532 equipment items split 344 combat-only / 177 skilling-only / 11 both / 0
 * neither under this exact rule.
 */

/**
 * @param {Object} statsObj - combatStats or noncombatStats object
 * @returns {boolean} true if at least one key has a non-zero numeric value
 */
function hasMeaningfulStats(statsObj) {
    if (!statsObj) return false;
    return Object.values(statsObj).some((v) => typeof v === 'number' && v !== 0);
}

/**
 * @param {Object} equipmentDetail - itemDetails.equipmentDetail
 * @returns {{combat: boolean, skiller: boolean}}
 */
export function classifyEquipmentItem(equipmentDetail) {
    return {
        combat: hasMeaningfulStats(equipmentDetail?.combatStats),
        skiller: hasMeaningfulStats(equipmentDetail?.noncombatStats),
    };
}
