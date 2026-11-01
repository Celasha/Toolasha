/**
 * Battle Stats
 *
 * Aggregates BattleEventTracker events into the numbers the live combat panels show.
 *
 * What is exact (read straight off the unit that received the change):
 *   - damage dealt by the whole party = damage received by monsters
 *   - damage taken, hits, crits, misses, healing, deaths and mana gained per unit
 *   - a player's mana spent, per ability (the spend and the prepared ability are on the same unit)
 *
 * What is NOT exact: damage per party member. The game never says which attacker hit which target.
 * Alone, every hit is yours, so your figure is exact (`attributionExact`). In a party a message's
 * monster hits are credited to a player only when exactly one player started a new attack in that
 * same message; every other hit goes to an explicit "unattributed" bucket, never to a guess.
 * Per-ability damage is not attempted. The estimate has not been validated against real party
 * recordings yet, which is why the panel labels it and shows the unattributed share.
 *
 * Time base: seconds with combat messages flowing. A gap longer than SESSION_GAP_MS (tab asleep,
 * disconnect, between runs) is not counted, so rates are not diluted by idle time.
 */

import { SIDE_MONSTER, SIDE_PLAYER } from './battle-event-tracker.js';

const SESSION_GAP_MS = 5000;

const emptyReceived = () => ({ damage: 0, hits: 0, crits: 0, misses: 0, healed: 0 });

export class BattleStats {
    constructor() {
        this.reset();
    }

    reset() {
        this.activeMs = 0;
        this.lastAt = null;
        this.partyDamage = 0;
        this.partyHits = 0;
        this.partyCrits = 0;
        this.partyMisses = 0;
        this.kills = new Map();
        this.killedMaxHp = 0;
        this.monsters = new Map();
        this.players = new Map();
        this.playerNames = [];
        this.playerCount = 0;
        this.dealt = new Map();
        this.unattributed = { damage: 0, hits: 0 };
    }

    /**
     * Players currently in the battle. One player means every hit is theirs (exact); more than one
     * means per-player damage can only be estimated.
     * @param {string[]} names - Player names in battle order
     */
    setPlayers(names) {
        this.playerNames = names;
        this.playerCount = names.length;
    }

    /**
     * Work out who landed the monster hits in one message.
     * Alone: you did, exactly. In a party: only when exactly one player started a new attack in the
     * same message (an estimate, since the game never links an attacker to a target). Anything else
     * is left unattributed rather than forced onto someone.
     * @param {Object[]} events - Events from one message
     * @returns {{name: string, exact: boolean}|null}
     */
    resolveAttacker(events) {
        if (this.playerNames.length === 1) {
            return { name: this.playerNames[0], exact: true };
        }
        const attackers = new Set(
            events.filter((event) => event.side === SIDE_PLAYER && event.type === 'attack').map((event) => event.name)
        );
        return attackers.size === 1 ? { name: [...attackers][0], exact: false } : null;
    }

    /**
     * Credit this message's monster hits to an attacker, or to the unattributed bucket.
     * @param {Object[]} events - Events from one message
     */
    attributeHits(events) {
        const hits = events.filter((event) => event.side === SIDE_MONSTER && event.type === 'damage');
        if (!hits.length) return;

        const attacker = this.resolveAttacker(events);
        for (const hit of hits) {
            if (!attacker) {
                this.unattributed.damage += hit.amount;
                this.unattributed.hits += 1;
                continue;
            }
            const row = this.dealt.get(attacker.name) || { damage: 0, hits: 0, crits: 0, misses: 0 };
            row.damage += hit.amount;
            row.hits += 1;
            if (hit.miss) row.misses += 1;
            else if (hit.crit) row.crits += 1;
            this.dealt.set(attacker.name, row);
        }
    }

    /**
     * Fold events from one message into the totals.
     * @param {Object[]} events - Events from BattleEventTracker
     * @param {number} [at] - Message timestamp in ms
     */
    record(events, at = Date.now()) {
        if (this.lastAt !== null) {
            const gap = at - this.lastAt;
            if (gap > 0 && gap <= SESSION_GAP_MS) this.activeMs += gap;
        }
        this.lastAt = at;

