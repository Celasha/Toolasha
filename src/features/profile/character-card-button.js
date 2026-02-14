/**
 * Character Card Button
 * Provides View Card functionality that opens character sheet in new tab.
 * The button itself is rendered in the combat score panel template (combat-score.js).
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { buildCharacterSheetLink } from './character-sheet.js';
import { calculateCombatScore } from './score-calculator.js';

/**
 * Convert combatConsumables array to actionTypeFoodSlotsMap/actionTypeDrinkSlotsMap format
 * @param {Array} combatConsumables - Array of consumable items from profile data
 * @param {Object} clientData - Init client data for item type lookups
 * @returns {Object} Object with actionTypeFoodSlotsMap and actionTypeDrinkSlotsMap
 */
function convertCombatConsumablesToSlots(combatConsumables, clientData) {
    const foodSlots = [];
    const drinkSlots = [];

    // Separate food and drinks (matching combat sim logic)
    combatConsumables.forEach((consumable) => {
        const itemHrid = consumable.itemHrid;

        // Check if it's a drink
        const isDrink =
            itemHrid.includes('coffee') ||
            itemHrid.includes('tea') ||
            clientData?.itemDetailMap?.[itemHrid]?.tags?.includes('drink');

        if (isDrink && drinkSlots.length < 3) {
            drinkSlots.push({ itemHrid });
        } else if (!isDrink && foodSlots.length < 3) {
            foodSlots.push({ itemHrid });
        }
    });

    // Pad to 4 slots (3 used + 1 null)
    while (foodSlots.length < 4) foodSlots.push(null);
    while (drinkSlots.length < 4) drinkSlots.push(null);

    return {
        actionTypeFoodSlotsMap: {
            '/action_types/combat': foodSlots,
        },
        actionTypeDrinkSlotsMap: {
            '/action_types/combat': drinkSlots,
        },
    };
}

/**
 * Handle View Card button click - opens character sheet in new tab
 * @param {Object} profileData - Profile data from WebSocket (profile_shared event)
 */
export async function handleViewCardClick(profileData) {
    try {
        const clientData = dataManager.getInitClientData();

        // Determine if viewing own profile or someone else's
        let characterData = null;

        // If we have profile data from profile_shared event, use it (other player)
        if (profileData?.profile) {
            characterData = profileData.profile;
        }
        // Otherwise use own character data from dataManager
        else {
            characterData = dataManager.characterData;
        }

        if (!characterData) {
            console.error('[CharacterCardButton] No character data available');
            return;
        }

        // Determine consumables data source
        let consumablesData = null;

        // If viewing own profile, use own character data (has actionTypeFoodSlotsMap/actionTypeDrinkSlotsMap)
        if (!profileData?.profile) {
            consumablesData = dataManager.characterData;
        }
        // If viewing other player, check if they have combatConsumables (only visible in party)
        else if (characterData.combatConsumables && characterData.combatConsumables.length > 0) {
            // Convert combatConsumables array to expected format
            consumablesData = convertCombatConsumablesToSlots(characterData.combatConsumables, clientData);
        }
        // Otherwise leave consumables empty (can't see other player's consumables outside party)

        // Find the profile modal for fallback
        const _modal = document.querySelector('.SharableProfile_modal__2OmCQ');

        // Calculate combat score
        let combatScore = null;
        try {
            const scoreResult = await calculateCombatScore(profileData || { profile: characterData });
            combatScore = scoreResult?.total || null;
        } catch (error) {
            console.warn('[CharacterCardButton] Failed to calculate combat score:', error);
        }

        // Build character sheet link using cached data (preferred) or DOM fallback
        const url = buildCharacterSheetLink(
            _modal,
            'https://tib-san.gitlab.io/mwi-character-sheet/',
            characterData,
            clientData,
            consumablesData,
            combatScore
        );

        // Open in new tab
        window.open(url, '_blank');
    } catch (error) {
        console.error('[CharacterCardButton] Failed to open character card:', error);
    }
}

/**
 * CharacterCardButton class - minimal feature registry interface.
 * The View Card button is now rendered directly in the combat score panel template.
 */
class CharacterCardButton {
    constructor() {
        this.isActive = false;
        this.isInitialized = false;
    }

    /**
     * Setup settings listeners for color changes
     */
    setupSettingListener() {
        config.onSettingChange('characterCard', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });

        config.onSettingChange('color_accent', () => {
            if (this.isInitialized) {
                this.refresh();
            }
        });
    }

    /**
     * Initialize character card button feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('characterCard')) {
            return;
        }

        this.isInitialized = true;
        this.isActive = true;
    }

    /**
     * Refresh colors on existing button
     */
    refresh() {
        const button = document.getElementById('mwi-character-card-btn');
        if (button) {
            button.style.background = config.COLOR_ACCENT;
        }
    }

    /**
     * Disable the feature
     */
    disable() {
        // Remove button from DOM if present
        const button = document.getElementById('mwi-character-card-btn');
        if (button) {
            button.remove();
        }

        this.isActive = false;
        this.isInitialized = false;
    }
}

const characterCardButton = new CharacterCardButton();
characterCardButton.setupSettingListener();

export default characterCardButton;
