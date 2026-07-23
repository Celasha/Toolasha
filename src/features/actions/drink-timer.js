/**
 * Drink Timer
 * Displays remaining drink time per slot inside each non-combat skill panel's
 * consumables section. Warns when any drink falls below the configured threshold
 * and highlights if the queued actions will outlast available drink supply.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { calculateDrinkRemainingSeconds, calculateQueueTimeSeconds } from '../../utils/drink-calculator.js';

const SECONDS_PER_HOUR = 3600;

class DrinkTimer {
    constructor() {
        this.initialized = false;
        this.observers = [];
    }

    initialize() {
        if (this.initialized) return;

        const unregister = domObserver.onClass(
            'DrinkTimer',
            'GatheringProductionSkillPanel_consumablesContainer',
            (el) => this._updatePanel(el)
        );
        this.observers.push(unregister);

        const unregisterAlchemy = domObserver.onClass('DrinkTimer-Alchemy', 'AlchemyPanel_consumablesContainer', (el) =>
            this._updatePanel(el)
        );
        this.observers.push(unregisterAlchemy);

        const unregisterEnhancing = domObserver.onClass(
            'DrinkTimer-Enhancing',
            'EnhancingPanel_consumablesContainer',
            (el) => this._updatePanel(el)
        );
        this.observers.push(unregisterEnhancing);

        const onUpdate = () => this._updateAllPanels();
        dataManager.on('consumables_updated', onUpdate);
        dataManager.on('items_updated', onUpdate);
        this.observers.push(() => {
            dataManager.off('consumables_updated', onUpdate);
            dataManager.off('items_updated', onUpdate);
        });

        this._updateAllPanels();
        this.initialized = true;
    }

    _updateAllPanels() {
        document.querySelectorAll('[class*="GatheringProductionSkillPanel_consumablesContainer"]').forEach((el) => {
            this._updatePanel(el);
        });
        document.querySelectorAll('[class*="AlchemyPanel_consumablesContainer"]').forEach((el) => {
            this._updatePanel(el);
        });
        document.querySelectorAll('[class*="EnhancingPanel_consumablesContainer"]').forEach((el) => {
            this._updatePanel(el);
        });
    }

    _updatePanel(consumablesContainer) {
        consumablesContainer.querySelector('.mwi-drink-timer')?.remove();

        const slotsEl = consumablesContainer.querySelector(
            '[class*="ActionTypeConsumableSlots_actionTypeConsumableSlots"]'
        );
        if (!slotsEl) return;

        const actionTypeHrid = this._getActionTypeHrid(slotsEl);
        if (!actionTypeHrid || actionTypeHrid === '/action_types/combat') return;

        const drinks = calculateDrinkRemainingSeconds(actionTypeHrid);
        if (!drinks.length) return;

        const thresholdSeconds = config.getSettingValue('drinkTimer_warningThreshold', 24) * SECONDS_PER_HOUR;
        const queueSeconds = calculateQueueTimeSeconds(actionTypeHrid);

        const wrapper = document.createElement('div');
        wrapper.className = 'mwi-drink-timer';
        wrapper.style.cssText = 'padding: 3px 8px 4px; font-size: 11px; line-height: 1.5;';

        // Per-drink time row
        const drinkParts = drinks.map(({ name, totalSeconds }) => {
            const color =
                totalSeconds < SECONDS_PER_HOUR ? '#ef4444' : totalSeconds < thresholdSeconds ? '#f0a830' : '#9ca3af';
            const prefix = totalSeconds < thresholdSeconds ? '⚠ ' : '';
            return `<span style="color:${color};">${prefix}${name}: ${this._formatTime(totalSeconds)}</span>`;
        });
        const drinkRow = document.createElement('div');
        drinkRow.innerHTML = drinkParts.join('<span style="color:#4b5563;"> · </span>');
        wrapper.appendChild(drinkRow);

        // Queue warning row
        if (queueSeconds > 0) {
            const minDrinkSeconds = Math.min(...drinks.map((d) => d.totalSeconds));
            const shortfall = queueSeconds - minDrinkSeconds;
            if (shortfall > 0) {
                const shortDrink = drinks.find((d) => d.totalSeconds === minDrinkSeconds);
                const queueRow = document.createElement('div');
                queueRow.style.color = '#f0a830';
                queueRow.textContent = `⚠ Queue (${this._formatTime(queueSeconds)}) outlasts ${shortDrink.name} by ${this._formatTime(shortfall)}`;
                wrapper.appendChild(queueRow);
            }
        }

        slotsEl.insertAdjacentElement('afterend', wrapper);
    }

    /**
     * Get actionTypeHrid from the ActionTypeConsumableSlots element via fiber.
     * The prop lives one level up in the return fiber.
     */
    _getActionTypeHrid(slotsEl) {
        const root = document.getElementById('root');
        const rootFiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
        if (!rootFiber) return null;

        function walk(f, target) {
            if (!f) return null;
            if (f.stateNode === target) return f;
            return walk(f.child, target) || walk(f.sibling, target);
        }

        const fiber = walk(rootFiber, slotsEl);
        return fiber?.return?.memoizedProps?.actionTypeHrid ?? null;
    }

    _formatTime(seconds) {
        if (seconds <= 0) return '0m';
        const h = Math.floor(seconds / SECONDS_PER_HOUR);
        const m = Math.floor((seconds % SECONDS_PER_HOUR) / 60);
        if (h >= 48) return `${Math.round(seconds / 86400)}d`;
        if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
        return `${m}m`;
    }

    cleanup() {
        this.observers.forEach((fn) => fn());
        this.observers = [];
        document.querySelectorAll('.mwi-drink-timer').forEach((el) => el.remove());
        this.initialized = false;
    }
}

const drinkTimer = new DrinkTimer();

export default {
    name: 'Drink Timer',
    initialize: () => drinkTimer.initialize(),
    cleanup: () => drinkTimer.cleanup(),
};
