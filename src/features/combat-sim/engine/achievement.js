import Buff from './buff.js';
import { getGameData } from './game-data.js';

/**
 * Achievement Tier buffs are derived entirely from live game data (TLA-044): a tier's buff applies
 * only when every achievement belonging to that tier (per achievementDetailMap's tierHrid) is
 * completed for this specific player, and only when the tier itself is usable in
 * /action_types/combat (per achievementTierDetailMap's usableInActionTypeMap). Mirrors the
 * existing data-driven Shrine pattern - never a hardcoded Novice/Veteran/Elite list, HRID, or
 * boost value.
 */
class Achievement {
    constructor(characterAchievements) {
        const gameData = getGameData();
        const achievementDetailMap = gameData.achievementDetailMap || {};
        const achievementTierDetailMap = gameData.achievementTierDetailMap || {};

        const completedHrids = new Set();
        for (const achievement of characterAchievements || []) {
            if (achievement?.isCompleted && achievement.achievementHrid) {
                completedHrids.add(achievement.achievementHrid);
            }
        }

        const tierTotals = new Map();
        const tierCompleted = new Map();
        for (const [achievementHrid, detail] of Object.entries(achievementDetailMap)) {
            const tierHrid = detail?.tierHrid;
            if (!tierHrid) continue;
            tierTotals.set(tierHrid, (tierTotals.get(tierHrid) || 0) + 1);
            if (completedHrids.has(achievementHrid)) {
                tierCompleted.set(tierHrid, (tierCompleted.get(tierHrid) || 0) + 1);
            }
        }

        this.buffs = [];
        for (const [tierHrid, tierDetail] of Object.entries(achievementTierDetailMap)) {
            if (!tierDetail?.buff) continue;
            if (!tierDetail.usableInActionTypeMap?.['/action_types/combat']) continue;

            // A tier with no resolvable achievement members must never vacuously grant its buff.
            const total = tierTotals.get(tierHrid) || 0;
            if (total === 0) continue;

            const completed = tierCompleted.get(tierHrid) || 0;
            if (completed !== total) continue;

            this.buffs.push(new Buff(tierDetail.buff));
        }
    }
}

export default Achievement;
