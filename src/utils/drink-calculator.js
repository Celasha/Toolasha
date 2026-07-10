/**
 * Drink Calculator Utility
 * Calculates remaining drink time and queue coverage for non-combat skill panels.
 *
 * Total remaining time per drink =
 *   currentActivationNs (from slot.duration) +
 *   inventoryCount × buffDurationNs × (1 + concentration)
 *
 * slot.duration is the remaining nanoseconds on the current activation as reported
 * by the server at last action completion. It is frozen while the skill is inactive
 * and refreshes each action cycle while active — accurate enough for hour-scale estimates.
 */

import dataManager from '../core/data-manager.js';
import { getDrinkConcentration } from './tea-parser.js';
import { resolveActionContext } from './action-context.js';
import { calculateActionStats } from './action-calculator.js';
import { calculateEfficiencyMultiplier } from './efficiency.js';

const FALLBACK_BUFF_DURATION_NS = 300_000_000_000; // 5 min in nanoseconds

/**
 * Calculate remaining drink time (in seconds) for each slotted drink of an action type.
 * Deduplicates slots if the same drink is slotted more than once.
 *
 * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
 * @returns {Array<{itemHrid: string, name: string, totalSeconds: number}>}
 */
export function calculateDrinkRemainingSeconds(actionTypeHrid) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return [];

    const slots = dataManager.getActionDrinkSlots(actionTypeHrid);
    if (!slots?.length) return [];

    const inventory = dataManager.getInventory();
    const { equipment } = resolveActionContext(actionTypeHrid);
    const itemDetailMap = gameData.itemDetailMap || {};
    const concentration = getDrinkConcentration(equipment, itemDetailMap);

    const results = [];
    const seen = new Set();

    for (const slot of slots) {
        if (!slot?.itemHrid) continue;
        if (seen.has(slot.itemHrid)) continue;
        seen.add(slot.itemHrid);

        const itemDetails = itemDetailMap[slot.itemHrid];
        if (!itemDetails) continue;

        const buffDurationNs = itemDetails.consumableDetail?.buffs?.[0]?.duration ?? FALLBACK_BUFF_DURATION_NS;
        const effectiveDurationNs = buffDurationNs * (1 + concentration);

        const inventoryCount = inventory
            .filter((i) => i.itemHrid === slot.itemHrid)
            .reduce((sum, i) => sum + (i.count || 0), 0);

        const currentActivationNs = slot.isActive ? slot.duration || 0 : 0;
        const totalNs = currentActivationNs + inventoryCount * effectiveDurationNs;

        results.push({
            itemHrid: slot.itemHrid,
            name: itemDetails.name,
            totalSeconds: totalNs / 1e9,
        });
    }

    return results;
}

/**
 * Calculate total remaining queue time in seconds for a given action type.
 * Only counts finite queued actions (infinite queues are skipped).
 *
 * @param {string} actionTypeHrid - e.g. "/action_types/woodcutting"
 * @returns {number} Total queue time in seconds, or 0 if no finite queue
 */
export function calculateQueueTimeSeconds(actionTypeHrid) {
    const gameData = dataManager.getInitClientData();
    if (!gameData) return 0;

    const skills = dataManager.getSkills();
    const { equipment } = resolveActionContext(actionTypeHrid);
    if (!skills || !equipment) return 0;

    const queuedActions = dataManager.getCurrentActions();
    let totalSeconds = 0;

    for (const queuedAction of queuedActions) {
        if (!queuedAction.hasMaxCount) continue;

        const actionDetails = dataManager.getActionDetails(queuedAction.actionHrid);
        if (!actionDetails || actionDetails.type !== actionTypeHrid) continue;

        const remaining = queuedAction.maxCount - queuedAction.currentCount;
        if (remaining <= 0) continue;

        const stats = calculateActionStats(actionDetails, {
            skills,
            equipment,
            itemDetailMap: gameData.itemDetailMap,
            includeCommunityBuff: true,
            includeBreakdown: false,
        });
        if (!stats) continue;

        const effMultiplier = calculateEfficiencyMultiplier(stats.totalEfficiency);
        totalSeconds += (remaining / effMultiplier) * stats.actionTime;
    }

    return totalSeconds;
}
