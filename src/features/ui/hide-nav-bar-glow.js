/**
 * Hide Nav Bar Glow
 * Suppresses the native pulsing glow animation on the left navigation bar's currently-active
 * skill link (native `.glowing` utility class - MWI reuses this same class for several unrelated
 * highlights, so the override is scoped to the navigation bar only).
 */

import config from '../../core/config.js';
import { addStyles, removeStyles } from '../../utils/dom.js';

const STYLE_ID = 'mwi-hide-nav-bar-glow';
const CSS = `
    [class*="NavigationBar_navigationLink"].glowing,
    [class*="NavigationBar_navigationLink"] .glowing {
        animation: none !important;
        box-shadow: none !important;
    }
`;

const hideNavBarGlow = {
    initialize() {
        if (!config.getSetting('hideNavBarGlow')) {
            return;
        }
        addStyles(CSS, STYLE_ID);
    },

    disable() {
        removeStyles(STYLE_ID);
    },
};

export default hideNavBarGlow;
