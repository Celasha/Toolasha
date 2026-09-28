/**
 * Profile Export Button Module
 * Adds "Export to Clipboard" button on profile page
 *
 * Allows users to copy character data for manual pasting into combat simulator
 */

import { constructExportObject } from './combat-sim-export.js';
import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import storage from '../../core/storage.js';
import domObserver from '../../core/dom-observer.js';

/**
 * Initialize profile export button
 */
function initialize() {
    waitForProfilePage();
    observeProfileClosure();
}

/**
 * Wait for profile page to load
 */
function waitForProfilePage() {
    domObserver.register(
        'ProfileExportButton-ProfileTab',
        () => {
            const profileTab = document.querySelector('div.SharableProfile_overviewTab__W4dCV');

            // Only inject if we're on the profile page AND button doesn't exist yet
            if (profileTab && !document.getElementById('toolasha-profile-export-button')) {
                injectExportButton(profileTab);
            }
        },
        { debounce: true, debounceDelay: 200 }
    );
}

/**
 * Observe profile page closure and clear current profile ID
 */
function observeProfileClosure() {
    domObserver.register(
        'ProfileExportButton-ProfileClose',
        () => {
            const profileTab = document.querySelector('div.SharableProfile_overviewTab__W4dCV');
            if (!profileTab) {
                // Profile closed - clear current profile ID
                storage.set('currentProfileId', null, 'combatExport', true);
            }
        },
        { debounce: true, debounceDelay: 200 }
    );
}

/**
 * Inject export button on profile page
 * @param {Element} container - Profile overview tab container
 */
function injectExportButton(container) {
    // Check if button already exists
    if (document.getElementById('toolasha-profile-export-button')) {
        return;
    }

    const button = document.createElement('button');
    button.id = 'toolasha-profile-export-button';
    button.textContent = t('profileExportButton.exportButtonLabel');
    button.style.cssText = `
        border-radius: 5px;
        height: 30px;
        background-color: ${config.COLOR_ACCENT};
        color: black;
        box-shadow: none;
        border: 0px;
        padding: 0 15px;
        cursor: pointer;
        font-weight: bold;
        margin-top: 10px;
        width: 100%;
    `;

    // Add hover effect
    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.8';
    });
    button.addEventListener('mouseleave', () => {
        button.style.opacity = '1';
    });

    // Add click handler
    button.addEventListener('click', async () => {
        await handleExport(button);
    });

    // Append to container
    container.appendChild(button);
}

/**
 * Handle export button click
 * @param {Element} button - Button element to update
 */
async function handleExport(button) {
    try {
        // Get current profile ID (if viewing someone else's profile)
        const currentProfileId = await storage.get('currentProfileId', 'combatExport', null);

        // Get export data in single-player format (for pasting into "Player 1 import" field)
        const exportData = await constructExportObject(currentProfileId, true);

        if (!exportData) {
            button.textContent = t('combatScore.noDataStatus');
            button.style.backgroundColor = '#dc3545'; // Red
            setTimeout(() => resetButton(button), 3000);
            console.error('[Profile Export] No export data available');
            alert(t('profileExportButton.noDataAlert'));
            return;
        }

        // Copy to clipboard
        const exportString = JSON.stringify(exportData.exportObj);
        await navigator.clipboard.writeText(exportString);

        // Success feedback
        button.textContent = t('combatScore.copiedStatus');
        button.style.backgroundColor = '#28a745'; // Green
        setTimeout(() => resetButton(button), 3000);
    } catch (error) {
        console.error('[Profile Export] Export failed:', error);

        // Error feedback
        button.textContent = t('combatScore.failedStatus');
        button.style.backgroundColor = '#dc3545'; // Red
        setTimeout(() => resetButton(button), 3000);

        // Show user-friendly error
        if (error.name === 'NotAllowedError') {
            alert(t('profileExportButton.clipboardAccessDeniedAlert'));
        } else {
            alert(t('profileExportButton.exportFailedAlert', { error: error.message }));
        }
    }
}

/**
 * Reset button to original state
 * @param {Element} button - Button element
 */
function resetButton(button) {
    button.textContent = t('profileExportButton.exportButtonLabel');
    button.style.backgroundColor = config.COLOR_ACCENT;
}

// Export module
export default {
    initialize,
};
