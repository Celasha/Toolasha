/**
 * Combat Battle Counter
 * Injects a battle/wave counter next to the action name in the top-left header panel.
 * - Regular zones: "Battle #N" — from battleId in new_battle message
 * - Dungeons: "Wave N · Battle #N" — wave from wave index, battle from battleId
 *
 * Target: Header_actionName (inline with zone name, e.g. "Chimerical Den · Wave 5")
 * domObserver watches Header_actionName so the span is re-injected whenever
 * React replaces that element between dungeon waves.
 */

import webSocketHook from '../../core/websocket.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import { t } from '../../core/i18n.js';

const COUNTER_ID = 'mwi-battle-counter';
const ACTION_NAME_SELECTOR = '[class*="Header_actionName"]';
const CURRENT_ACTION_SELECTOR = '[class*="Header_currentAction"]';

class CombatBattleCounter {
    constructor() {
        this.initialized = false;
        this.newBattleHandler = null;
        this.unregisterObserver = null;
        this.battleId = 0;
        this.currentWave = 0;
        this.isDungeon = false;
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('combatBattleCounter')) return;

        this.newBattleHandler = (data) => this._onNewBattle(data);
        webSocketHook.on('new_battle', this.newBattleHandler);

        this._onActionsUpdated = () => this._checkCombatEnded();
        dataManager.on('actions_updated', this._onActionsUpdated);

        this.unregisterObserver = domObserver.onClass('CombatBattleCounter', 'Header_actionName', () =>
            this._injectOrUpdate()
        );

        this.initialized = true;
    }

    _checkCombatEnded() {
        if (!this._isInDungeon() && !this._isInCombat()) {
            this.battleId = 0;
            this.currentWave = 0;
            this.isDungeon = false;
            document.getElementById(COUNTER_ID)?.remove();
        }
    }

    _isInCombat() {
        const actions = dataManager.getCurrentActions();
        if (!actions || actions.length === 0) return false;
        const active = actions[0];
        return active.actionHrid?.startsWith('/actions/combat/') && !active.isDone;
    }

    _isInDungeon() {
        if (!this._isInCombat()) return false;
        const active = dataManager.getCurrentActions()[0];
        return dataManager.getActionDetails(active.actionHrid)?.combatZoneInfo?.isDungeon === true;
    }

    _onNewBattle(data) {
        this.battleId = data.battleId;
        if (this._isInDungeon()) {
            this.isDungeon = true;
            this.currentWave = data.wave ?? 0;
        } else {
            this.isDungeon = false;
        }
        this._injectOrUpdate();
    }

    _injectOrUpdate() {
        // Only show counter while in combat
        if (!this._isInCombat()) {
            document.getElementById(COUNTER_ID)?.remove();
            return;
        }

        const currentAction = document.querySelector(CURRENT_ACTION_SELECTOR);
        const nameRow = currentAction?.querySelector(ACTION_NAME_SELECTOR);
        if (!currentAction || !nameRow) return;

        let el = document.getElementById(COUNTER_ID);
        if (!el || !el.isConnected) {
            el = document.createElement('span');
            el.id = COUNTER_ID;
            el.style.cssText = 'color: rgba(255,255,255,0.6); margin-left: 6px; white-space: nowrap;';
            nameRow.appendChild(el);
        }

        if (this.isDungeon) {
            el.textContent = `· ${t('Wave ')}${this.currentWave} · ${t('Battle #')}${this.battleId}`;
        } else if (this.battleId > 0) {
            el.textContent = `· ${t('Battle #')}${this.battleId}`;
        }
    }

    disable() {
        if (this.newBattleHandler) {
            webSocketHook.off('new_battle', this.newBattleHandler);
            this.newBattleHandler = null;
        }
        if (this._onActionsUpdated) {
            dataManager.off('actions_updated', this._onActionsUpdated);
            this._onActionsUpdated = null;
        }
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        document.getElementById(COUNTER_ID)?.remove();
        this.initialized = false;
    }
}

const combatBattleCounter = new CombatBattleCounter();

export default combatBattleCounter;
