/**
 * Character Card Button
 * Adds a "View Card" button to profile view that opens character sheet in new tab
 */

import config from '../../core/config.js';
import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import { buildCharacterSheetLink } from './character-sheet.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * CharacterCardButton class manages character card export button on profiles
 */
class CharacterCardButton {
    constructor() {
        this.isActive = false;
        this.isInitialized = false;
        this.currentProfileData = null; // Store profile data for food/drinks
        this.profileSharedHandler = null; // Store handler reference for cleanup
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Setup settings listeners for feature toggle and color changes
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
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('characterCard')) {
            return;
        }

        this.isInitialized = true;

        this.profileSharedHandler = (data) => {
            this.handleProfileShared(data);
        };

        // Listen for profile_shared WebSocket messages
        webSocketHook.on('profile_shared', this.profileSharedHandler);

        this.isActive = true;
    }

    /**
     * Handle profile_shared WebSocket message
     * @param {Object} profileData - Profile data from WebSocket
     */
    async handleProfileShared(profileData) {
        // Store profile data for food/drinks extraction
        this.currentProfileData = profileData;

        // Wait for profile panel to appear in DOM
        const profilePanel = await this.waitForProfilePanel();
        if (!profilePanel) {
            console.error('[CharacterCardButton] Could not find profile panel');
            return;
        }

        // Inject the character card button
        this.injectButton(profilePanel);
    }

    /**
     * Wait for profile panel to appear in DOM
     * @returns {Promise<Element|null>} Profile panel element or null if timeout
     */
    async waitForProfilePanel() {
        for (let i = 0; i < 20; i++) {
            const panel = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
            if (panel) {
                return panel;
            }
            await new Promise((resolve) => {
                const retryTimeout = setTimeout(resolve, 100);
                this.timerRegistry.registerTimeout(retryTimeout);
            });
        }
        return null;
    }

    /**
     * Inject character card button into profile panel
     * @param {Element} _profilePanel - Profile panel element
     */
    injectButton(_profilePanel) {
        // Check if button already exists
        const existingButton = document.getElementById('mwi-character-card-btn');
        if (existingButton) {
            return;
        }

        // Find the combat score panel to inject button into
        const combatScorePanel = document.getElementById('mwi-combat-score-panel');
        if (!combatScorePanel) {
            console.warn('[CharacterCardButton] Combat score panel not found - button not injected');
            return;
        }

        // Find the button container (should be the div with both export buttons)
        const buttonContainer = combatScorePanel.querySelector('div[style*="margin-top: 12px"]');
        if (!buttonContainer) {
            console.warn('[CharacterCardButton] Button container not found in combat score panel');
            return;
        }

        // Create button element
        const button = document.createElement('button');
        button.id = 'mwi-character-card-btn';
        button.textContent = 'View Card';
        button.style.cssText = `
            padding: 8px 12px;
            background: ${config.COLOR_ACCENT};
            color: black;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 0.85rem;
            width: 100%;
        `;

        // Add click handler
        button.addEventListener('click', () => {
            this.handleButtonClick();
        });

        // Add hover effects
        button.addEventListener('mouseenter', () => {
            button.style.opacity = '0.8';
        });
        button.addEventListener('mouseleave', () => {
            button.style.opacity = '1';
        });

        // Append button to container
        buttonContainer.appendChild(button);
    }

    /**
     * Handle character card button click
     */
    handleButtonClick() {
        try {
            const clientData = dataManager.getInitClientData();

            // Determine if viewing own profile or someone else's
            let characterData = null;

            // If we have profile data from profile_shared event, use it (other player)
            if (this.currentProfileData?.profile) {
                characterData = this.currentProfileData.profile;
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
            if (!this.currentProfileData?.profile) {
                consumablesData = dataManager.characterData;
            }
            // If viewing other player, check if they have combatConsumables (only visible in party)
            else if (characterData.combatConsumables && characterData.combatConsumables.length > 0) {
                // Convert combatConsumables array to expected format
                consumablesData = this.convertCombatConsumablesToSlots(characterData.combatConsumables, clientData);
            }
            // Otherwise leave consumables empty (can't see other player's consumables outside party)

            // Find the profile modal for fallback
            const _modal = document.querySelector('.SharableProfile_modal__2OmCQ');

            // Build character sheet link using cached data (preferred) or DOM fallback
            const url = buildCharacterSheetLink(
                _modal,
                'https://tib-san.github.io/mwi-character-sheet/',
                characterData,
                clientData,
                consumablesData
            );

            // Open in new tab
            window.open(url, '_blank');
        } catch (error) {
            console.error('[CharacterCardButton] Failed to open character card:', error);
        }
    }

    /**
     * Convert combatConsumables array to actionTypeFoodSlotsMap/actionTypeDrinkSlotsMap format
     * @param {Array} combatConsumables - Array of consumable items from profile data
     * @param {Object} clientData - Init client data for item type lookups
     * @returns {Object} Object with actionTypeFoodSlotsMap and actionTypeDrinkSlotsMap
     */
    convertCombatConsumablesToSlots(combatConsumables, clientData) {
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
        if (this.profileSharedHandler) {
            webSocketHook.off('profile_shared', this.profileSharedHandler);
            this.profileSharedHandler = null;
        }

        // Remove button from DOM
        const button = document.getElementById('mwi-character-card-btn');
        if (button) {
            button.remove();
        }

        this.currentProfileData = null;
        this.timerRegistry.clearAll();
        this.isActive = false;
        this.isInitialized = false;
    }
}

const characterCardButton = new CharacterCardButton();
characterCardButton.setupSettingListener();

export default characterCardButton;
