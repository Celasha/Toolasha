/**
 * Combat Consumable Timer
 * Displays remaining runway for active combat food/drinks directly below each item's icon in
 * the live in-battle Consumables grid. Unlike skilling teas, combat food has no fixed buff
 * duration and combat drinks are trigger-gated rather than continuously active, so the
 * duration-based math used by Drink Timer doesn't apply here. Instead this reuses Combat
 * Stats' own empirical consumption-rate tracker (timeToZeroSeconds) so the number matches the
 * Combat Stats popup.
 *
 * Each active item's hrid is read directly off its rendered icon (the sprite href fragment is
 * the item's slug, e.g. "#star_fruit_gummy" -> "/items/star_fruit_gummy") rather than from a
 * slot-assignment data source, since the live battle grid only ever shows what's actually
 * equipped this battle.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import combatStatsDataCollector from '../combat-stats/combat-stats-data-collector.js';
import { formatRunway, getRunwayColor } from '../combat-stats/combat-stats-ui.js';

const SECONDS_PER_HOUR = 3600;

class CombatConsumableTimer {
    constructor() {
        this.initialized = false;
        this.observers = [];
    }

    /**
     * Setup setting change listener (always active, even when feature is disabled)
     */
    setupSettingListener() {
        config.onSettingChange('combatConsumableTimer', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.cleanup();
            }
        });
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('combatConsumableTimer')) return;

        const unregister = domObserver.onClass('CombatConsumableTimer', 'BattlePanel_combatConsumables', (el) =>
            this._updatePanel(el)
        );
        this.observers.push(unregister);

        // Refresh on every new_battle tick (each kill), the same signal Combat Stats' own
        // collector uses to recompute timeToZeroSeconds, since the grid itself doesn't remount
        // between kills so domObserver alone wouldn't otherwise re-trigger this.
        this.newBattleHandler = () => this._updateAllPanels();
        webSocketHook.on('new_battle', this.newBattleHandler);
        this.observers.push(() => webSocketHook.off('new_battle', this.newBattleHandler));

        // Combat Stats only loads its persisted last-session data lazily when its own popup
        // opens. Backfill it here so the panel can show a runway estimate immediately, even
        // before this session's first kill.
        combatStatsDataCollector.loadLatestData().then(() => this._updateAllPanels());

        this._updateAllPanels();
        this.initialized = true;
    }

    _updateAllPanels() {
        document.querySelectorAll('[class*="BattlePanel_combatConsumables"]').forEach((el) => {
            this._updatePanel(el);
        });
    }

    _updatePanel(consumablesContainer) {
        consumablesContainer.querySelectorAll('.mwi-combat-consumable-timer').forEach((el) => el.remove());

        const itemEls = consumablesContainer.querySelectorAll('[class*="CombatConsumable_combatConsumable"]');
        if (!itemEls.length) return;

        const selfConsumables = this._getSelfConsumables();
        if (!selfConsumables) return;

        const thresholdSeconds = config.getSettingValue('combatStats_runwayWarningThreshold', 12) * SECONDS_PER_HOUR;

        itemEls.forEach((itemEl) => {
            const itemHrid = this._getItemHrid(itemEl);
            if (!itemHrid) return;

            const consumable = selfConsumables.find((c) => c.itemHrid === itemHrid);
            if (!consumable) return;

            const { timeToZeroSeconds } = consumable;
            const color = getRunwayColor(timeToZeroSeconds);
            const prefix = Number.isFinite(timeToZeroSeconds) && timeToZeroSeconds < thresholdSeconds ? '⚠ ' : '';

            const label = document.createElement('div');
            label.className = 'mwi-combat-consumable-timer';
            label.style.cssText = `color:${color}; font-size: 10px; text-align: center; line-height: 1.3;`;
            label.textContent = `${prefix}${formatRunway(timeToZeroSeconds)}`;

            itemEl.insertAdjacentElement('afterend', label);
        });
    }

    /**
     * Item hrid rendered by a single consumable slot, read from its icon's sprite href
     * fragment (e.g. "#star_fruit_gummy").
     * @param {Element} itemEl - A `.CombatConsumable_combatConsumable` element
     * @returns {string|null}
     */
    _getItemHrid(itemEl) {
        const use = itemEl.querySelector('use');
        const href = use?.getAttribute('href') || use?.getAttribute('xlink:href') || '';
        const slug = href.split('#')[1];
        return slug ? `/items/${slug}` : null;
    }

    /**
     * The current player's tracked consumables from Combat Stats' own tracker.
     * @returns {Array|null} null if Combat Stats has no data yet (feature disabled, or never tracked)
     */
    _getSelfConsumables() {
        const latestData = combatStatsDataCollector.getLatestData();
        const selfPlayer = latestData?.players?.find((player) => player.isCurrentPlayer);
        return selfPlayer?.consumables || null;
    }

    cleanup() {
        this.observers.forEach((fn) => fn());
        this.observers = [];
        document.querySelectorAll('.mwi-combat-consumable-timer').forEach((el) => el.remove());
        this.initialized = false;
    }
}

const combatConsumableTimer = new CombatConsumableTimer();
combatConsumableTimer.setupSettingListener();

export default {
    name: 'Combat Consumable Timer',
    initialize: () => combatConsumableTimer.initialize(),
    cleanup: () => combatConsumableTimer.cleanup(),
};
