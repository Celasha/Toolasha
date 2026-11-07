/**
 * Buff tracker
 *
 * Which timed buffs and debuffs are on each unit, for the icons under the characters. The game sends no
 * buff list in its combat updates, so this works from what it does send:
 *
 *   - a cast (the ability that just ran) is looked up in the game's own ability data, which says what it
 *     applies, to whom, and for how long; nothing here is a hand-kept list of abilities;
 *   - the stunned / blinded / silenced / enraged flags are exact, and only their length is predicted from
 *     the ability that caused them;
 *   - a unit dying clears what was on it, and a new wave clears the monsters;
 *   - curse is counted from the hits of the player who holds it (their curse stat is in `new_battle`).
 *
 * The timers are predictions from the moment the cast was seen, so they can drift from the server's by a
 * little. Pure logic: feed it tracker events.
 */

import { SIDE_MONSTER, SIDE_PLAYER } from './battle-event-tracker.js';

const NS_PER_MS = 1e6;
// A status flag that rises this soon after a cast is taken to be that cast's doing
const STATUS_LINK_MS = 1500;
// Curse (a weapon stat, not an ability): every landed hit by its holder adds a stack, each hit refreshes the
// timer of all of them, up to five. Per the game's own description of the stat.
const CURSE_ID = 'curse';
const CURSE_MAX_STACKS = 5;
const CURSE_DURATION_MS = 15000;

export const KIND_BUFF = 'buff';
export const KIND_DEBUFF = 'debuff';
export const KIND_DOT = 'dot';
export const KIND_STATUS = 'status';

const opposite = (side) => (side === SIDE_PLAYER ? SIDE_MONSTER : SIDE_PLAYER);
const unitKey = (side, index) => `${side}:${index}`;

export class BuffTracker {
    constructor() {
        // Looks up an ability's effects in the game data
        this.effectsOf = () => [];
        this.reset();
    }

    reset() {
        // unitKey -> Map<entryId, entry>
        this.units = new Map();
        // `${unitKey}|${status}` -> {durationMs, at}: how long a status should last, from the cast behind it
        this.pending = new Map();
    }

    /**
     * @param {function(string): Object[]} lookup - Ability hrid to its effects
     */
    setEffectsLookup(lookup) {
        this.effectsOf = lookup;
    }

    /**
     * A new wave: the monsters are new, so nothing on them carries over. Player buffs run on.
     */
    beginWave() {
        for (const key of [...this.units.keys()]) {
            if (key.startsWith(`${SIDE_MONSTER}:`)) this.units.delete(key);
        }
        this.pending.clear();
    }

    /**
     * @param {Object[]} events - Events from one message, from BattleEventTracker
     * @param {number} at - Message timestamp in ms
     * @param {{p: Array<{index: number, hp: number}>, m: Array<{index: number, hp: number}>}} roster - Units
     *     on each side as they are now, for the casts that hit everyone
     */
    record(events, at, roster) {
        for (const event of events) {
            if (event.type === 'death') this.units.delete(unitKey(event.side, event.index));
        }

        const damaged = { [SIDE_PLAYER]: [], [SIDE_MONSTER]: [] };
        for (const event of events) {
            if (event.type === 'damage' && !event.miss && event.amount > 0) damaged[event.side].push(event.index);
        }

        for (const event of events) {
            if (event.type === 'attack' && event.abilityHrid) this.applyCast(event, at, roster, damaged);
        }
        this.applyCurse(events, at, roster, damaged);
        for (const event of events) {
            if (event.type === 'status') this.applyStatus(event, at);
        }
    }

    /**
     * One message is one combat event with one attacker, so when the player who acted holds curse, every
     * monster that took damage from it gains a stack. Several actors at once, or damage with no attacker
     * (damage over time), leaves the count alone: the owner of those hits is not known.
     * @param {Object[]} events
     * @param {number} at
     * @param {Object} roster - Players carry their `curse` stat
     * @param {Object} damaged - Indexes of the units that took damage in this message, per side
     */
    applyCurse(events, at, roster, damaged) {
        const attackers = events.filter((event) => event.type === 'attack' && event.side === SIDE_PLAYER);
        if (attackers.length !== 1) return;
        const perStack = roster?.[SIDE_PLAYER]?.find((unit) => unit.index === attackers[0].index)?.curse;
        if (!(perStack > 0)) return;

        // A monster that died of this hit has nothing left to show
        const died = new Set(events.filter((e) => e.type === 'death' && e.side === SIDE_MONSTER).map((e) => e.index));
        for (const index of new Set(damaged[SIDE_MONSTER])) {
            if (died.has(index)) continue;
            const key = unitKey(SIDE_MONSTER, index);
            const entries = this.units.get(key) || new Map();
            const current = entries.get(CURSE_ID);
            const live = current && current.expiresAt > at;
            entries.set(CURSE_ID, {
                id: CURSE_ID,
                kind: KIND_DEBUFF,
                abilityHrid: '',
                symbol: '☠',
                stacks: Math.min(CURSE_MAX_STACKS, (live ? current.stacks : 0) + 1),
                perStack,
                durationMs: CURSE_DURATION_MS,
                at,
                expiresAt: at + CURSE_DURATION_MS,
            });
            this.units.set(key, entries);
        }
    }

