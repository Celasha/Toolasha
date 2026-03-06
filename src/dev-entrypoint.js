/**
 * Toolasha Dev Entrypoint
 * Bundles libraries and entrypoint into a single file for local testing.
 */

// Environment mismatch detection
(function checkBuildEnvironment() {
    const buildTarget = window.Toolasha?.__buildTarget;
    // Check for GM_info specifically - the Steam polyfill provides GM but not GM_info
    const hasScriptManager = typeof GM_info !== 'undefined';

    if (buildTarget === 'browser' && !hasScriptManager) {
        alert(
            'Toolasha: Wrong build installed!\n\n' +
                'You have the BROWSER build installed, but you are running on Steam.\n' +
                'The browser build requires Tampermonkey and will not work on Steam.\n\n' +
                'Please install the Steam build instead.'
        );
        throw new Error('[Toolasha] Browser build cannot run on Steam. Install the Steam build.');
    }
    if (buildTarget === 'steam' && hasScriptManager) {
        console.warn(
            '[Toolasha] Steam build detected in browser. ' +
                'The Steam build is larger than necessary for browser use — consider switching to the browser build. ' +
                'Continuing anyway.'
        );
    }
})();

import './libraries/core.js';
import './libraries/utils.js';
import './libraries/market.js';
import './libraries/actions.js';
import './libraries/combat.js';
import './libraries/ui.js';
import './entrypoint.js';
