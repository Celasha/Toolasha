/**
 * Profile Cache Module
 * Stores current profile in memory for Steam users
 */

// Module-level variable to hold current profile in memory
let currentProfileCache = null;

/**
 * Set current profile in memory
 * @param {Object} profileData - Profile data from profile_shared message
 */
export function setCurrentProfile(profileData) {
    currentProfileCache = profileData;
}

/**
 * Get current profile from memory
 * @returns {Object|null} Current profile or null
 */
export function getCurrentProfile() {
    return currentProfileCache;
}

/**
 * Clear current profile from memory
 */
export function clearCurrentProfile() {
    currentProfileCache = null;
}
