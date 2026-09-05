/**
 * House Score (TLA-041)
 *
 * Combat/Skiller House investment, derived from `usableInActionTypeMap` (PB-08) rather than a
 * hardcoded room-name list, priced with pure Ask (F-10).
 */

import { calculateHousesCostByDomain } from '../../../utils/house-cost-calculator.js';
import { emptyCategory, attribute } from './score-result.js';

/**
 * @param {Object} profileData - Profile data from game
 * @returns {{combat: Object, skiller: Object}}
 */
export function calculateHouseScore(profileData) {
    const characterHouseRooms = profileData.profile?.characterHouseRoomMap || {};

    const combat = emptyCategory();
    const skiller = emptyCategory();

    for (const [domain, category] of [
        ['combat', combat],
        ['skilling', skiller],
    ]) {
        const { complete, breakdown } = calculateHousesCostByDomain(characterHouseRooms, domain);
        for (const house of breakdown) {
            attribute(category, { name: `${house.name} ${house.level}`, cost: house.cost, complete: true });
        }
        category.complete = complete;
    }

    return { combat, skiller };
}
