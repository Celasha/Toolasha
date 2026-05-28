/**
 * Labyrinth Clear Rate Calculator
 * Shows expected clear time and success rate on labyrinth skilling and combat room tiles.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import { buildPlayerDTO, buildGameDataPayload, applyLoadoutSnapshotToDTO } from '../combat-sim/combat-sim-adapter.js';
import { runLabyrinthSimulation } from '../combat-sim/combat-sim-runner.js';
import loadoutSnapshot from './loadout-snapshot.js';

const ROOM_DURATION = 120;
const BASE_SKILLING_TIME = 10;
const BASE_ENHANCING_TIME = 8;
const UPGRADE_STEP = 0.01;
const UPGRADE_SUCCESS_STEP = 0.005;
const BADGE_CLASS = 'mwi-labyrinth-clear';
const RECOMMEND_CLASS = 'mwi-labyrinth-recommend';
const RECOMMEND_CONTROLS_CLASS = 'mwi-labyrinth-recommend-controls';
const LIVE_PROGRESS_CLASS = 'mwi-labyrinth-live-progress';
const LIVE_PROGRESS_STALE_MS = 5000;

class LabyrinthClearRate {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
        this.roomData = null;
        this.wsHandler = null;
        this.combatCache = new Map();
        this.simQueue = [];
        this.simRunning = false;
        this.recommendations = new Map();
        this.recommendRunning = false;
        this._recommendSimHours = 1;
        this.liveProgressHandler = null;
        this.liveProgressTimeout = null;
    }

    initialize() {
        if (!config.getSetting('labyrinthClearRate')) {
            return;
        }

        if (this.isInitialized) {
            return;
        }

        this.wsHandler = (data) => this.onLabyrinthUpdated(data);
        webSocketHook.on('labyrinth_updated', this.wsHandler);

        this.settingHandler = () => {
            this.combatCache.clear();
            this.recommendations.clear();
            this.injectOverlays();
        };
        webSocketHook.on('setting_updated', this.settingHandler);

        this.loadoutsHandler = () => {
            this.combatCache.clear();
            this.recommendations.clear();
            this.injectOverlays();
        };
        webSocketHook.on('loadouts_updated', this.loadoutsHandler);

        this.liveProgressHandler = (data) => this.onLiveProgress(data);
        webSocketHook.on('labyrinth_room_progress', this.liveProgressHandler);

        const unregister = domObserver.onClass('LabyrinthClearRate', 'LabyrinthPanel_skipThreshold', () =>
            this.injectOverlays()
        );
        this.unregisterHandlers.push(unregister);

        setTimeout(() => this.injectOverlays(), 500);

        this.isInitialized = true;
    }

    disable() {
        if (this.wsHandler) {
            webSocketHook.off('labyrinth_updated', this.wsHandler);
            this.wsHandler = null;
        }

        if (this.settingHandler) {
            webSocketHook.off('setting_updated', this.settingHandler);
            this.settingHandler = null;
        }

        if (this.loadoutsHandler) {
            webSocketHook.off('loadouts_updated', this.loadoutsHandler);
            this.loadoutsHandler = null;
        }

        if (this.liveProgressHandler) {
            webSocketHook.off('labyrinth_room_progress', this.liveProgressHandler);
            this.liveProgressHandler = null;
        }

        this.clearLiveProgress();

        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];

        document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
        document.querySelectorAll(`.${RECOMMEND_CLASS}`).forEach((el) => el.remove());
        document.querySelectorAll(`.${RECOMMEND_CONTROLS_CLASS}`).forEach((el) => el.remove());
        document.querySelectorAll(`.${LIVE_PROGRESS_CLASS}`).forEach((el) => el.remove());

        this.roomData = null;
        this.combatCache.clear();
        this.simQueue = [];
        this.simRunning = false;
        this.recommendations.clear();
        this.recommendRunning = false;
        this.isInitialized = false;
    }

    onLabyrinthUpdated(data) {
        const roomData = data.labyrinth?.roomData;
        if (roomData) {
            this.roomData = roomData;
            this.injectOverlays();
        }
    }

    /**
     * Get labyrinth upgrade levels from characterInfo
     */
    getLabyrinthUpgrades() {
        const info = dataManager.characterData?.characterInfo;
        if (!info) return { speed: 0, efficiency: 0, success: 0, doubleProgress: 0 };

        return {
            speed: Math.max(0, Math.floor(Number(info.labyrinthSkillActionSpeedLevel) || 0)),
            efficiency: Math.max(0, Math.floor(Number(info.labyrinthSkillingEfficiencyLevel) || 0)),
            success: Math.max(0, Math.floor(Number(info.labyrinthSkillingSuccessLevel) || 0)),
            doubleProgress: Math.max(0, Math.floor(Number(info.labyrinthSkillingDoubleProgressLevel) || 0)),
        };
    }

    /**
     * Get crate buff arrays for all equipped crates
     */
    getCrateBuffs() {
        const labyrinth = dataManager.characterData?.characterLabyrinth;
        const setting = dataManager.characterData?.characterSetting;
        const gameData = dataManager.getInitClientData();
        if (!gameData?.labyrinthCrateDetailMap) return [];

        const crateHrids = [
            labyrinth?.teaCrateItemHrid || setting?.labyrinthTeaCrateHrid || '',
            labyrinth?.coffeeCrateItemHrid || setting?.labyrinthCoffeeCrateHrid || '',
            labyrinth?.foodCrateItemHrid || setting?.labyrinthFoodCrateHrid || '',
        ];

        const allBuffs = [];
        for (const hrid of crateHrids) {
            if (!hrid) continue;
            const buffs = gameData.labyrinthCrateDetailMap[hrid];
            if (Array.isArray(buffs)) {
                allBuffs.push(...buffs);
            }
        }
        return allBuffs;
    }

    /**
     * Aggregate all buff sources into skilling metrics for a given skill
     * @param {string} skillId - e.g. "woodcutting"
     * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
     */
    getSkillingMetrics(skillId, actionTypeHrid) {
        const metrics = {
            skillLevelBonus: 0,
            efficiencyBonus: 0,
            actionSpeedBonus: 0,
            successBonus: 0,
            doubleProgressBonus: 0,
        };
        const charData = dataManager.characterData;
        if (!charData) return metrics;

        const skillLevelType = `/buff_types/${skillId}_level`;
        const skillSuccessType = `/buff_types/${skillId}_success`;

        const buffSources = [
            charData.equipmentActionTypeBuffsMap?.[actionTypeHrid],
            charData.communityActionTypeBuffsMap?.[actionTypeHrid],
            charData.houseActionTypeBuffsMap?.[actionTypeHrid],
            charData.achievementActionTypeBuffsMap?.[actionTypeHrid],
        ];

        for (const buffs of buffSources) {
            if (!Array.isArray(buffs)) continue;
            for (const buff of buffs) {
                if (!buff?.typeHrid) continue;
                const amount = (buff.flatBoost || 0) + (buff.ratioBoost || 0);
                if (amount === 0) continue;
                this.applyBuff(metrics, buff.typeHrid, amount, skillLevelType, skillSuccessType);
            }
        }

        const crateBuffs = this.getCrateBuffs();
        for (const buff of crateBuffs) {
            if (!buff?.typeHrid) continue;
            const amount = (buff.flatBoost || 0) + (buff.ratioBoost || 0);
            if (amount === 0) continue;
            this.applyBuff(metrics, buff.typeHrid, amount, skillLevelType, skillSuccessType);
        }

        const upgrades = this.getLabyrinthUpgrades();
        metrics.actionSpeedBonus += upgrades.speed * UPGRADE_STEP;
        metrics.efficiencyBonus += upgrades.efficiency * UPGRADE_STEP;
        metrics.successBonus += upgrades.success * UPGRADE_SUCCESS_STEP;
        metrics.doubleProgressBonus += upgrades.doubleProgress * UPGRADE_STEP;

        return metrics;
    }

    /**
     * Apply a single buff to metrics based on its type
     */
    applyBuff(metrics, typeHrid, amount, skillLevelType, skillSuccessType) {
        if (typeHrid === skillLevelType) {
            metrics.skillLevelBonus += amount;
        } else if (typeHrid === '/buff_types/efficiency') {
            metrics.efficiencyBonus += amount;
        } else if (typeHrid === '/buff_types/action_speed') {
            metrics.actionSpeedBonus += amount;
        } else if (typeHrid === '/buff_types/labyrinth_double_progress') {
            metrics.doubleProgressBonus += amount;
        } else if (typeHrid === '/buff_types/success_rate' || typeHrid === skillSuccessType) {
            metrics.successBonus += amount;
        }
    }

    /**
     * Compute clear stats for a non-enhancing skilling room
     */
    computeSkillingClear(skillHrid, roomLevel) {
        const skillId = skillHrid.replace('/skills/', '');
        const actionTypeHrid = `/action_types/${skillId}`;
        const metrics = this.getSkillingMetrics(skillId, actionTypeHrid);

        const skills = dataManager.getSkills();
        const skill = skills?.find((s) => s.skillHrid === skillHrid);
        const baseLevel = skill?.level || 1;

        const effectiveLevel = baseLevel + metrics.skillLevelBonus;
        const levelDelta = effectiveLevel - roomLevel;
        const levelBonus = levelDelta >= 0 ? levelDelta * 0.005 : levelDelta * 0.01;
        const successChance = Math.min(1, Math.max(0, 0.8 * (1 + levelBonus + metrics.successBonus)));
        const doubleChance = Math.min(1, Math.max(0, metrics.doubleProgressBonus));

        const workPower = effectiveLevel * (1 + metrics.efficiencyBonus);
        const progressPerSuccess = Math.max(0, Math.floor(workPower));
        const targetProgress = roomLevel * 10;

        const actionSeconds = BASE_SKILLING_TIME / Math.max(0.05, 1 + metrics.actionSpeedBonus);
        const attempts = Math.max(1, Math.floor(ROOM_DURATION / actionSeconds));

        const clearStats = this.computeNonEnhancingClearStats(
            attempts,
            successChance,
            doubleChance,
            progressPerSuccess,
            targetProgress
        );
        const result = this.buildResult(clearStats, actionSeconds);
        result.type = 'skilling';
        result.effectiveLevel = effectiveLevel;
        result.baseLevel = baseLevel;
        result.successChance = successChance;
        result.doubleChance = doubleChance;
        result.attempts = attempts;
        result.actionSeconds = actionSeconds;
        result.workPower = workPower;
        result.progressPerSuccess = progressPerSuccess;
        result.targetProgress = targetProgress;
        result.roomLevel = roomLevel;
        result.xpPerRoom = roomLevel * 50;
        return result;
    }

    /**
     * Compute clear stats for an enhancing room
     */
    computeEnhancingClear(roomLevel) {
        const skillId = 'enhancing';
        const actionTypeHrid = '/action_types/enhancing';
        const metrics = this.getSkillingMetrics(skillId, actionTypeHrid);

        const skills = dataManager.getSkills();
        const skill = skills?.find((s) => s.skillHrid === '/skills/enhancing');
        const baseLevel = skill?.level || 1;

        const effectiveLevel = baseLevel + metrics.skillLevelBonus;
        const levelDelta = effectiveLevel - roomLevel;
        const levelBonus = levelDelta >= 0 ? levelDelta * 0.005 : levelDelta * 0.01;
        const successChance = Math.min(1, Math.max(0, 0.8 * (1 + levelBonus + metrics.successBonus)));
        const doubleChance = Math.min(1, Math.max(0, metrics.doubleProgressBonus));

        const actionSeconds = BASE_ENHANCING_TIME / Math.max(0.05, 1 + metrics.actionSpeedBonus);
        const attempts = Math.max(1, Math.floor(ROOM_DURATION / actionSeconds));
        const targetLevel = 5;

        const clearStats = this.computeEnhancingClearStats(attempts, successChance, doubleChance, targetLevel);
        const result = this.buildResult(clearStats, actionSeconds);
        result.type = 'enhancing';
        result.effectiveLevel = effectiveLevel;
        result.baseLevel = baseLevel;
        result.successChance = successChance;
        result.doubleChance = doubleChance;
        result.attempts = attempts;
        result.actionSeconds = actionSeconds;
        result.targetLevel = targetLevel;
        result.roomLevel = roomLevel;
        return result;
    }

    buildResult(clearStats, actionSeconds) {
        const { clearChance, expectedAttemptsOnClear } = clearStats;
        if (clearChance <= 0) {
            return { clearChance: 0, expectedSeconds: Infinity };
        }
        const expectedSecondsOnSuccess = expectedAttemptsOnClear * actionSeconds;
        const expectedSeconds =
            (clearChance * expectedSecondsOnSuccess + (1 - clearChance) * ROOM_DURATION) / clearChance;
        return { clearChance, expectedSeconds };
    }

    /**
     * State machine for non-enhancing rooms.
     * Tracks probability distribution over progress units.
     */
    computeNonEnhancingClearStats(attempts, successChance, doubleChance, progressPerSuccess, targetProgress) {
        if (targetProgress <= 0) return { clearChance: 1, expectedAttemptsOnClear: 0 };
        if (attempts <= 0 || progressPerSuccess <= 0) return { clearChance: 0, expectedAttemptsOnClear: null };
        if (successChance <= 0) return { clearChance: 0, expectedAttemptsOnClear: null };

        const neededUnits = Math.ceil(targetProgress / progressPerSuccess - 1e-9);
        if (neededUnits <= 0) return { clearChance: 1, expectedAttemptsOnClear: 0 };
        if (neededUnits > attempts * 2) return { clearChance: 0, expectedAttemptsOnClear: null };

        const q0 = 1 - successChance;
        const q1 = successChance * (1 - doubleChance);
        const q2 = successChance * doubleChance;

        let stateDist = new Float64Array(neededUnits + 1);
        stateDist[0] = 1;
        let expectedAttemptsNumerator = 0;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const nextDist = new Float64Array(neededUnits + 1);

            for (let units = 0; units <= neededUnits; units++) {
                const prob = stateDist[units];
                if (prob <= 0) continue;

                if (units === neededUnits) {
                    nextDist[neededUnits] += prob;
                    continue;
                }

                nextDist[units] += prob * q0;
                nextDist[Math.min(neededUnits, units + 1)] += prob * q1;
                nextDist[Math.min(neededUnits, units + 2)] += prob * q2;
            }

            const reachedNow = nextDist[neededUnits] - stateDist[neededUnits];
            if (reachedNow > 0) {
                expectedAttemptsNumerator += attempt * reachedNow;
            }

            stateDist = nextDist;
        }

        const clearChance = Math.min(1, Math.max(0, stateDist[neededUnits]));
        const expectedAttemptsOnClear = clearChance > 0 ? expectedAttemptsNumerator / clearChance : null;
        return { clearChance, expectedAttemptsOnClear };
    }

    /**
     * State machine for enhancing rooms.
     * States are enhancement levels 0..targetLevel.
     * Fail: drop to max(0, level-1). Success: +1. Double: +2.
     */
    computeEnhancingClearStats(attempts, successChance, doubleChance, targetLevel, startLevel = 0) {
        if (targetLevel <= 0) return { clearChance: 1, expectedAttemptsOnClear: 0 };
        if (attempts <= 0) return { clearChance: 0, expectedAttemptsOnClear: null };
        if (successChance <= 0) return { clearChance: 0, expectedAttemptsOnClear: null };

        const failChance = 1 - successChance;
        const singleChance = successChance * (1 - doubleChance);
        const doubleSuccessChance = successChance * doubleChance;

        let stateDist = new Float64Array(targetLevel + 1);
        stateDist[Math.min(startLevel, targetLevel)] = 1;
        let expectedAttemptsNumerator = 0;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const nextDist = new Float64Array(targetLevel + 1);

            for (let level = 0; level <= targetLevel; level++) {
                const prob = stateDist[level];
                if (prob <= 0) continue;

                if (level === targetLevel) {
                    nextDist[targetLevel] += prob;
                    continue;
                }

                nextDist[Math.max(0, level - 1)] += prob * failChance;
                nextDist[Math.min(targetLevel, level + 1)] += prob * singleChance;
                nextDist[Math.min(targetLevel, level + 2)] += prob * doubleSuccessChance;
            }

            const reachedNow = nextDist[targetLevel] - stateDist[targetLevel];
            if (reachedNow > 0) {
                expectedAttemptsNumerator += attempt * reachedNow;
            }

            stateDist = nextDist;
        }

        const clearChance = Math.min(1, Math.max(0, stateDist[targetLevel]));
        const expectedAttemptsOnClear = clearChance > 0 ? expectedAttemptsNumerator / clearChance : null;
        return { clearChance, expectedAttemptsOnClear };
    }

    /**
     * Get the skip threshold for a skill from characterSetting
     */
    getSkipThreshold(skillHrid) {
        const charSetting = dataManager.characterData?.characterSetting;
        if (!charSetting) return 0;

        const skillId = skillHrid.replace('/skills/', '');
        const key = `labyrinthSkip${skillId.charAt(0).toUpperCase()}${skillId.slice(1)}`;
        return Math.max(0, Math.floor(Number(charSetting[key]) || 0));
    }

    /**
     * Get effective level for a skill (base + buff bonuses)
     */
    getEffectiveLevel(skillHrid) {
        const skillId = skillHrid.replace('/skills/', '');
        const actionTypeHrid = `/action_types/${skillId}`;
        const metrics = this.getSkillingMetrics(skillId, actionTypeHrid);

        const skills = dataManager.getSkills();
        const skill = skills?.find((s) => s.skillHrid === skillHrid);
        const baseLevel = skill?.level || 1;
        return baseLevel + metrics.skillLevelBonus;
    }

    /**
     * Get base combat level for a monster
     */
    getBaseCombatLevel(monsterHrid) {
        const gameData = dataManager.getInitClientData();
        const monster = gameData?.combatMonsterDetailMap?.[monsterHrid];
        return monster?.combatDetails?.combatLevel || 100;
    }

    /**
     * Compute target room level from effective level + skip threshold
     * Matches reference script: floor(effectiveLevel + skipThreshold - 1)
     */
    getTargetRoomLevel(skillHrid) {
        const effectiveLevel = this.getEffectiveLevel(skillHrid);
        const skipThreshold = this.getSkipThreshold(skillHrid);
        if (skipThreshold <= 0) return 0;

        return Math.floor(effectiveLevel + skipThreshold - 1);
    }

    /**
     * Get the skip threshold for a combat room from characterSetting
     */
    getCombatSkipThreshold(monsterHrid) {
        const charSetting = dataManager.characterData?.characterSetting;
        if (!charSetting) return 0;

        const monsterName = monsterHrid.replace('/monsters/', '');
        const pascal = monsterName
            .split('_')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');
        const key = `labyrinthSkip${pascal}`;
        return Math.max(0, Math.floor(Number(charSetting[key]) || 0));
    }

    /**
     * Compute target room level for a combat room.
     * Combat rooms use the monster's base combat level as the effective level base.
     */
    getCombatRoomLevel(monsterHrid) {
        if (this.roomData) {
            const room = this.findRoomByMonsterHrid(monsterHrid);
            if (room && !room.isCleared) {
                return Number(room.recommendedLevel || 0);
            }
        }

        const skipThreshold = this.getCombatSkipThreshold(monsterHrid);
        if (skipThreshold <= 0) return 0;

        const baseCombatLevel = this.getBaseCombatLevel(monsterHrid);
        return Math.floor(baseCombatLevel + skipThreshold - 1);
    }

    /**
     * Get the labyrinth loadout ID for a monster from characterSetting
     */
    getLabyrinthLoadoutId(monsterHrid) {
        const charSetting = dataManager.characterData?.characterSetting;
        if (!charSetting) return 0;

        const monsterName = monsterHrid.replace('/monsters/', '');
        const pascal = monsterName
            .split('_')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');
        return Number(charSetting[`labyrinthLoadout${pascal}`]) || 0;
    }

    /**
     * Build a player DTO with the labyrinth loadout applied
     */
    buildLabyrinthPlayerDTO(loadoutId) {
        const dto = buildPlayerDTO();
        if (!dto) return null;

        const snapshot = loadoutSnapshot.snapshots[loadoutId];
        if (snapshot?.name) {
            const gameData = buildGameDataPayload();
            applyLoadoutSnapshotToDTO(dto, snapshot.name, gameData);
        }
        return dto;
    }

    /**
     * Build labyrinth combat upgrade buffs from characterInfo
     */
    getLabyrinthCombatBuffs() {
        const info = dataManager.characterData?.characterInfo;
        if (!info) return [];

        const buffs = [];
        const defs = [
            ['labyrinthCombatDamageLevel', 'combat_damage', '/buff_types/damage', 'ratioBoost'],
            ['labyrinthAttackSpeedLevel', 'attack_speed', '/buff_types/attack_speed', 'ratioBoost'],
            ['labyrinthCastSpeedLevel', 'cast_speed', '/buff_types/cast_speed', 'flatBoost'],
            ['labyrinthCriticalRateLevel', 'critical_rate', '/buff_types/critical_rate', 'flatBoost'],
        ];
        for (const [infoKey, uniqueKey, typeHrid, valueKey] of defs) {
            const level = Math.max(0, Math.floor(Number(info[infoKey]) || 0));
            if (level <= 0) continue;
            const buff = {
                uniqueHrid: `/buff_uniques/labyrinth_upgrade_${uniqueKey}`,
                typeHrid,
                ratioBoost: 0,
                ratioBoostLevelBonus: 0,
                flatBoost: 0,
                flatBoostLevelBonus: 0,
                startTime: '0001-01-01T00:00:00Z',
                duration: 0,
            };
            buff[valueKey] = level * UPGRADE_STEP;
            buffs.push(buff);
        }
        return buffs;
    }

    /**
     * Get crate HRIDs as an array for the combat sim
     */
    getCrateHrids() {
        const labyrinth = dataManager.characterData?.characterLabyrinth;
        const setting = dataManager.characterData?.characterSetting;
        return [
            labyrinth?.teaCrateItemHrid || setting?.labyrinthTeaCrateHrid || '',
            labyrinth?.coffeeCrateItemHrid || setting?.labyrinthCoffeeCrateHrid || '',
            labyrinth?.foodCrateItemHrid || setting?.labyrinthFoodCrateHrid || '',
        ].filter(Boolean);
    }

    /**
     * Build cache key for a combat sim result
     */
    buildCombatCacheKey(monsterHrid, roomLevel) {
        const loadoutId = this.getLabyrinthLoadoutId(monsterHrid);
        const crateHrids = this.getCrateHrids();
        return `${monsterHrid}:${roomLevel}:${loadoutId}:${crateHrids.join(',')}`;
    }

    getCachedCombatResult(monsterHrid, roomLevel) {
        return this.combatCache.get(this.buildCombatCacheKey(monsterHrid, roomLevel)) || null;
    }

    /**
     * Run combat sim for a monster room and return clear stats
     */
    async computeCombatClear(monsterHrid, roomLevel) {
        const cacheKey = this.buildCombatCacheKey(monsterHrid, roomLevel);
        if (this.combatCache.has(cacheKey)) return this.combatCache.get(cacheKey);

        const loadoutId = this.getLabyrinthLoadoutId(monsterHrid);
        const dto = this.buildLabyrinthPlayerDTO(loadoutId);
        if (!dto) return { clearChance: 0, expectedSeconds: Infinity };

        const gameData = buildGameDataPayload();
        const crateHrids = this.getCrateHrids();
        const labyrinthCombatBuffs = this.getLabyrinthCombatBuffs();

        try {
            const simResult = await runLabyrinthSimulation({
                gameData,
                playerDTOs: [dto],
                zoneHrid: '/actions/combat/fly',
                monsterHrid,
                roomLevel,
                crates: crateHrids,
                hours: this._recommendSimHours || 1,
                communityBuffs: { mooPass: false, comExp: 0, comDrop: 0 },
                labyrinthCombatBuffs,
            });

            const attempts = simResult.labyAttemptCount || 1;
            const winRate = (simResult.encounters || 0) / attempts;
            const totalTime = simResult.simulatedTime / 1e9;
            const avgTime = totalTime / attempts;

            const gameDataLocal = dataManager.getInitClientData();
            const monsterDetail = gameDataLocal?.combatMonsterDetailMap?.[monsterHrid];
            const monsterName = monsterDetail?.name || monsterHrid.replace('/monsters/', '').replace(/_/g, ' ');

            const snapshot = loadoutSnapshot.snapshots[loadoutId];
            const loadoutName = snapshot?.name || `Loadout #${loadoutId}`;

            const result = {
                clearChance: winRate,
                expectedSeconds: winRate > 0 ? avgTime / winRate : Infinity,
                type: 'combat',
                winRate,
                avgFightSeconds: avgTime,
                monsterName,
                loadoutName,
                roomLevel,
            };

            this.combatCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error('[LabyrinthClearRate] Combat sim failed:', error);
            return { clearChance: 0, expectedSeconds: Infinity };
        }
    }

    queueCombatSim(monsterHrid, roomLevel, badge) {
        this.simQueue.push({ monsterHrid, roomLevel, badge });
    }

    async processSimQueue() {
        if (this.simRunning) return;
        this.simRunning = true;
        while (this.simQueue.length > 0) {
            const { monsterHrid, roomLevel, badge } = this.simQueue.shift();
            if (!badge.isConnected) continue;
            const result = await this.computeCombatClear(monsterHrid, roomLevel);
            if (badge.isConnected) this.updateBadge(badge, result, roomLevel);
        }
        this.simRunning = false;
    }

    /**
     * Binary search for the maximum skip threshold where clear chance >= targetRate
     */
    findRecommendedThreshold(skillHrid, targetRate) {
        const effectiveLevel = this.getEffectiveLevel(skillHrid);
        const isEnhancing = skillHrid === '/skills/enhancing';
        let low = 0;
        let high = 300;
        let bestThreshold = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const roomLevel = Math.floor(effectiveLevel + mid - 1);
            if (roomLevel <= 0) {
                low = mid + 1;
                continue;
            }
            const result = isEnhancing
                ? this.computeEnhancingClear(roomLevel)
                : this.computeSkillingClear(skillHrid, roomLevel);
            if (result.clearChance >= targetRate) {
                bestThreshold = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return bestThreshold;
    }

    /**
     * Async binary search for combat room recommended threshold
     */
    async findRecommendedThresholdCombat(monsterHrid, targetRate) {
        const baseCombatLevel = this.getBaseCombatLevel(monsterHrid);
        let low = 0;
        let high = 300;
        let bestThreshold = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const roomLevel = Math.floor(baseCombatLevel + mid - 1);
            if (roomLevel <= 0) {
                low = mid + 1;
                continue;
            }
            const result = await this.computeCombatClear(monsterHrid, roomLevel);
            if (result.clearChance >= targetRate) {
                bestThreshold = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return bestThreshold;
    }

    /**
     * Run recommendations for all visible rooms
     */
    async runRecommendations() {
        if (this.recommendRunning) return;
        this.recommendRunning = true;
        this.recommendations.clear();
        this.combatCache.clear();

        const rateInput = document.getElementById('mwi-recommend-target-rate');
        const targetPct = rateInput ? parseInt(rateInput.value, 10) : null;
        const targetRate =
            (targetPct > 0 && targetPct <= 100 ? targetPct : config.getSetting('labyrinthRecommendTargetRate') || 70) /
            100;

        const hoursInput = document.getElementById('mwi-recommend-sim-hours');
        const hoursVal = hoursInput ? parseInt(hoursInput.value, 10) : null;
        this._recommendSimHours =
            hoursVal > 0 && hoursVal <= 100 ? hoursVal : config.getSetting('labyrinthRecommendSimHours') || 1;
        const cells = document.querySelectorAll('[class*="LabyrinthPanel_skipThreshold"]');
        const rooms = [];

        for (const cell of cells) {
            const roomHrid = this.extractRoomHrid(cell);
            if (!roomHrid) continue;
            const isSkill = roomHrid.startsWith('/skills/');
            const isMonster = roomHrid.startsWith('/monsters/');
            if (!isSkill && !isMonster) continue;
            rooms.push({ roomHrid, isSkill });
        }

        const button = document.querySelector(`.${RECOMMEND_CONTROLS_CLASS} button`);
        const totalRooms = rooms.length;
        let completed = 0;

        for (const { roomHrid, isSkill } of rooms) {
            if (isSkill) {
                const threshold = this.findRecommendedThreshold(roomHrid, targetRate);
                this.recommendations.set(roomHrid, { threshold });
            } else {
                if (button) button.textContent = `Recommending... (${completed + 1}/${totalRooms})`;
                const threshold = await this.findRecommendedThresholdCombat(roomHrid, targetRate);
                this.recommendations.set(roomHrid, { threshold });
            }
            completed++;
        }

        if (button) button.textContent = 'Recommend';
        this.recommendRunning = false;
        this.injectRecommendationBadges();
    }

    /**
     * Inject recommendation badges onto visible cells
     */
    injectRecommendationBadges() {
        document.querySelectorAll(`.${RECOMMEND_CLASS}`).forEach((el) => el.remove());
        if (this.recommendations.size === 0) return;

        const cells = document.querySelectorAll('[class*="LabyrinthPanel_skipThreshold"]');
        for (const cell of cells) {
            const roomHrid = this.extractRoomHrid(cell);
            if (!roomHrid) continue;

            const rec = this.recommendations.get(roomHrid);
            if (!rec) continue;

            const isSkill = roomHrid.startsWith('/skills/');
            const currentThreshold = isSkill ? this.getSkipThreshold(roomHrid) : this.getCombatSkipThreshold(roomHrid);

            const badge = document.createElement('span');
            badge.className = RECOMMEND_CLASS;
            badge.style.cssText = 'font-size:0.7rem; margin-left:6px; white-space:nowrap; font-weight:bold;';
            badge.textContent = `Rec: +${rec.threshold}`;

            const targetPct = config.getSetting('labyrinthRecommendTargetRate') || 70;
            badge.title = `Recommended skip threshold for ≥${targetPct}% clear rate`;

            if (currentThreshold <= rec.threshold) {
                badge.style.color = '#00c896';
            } else if (currentThreshold <= rec.threshold + 10) {
                badge.style.color = '#f0ad4e';
            } else {
                badge.style.color = '#d9534f';
            }

            cell.appendChild(badge);
        }
    }

    /**
     * Inject recommend controls (button + target input) into the automation panel
     */
    injectRecommendControls() {
        if (document.querySelector(`.${RECOMMEND_CONTROLS_CLASS}`)) return;

        const table = document.querySelector('[class*="LabyrinthPanel_automationTable"]');
        if (!table) return;

        const container = document.createElement('div');
        container.className = RECOMMEND_CONTROLS_CLASS;
        container.style.cssText =
            'display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:0.8rem; flex-wrap:wrap;';

        const inputStyle =
            'width:50px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:4px; padding:2px 4px; font-size:0.75rem; text-align:center;';
        const labelStyle = 'color:#888; font-size:0.75rem; white-space:nowrap;';

        const defaultRate = config.getSetting('labyrinthRecommendTargetRate') || 70;
        const defaultHours = config.getSetting('labyrinthRecommendSimHours') || 1;

        const rateLabel = document.createElement('span');
        rateLabel.style.cssText = labelStyle;
        rateLabel.textContent = 'Target Win %';

        const rateInput = document.createElement('input');
        rateInput.type = 'number';
        rateInput.id = 'mwi-recommend-target-rate';
        rateInput.min = '1';
        rateInput.max = '100';
        rateInput.step = '1';
        rateInput.value = defaultRate;
        rateInput.style.cssText = inputStyle;

        const hoursLabel = document.createElement('span');
        hoursLabel.style.cssText = labelStyle;
        hoursLabel.textContent = 'Sim Hours';

        const hoursInput = document.createElement('input');
        hoursInput.type = 'number';
        hoursInput.id = 'mwi-recommend-sim-hours';
        hoursInput.min = '1';
        hoursInput.max = '100';
        hoursInput.step = '1';
        hoursInput.value = defaultHours;
        hoursInput.style.cssText = inputStyle;

        const button = document.createElement('button');
        button.textContent = 'Recommend';
        button.style.cssText =
            'padding:2px 10px; cursor:pointer; font-size:0.75rem; border-radius:4px; border:1px solid #555; background:#333; color:#ccc;';
        button.addEventListener('click', () => this.runRecommendations());

        container.appendChild(rateLabel);
        container.appendChild(rateInput);
        container.appendChild(hoursLabel);
        container.appendChild(hoursInput);
        container.appendChild(button);
        table.parentNode.insertBefore(container, table);
    }

    /**
     * Handle incoming labyrinth_room_progress WS message
     */
    onLiveProgress(data) {
        if (!config.getSetting('labyrinthLiveProgress')) return;
        this.refreshLiveProgress(data);
    }

    /**
     * Compute live clear estimate from room progress data
     */
    computeLiveEstimate(progress) {
        const isEnhancing = progress.targetLevel != null;
        const successChance = Math.min(1, Math.max(0, Number(progress.successRate) || 0));
        const doubleChance = Math.min(1, Math.max(0, Number(progress.doubleProgressChance) || 0));
        const fallbackMs = (isEnhancing ? BASE_ENHANCING_TIME : BASE_SKILLING_TIME) * 1000;
        const actionTimeMs = Math.max(1, Number(progress.actionTimeMs) || fallbackMs);
        const totalAttempts = Math.max(0, Math.floor((ROOM_DURATION * 1000) / actionTimeMs));
        const actionCounter = Math.max(0, Math.floor(Number(progress.actionCounter) || 0));
        const attemptsLeft = Math.max(0, totalAttempts - actionCounter);

        if (isEnhancing) {
            const targetLevel = Math.max(0, Math.floor(Number(progress.targetLevel) || 0));
            if (targetLevel <= 0) return null;
            const currentLevel = Math.max(0, Math.floor(Number(progress.currentEnhLevel) || 0));
            const clearStats = this.computeEnhancingClearStats(
                attemptsLeft,
                successChance,
                doubleChance,
                targetLevel,
                currentLevel
            );
            return {
                isEnhancing: true,
                clearChance: Math.min(1, Math.max(0, clearStats.clearChance || 0)),
                attemptsLeft,
                actionCounter,
                totalAttempts,
                successChance,
                doubleChance,
                currentLevel,
                targetLevel,
            };
        }

        const progressPerAction = Math.max(0, Number(progress.progressPerAction) || 0);
        const progressPerSuccess = Math.max(0, Math.floor(progressPerAction));
        const targetWorkValue = Math.max(0, Number(progress.targetWorkValue) || 0);
        if (targetWorkValue <= 0) return null;

        let currentWorkValue = Math.max(0, Number(progress.currentWorkValue) || 0);
        if (currentWorkValue <= 0) {
            const ratio = Math.min(1, Math.max(0, Number(progress.currentProgress) || 0));
            if (ratio > 0) currentWorkValue = targetWorkValue * ratio;
        }

        const remainingWork = Math.max(0, targetWorkValue - currentWorkValue);
        const clearStats = this.computeNonEnhancingClearStats(
            attemptsLeft,
            successChance,
            doubleChance,
            progressPerSuccess,
            remainingWork
        );
        return {
            isEnhancing: false,
            clearChance: Math.min(1, Math.max(0, clearStats.clearChance || 0)),
            attemptsLeft,
            actionCounter,
            totalAttempts,
            successChance,
            doubleChance,
            currentWorkValue: Math.round(currentWorkValue),
            targetWorkValue: Math.round(targetWorkValue),
        };
    }

    /**
     * Update or create the live progress overlay
     */
    refreshLiveProgress(progress) {
        if (this.liveProgressTimeout) {
            clearTimeout(this.liveProgressTimeout);
        }
        this.liveProgressTimeout = setTimeout(() => this.clearLiveProgress(), LIVE_PROGRESS_STALE_MS);

        const estimate = this.computeLiveEstimate(progress);
        if (!estimate) return;

        const host =
            document.querySelector("div[class*='Header_actionName'] div[class*='Header_displayName']") ||
            document.querySelector("div[class*='Header_actionName']");
        if (!host) return;

        let node = host.querySelector(`.${LIVE_PROGRESS_CLASS}`);
        if (!node) {
            node = document.createElement('span');
            node.className = LIVE_PROGRESS_CLASS;
            node.style.cssText = 'color:#fff; font-size:0.875rem;';
            host.appendChild(node);
        }

        const chancePct = (estimate.clearChance * 100).toFixed(1);
        if (estimate.isEnhancing) {
            node.textContent = ` [Clear ${chancePct}% | +${estimate.currentLevel}/+${estimate.targetLevel} | ${estimate.attemptsLeft} left]`;
        } else {
            node.textContent = ` [Clear ${chancePct}% | ${estimate.attemptsLeft} left]`;
        }

        const tooltipLines = [
            `Success: ${(estimate.successChance * 100).toFixed(1)}% | Double: ${(estimate.doubleChance * 100).toFixed(1)}%`,
            `Actions: ${estimate.actionCounter}/${estimate.totalAttempts}`,
        ];
        if (estimate.isEnhancing) {
            tooltipLines.push(`Enhance: +${estimate.currentLevel}/+${estimate.targetLevel}`);
        } else {
            tooltipLines.push(`Progress: ${estimate.currentWorkValue}/${estimate.targetWorkValue}`);
        }
        node.title = tooltipLines.join('\n');
    }

    /**
     * Remove live progress overlay and clear timeout
     */
    clearLiveProgress() {
        if (this.liveProgressTimeout) {
            clearTimeout(this.liveProgressTimeout);
            this.liveProgressTimeout = null;
        }
        document.querySelectorAll(`.${LIVE_PROGRESS_CLASS}`).forEach((el) => el.remove());
    }

    findRoomByMonsterHrid(monsterHrid) {
        if (!this.roomData) return null;
        for (const row of this.roomData) {
            for (const cell of row) {
                if (cell && cell.monsterHrid === monsterHrid) {
                    return cell;
                }
            }
        }
        return null;
    }

    /**
     * Inject clear rate overlays onto visible labyrinth room cells
     */
    injectOverlays() {
        const cells = document.querySelectorAll('[class*="LabyrinthPanel_skipThreshold"]');
        if (!cells.length) return;

        document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
        this.simQueue = [];

        for (const cell of cells) {
            const roomHrid = this.extractRoomHrid(cell);
            if (!roomHrid) continue;

            const isSkill = roomHrid.startsWith('/skills/');
            const isMonster = roomHrid.startsWith('/monsters/');
            if (!isSkill && !isMonster) continue;

            if (isSkill) {
                let roomLevel = null;
                if (this.roomData) {
                    const room = this.findRoomByHrid(roomHrid);
                    if (room && !room.isCleared) {
                        roomLevel = Number(room.recommendedLevel || 0);
                    }
                }
                if (!roomLevel) {
                    roomLevel = this.getTargetRoomLevel(roomHrid);
                }
                if (!roomLevel || roomLevel <= 0) continue;

                const isEnhancing = roomHrid === '/skills/enhancing';
                const result = isEnhancing
                    ? this.computeEnhancingClear(roomLevel)
                    : this.computeSkillingClear(roomHrid, roomLevel);

                if (!result) continue;
                this.appendBadge(cell, result, roomLevel);
            } else {
                const roomLevel = this.getCombatRoomLevel(roomHrid);
                if (!roomLevel || roomLevel <= 0) continue;

                const cached = this.getCachedCombatResult(roomHrid, roomLevel);
                if (cached) {
                    this.appendBadge(cell, cached, roomLevel);
                } else {
                    const badge = this.appendPlaceholderBadge(cell);
                    this.queueCombatSim(roomHrid, roomLevel, badge);
                }
            }
        }

        this.processSimQueue();
        this.injectRecommendControls();
        if (this.recommendations.size > 0) {
            this.injectRecommendationBadges();
        }
    }

    appendBadge(cell, result, roomLevel) {
        const badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        badge.style.cssText = 'font-size:0.7rem; margin-left:6px; white-space:nowrap;';
        badge.style.color = this.getBadgeColor(result.clearChance);

        const pct = Math.round(result.clearChance * 100);
        const timeText = this.formatTime(result.expectedSeconds);
        badge.textContent = pct >= 100 ? timeText : `${pct}% ${timeText}`;
        badge.title = this.formatTooltip(result, roomLevel);

        cell.appendChild(badge);
        return badge;
    }

    appendPlaceholderBadge(cell) {
        const badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        badge.style.cssText = 'font-size:0.7rem; margin-left:6px; white-space:nowrap; color:#999;';
        badge.textContent = '...';
        badge.title = 'Simulating combat...';
        cell.appendChild(badge);
        return badge;
    }

    updateBadge(badge, result, roomLevel) {
        badge.style.color = this.getBadgeColor(result.clearChance);
        const pct = Math.round(result.clearChance * 100);
        const timeText = this.formatTime(result.expectedSeconds);
        badge.textContent = pct >= 100 ? timeText : `${pct}% ${timeText}`;
        badge.title = this.formatTooltip(result, roomLevel);
    }

    /**
     * Find a room in cached roomData matching the extracted HRID
     */
    findRoomByHrid(skillHrid) {
        if (!this.roomData) return null;
        for (const row of this.roomData) {
            for (const cell of row) {
                if (cell && cell.skillHrid === skillHrid) {
                    return cell;
                }
            }
        }
        return null;
    }

    /**
     * Extract skill HRID from a skip threshold cell's row
     */
    extractRoomHrid(cell) {
        try {
            const row = cell.closest('tr');
            if (!row) return null;

            const useEl = row.querySelector('[class*="LabyrinthPanel_roomLabel"] use');
            if (!useEl) return null;

            const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
            if (!href) return null;

            const slug = href.split('#')[1];
            if (!slug) return null;

            if (href.includes('skills_sprite')) {
                return `/skills/${slug}`;
            }
            return `/monsters/${slug}`;
        } catch {
            return null;
        }
    }

    formatTooltip(result, roomLevel) {
        const pct = (v) => `${(v * 100).toFixed(1)}%`;

        if (result.type === 'skilling') {
            return [
                `Success: ${pct(result.successChance)} | Double: ${pct(result.doubleChance)}`,
                `Actions: ${result.attempts} @ ${result.actionSeconds.toFixed(2)}s each`,
                `Work Power: ${Math.floor(result.workPower)} → Progress: ${result.progressPerSuccess}/${result.targetProgress} per success`,
                `Effective Level: ${Math.floor(result.effectiveLevel)} (base ${result.baseLevel} + ${Math.floor(result.effectiveLevel - result.baseLevel)})`,
                `Room Level: ${result.roomLevel} | XP/room: ${result.xpPerRoom}`,
            ].join('\n');
        }

        if (result.type === 'enhancing') {
            return [
                `Success: ${pct(result.successChance)} | Double: ${pct(result.doubleChance)}`,
                `Actions: ${result.attempts} @ ${result.actionSeconds.toFixed(2)}s each`,
                `Target: +${result.targetLevel} | Effective Level: ${Math.floor(result.effectiveLevel)}`,
                `Room Level: ${result.roomLevel}`,
            ].join('\n');
        }

        if (result.type === 'combat') {
            return [
                `Win Rate: ${pct(result.winRate)} | Avg Fight: ${Math.round(result.avgFightSeconds)}s`,
                `Monster: ${result.monsterName} | Room Level: ${result.roomLevel}`,
                `Loadout: "${result.loadoutName}"`,
            ].join('\n');
        }

        const clearPct = Math.round(result.clearChance * 100);
        const timeText = this.formatTime(result.expectedSeconds);
        return `Clear: ${clearPct}% | Expected: ${timeText} | Room level: ${roomLevel}`;
    }

    getBadgeColor(clearChance) {
        if (clearChance >= 0.95) return '#00c896';
        if (clearChance >= 0.7) return '#f0ad4e';
        return '#d9534f';
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '—';
        if (seconds >= 9999) return '∞';
        const s = Math.round(seconds);
        if (s < 60) return `~${s}s`;
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `~${m}:${rem.toString().padStart(2, '0')}`;
    }
}

const labyrinthClearRate = new LabyrinthClearRate();
export default labyrinthClearRate;
