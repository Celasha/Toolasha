/**
 * Combat Simulator Feature Module
 * Integrates the combat simulator engine into the Toolasha UI
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import combatSimUI from './combat-sim-ui.js';
import { cancelSimulation } from './combat-sim-runner.js';
import { cancelAllZonesSimulation } from './all-zones-runner.js';

const BUTTON_CLASS = 'toolasha-combat-sim-btn';

class CombatSim {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
    }

    /**
     * Initialize the combat simulator feature
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('combatSim')) {
            return;
        }

        this.isInitialized = true;

        combatSimUI.buildPanel();

        // Watch for the combat panel appearing and inject the button
        const unregister = domObserver.onClass('CombatSimButton', 'CombatPanel_combatPanel', (node) => {
            this._injectButton(node);
        });
        this.unregisterHandlers.push(unregister);

        // Try to inject into an already-visible combat panel
        const existingPanel = document.querySelector('[class*="CombatPanel_combatPanel"]');
        if (existingPanel) {
            this._injectButton(existingPanel);
        }
    }

    /**
     * Inject the Combat Sim toggle button into a combat panel
     * @param {HTMLElement} combatPanel - The combat panel element
     */
    _injectButton(combatPanel) {
        if (!combatPanel || combatPanel.querySelector(`.${BUTTON_CLASS}`)) {
            return;
        }

        // Find the tabs container within the combat panel
        const tabsContainer = combatPanel.querySelector('[class*="TabsComponent_tabsContainer"] > div > div > div');

        if (!tabsContainer) {
            return;
        }

        const button = document.createElement('div');
        button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary css-1q2h7u5 ' + BUTTON_CLASS;
        button.textContent = 'Combat Sim';
        button.style.cssText =
            'cursor: pointer; background: linear-gradient(135deg, #3a7bd5, #5f3dc4); color: #fff; border-radius: 4px; padding: 4px 10px; font-size: 12px; white-space: nowrap;';

        button.addEventListener('click', () => {
            combatSimUI.toggle();
        });

        tabsContainer.appendChild(button);
    }

    /**
     * Disable the combat simulator feature and clean up
     */
    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        cancelSimulation();
        cancelAllZonesSimulation();
        combatSimUI.destroy();

        // Remove all injected buttons
        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((btn) => btn.remove());

        this.isInitialized = false;
    }
}

const combatSim = new CombatSim();
export default combatSim;
