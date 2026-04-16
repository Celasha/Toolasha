/**
 * Character Card Button
 * Provides View Card functionality that opens character sheet in new tab.
 * The button itself is rendered in the combat score panel template (combat-score.js).
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { buildCharacterSheetLink } from './character-sheet.js';
import { calculateCombatScore } from './score-calculator.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';

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
 * Handle View Card click using a saved loadout snapshot for equipment/abilities/food.
 * Skills, housing, achievements, and cosmetics are always taken from live character data.
 * @param {string} snapshotName - Name of the loadout snapshot to use
 */
export async function handleViewCardFromSnapshot(snapshotName) {
    try {
        const clientData = dataManager.getInitClientData();
        const characterData = dataManager.characterData;

        if (!characterData) {
            console.error('[CharacterCardButton] No character data available');
            return;
        }

        const snapshot = loadoutSnapshot.getAllSnapshots().find((s) => s.name === snapshotName);
        if (!snapshot) {
            console.error('[CharacterCardButton] Snapshot not found:', snapshotName);
            return;
        }

        // Build wearableItemMap: cosmetic slots from characterItems + combat equipment from snapshot
        const wearableItemMap = {};
        const COSMETIC_LOCATIONS = new Set([
            '/item_locations/avatar',
            '/item_locations/outfit',
            '/item_locations/chat_icon',
        ]);
        for (const item of characterData.characterItems || []) {
            if (COSMETIC_LOCATIONS.has(item.itemLocationHrid)) {
                wearableItemMap[item.itemLocationHrid] = {
                    itemLocationHrid: item.itemLocationHrid,
                    itemHrid: item.itemHrid,
                    enhancementLevel: item.enhancementLevel || 0,
                };
            }
        }
        for (const equip of snapshot.equipment) {
            wearableItemMap[equip.itemLocationHrid] = {
                itemLocationHrid: equip.itemLocationHrid,
                itemHrid: equip.itemHrid,
                enhancementLevel: equip.enhancementLevel || 0,
            };
        }

        // Build ability level lookup from current character data (levels are character-scoped, not loadout-scoped)
        const abilityLevelMap = {};
        for (const ab of characterData.combatUnit?.combatAbilities || []) {
            if (ab.abilityHrid) abilityLevelMap[ab.abilityHrid] = ab.level || 1;
        }

        // Map snapshot abilities to the format buildSegmentsFromCharacterData expects
        const equippedAbilities = snapshot.abilities.map((ab) => ({
            abilityHrid: ab.abilityHrid,
            level: abilityLevelMap[ab.abilityHrid] || 1,
        }));

        // Build food/drink consumables in the format formatFoodData expects
        const consumablesData = {
            actionTypeFoodSlotsMap: {
                '/action_types/combat': snapshot.food.map((f) => (f.itemHrid ? { itemHrid: f.itemHrid } : null)),
            },
            actionTypeDrinkSlotsMap: {
                '/action_types/combat': snapshot.drinks.map((d) => (d.itemHrid ? { itemHrid: d.itemHrid } : null)),
            },
        };

        // Synthetic character data: base character with snapshot overrides for equipment and abilities.
        // Setting characterItems to undefined forces buildSegmentsFromCharacterData to use wearableItemMap.
        const syntheticCharacterData = {
            ...characterData,
            wearableItemMap,
            equippedAbilities,
            characterItems: undefined,
        };

        // Calculate combat score using snapshot equipment
        let combatScore = null;
        try {
            const scoreResult = await calculateCombatScore({ profile: syntheticCharacterData });
            combatScore = scoreResult?.total || null;
        } catch (error) {
            console.warn('[CharacterCardButton] Failed to calculate combat score for snapshot:', error);
        }

        const url = buildCharacterSheetLink(
            null,
            'https://tib-san.gitlab.io/mwi-character-sheet/',
            syntheticCharacterData,
            clientData,
            consumablesData,
            combatScore
        );

        window.open(url, '_blank');
    } catch (error) {
        console.error('[CharacterCardButton] Failed to open character card from snapshot:', error);
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
