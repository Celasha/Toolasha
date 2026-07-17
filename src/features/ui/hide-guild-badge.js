/**
 * Hide Guild Badge
 * Hides the notification badge on the Guild navigation bar item
 */

import config from '../../core/config.js';
import { addStyles, removeStyles } from '../../utils/dom.js';

const STYLE_ID = 'mwi-hide-guild-badge';
const CSS = `
    [class*="NavigationBar_nav__"]:has(svg[aria-label="navigationBar.guild"]) [class*="NavigationBar_badge"]:not([class*="NavigationBar_ocean"]) {
        display: none !important;
    }
`;

const hideGuildBadge = {
    initialize() {
        if (!config.getSetting('hideGuildBadge')) {
            return;
        }
        addStyles(CSS, STYLE_ID);
    },

    disable() {
        removeStyles(STYLE_ID);
    },
};

export default hideGuildBadge;
