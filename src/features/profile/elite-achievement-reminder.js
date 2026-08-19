/**
 * Elite Achievement Reminder
 * Shows a small icon next to a player's name on their shared profile when they haven't
 * completed all Elite achievements yet; clicking it pre-fills a customizable whisper.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';

const ICON_ID = 'mwi-elite-achievement-reminder-icon';
const ELITE_TIER_HRID = '/achievement_tiers/elite';
const DEFAULT_MESSAGE = 'Be Elite. Do your Elite achievements.';

/**
 * Determine whether a shared profile's Elite achievement tier is incomplete.
 * @param {Array} characterAchievements - profile.characterAchievements from a profile_shared payload
 * @param {Object} achievementDetailMap - dataManager.getInitClientData().achievementDetailMap
 * @returns {boolean} True if at least one Elite achievement has not been completed
 */
export function isEliteTierIncomplete(characterAchievements, achievementDetailMap) {
    if (!characterAchievements || !achievementDetailMap) return false;

    let total = 0;
    for (const details of Object.values(achievementDetailMap)) {
        if (details?.tierHrid === ELITE_TIER_HRID) total++;
    }
    if (total === 0) return false;

    const completedHrids = new Set();
    for (const achievement of characterAchievements) {
        if (!achievement.isCompleted || !achievement.achievementHrid) continue;
        if (achievementDetailMap[achievement.achievementHrid]?.tierHrid === ELITE_TIER_HRID) {
            completedHrids.add(achievement.achievementHrid);
        }
    }

    return completedHrids.size < total;
}

class EliteAchievementReminder {
    constructor() {
        this.isActive = false;
        this.isInitialized = false;
        this.profileSharedHandler = null;
        this.currentIcon = null;
    }

    /**
     * Setup settings listener for feature toggle
     */
    setupSettingListener() {
        config.onSettingChange('eliteAchievementReminder', (value) => {
            if (value) {
                this.initialize();
            } else {
                this.disable();
            }
        });
    }

    /**
     * Initialize the feature
     */
    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('eliteAchievementReminder')) return;

        this.isInitialized = true;

        this.profileSharedHandler = (data) => {
            this.handleProfileShared(data);
        };

        webSocketHook.on('profile_shared', this.profileSharedHandler);

        this.isActive = true;
    }

    /**
     * Handle profile_shared WebSocket message
     * @param {Object} profileData - Profile data from WebSocket
     */
    async handleProfileShared(profileData) {
        if (!config.getSetting('eliteAchievementReminder')) return;

        const clientData = dataManager.getInitClientData();
        const characterAchievements = profileData?.profile?.characterAchievements;
        if (!isEliteTierIncomplete(characterAchievements, clientData?.achievementDetailMap)) return;

        const playerName = profileData?.profile?.sharableCharacter?.name;
        if (!playerName) return;

        const profilePanel = await this.waitForProfilePanel();
        if (!profilePanel) return;

        const modalContainer =
            profilePanel.closest('.SharableProfile_modal__2OmCQ') || profilePanel.closest('[class*="Modal"]');
        if (!modalContainer) return;

        const header = modalContainer.querySelector('[class*="SharableProfile_header"]');
        const nameContainer = header?.querySelector('[class*="CharacterName_characterName"]');
        if (!nameContainer) return;

        this.showIcon(nameContainer, modalContainer, playerName);
    }

    /**
     * Wait for the profile panel to appear in the DOM
     * @returns {Promise<Element|null>} Profile panel element or null if timeout
     */
    async waitForProfilePanel() {
        for (let i = 0; i < 20; i++) {
            const panel = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
            if (panel) return panel;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    }

    /**
     * Inject the reminder icon next to the player's name
     * @param {Element} nameContainer - CharacterName_characterName element
     * @param {Element} modalContainer - Profile modal container element
     * @param {string} playerName - Name of the viewed player
     */
    showIcon(nameContainer, modalContainer, playerName) {
        if (this.currentIcon) {
            this.currentIcon.remove();
            this.currentIcon = null;
        }

        const icon = document.createElement('span');
        icon.id = ICON_ID;
        icon.textContent = '✉️';
        icon.title = 'Remind about Elite achievements';
        icon.style.cssText = `
            cursor: pointer;
            margin-left: 6px;
            font-size: 0.9em;
        `;
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sendReminder(playerName);
        });

        nameContainer.appendChild(icon);
        this.currentIcon = icon;

        this.setupCleanupObserver(icon, modalContainer);
    }

    /**
     * Pre-fill the chat input with the configured whisper message (does not send it)
     * @param {string} playerName - Name of the player to whisper
     */
    sendReminder(playerName) {
        const chatInput = document.querySelector('[class*="Chat_chatInputContainer"] input');
        if (!chatInput) return;

        const message = config.getSettingValue('eliteAchievementReminderMessage', DEFAULT_MESSAGE) || DEFAULT_MESSAGE;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(chatInput, `/w ${playerName} ${message}`);
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        chatInput.focus();
    }

    /**
     * Remove the icon once the profile modal closes
     * @param {Element} icon - Injected icon element
     * @param {Element} modal - Profile modal container element
     */
    setupCleanupObserver(icon, modal) {
        if (!document.body) return;

        const cleanupObserver = createMutationWatcher(
            document.body,
            () => {
                if (
                    !document.body.contains(modal) ||
                    !document.querySelector('div.SharableProfile_overviewTab__W4dCV')
                ) {
                    icon.remove();
                    if (this.currentIcon === icon) this.currentIcon = null;
                    cleanupObserver();
                }
            },
            { childList: true, subtree: true }
        );
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.profileSharedHandler) {
            webSocketHook.off('profile_shared', this.profileSharedHandler);
            this.profileSharedHandler = null;
        }

        if (this.currentIcon) {
            this.currentIcon.remove();
            this.currentIcon = null;
        }

        this.isActive = false;
        this.isInitialized = false;
    }
}

const eliteAchievementReminder = new EliteAchievementReminder();
eliteAchievementReminder.setupSettingListener();

export default eliteAchievementReminder;
