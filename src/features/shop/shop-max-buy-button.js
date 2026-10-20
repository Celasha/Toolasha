/**
 * Shop Max Buy Button
 * Adds a "Max" button to Shop, Task Shop, Labyrinth Shop, and Cowbell Store buy dialogs that
 * fills in the most of the item the player can afford - mirroring Marketplace's and Guild
 * Shop's existing native Max/All buttons for the surfaces that don't have one.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { addStyles, removeStyles } from '../../utils/dom.js';
import {
    resolveCostLines,
    computeMaxAffordable,
    resolveCommunityBuffCostLines,
    normalizeCostLinesToUnit,
} from '../../utils/shop-max-buy.js';
import { setReactInputValue } from '../../utils/react-input.js';

const BUTTON_CLASS = 'toolasha-shop-max-buy-button';
const STYLE_ID = 'mwi-shop-max-buy-button-style';

// Dark-theme "injected action button next to native UI" look already established by
// labyrinth-missing-supplies.js's button, for visual consistency with that precedent.
const SHOP_MAX_BUY_BUTTON_CSS = `
    .${BUTTON_CLASS} {
        margin-left: 4px;
        padding: 4px 10px;
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
        color: #ffffff;
        border: 1px solid rgba(91, 141, 239, 0.4);
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
    }
    .${BUTTON_CLASS}:hover {
        background: linear-gradient(180deg, rgba(91, 141, 239, 0.3) 0%, rgba(91, 141, 239, 0.15) 100%);
    }
`;

// Each panel is its own React component with its own CSS-module class prefix, but all share
// the same inner structure: <label>Quantity</label> + <input type="number"> + an empty error
// <div>, then a cost line, then the Buy <button>. Prefixes survive game rebuilds; the hash
// suffix after them does not. modalContentClass scopes the Buy-button oracle lookup to this
// panel's own dialog, confirmed present on all four panels directly in the client bundle.
const PANEL_CONFIGS = [
    {
        key: 'shop',
        inputContainerClass: 'ShopPanel_inputContainer',
        modalContentClass: 'ShopPanel_modalContent',
        costStyle: 'text',
    },
    {
        key: 'tasks',
        inputContainerClass: 'TasksPanel_inputContainer',
        modalContentClass: 'TasksPanel_modalContent',
        costStyle: 'icon',
    },
    {
        key: 'labyrinth',
        inputContainerClass: 'LabyrinthPanel_inputContainer',
        modalContentClass: 'LabyrinthPanel_modalContent',
        costStyle: 'icon',
    },
    // Cowbell Store's MooPass (cowbell tier), Community Buffs, and Convenience tabs all render
    // through this same component/class - one target covers all three.
    {
        key: 'cowbellStore',
        inputContainerClass: 'CowbellStorePanel_inputContainer',
        modalContentClass: 'CowbellStorePanel_modalContent',
        costStyle: 'icon',
    },
];

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

class ShopMaxBuyButton {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('shop_maxBuyButton')) return;

        this.isInitialized = true;
        addStyles(SHOP_MAX_BUY_BUTTON_CSS, STYLE_ID);

        for (const panelConfig of PANEL_CONFIGS) {
            const unregister = domObserver.onClass(
                `shop-max-buy-${panelConfig.key}`,
                panelConfig.inputContainerClass,
                (container) => this.injectButton(container, panelConfig)
            );
            this.unregisterHandlers.push(unregister);
        }
    }

    disable() {
        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];
        this.isInitialized = false;
        removeStyles(STYLE_ID);
    }

    /**
     * @param {Element} container - the *Panel_inputContainer element
     * @param {{costStyle: 'text'|'icon', modalContentClass: string}} panelConfig
     */
    injectButton(container, panelConfig) {
        if (container.querySelector(`.${BUTTON_CLASS}`)) return;

        const input = container.querySelector('input[type="number"]');
        const inputWrapper = container.querySelector('[class*="Input_inputContainer"]');
        if (!input || !inputWrapper) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON_CLASS;
        button.textContent = t('shopMaxBuyButton.buttonLabel');
        button.addEventListener('click', (event) => {
            event.preventDefault();
            this.handleMaxClick(container, input, panelConfig);
        });

        inputWrapper.insertAdjacentElement('afterend', button);
    }

    /**
     * @param {Element} container
     * @param {HTMLInputElement} input
     * @param {{costStyle: 'text'|'icon', modalContentClass: string}} panelConfig
     */
    async handleMaxClick(container, input, panelConfig) {
        const costLines = this.resolveUnitCostLines(container, input, panelConfig);
        const candidate = computeMaxAffordable(costLines);
        if (candidate === null) return;

        await this.fillAndVerify(container, input, candidate, panelConfig.modalContentClass);
    }

    /**
     * Per-unit cost lines for the dialog. Community Buff dialogs open at 10 minutes, so their
     * "You Pay" row is a total, not a unit price: take the per-minute cost from game data, and
     * only if that can't be resolved divide the displayed total by the typed quantity.
     * @param {Element} container
     * @param {HTMLInputElement} input
     * @param {{key: string, costStyle: 'text'|'icon'}} panelConfig
     * @returns {Array<{itemHrid: string, perUnitAmount: number}>}
     */
    resolveUnitCostLines(container, input, panelConfig) {
        if (panelConfig.key !== 'cowbellStore') {
            return resolveCostLines(container, panelConfig.costStyle);
        }

        const fromGameData = resolveCommunityBuffCostLines(container);
        if (fromGameData) return fromGameData;

        return normalizeCostLinesToUnit(resolveCostLines(container, panelConfig.costStyle), parseInt(input.value, 10));
    }

    /**
     * Fill the input with `candidate`, then - since some purchases (e.g. Cowbell Store's
     * Convenience tab) enforce a cap beyond raw affordability that isn't readable from the DOM -
     * treat the Buy button's disabled state as the oracle and binary-search downward until a
     * valid quantity is found. This also self-corrects any currency misidentification instead
     * of silently leaving an invalid quantity filled in.
     *
     * The Buy button is looked up scoped to this panel's own modal content root (not merely
     * container.parentElement - Button_success is a generic shared class reused by every
     * success-colored button game-wide, so a too-narrow or too-wide scope can silently match
     * the wrong button), and only trusted as an oracle when exactly one visible match is found
     * in that scope. An ambiguous (zero or multiple) match means there's no reliable oracle, so
     * verification stops immediately and the quantity already filled is left as-is - the same
     * fail-safe already used when nothing is affordable at all.
     * @param {Element} container
     * @param {HTMLInputElement} input
     * @param {number} candidate
     * @param {string} modalContentClass
     */
    async fillAndVerify(container, input, candidate, modalContentClass) {
        const modalRoot = container.closest(`[class*="${modalContentClass}"]`) || document;
        const findBuyButton = () => {
            const matches = [...modalRoot.querySelectorAll('button[class*="Button_success"]')].filter(
                (button) => button.offsetParent !== null
            );
            return matches.length === 1 ? matches[0] : null;
        };

        // true: unambiguously found and disabled (keep searching smaller). false: unambiguously
        // found and enabled (this quantity works). null: no reliable oracle - stop and leave as-is.
        const setAndCheck = async (value) => {
            setReactInputValue(input, value, { focus: false });
            await nextFrame();
            const button = findBuyButton();
            return button ? button.disabled : null;
        };

        if ((await setAndCheck(candidate)) !== true) return;

        let low = 1;
        let high = candidate - 1;
        let best = null;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const result = await setAndCheck(mid);
            if (result === null) break; // lost the oracle mid-search - stop rather than guess
            if (result) {
                high = mid - 1;
            } else {
                best = mid;
                low = mid + 1;
            }
        }

        if (best !== null) {
            await setAndCheck(best);
        }
        // else: nothing affordable even at quantity 1 - leave the input as last probed and let
        // the game's own validation messaging explain why, same as if the user had typed it.
    }
}

const shopMaxBuyButton = new ShopMaxBuyButton();
export default shopMaxBuyButton;
