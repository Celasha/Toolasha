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
import { formatLargeNumber } from '../../utils/formatters.js';
import performanceMonitor from '../../utils/performance-monitor.js';
import BattleEventTracker from './battle-event-tracker.js';
import BattleStats from './battle-stats.js';
import { getAbilityEffects, getAbilityTiming, getDotDurationMs } from './ability-effects.js';
import BuffTracker from './buff-tracker.js';
import { playerColor, sharedPlayerColors } from './combat-live-chart.js';
import unitOverlay from './unit-overlay.js';
import CombatLiveHistory from './combat-live-history.js';
import CombatLiveRecorder from './combat-live-recorder.js';
import combatLiveUI from './combat-live-ui.js';

// The labels under the units hide once the fight has been quiet this long, like the panel
const OVERLAY_IDLE_MS = 60000;

// Ordinary monsters enrage after 3 minutes; a boss takes longer, which is the one reliable sign of a boss wave
const BOSS_ENRAGE_TIMER_NS = 180e9;

class CombatLive {
    constructor() {
        this.isInitialized = false;
        this.tracker = new BattleEventTracker();
        this.stats = new BattleStats();
        this.stats.setDotLookup(getDotDurationMs);
        this.stats.setAbilityLookup(getAbilityTiming);
        this.recorder = new CombatLiveRecorder();
        this.buffs = new BuffTracker();
        this.buffs.setEffectsLookup(getAbilityEffects);
        this.history = new CombatLiveHistory();
        this.lastMessageAt = 0;
        // Rooms of a labyrinth are separate combats of one run, so they must not restart the meters
        this.inLabyrinth = false;
        this.labyrinthHandler = null;
        this.newBattleHandler = null;
        this.battleUpdatedHandler = null;
        this.socketCloseHandler = null;
    }

    initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.newBattleHandler = (data) => this.onNewBattle(data);
        // Measured, because this is the part that runs many times a second in a fight
        this.battleUpdatedHandler = performanceMonitor.wrap('combatLive:battle_updated', (data) =>
            this.onBattleUpdated(data)
        );
        // A dropped connection can lose ticks, so start the next battle's numbers from scratch
        this.socketCloseHandler = () => this.reset();

        webSocketHook.on('new_battle', this.newBattleHandler);
        webSocketHook.on('battle_updated', this.battleUpdatedHandler);
        this.labyrinthHandler = (data) => {
            this.inLabyrinth = Boolean(data?.labyrinth?.isActive);
        };
        webSocketHook.on('labyrinth_updated', this.labyrinthHandler);
        webSocketHook.onSocketEvent('close', this.socketCloseHandler);

        combatLiveUI.initialize({
            getSummary: () => this.stats.getSummary(),
            getLastMessageAt: () => this.lastMessageAt,
            onReset: () => {
                this.archiveAndReset();
                this.recorder.clear();
            },
            history: this.history,
            isRecording: () => this.isRecording(),
            getRecording: () => (this.recorder.entries.length ? this.recorder.exportJSON() : null),
        });

        unitOverlay.initialize({
            getBuffs: (side, index, now) => this.buffs.getUnit(side, index, now),
            getBadge: (index) => this.getUnitBadge(index),
            isActive: () => this.lastMessageAt > 0 && Date.now() - this.lastMessageAt <= OVERLAY_IDLE_MS,
            rosterSize: (side) => (side === 'p' ? this.tracker.players : this.tracker.monsters).length,
        });
    }

    /**
     * The label under a player on the combat screen: their DPS, and their HPS if they heal.
     * @param {number} index - Position in the party
     * @returns {?{text: string, healText: string, color: string}}
     */
    getUnitBadge(index) {
        const name = this.tracker.players[index]?.name;
        if (!name) return null;
        const { dps, hps } = this.stats.getBadge(name);
        return {
            text: `${formatLargeNumber(dps, 1)} dps`,
            healText: hps > 0.05 ? `${formatLargeNumber(hps, 1)} hps` : '',
            color: playerColor(sharedPlayerColors, name),
        };
    }

    /**
     * A new combat instance: the server gives every wave of one combat (a zone stay, a dungeon run) the same
     * `combatStartTime`, so a different one means a different combat. Labyrinth rooms are left alone.
     * @param {Object} data - new_battle payload
     * @returns {boolean}
     */
    isNewCombat(data) {
        const previous = this.tracker.combatStartTime;
        return (
            Boolean(config.getSetting('combatLive_autoReset')) &&
            !this.inLabyrinth &&
            previous !== null &&
            data?.combatStartTime != null &&
            data.combatStartTime !== previous
        );
    }

    /**
     * Keep the finished session in the history, then start the meters over.
     */
    archiveAndReset() {
        this.history.archive(this.stats.getSummary()).catch((error) => {
            console.error('[CombatLive] Failed to save the finished session:', error);
        });
        this.stats.reset();
    }

    onNewBattle(data) {
        const now = Date.now();
        if (this.isNewCombat(data)) this.archiveAndReset();
        this.tracker.handleNewBattle(data);
        this.stats.beginWave(now);
        this.buffs.beginWave();
        this.stats.setBoss(
            this.tracker.monsters.some((monster) => monster.enrageTimerNs > BOSS_ENRAGE_TIMER_NS),
            now
        );
        this.stats.setPlayers(this.tracker.players.map((player) => player.name));
        this.stats.setLoadouts(this.tracker.players);
        const selfId = String(dataManager.getCurrentCharacterId() ?? '');
        const self = this.tracker.players.find((player) => selfId && String(player.id) === selfId);
        this.stats.setSelf(self?.name ?? null);
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
        const events = this.tracker.handleBattleUpdated(data);
        this.stats.record(events, now);
        this.buffs.record(events, now, {
            p: this.tracker.players.map((unit) => ({ index: unit.index, hp: unit.hp })),
            m: this.tracker.monsters.map((unit) => ({ index: unit.index, hp: unit.hp })),
        });
        this.lastMessageAt = now;
    }

    reset() {
        this.tracker.reset();
        this.stats.reset();
        this.buffs.reset();
        this.lastMessageAt = 0;
    }

    cleanup() {
        if (!this.isInitialized) return;
        this.isInitialized = false;

        if (this.newBattleHandler) webSocketHook.off('new_battle', this.newBattleHandler);
        if (this.battleUpdatedHandler) webSocketHook.off('battle_updated', this.battleUpdatedHandler);
        if (this.socketCloseHandler) webSocketHook.offSocketEvent('close', this.socketCloseHandler);
        if (this.labyrinthHandler) webSocketHook.off('labyrinth_updated', this.labyrinthHandler);
        this.labyrinthHandler = null;
        this.newBattleHandler = null;
        this.battleUpdatedHandler = null;
        this.socketCloseHandler = null;

        combatLiveUI.cleanup();
        unitOverlay.cleanup();
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
