/**
 * Consumable reconciliation (issue #803).
 *
 * Event counting misses consumption whenever the page is not receiving events (closed tab,
 * suspended page, reconnect). Every new_battle carries the player's current consumable counts, so
 * the difference between the count we last held and the count in the payload is the consumption
 * we missed. This module decides how much of that difference to believe and how much of the
 * unobserved time belongs in the rate's time base. It is pure: callers apply the result.
 */

/** A silence longer than this between two messages is treated as "we were not watching". */
export const UNOBSERVED_GAP_SECONDS = 180;

/** Headroom over the cooldown-based maximum rate, covering rounding and drink concentration. */
export const PLAUSIBILITY_FACTOR = 1.5;

/** Minimum number of normal message intervals before an average wave time is trusted. */
export const MIN_WAVE_SAMPLES = 3;

/**
 * Classify one item's count difference.
 * @param {Object} params
 * @param {number|undefined} params.lastKnown - Count we last held, undefined when never seen
 * @param {number} params.snapshot - Count in the new_battle payload
 * @param {number} params.effectiveGapSeconds - Seconds the item could have been consumed for
 * @param {number} params.maxRatePerSecond - Cooldown-based maximum consumption rate
 * @returns {{action: 'none'|'baseline'|'credit'|'reject'|'restock', credited: number, missed: number}}
 */
export function classifyItem({ lastKnown, snapshot, effectiveGapSeconds, maxRatePerSecond }) {
    if (lastKnown === undefined || lastKnown === null) {
        return { action: 'baseline', credited: 0, missed: 0 };
    }

    const missed = lastKnown - snapshot;
    if (missed === 0) return { action: 'none', credited: 0, missed: 0 };
    if (missed < 0) return { action: 'restock', credited: 0, missed };

    const plausibleMax = Math.max(1, Math.ceil(effectiveGapSeconds * maxRatePerSecond * PLAUSIBILITY_FACTOR));
    if (missed <= plausibleMax) return { action: 'credit', credited: missed, missed };
    return { action: 'reject', credited: 0, missed };
}

/**
 * Reconcile every item of one tracker against a new_battle snapshot.
 * @param {Object} params
 * @param {Array<{itemHrid: string, lastKnown: (number|undefined), snapshot: number, maxRatePerSecond: number}>} params.items
 * @param {number|null} params.gapSeconds - Seconds since this tracker last saw a message, null if never
 * @param {number|null} params.fightingSeconds - Estimated fighting time inside the gap, null if unknown
 * @returns {{unobserved: boolean, excludeSeconds: number, items: Array<{itemHrid: string, action: string, credited: number, missed: number}>}}
 *   `excludeSeconds` is the part of the gap that must be removed from the tracker's time base.
 */
export function reconcileSnapshot({ items, gapSeconds, fightingSeconds }) {
    if (gapSeconds === null || gapSeconds === undefined) {
        return {
            unobserved: false,
            excludeSeconds: 0,
            items: items.map((item) => ({ itemHrid: item.itemHrid, action: 'baseline', credited: 0, missed: 0 })),
        };
    }

    const gap = Math.max(0, gapSeconds);
    const unobserved = gap > UNOBSERVED_GAP_SECONDS;
    const effectiveGap = unobserved && fightingSeconds > 0 ? Math.min(gap, fightingSeconds) : gap;

    const results = items.map((item) => ({
        itemHrid: item.itemHrid,
        ...classifyItem({
            lastKnown: item.lastKnown,
            snapshot: item.snapshot,
            effectiveGapSeconds: effectiveGap,
            maxRatePerSecond: item.maxRatePerSecond,
        }),
    }));

    let excludeSeconds = 0;
    if (unobserved) {
        const creditedAny = results.some((result) => result.action === 'credit');
        excludeSeconds = creditedAny ? gap - effectiveGap : gap;
    }

    return { unobserved, excludeSeconds, items: results };
}

/**
 * Number of waves fought between two new_battle messages of the same run.
 * Regular zones advance battleId once per wave. Dungeons advance battleId once per run and reset
 * `wave` each run, so waves are battleId change x max waves + wave change.
 * @param {Object} params
 * @param {number|null} params.previousBattleId
 * @param {number|null} params.previousWave
 * @param {number} params.battleId
 * @param {number|null} params.wave
 * @param {number|null} params.dungeonMaxWaves - Max waves when in a dungeon, otherwise null
 * @returns {number|null} Null when it cannot be derived or is not positive
 */
export function wavesElapsed({ previousBattleId, previousWave, battleId, wave, dungeonMaxWaves }) {
    if (previousBattleId === null || previousBattleId === undefined) return null;

    let waves;
    if (dungeonMaxWaves > 0) {
        if (typeof previousWave !== 'number' || typeof wave !== 'number') return null;
        waves = (battleId - previousBattleId) * dungeonMaxWaves + (wave - previousWave);
    } else {
        waves = battleId - previousBattleId;
    }
    return waves > 0 ? waves : null;
}

/**
 * Estimated fighting time for a gap from the wave count and the run's average wave time.
 * @param {number|null} waves
 * @param {{sum: number, count: number}|null} waveStats - Sum and count of normal message intervals
 * @returns {number|null}
 */
export function estimateFightingSeconds(waves, waveStats) {
    if (!waves || !waveStats || waveStats.count < MIN_WAVE_SAMPLES || waveStats.sum <= 0) return null;
    return waves * (waveStats.sum / waveStats.count);
}
