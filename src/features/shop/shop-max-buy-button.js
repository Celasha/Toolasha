/**
 * Shop Max Buy Button
 * Adds a "Max" button to Shop, Task Shop, Labyrinth Shop, and Cowbell Store buy dialogs that
 * fills in the most of the item the player can afford - mirroring Marketplace's and Guild
 * Shop's existing native Max/All buttons for the surfaces that don't have one.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { resolveCostLines, computeMaxAffordable } from '../../utils/shop-max-buy.js';
import { setReactInputValue } from '../../utils/react-input.js';

const BUTTON_CLASS = 'toolasha-shop-max-buy-button';

// Each panel is its own React component with its own CSS-module class prefix, but all share
// the same inner structure: <label>Quantity</label> + <input type="number"> + an empty error
// <div>, then a cost line, then the Buy <button>. Prefixes survive game rebuilds; the hash
// suffix after them does not.
const PANEL_CONFIGS = [
    { key: 'shop', inputContainerClass: 'ShopPanel_inputContainer', costStyle: 'text' },
    { key: 'tasks', inputContainerClass: 'TasksPanel_inputContainer', costStyle: 'icon' },
    { key: 'labyrinth', inputContainerClass: 'LabyrinthPanel_inputContainer', costStyle: 'icon' },
    // Cowbell Store's MooPass (cowbell tier), Community Buffs, and Convenience tabs all render
    // through this same component/class - one target covers all three.
    { key: 'cowbellStore', inputContainerClass: 'CowbellStorePanel_inputContainer', costStyle: 'icon' },
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
    }

    /**
     * @param {Element} container - the *Panel_inputContainer element
     * @param {{costStyle: 'text'|'icon'}} panelConfig
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
            this.handleMaxClick(container, input, panelConfig.costStyle);
        });

        inputWrapper.insertAdjacentElement('afterend', button);
    }

    /**
     * @param {Element} container
     * @param {HTMLInputElement} input
     * @param {'text'|'icon'} costStyle
     */
    async handleMaxClick(container, input, costStyle) {
        const costLines = resolveCostLines(container, costStyle);
        const candidate = computeMaxAffordable(costLines);
        if (candidate === null) return;

        await this.fillAndVerify(container, input, candidate);
    }

    /**
     * Fill the input with `candidate`, then - since some purchases (e.g. Cowbell Store's
     * Convenience tab) enforce a cap beyond raw affordability that isn't readable from the DOM -
     * treat the Buy button's disabled state as the oracle and binary-search downward until a
     * valid quantity is found. This also self-corrects any currency misidentification instead
     * of silently leaving an invalid quantity filled in.
     * @param {Element} container
     * @param {HTMLInputElement} input
     * @param {number} candidate
     */
    async fillAndVerify(container, input, candidate) {
        const buyButton = () => container.parentElement?.querySelector('button[class*="Button_success"]');

        const setAndCheckDisabled = async (value) => {
            setReactInputValue(input, value, { focus: false });
            await nextFrame();
            const button = buyButton();
            return button ? button.disabled : true;
        };

        if (!(await setAndCheckDisabled(candidate))) return;

        let low = 1;
        let high = candidate - 1;
        let best = null;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (await setAndCheckDisabled(mid)) {
                high = mid - 1;
            } else {
                best = mid;
                low = mid + 1;
            }
        }

        if (best !== null) {
            await setAndCheckDisabled(best);
        }
        // else: nothing affordable even at quantity 1 - leave the input as last probed and let
        // the game's own validation messaging explain why, same as if the user had typed it.
    }
}

const shopMaxBuyButton = new ShopMaxBuyButton();
export default shopMaxBuyButton;
