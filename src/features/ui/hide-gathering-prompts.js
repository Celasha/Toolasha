/**
 * Hide Gathering Prompts
 * For Non-Gathering Iron Cow (NGIC) characters, who never gather: hides the experience readouts on the
 * Milking, Foraging and Woodcutting navigation links, and hides the tutorial quest (header task and
 * popup) while the tutorial is unfinished.
 *
 * Idea from brandlythebozo's "MWI NGIC QoL" userscript.
 *
 * The skill links are told apart by their skill icon, so reordering the sidebar or changing the game
 * language does not matter. Everything is hidden with CSS; the game's own elements are never removed,
 * so React keeps working with them.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { addStyles, removeStyles } from '../../utils/dom.js';

const NAV_STYLE_ID = 'mwi-hide-gathering-prompts-nav';
const TUTORIAL_STYLE_ID = 'mwi-hide-gathering-prompts-tutorial';

export const GATHERING_SKILLS = ['milking', 'foraging', 'woodcutting'];

// The game's experience bar (which also holds the remaining-XP text) and our XP percentage
const NAV_TARGETS = ['[class*="NavigationBar_experienceBar"]', '.mwi-exp-percentage'];

const NAV_SELECTORS = GATHERING_SKILLS.flatMap((skill) =>
    NAV_TARGETS.map((target) => `[class*="NavigationBar_nav__"]:has(use[href$="#${skill}"]) ${target}`)
);

export const NAV_CSS = `
    ${NAV_SELECTORS.join(',\n    ')} {
        display: none !important;
    }
`;

export const TUTORIAL_CSS = `
    [class*="Header_questInfo"],
    [class*="QuestModal_questModalContainer"] {
        display: none !important;
    }
`;

const hideGatheringPrompts = {
    questsHandler: null,

    initialize() {
        if (!config.getSetting('hideGatheringPrompts')) {
            return;
        }

        addStyles(NAV_CSS, NAV_STYLE_ID);

        this.questsHandler = () => this.syncTutorialStyle();
        dataManager.on('quests_updated', this.questsHandler);
        this.syncTutorialStyle();
    },

    /**
     * Hide the tutorial quest only while the character still has one
     */
    syncTutorialStyle() {
        const hasStyle = !!document.getElementById(TUTORIAL_STYLE_ID);
        const hasTutorial = dataManager.hasTutorialQuest();

        if (hasTutorial && !hasStyle) {
            addStyles(TUTORIAL_CSS, TUTORIAL_STYLE_ID);
        } else if (!hasTutorial && hasStyle) {
            removeStyles(TUTORIAL_STYLE_ID);
        }
    },

    disable() {
        if (this.questsHandler) {
            dataManager.off('quests_updated', this.questsHandler);
            this.questsHandler = null;
        }
        removeStyles(NAV_STYLE_ID);
        removeStyles(TUTORIAL_STYLE_ID);
    },
};

export default hideGatheringPrompts;
