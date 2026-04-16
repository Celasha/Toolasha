/**
 * Task Claim Collector
 * Adds a "Claim Reward" proxy button to the task panel header next to the
 * "Highlight Task Items" button. One user click triggers one real click on the
 * first available Claim Reward button in the task list. React manages the original
 * buttons normally; this feature only reads and forwards clicks.
 */

import { GAME } from '../../utils/selectors.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';

const PROXY_BTN_ID = 'mwi-claim-proxy-btn';
const CLAIM_BTN_SELECTOR = 'button.Button_button__1Fe9z.Button_buy__3s24l';

class TaskClaimCollector {
    constructor() {
        this.initialized = false;
        this.unregisterObserver = null;
        this.mutationObserver = null;
        this.proxyButton = null;
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('taskClaimCollector')) return;

        this.unregisterObserver = domObserver.onClass(
            'TaskClaimCollector',
            'TasksPanel_taskSlotCount',
            (headerElement) => this._onTaskPanelAppeared(headerElement)
        );

        this.initialized = true;
    }

    _onTaskPanelAppeared(headerElement) {
        const taskList = document.querySelector(GAME.TASK_LIST);
        if (!taskList) return;

        this._ensureProxyButton(headerElement);
        this._updateProxyButton(taskList);

        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }

        this.mutationObserver = new MutationObserver(() => {
            const list = document.querySelector(GAME.TASK_LIST);
            if (list) this._updateProxyButton(list);
        });

        this.mutationObserver.observe(taskList, { childList: true, subtree: true });
    }

    /**
     * Create the proxy button in the task panel header after "Highlight Task Items".
     */
    _ensureProxyButton(headerElement) {
        if (document.getElementById(PROXY_BTN_ID)) return;

        this.proxyButton = document.createElement('button');
        this.proxyButton.id = PROXY_BTN_ID;
        this.proxyButton.className = 'Button_button__1Fe9z Button_small__3fqC7';
        this.proxyButton.style.marginLeft = '8px';
        this.proxyButton.addEventListener('click', () => this._claimNext());

        const highlightBtn = headerElement.querySelector('[data-mwi-task-highlight]');
        if (highlightBtn) {
            highlightBtn.after(this.proxyButton);
        } else {
            headerElement.appendChild(this.proxyButton);
        }
    }

    /**
     * Update the proxy button label and visibility based on how many claims are available.
     */
    _updateProxyButton(taskList) {
        if (!this.proxyButton) return;

        const count = this._getClaimableButtons(taskList).length;
        if (count > 0) {
            this.proxyButton.textContent = count > 1 ? `Claim Reward (${count})` : 'Claim Reward';
            this.proxyButton.style.display = '';
        } else {
            this.proxyButton.style.display = 'none';
        }
    }

    /**
     * Return all enabled Claim Reward buttons in the task list.
     */
    _getClaimableButtons(taskList) {
        return Array.from(taskList.querySelectorAll(CLAIM_BTN_SELECTOR)).filter(
            (btn) => btn.textContent.trim() === 'Claim Reward' && !btn.disabled
        );
    }

    /**
     * Click the first available claim button in the task list.
     */
    _claimNext() {
        const taskList = document.querySelector(GAME.TASK_LIST);
        if (!taskList) return;

        const claimable = this._getClaimableButtons(taskList);
        if (claimable.length > 0) {
            claimable[0].click();
        }
    }

    disable() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.proxyButton) {
            this.proxyButton.remove();
            this.proxyButton = null;
        }

        this.initialized = false;
    }
}

const taskClaimCollector = new TaskClaimCollector();

export default taskClaimCollector;
