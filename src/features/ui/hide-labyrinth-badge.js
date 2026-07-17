/**
 * Hide Labyrinth Badge
 * Hides the notification badge on the Labyrinth navigation bar item
 */

import config from '../../core/config.js';
import { addStyles, removeStyles } from '../../utils/dom.js';

const STYLE_ID = 'mwi-hide-labyrinth-badge';
const CSS = `
    [class*="NavigationBar_nav__"]:has(svg[aria-label="navigationBar.labyrinth"]) [class*="NavigationBar_badge"]:not([class*="NavigationBar_ocean"]) {
        display: none !important;
    }
`;

const hideLabyrinthBadge = {
    initialize() {
        if (!config.getSetting('hideLabyrinthBadge')) {
            return;
        }
        addStyles(CSS, STYLE_ID);
    },

    disable() {
        removeStyles(STYLE_ID);
    },
};

export default hideLabyrinthBadge;
