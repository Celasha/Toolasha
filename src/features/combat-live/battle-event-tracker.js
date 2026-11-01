/**
 * Battle Event Tracker
 *
 * Turns the game's `new_battle` / `battle_updated` messages into discrete combat events by diffing
 * each unit against its previous state, using the same rules the game client uses to draw its own
 * damage splats (see GamePage.updateCombatUnit / CombatUnit.componentDidUpdate in the client):
 *
 *   - HP went up                      -> heal of that amount
 *   - else dmgCounter changed         -> damage equal to the HP lost; critical when dmgCounter equals
 *                                        critCounter; an amount of 0 is a miss
 *   - MP went up                      -> mana gain
 *
 * Everything here describes the unit that RECEIVED the change, so it is exact. The client never links
 * an attacker to a target, so this module does not either: each unit only reports its own wind-up
 * (`attack` events carry the ability the unit started preparing).
 *
 * Pure logic: no DOM, no WebSocket. Feed it payloads with handleNewBattle / handleBattleUpdated.
 */

const SIDE_PLAYER = 'p';
const SIDE_MONSTER = 'm';

/**
 * Normalise a unit from `new_battle` (full field names) into tracked state.
 * @param {Object} unit - Raw unit from new_battle
 * @param {string} side - 'p' or 'm'
 * @param {number} index - Index within its side
 * @returns {Object} Tracked unit state
 */
function unitFromNewBattle(unit, side, index) {
    return {
        side,
        index,
        id: unit?.character?.id ?? null,
        name: unit?.name ?? unit?.character?.name ?? null,
        hrid: unit?.hrid ?? null,
        hp: unit?.currentHitpoints ?? 0,
        maxHp: unit?.maxHitpoints ?? 0,
        mp: unit?.currentManapoints ?? 0,
        maxMp: unit?.maxManapoints ?? 0,
        dmgCounter: unit?.damageSplatCounter ?? 0,
        critCounter: unit?.criticalDamageSplatCounter ?? 0,
        atkCounter: unit?.attackAttemptCounter ?? 0,
        isAutoAtk: Boolean(unit?.isPreparingAutoAttack),
        abilityHrid: unit?.preparingAbilityHrid || '',
        intervalNs: unit?.attackOrCastInterval ?? 0,
    };
}

/**
 * Apply a `battle_updated` entry (short field names) to a tracked unit and describe what changed.
 * @param {Object} prev - Previous tracked unit
 * @param {Object} entry - Raw pMap/mMap entry
 * @returns {{next: Object, events: Object[]}}
 */
function applyUpdate(prev, entry) {
    const next = {
        ...prev,
        hp: entry.cHP ?? prev.hp,
        maxHp: entry.mHP ?? prev.maxHp,
        mp: entry.cMP ?? prev.mp,
        maxMp: entry.mMP ?? prev.maxMp,
        dmgCounter: entry.dmgCounter ?? prev.dmgCounter,
        critCounter: entry.critCounter ?? prev.critCounter,
        atkCounter: entry.atkCounter ?? prev.atkCounter,
        isAutoAtk: Boolean(entry.isAutoAtk),
        abilityHrid: entry.abilityHrid || '',
        intervalNs: entry.int ?? prev.intervalNs,
    };
    const base = {
        side: prev.side,
        index: prev.index,
        id: prev.id,
        name: prev.name,
        hrid: prev.hrid,
        maxHp: next.maxHp,
    };
    const events = [];

    const hpDelta = next.hp - prev.hp;
    if (hpDelta > 0) {
        // Coming back from 0 HP is a respawn, not healing
        events.push(
            prev.hp <= 0 ? { ...base, type: 'revive', hp: next.hp } : { ...base, type: 'heal', amount: hpDelta }
        );
    } else if (next.dmgCounter !== prev.dmgCounter) {
        // Max with 0 so a miss is 0 rather than -0
        const amount = Math.max(0, -hpDelta);
        events.push({
            ...base,
            type: 'damage',
            amount,
            crit: next.dmgCounter === next.critCounter,
            miss: amount === 0,
        });
        if (prev.hp > 0 && next.hp <= 0) {
            events.push({ ...base, type: 'death' });
        }
    } else if (hpDelta < 0) {
        // HP fell without a damage splat (e.g. a cost or drain): still a death if it hit 0
        if (prev.hp > 0 && next.hp <= 0) {
            events.push({ ...base, type: 'death' });
        }
    }

    const mpDelta = next.mp - prev.mp;
    if (mpDelta > 0) {
        events.push({ ...base, type: 'mana-gain', amount: mpDelta });
    } else if (mpDelta < 0) {
        // The unit's own prepared ability is on the same entry, so the spend can be tied to it
        events.push({
            ...base,
            type: 'mana-spend',
            amount: -mpDelta,
            abilityHrid: next.abilityHrid || prev.abilityHrid,
        });
    }

    if (next.atkCounter !== prev.atkCounter) {
        events.push({
            ...base,
            type: 'attack',
            auto: next.isAutoAtk,
            abilityHrid: next.abilityHrid,
            intervalMs: next.intervalNs / 1e6,
        });
    }

    return { next, events };
}

export class BattleEventTracker {
    constructor() {
        this.reset();
    }

    /**
     * Forget everything (battle ended, character switched, socket closed).
     */
    reset() {
        this.battleId = null;
        this.wave = null;
        this.combatStartTime = null;
        this.players = [];
        this.monsters = [];
    }

    /**
     * Start tracking a battle from a `new_battle` message.
     * @param {Object} data - new_battle payload
     */
    handleNewBattle(data) {
        this.battleId = data?.battleId ?? null;
        this.wave = data?.wave ?? null;
        this.combatStartTime = data?.combatStartTime ?? null;
        this.players = (data?.players || []).map((unit, index) => unitFromNewBattle(unit, SIDE_PLAYER, index));
        this.monsters = (data?.monsters || []).map((unit, index) => unitFromNewBattle(unit, SIDE_MONSTER, index));
    }

    /**
     * Diff a `battle_updated` message against the tracked units.
     * Like the client, ignores updates for any other battle and for units it has never seen.
     * @param {Object} data - battle_updated payload
     * @returns {Object[]} Events produced, in unit order (players first)
     */
    handleBattleUpdated(data) {
        if (!data || data.battleId !== this.battleId) {
            return [];
        }
        const events = [];
        this.applyMap(data.pMap, this.players, events);
        this.applyMap(data.mMap, this.monsters, events);
        return events;
    }

    /**
     * @param {Object} map - pMap or mMap (sparse, keyed by unit index)
     * @param {Object[]} units - Tracked units for that side (mutated in place)
     * @param {Object[]} events - Output list
     */
    applyMap(map, units, events) {
        for (const [key, entry] of Object.entries(map || {})) {
            const index = Number(key);
            const prev = units[index];
            if (!prev || !entry) continue;
            const { next, events: unitEvents } = applyUpdate(prev, entry);
            units[index] = next;
            events.push(...unitEvents);
        }
    }

    /**
     * @param {string} side - 'p' or 'm'
     * @param {number} index
     * @returns {Object|null} Current tracked unit
     */
    getUnit(side, index) {
        return (side === SIDE_PLAYER ? this.players : this.monsters)[index] || null;
    }
}

export { SIDE_PLAYER, SIDE_MONSTER };
export default BattleEventTracker;
