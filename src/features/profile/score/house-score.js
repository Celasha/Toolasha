/**
 * House Score (TLA-041 / TLA-041C)
 *
 * Combat/Skiller House investment, derived from `usableInActionTypeMap` (PB-08) rather than a
 * hardcoded room-name list, priced with pure Ask (F-10). Room-level completeness is preserved per
 * leaf (LB-04/LB-05) rather than only at the aggregate category level.
 */

import dataManager from '../../../core/data-manager.js';
import { calculateHousesCostByDomain } from '../../../utils/house-cost-calculator.js';
import { emptyCategory, attribute } from './score-result.js';
import { getHouseRoomName } from '../../../utils/game-i18n.js';

/**
 * @param {Object} profileData - Profile data from game
 * @returns {{combat: Object, skiller: Object}}
 */
export function calculateHouseScore(profileData) {
    const characterHouseRooms = profileData.profile?.characterHouseRoomMap || {};

    // calculateHousesCostByDomain() returns English room names without HRIDs, so rebuild a
    // name -> HRID index to localize each breakdown leaf at this display boundary.
    const houseRoomDetailMap = dataManager.getInitClientData()?.houseRoomDetailMap || {};
    const roomHridByEnglishName = new Map(
        Object.entries(houseRoomDetailMap).map(([hrid, detail]) => [detail.name, hrid])
    );

    const combat = emptyCategory();
    const skiller = emptyCategory();

    for (const [domain, category] of [
        ['combat', combat],
        ['skilling', skiller],
    ]) {
        const { complete, breakdown } = calculateHousesCostByDomain(characterHouseRooms, domain);
        for (const house of breakdown) {
            const roomHrid = roomHridByEnglishName.get(house.name) || null;
            attribute(category, {
                name: `${getHouseRoomName(roomHrid, house.name)} ${house.level}`,
                cost: house.cost,
                complete: house.complete,
                isOutlier: house.isOutlier,
            });
        }
        // Fail-closed guard: an aggregate-level incompleteness with no representable room leaf
        // (e.g. missing upgradeCostsMap entirely) still marks the category incomplete.
        category.complete = category.complete && complete;
    }

    return { combat, skiller };
}
