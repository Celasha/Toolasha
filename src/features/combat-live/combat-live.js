/**
 * Combat Live
 *
 * Live combat meters fed by the game's own battle messages: party damage (DPS and true DPS),
 * damage taken, and mana. All state lives in BattleEventTracker / BattleStats (pure logic); this
 * module only owns the WebSocket subscriptions and the panel lifecycle.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import BattleEventTracker from './battle-event-tracker.js';
import BattleStats from './battle-stats.js';
import CombatLiveRecorder from './combat-live-recorder.js';
import combatLiveUI from './combat-live-ui.js';

class CombatLive {
    constructor() {
        this.isInitialized = false;
        this.tracker = new BattleEventTracker();
        this.stats = new BattleStats();
        this.recorder = new CombatLiveRecorder();
        this.lastMessageAt = 0;
        this.newBattleHandler = null;
        this.battleUpdatedHandler = null;
        this.socketCloseHandler = null;
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.newBattleHandler = (data) => this.onNewBattle(data);
        this.battleUpdatedHandler = (data) => this.onBattleUpdated(data);
        // A dropped connection can lose ticks, so start the next battle's numbers from scratch
        this.socketCloseHandler = () => this.reset();

        webSocketHook.on('new_battle', this.newBattleHandler);
        webSocketHook.on('battle_updated', this.battleUpdatedHandler);
        webSocketHook.onSocketEvent('close', this.socketCloseHandler);

        combatLiveUI.initialize({
            getSummary: () => this.stats.getSummary(),
            getLastMessageAt: () => this.lastMessageAt,
            onReset: () => {
                this.stats.reset();
                this.recorder.clear();
            },
            isRecording: () => this.isRecording(),
            getRecording: () => (this.recorder.entries.length ? this.recorder.exportJSON() : null),
        });
    }

    onNewBattle(data) {
        const now = Date.now();
        this.tracker.handleNewBattle(data);
        this.stats.setPlayers(this.tracker.players.map((player) => player.name));
        if (this.isRecording()) {
            this.recorder.recordNewBattle(data, now, dataManager.getCurrentCharacterId());
        }
        this.lastMessageAt = now;
    }

    /**
     * @returns {boolean} Whether raw battle ticks are being kept for attribution debugging
     */
    isRecording() {
        return Boolean(config.getSetting('combatLive_record'));
    }

    onBattleUpdated(data) {
        if (!data || data.battleId !== this.tracker.battleId) return;
        const now = Date.now();
        if (this.isRecording()) {
            this.recorder.recordBattleUpdated(data, now);
        }
        this.stats.record(this.tracker.handleBattleUpdated(data), now);
        this.lastMessageAt = now;
    }

    reset() {
        this.tracker.reset();
        this.stats.reset();
        this.lastMessageAt = 0;
    }

    cleanup() {
        if (!this.isInitialized) return;
        this.isInitialized = false;

        if (this.newBattleHandler) webSocketHook.off('new_battle', this.newBattleHandler);
        if (this.battleUpdatedHandler) webSocketHook.off('battle_updated', this.battleUpdatedHandler);
        if (this.socketCloseHandler) webSocketHook.offSocketEvent('close', this.socketCloseHandler);
        this.newBattleHandler = null;
        this.battleUpdatedHandler = null;
        this.socketCloseHandler = null;

        combatLiveUI.cleanup();
        this.reset();
        // A recording holds party names, so it never outlives the character session
        this.recorder.clear();
    }
}

const combatLive = new CombatLive();

export default {
    name: 'Combat Live',
    initialize: () => combatLive.initialize(),
    cleanup: () => combatLive.cleanup(),
    // Exposed for tests
    instance: combatLive,
};
