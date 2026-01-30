/**
 * Buff Parser Utilities
 * Parse active buffs from character data
 */

import dataManager from '../core/data-manager.js';

/**
 * Get alchemy success rate bonus from active buffs
 * @returns {number} Alchemy success rate bonus (0-1, e.g., 0.087 for 8.7% multiplicative bonus)
 */
export function getAlchemySuccessBonus() {
    try {
        const characterData = dataManager.characterData;
        if (!characterData || !characterData.consumableActionTypeBuffsMap) {
            return 0;
        }

        const alchemyBuffs = characterData.consumableActionTypeBuffsMap['/action_types/alchemy'];
        if (!Array.isArray(alchemyBuffs)) {
            return 0;
        }

        let bonus = 0;
        for (const buff of alchemyBuffs) {
            if (buff.typeHrid === '/buff_types/alchemy_success') {
                // ratioBoost is already scaled with drink concentration by the game
                bonus += buff.ratioBoost || 0;
            }
        }

        return bonus;
    } catch (error) {
        console.error('[BuffParser] Failed to get alchemy success bonus:', error);
        return 0;
    }
}
