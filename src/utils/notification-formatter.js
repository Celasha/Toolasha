/**
 * Notification Message Formatter
 * Renders `infoNotification.*` WebSocket messages (see features/chat/notification-log.js) into
 * readable text. Templates live in the locale tables under the `notificationFormatter` namespace
 * (see src/locales/en.js) and are copied from the game client's own i18n bundle (English):
 * Toolasha runs outside the game's React tree and has no reachable route to its live translator
 * (it is bound to `this.props.t` on a connected component, not exposed on window), so these are
 * a static snapshot rather than a live lookup. Update the locale tables if the game adds/changes keys.
 */

import dataManager from '../core/data-manager.js';
import { t } from '../core/i18n.js';
import { formatWithSeparator } from './formatters.js';

/** Variable names whose values are plain quantities, not names/codes/hrids - format with thousand separators. */
const NUMERIC_VARS = new Set(['count', 'coins', 'filled', 'total', 'minutes', 'level', 'days', 'limit', 'boundary']);

const CATEGORIES = {
    trading: [
        'boughtItem',
        'soldItem',
        'buyOrderCompleted',
        'sellOrderCompleted',
        'buyListingProgress',
        'sellListingProgress',
        'listingPegged',
    ],
    guild: [
        'guildCreated',
        'guildDisbanded',
        'guildLeft',
        'guildPromotedTo',
        'guildDemotedTo',
        'guildLeadershipPassed',
        'guildMemberPromoted',
        'guildMemberDemoted',
        'guildMessagePinned',
        'guildKicked',
        'kickedGuildMember',
        'guildInvited',
        'guildInviteSent',
        'guildInviteCanceled',
        'guildJoined',
        'guildInviteDeclined',
        'guildApplicationSent',
        'guildApplicationAccepted',
        'guildTrialStarted',
    ],
    party: [
        'partyCreated',
        'partyOptionsSaved',
        'partyOpenForRecruiting',
        'partyLeadershipChanged',
        'partyJoined',
        'readyToBattle',
        'notReadyToBattle',
        'partyDisbanded',
        'partyLeft',
        'partyKicked',
        'partyMemberKicked',
    ],
    progression: ['characterLeveledUp', 'achievementCompleted'],
    house: ['houseConstructed'],
    social: [
        'addedFriend',
        'removedFriend',
        'blockedCharacter',
        'unblockedCharacter',
        'chatReportSubmitted',
        'nameChanged',
    ],
    cosmetic: [
        'chatIconUnlocked',
        'nameColorUnlocked',
        'avatarUnlocked',
        'avatarOutfitUnlocked',
        'avatarBackgroundUnlocked',
        'avatarBorderUnlocked',
    ],
    loadout: ['loadoutCreated', 'loadoutUpdated', 'setupImportedToLoadout', 'loadoutEquipped', 'loadoutDeleted'],
    purchases: [
        'upgradePurchased',
        'cowbellPurchaseCompleted',
        'mooPassPurchaseCompleted',
        'mooPassGranted',
        'steamCheckoutRequested',
        'creatorCodeSet',
    ],
    community: ['communityBuffAdded'],
    referral: ['referralJoined', 'newReferralBonus'],
    labyrinth: ['labyrinthShroudFailed'],
    other: ['updateSuccessful'],
};

const KEY_TO_CATEGORY = new Map();
for (const [category, keys] of Object.entries(CATEGORIES)) {
    for (const key of keys) {
        KEY_TO_CATEGORY.set(key, category);
    }
}

/** Nested `$t(table.{{var}})` resolvers, backed by dataManager's detail maps. */
const NESTED_TABLES = {
    itemNames: (hrid) => dataManager.getItemDetails(hrid)?.name,
    houseRoomNames: (hrid) => dataManager.getInitClientData()?.houseRoomDetailMap?.[hrid]?.name,
    buyableUpgradeNames: (hrid) => dataManager.getInitClientData()?.buyableUpgradeDetailMap?.[hrid]?.name,
    communityBuffTypeNames: (hrid) => dataManager.getInitClientData()?.communityBuffTypeDetailMap?.[hrid]?.name,
    guildCharacterRoleNames: (role) => dataManager.getInitClientData()?.guildCharacterRoleDetailMap?.[role]?.name,
    skillNames: (hrid) => dataManager.getInitClientData()?.skillDetailMap?.[hrid]?.name,
    achievementNames: (hrid) => dataManager.getInitClientData()?.achievementDetailMap?.[hrid]?.name,
    // No detail map with a "name" field exists for chat icons or name colors (verified against
    // the game's static definitions), so these always fall through to humanizeHrid below.
};

/**
 * Turn a hrid (or any slash/underscore-separated identifier) into a readable label.
 * Used both as a last-resort for unresolved nested lookups and for unknown message keys.
 * @param {string} value
 * @returns {string}
 */
function humanizeHrid(value) {
    const tail =
        String(value ?? '')
            .split('/')
            .pop() || '';
    return tail
        .split('_')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Turn a camelCase message key (e.g. "soldItem") into a readable label ("Sold Item").
 * Used only as a last resort when a message key has no known template.
 * @param {string} key
 * @returns {string}
 */
function humanizeCamelCase(key) {
    const spaced = String(key ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Resolve a single `$t(table.{{var}})` reference to a display name.
 * @param {string} tableName
 * @param {string} rawValue
 * @returns {string}
 */
function resolveNestedName(tableName, rawValue) {
    const resolver = NESTED_TABLES[tableName];
    const resolved = resolver ? resolver(rawValue) : null;
    return resolved || humanizeHrid(rawValue);
}

/**
 * Format an `infoNotification.*` WebSocket message into readable text.
 * @param {string} message - e.g. "infoNotification.soldItem"
 * @param {Array<{name: string, data: string}>} variables
 * @returns {string}
 */
export function formatNotificationMessage(message, variables) {
    const key = String(message || '').replace(/^infoNotification\./, '');

    const varMap = {};
    for (const variable of variables || []) {
        if (variable && variable.name !== undefined) {
            varMap[variable.name] = variable.data;
        }
    }

    const templateKey = `notificationFormatter.${key}`;
    const template = t(templateKey);
    if (!template || template === templateKey) {
        // Unrecognized key (e.g. a new game update added one): still show something useful
        // instead of dropping the notification or throwing.
        const parts = Object.entries(varMap).map(([name, data]) => `${name}: ${data}`);
        return `${humanizeCamelCase(key)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }

    const withNested = template.replace(/\$t\(([a-zA-Z]+)\.\{\{([a-zA-Z]+)\}\}\)/g, (_match, tableName, varName) =>
        resolveNestedName(tableName, varMap[varName])
    );

    return withNested.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, varName) => {
        const value = varMap[varName];
        if (value === undefined) {
            return '';
        }
        if (NUMERIC_VARS.has(varName) && value !== '' && Number.isFinite(Number(value))) {
            return formatWithSeparator(Number(value));
        }
        return String(value);
    });
}

/**
 * Classify a message key into a filter category.
 * @param {string} message - e.g. "infoNotification.soldItem"
 * @returns {string}
 */
export function getNotificationCategory(message) {
    const key = String(message || '').replace(/^infoNotification\./, '');
    return KEY_TO_CATEGORY.get(key) || 'other';
}

/**
 * All known filter categories, in a stable display order.
 * @returns {string[]}
 */
export function getAllNotificationCategories() {
    return [...new Set(Object.keys(CATEGORIES))];
}