        for (const event of events) {
            if (event.side === SIDE_MONSTER) {
                this.recordMonster(event);
            } else if (event.side === SIDE_PLAYER) {
                this.recordPlayer(event);
            }
        }
        this.attributeHits(events);
    }

    recordMonster(event) {
        const key = event.hrid || `monster-${event.index}`;
        const monster = this.monsters.get(key) || { hrid: event.hrid, ...emptyReceived(), kills: 0 };
        this.monsters.set(key, monster);

        if (event.type === 'damage') {
            monster.damage += event.amount;
            monster.hits += 1;
            this.partyDamage += event.amount;
            this.partyHits += 1;
            if (event.crit && !event.miss) {
                monster.crits += 1;
                this.partyCrits += 1;
            }
            if (event.miss) {
                monster.misses += 1;
                this.partyMisses += 1;
            }
        } else if (event.type === 'heal') {
            monster.healed += event.amount;
        } else if (event.type === 'death') {
            monster.kills += 1;
            this.kills.set(key, (this.kills.get(key) || 0) + 1);
            this.killedMaxHp += event.maxHp || 0;
        }
    }

    recordPlayer(event) {
        const key = event.name || `player-${event.index}`;
        const player = this.players.get(key) || {
            name: event.name,
            ...emptyReceived(),
            deaths: 0,
            manaGained: 0,
            manaSpent: 0,
            abilityMana: new Map(),
        };
        this.players.set(key, player);

        switch (event.type) {
            case 'damage':
                player.damage += event.amount;
                player.hits += 1;
                if (event.miss) player.misses += 1;
                else if (event.crit) player.crits += 1;
                break;
            case 'heal':
                player.healed += event.amount;
                break;
            case 'death':
                player.deaths += 1;
                break;
            case 'mana-gain':
                player.manaGained += event.amount;
                break;
            case 'mana-spend': {
                player.manaSpent += event.amount;
                const ability = event.abilityHrid || '';
                const row = player.abilityMana.get(ability) || { mana: 0, events: 0 };
                row.mana += event.amount;
                row.events += 1;
                player.abilityMana.set(ability, row);
                break;
            }
            default:
                break;
        }
    }

    /**
     * @returns {number} Seconds of combat counted so far
     */
    getActiveSeconds() {
        return this.activeMs / 1000;
    }

    /**
     * @returns {Object} Plain summary for the panels
     */
    getSummary() {
        const seconds = this.getActiveSeconds();
        const rate = (value) => (seconds > 0 ? value / seconds : 0);
        const kills = [...this.kills.values()].reduce((sum, count) => sum + count, 0);
        return {
            seconds,
            party: {
                damage: this.partyDamage,
                dps: rate(this.partyDamage),
                hits: this.partyHits,
                crits: this.partyCrits,
                misses: this.partyMisses,
                kills,
                // Kills x max HP: unaffected by overkill and enemy healing
                trueDps: rate(this.killedMaxHp),
            },
            attributionExact: this.playerCount === 1,
            // Per-player damage dealt: exact when alone, an estimate in a party (see resolveAttacker)
            dealt: this.playerNames.map((name) => {
                const row = this.dealt.get(name) || { damage: 0, hits: 0, crits: 0, misses: 0 };
                return { name, ...row, dps: rate(row.damage) };
            }),
            unattributed: {
                ...this.unattributed,
                share: this.partyDamage > 0 ? this.unattributed.damage / this.partyDamage : 0,
            },
            monsters: [...this.monsters.values()].sort((a, b) => b.damage - a.damage),
            players: [...this.players.values()].map((player) => ({
                ...player,
                damageTakenPerSecond: rate(player.damage),
                deathsPerHour: seconds > 0 ? (player.deaths / seconds) * 3600 : 0,
                manaSpentPerSecond: rate(player.manaSpent),
                manaGainedPerSecond: rate(player.manaGained),
                abilityMana: [...player.abilityMana.entries()]
                    .map(([abilityHrid, row]) => ({ abilityHrid, ...row, perSecond: rate(row.mana) }))
                    .sort((a, b) => b.mana - a.mana),
            })),
        };
    }
}

export default BattleStats;
