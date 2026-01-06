/**
 * Profile Export Button Module
 * Adds "Export to Clipboard" button on profile page
 *
 * Allows users to copy character data for manual pasting into combat simulator
 */

import { constructExportObject } from './combat-sim-export.js';
import config from '../../core/config.js';

/**
 * Initialize profile export button
 */
export function initialize() {
    console.log('[Profile Export] Initializing');
    waitForProfilePage();
}

/**
 * Wait for profile page to load
 */
function waitForProfilePage() {
    const checkInterval = setInterval(() => {
        const profileTab = document.querySelector('div.SharableProfile_overviewTab__W4dCV');

        // Only inject if we're on the profile page AND button doesn't exist yet
        if (profileTab && !document.getElementById('toolasha-profile-export-button')) {
            injectExportButton(profileTab);
        }
    }, 500);

    // Keep checking - profile page can be opened/closed multiple times
    // Don't stop the interval since user may navigate away and come back
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
    button.textContent = 'Export to Clipboard';
    button.style.cssText = `
        border-radius: 5px;
        height: 30px;
        background-color: ${config.SCRIPT_COLOR_MAIN};
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
        // Get export data
        const exportData = await constructExportObject();

        if (!exportData) {
            button.textContent = '✗ No Data';
            button.style.backgroundColor = '#dc3545'; // Red
            setTimeout(() => resetButton(button), 3000);
            console.error('[Profile Export] No export data available');
            alert('No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again');
            return;
        }

        // Copy to clipboard
        const exportString = JSON.stringify(exportData.exportObj);
        await navigator.clipboard.writeText(exportString);

        // Success feedback
        button.textContent = '✓ Copied';
        button.style.backgroundColor = '#28a745'; // Green
        setTimeout(() => resetButton(button), 3000);

    } catch (error) {
        console.error('[Profile Export] Export failed:', error);

        // Error feedback
        button.textContent = '✗ Failed';
        button.style.backgroundColor = '#dc3545'; // Red
        setTimeout(() => resetButton(button), 3000);

        // Show user-friendly error
        if (error.name === 'NotAllowedError') {
            alert('Clipboard access denied. Please allow clipboard permissions for this site.');
        } else {
            alert('Export failed: ' + error.message);
        }
    }
}

/**
 * Reset button to original state
 * @param {Element} button - Button element
 */
function resetButton(button) {
    button.textContent = 'Export to Clipboard';
    button.style.backgroundColor = config.SCRIPT_COLOR_MAIN;
}
