/**
 * Combat Battle Counter
 * Injects a battle/wave counter next to the action name in the top-left header panel.
 * - Regular zones: "Battle #N" — from battleId in new_battle message
 * - Dungeons: "Wave N · Battle #N" — wave from wave index, battle from battleId
 * - Labyrinth: "Attempt #N" — from entryCount in labyrinth_updated room data
 *
 * Target: Header_actionName (inline with zone name, e.g. "Chimerical Den · Wave 5")
 * domObserver watches Header_actionName so the span is re-injected whenever
 * React replaces that element between dungeon waves.
 */

import webSocketHook from '../../core/websocket.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';

const COUNTER_ID = 'mwi-battle-counter';
const ACTION_NAME_SELECTOR = '[class*="Header_actionName"]';
const CURRENT_ACTION_SELECTOR = '[class*="Header_currentAction"]';

class CombatBattleCounter {
    constructor() {
        this.initialized = false;
        this.newBattleHandler = null;
        this.labyrinthHandler = null;
        this.unregisterObserver = null;
        this.battleId = 0;
        this.currentWave = 0;
        this.isDungeon = false;
        this.isLabyrinth = false;
        this.labyrinthAttempt = 0;
    }

    initialize() {
        if (this.initialized) return;
        if (!config.getSetting('combatBattleCounter')) return;

        this.newBattleHandler = (data) => this._onNewBattle(data);
        webSocketHook.on('new_battle', this.newBattleHandler);

        this.labyrinthHandler = (data) => this._onLabyrinthUpdated(data);
        webSocketHook.on('labyrinth_updated', this.labyrinthHandler);

        this._onActionsUpdated = (data) => this._checkCombatEnded(data);
        dataManager.on('actions_updated', this._onActionsUpdated);

        this.unregisterObserver = domObserver.onClass('CombatBattleCounter', 'Header_actionName', () =>
            this._injectOrUpdate()
        );

        this.initialized = true;
    }

    _checkCombatEnded(data) {
        if (this.battleId === 0 && this.labyrinthAttempt === 0) return;

        const combatEnded = data.endCharacterActions?.some(
            (a) => a.isDone && a.actionHrid?.startsWith('/actions/combat/')
        );
        const hasCombatAction = data.endCharacterActions?.some(
            (a) => !a.isDone && a.actionHrid?.startsWith('/actions/combat/')
        );
        const hasNewNonCombatAction = data.endCharacterActions?.some(
            (a) => !a.isDone && !a.actionHrid?.startsWith('/actions/combat/') && a.currentCount === 0
        );

        if (combatEnded || (hasNewNonCombatAction && !hasCombatAction)) {
            this.battleId = 0;
            this.currentWave = 0;
            this.isDungeon = false;
            this.isLabyrinth = false;
            this.labyrinthAttempt = 0;
            document.getElementById(COUNTER_ID)?.remove();
        }
    }

    _onLabyrinthUpdated(data) {
        const labyrinth = data.labyrinth;
        if (!labyrinth?.isActive) return;

        let pathCoords;
        try {
            pathCoords = JSON.parse(labyrinth.pathData || '[]');
        } catch {
            return;
        }
        if (!pathCoords.length) return;

        const active = pathCoords[pathCoords.length - 1];
        const room = labyrinth.roomData?.[active.y]?.[active.x];
        if (!room || room.roomType !== '/labyrinth_room_types/combat') return;

        const entryCount = room.entryCount || 0;
        if (entryCount > 0) {
            this.isLabyrinth = true;
            this.labyrinthAttempt = entryCount;
            this._injectOrUpdate();
        }
    }

    _onNewBattle(data) {
        this.isLabyrinth = false;
        this.battleId = data.battleId;
        const actions = dataManager.getCurrentActions();
        const combatAction = actions.find((a) => a.actionHrid?.startsWith('/actions/combat/') && !a.isDone);
        const isDungeon = combatAction
            ? dataManager.getActionDetails(combatAction.actionHrid)?.combatZoneInfo?.isDungeon === true
            : false;

        if (isDungeon) {
            this.isDungeon = true;
            this.currentWave = data.wave ?? 0;
        } else {
            this.isDungeon = false;
        }
        this._injectOrUpdate();
    }

    _injectOrUpdate() {
        if (this.battleId === 0 && this.labyrinthAttempt === 0) {
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

        if (this.isLabyrinth) {
            el.textContent = `· Attempt #${this.labyrinthAttempt}`;
        } else if (this.isDungeon) {
            el.textContent = `· Wave ${this.currentWave} · Battle #${this.battleId}`;
        } else {
            el.textContent = `· Battle #${this.battleId}`;
        }
    }

    disable() {
        if (this.newBattleHandler) {
            webSocketHook.off('new_battle', this.newBattleHandler);
            this.newBattleHandler = null;
        }
        if (this.labyrinthHandler) {
            webSocketHook.off('labyrinth_updated', this.labyrinthHandler);
            this.labyrinthHandler = null;
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
