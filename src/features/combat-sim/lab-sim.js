/**
 * Lab Sim Feature Module
 * Integrates the labyrinth simulator into the game's Labyrinth page.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import labSimUI from './lab-sim-ui.js';
import { cancelSimulation } from './combat-sim-runner.js';
import { t } from '../../core/i18n.js';

const BUTTON_CLASS = 'toolasha-lab-sim-btn';

class LabSim {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('combatSim')) return;

        this.isInitialized = true;

        labSimUI.buildPanel();

        const unregister = domObserver.onClass('LabSimButton', 'LabyrinthPanel_tabsComponentContainer', (node) => {
            this._injectButton(node);
        });
        this.unregisterHandlers.push(unregister);

        const existingPanel = document.querySelector('[class*="LabyrinthPanel_tabsComponentContainer"]');
        if (existingPanel) {
            this._injectButton(existingPanel);
        }
    }

    /**
     * @param {HTMLElement} tabsContainer - The LabyrinthPanel_tabsComponentContainer element
     */
    _injectButton(tabsContainer) {
        if (!tabsContainer || tabsContainer.querySelector(`.${BUTTON_CLASS}`)) return;

        const innerContainer = tabsContainer.querySelector('[class*="TabsComponent_tabsContainer"] > div > div > div');
        if (!innerContainer) return;

        const button = document.createElement('div');
        button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary css-1q2h7u5 ' + BUTTON_CLASS;
        button.textContent = t('Lab Sim');
        button.style.cssText =
            'cursor: pointer; background: linear-gradient(135deg, #3a7bd5, #5f3dc4); color: #fff; border-radius: 4px; padding: 4px 10px; font-size: 12px; white-space: nowrap;';

        button.addEventListener('click', () => {
            labSimUI.toggle();
        });

        innerContainer.appendChild(button);
    }

    disable() {
        for (const unregister of this.unregisterHandlers) {
            unregister();
        }
        this.unregisterHandlers = [];

        cancelSimulation();
        labSimUI.destroy();

        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((btn) => btn.remove());

        this.isInitialized = false;
    }
}

const labSim = new LabSim();
export default labSim;
