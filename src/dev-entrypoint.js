/**
 * Toolasha Dev Entrypoint
 * Bundles libraries and entrypoint into a single file for local testing.
 */

// Environment mismatch detection
(function checkBuildEnvironment() {
    const buildTarget = window.Toolasha?.__buildTarget;
    const hasScriptManager = typeof GM !== 'undefined' || typeof GM_info !== 'undefined';

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
        alert(
            'Toolasha: Wrong build installed!\n\n' +
                'You have the STEAM build installed, but you are running in a browser.\n' +
                'The Steam build is unnecessarily large for browser use.\n\n' +
                'Please install the browser build instead.'
        );
        throw new Error('[Toolasha] Steam build should not run in a browser. Install the browser build.');
    }
})();

import './libraries/core.js';
import './libraries/utils.js';
import './libraries/market.js';
import './libraries/actions.js';
import './libraries/combat.js';
import './libraries/ui.js';
import './entrypoint.js';