    /**
     * @param {Object} cast - An attack event with the ability that ran
     * @param {number} at
     * @param {Object} roster
     * @param {Object} damaged - Indexes of the units that took damage in this message, per side
     */
    applyCast(cast, at, roster, damaged) {
        for (const effect of this.effectsOf(cast.abilityHrid) || []) {
            const targets = this.targetsOf(effect.targetType, cast, roster, damaged);
            if (!targets.length) continue;
            const friendly = targets[0].side === cast.side;

            for (const buff of effect.buffs || []) {
                const durationMs = (buff.duration || 0) / NS_PER_MS;
                if (!(durationMs > 0)) continue;
                for (const target of targets) {
                    this.add(target, buff.uniqueHrid || `${cast.abilityHrid}:${buff.typeHrid}`, {
                        kind: friendly ? KIND_BUFF : KIND_DEBUFF,
                        abilityHrid: cast.abilityHrid,
                        durationMs,
                        at,
                    });
                }
            }

            if (!friendly && effect.damageOverTimeDuration > 0) {
                for (const target of targets) {
                    this.add(target, `dot:${cast.abilityHrid}`, {
                        kind: KIND_DOT,
                        abilityHrid: cast.abilityHrid,
                        durationMs: effect.damageOverTimeDuration / NS_PER_MS,
                        at,
                    });
                }
            }

            // The flag decides whether a stun, blind or silence happened; the ability says for how long
            for (const [status, field] of [
                ['stunned', 'stunDuration'],
                ['blinded', 'blindDuration'],
                ['silenced', 'silenceDuration'],
            ]) {
                if (!(effect[field] > 0) || friendly) continue;
                for (const target of targets) {
                    this.pending.set(`${unitKey(target.side, target.index)}|${status}`, {
                        abilityHrid: cast.abilityHrid,
                        durationMs: effect[field] / NS_PER_MS,
                        at,
                    });
                }
            }
        }
    }

    /**
     * @param {string} targetType - self, allAllies, enemy, allEnemies...
     * @param {Object} cast
     * @param {Object} roster
     * @param {Object} damaged
     * @returns {Array<{side: string, index: number}>}
     */
    targetsOf(targetType, cast, roster, damaged) {
        const alive = (side) =>
            (roster?.[side] || []).filter((unit) => unit.hp > 0).map((unit) => ({ side, index: unit.index }));
        switch (targetType) {
            case 'self':
                return [{ side: cast.side, index: cast.index }];
            case 'allAllies':
                return alive(cast.side);
            case 'allEnemies':
                return alive(opposite(cast.side));
            case 'enemy':
                // The target is not sent; the unit that took the hit in this message is the one
                return [...new Set(damaged[opposite(cast.side)])].map((index) => ({
                    side: opposite(cast.side),
                    index,
                }));
            default:
                return [];
        }
    }

    add(target, id, entry) {
        const key = unitKey(target.side, target.index);
        const entries = this.units.get(key) || new Map();
        // Casting again refreshes the timer
        entries.set(id, { id, ...entry, expiresAt: entry.at + entry.durationMs });
        this.units.set(key, entries);
    }

    applyStatus(event, at) {
        const key = unitKey(event.side, event.index);
        const id = `status:${event.status}`;
        if (!event.on) {
            this.units.get(key)?.delete(id);
            return;
        }
        const linked = this.pending.get(`${key}|${event.status}`);
        const known = linked && at - linked.at <= STATUS_LINK_MS;
        this.add(
            { side: event.side, index: event.index },
            id,
            known
                ? {
                      kind: KIND_STATUS,
                      status: event.status,
                      abilityHrid: linked.abilityHrid,
                      durationMs: linked.durationMs,
                      at,
                  }
                : // No cast to blame (an enrage, or one we missed): shown while the flag is up, without a countdown
                  { kind: KIND_STATUS, status: event.status, abilityHrid: '', durationMs: null, at }
        );
        if (!known) this.units.get(key).get(id).expiresAt = null;
    }

    /**
     * @param {string} side - 'p' or 'm'
     * @param {number} index
     * @param {number} now - Timestamp in ms
     * @returns {Array<{id: string, kind: string, status?: string, abilityHrid: string, remainingMs: ?number, durationMs: ?number, symbol?: string, stacks?: number, value?: number}>}
     *     What is on that unit, buffs first and the ones running out soonest leading
     */
    getUnit(side, index, now) {
        const entries = this.units.get(unitKey(side, index));
        if (!entries) return [];
        // One icon per ability: a cast that applies several effects at once would otherwise show the same icon
        // several times. Statuses stay apart, since each has its own icon.
        const grouped = new Map();
        for (const [id, entry] of entries) {
            if (entry.expiresAt !== null && entry.expiresAt <= now) {
                entries.delete(id);
                continue;
            }
            const remainingMs = entry.expiresAt === null ? null : entry.expiresAt - now;
            const groupId =
                entry.kind === KIND_STATUS || !entry.abilityHrid ? id : `${entry.kind}:${entry.abilityHrid}`;
            const seen = grouped.get(groupId);
            if (seen) {
                if (remainingMs !== null && (seen.remainingMs === null || remainingMs > seen.remainingMs)) {
                    seen.remainingMs = remainingMs;
                    seen.durationMs = entry.durationMs;
                }
                continue;
            }
            grouped.set(groupId, {
                id: groupId,
                kind: entry.kind,
                status: entry.status,
                abilityHrid: entry.abilityHrid,
                remainingMs,
                durationMs: entry.durationMs,
                ...(entry.stacks
                    ? { symbol: entry.symbol, stacks: entry.stacks, value: entry.stacks * entry.perStack }
                    : {}),
            });
        }
        const out = [...grouped.values()];
        const order = { [KIND_BUFF]: 0, [KIND_STATUS]: 1, [KIND_DEBUFF]: 2, [KIND_DOT]: 3 };
        return out.sort(
            (a, b) => order[a.kind] - order[b.kind] || (a.remainingMs ?? Infinity) - (b.remainingMs ?? Infinity)
        );
    }
}

export default BuffTracker;
