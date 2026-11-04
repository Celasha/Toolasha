/**
 * Battle Stats
 *
 * Aggregates BattleEventTracker events into the numbers the live combat panels show.
 *
 * Received by a unit (read straight off that unit): damage taken, hits, crits, misses, healing,
 * deaths and mana gained. Party damage is therefore the damage received by monsters.
 *
 * Who dealt it: the game's developer confirmed one battle_updated is one combat event with one
 * attacker, and the attacker is the unit whose attack counter rose. So every monster hit in a
 * message is credited to the one player who acted in it, under the ability that player had prepared
 * beforehand (or auto attack). When nobody acted the damage has no attacker in the message:
 *   - a monster acted in the same message  -> reflected (thorns, retribution)
 *   - nobody acted                          -> damage over time
 * Alone, those two are still yours (nobody else can have caused them), so they are credited to you
 * under their own labels. In a party they stay unattributed rather than being pinned on someone.
 * A message where several players acted at once is unclear and is also left unattributed.
 *
 * Time base: seconds with combat messages flowing. A gap longer than SESSION_GAP_MS (tab asleep,
 * disconnect, between runs) is not counted, so rates are not diluted by idle time.
 */

import { SIDE_MONSTER, SIDE_PLAYER } from './battle-event-tracker.js';
import { DamageHistory, smoothSeries } from './damage-history.js';

const SESSION_GAP_MS = 5000;

// Recent credited hits are kept for the DPS visual: bounded by age and by count
const RECENT_HIT_MS = 65000;
// How much of that the hit tape draws
export const TAPE_WINDOW_MS = 60000;
const RECENT_HIT_MAX = 600;
// "Current DPS" is the damage dealt in this trailing window: long enough that one big hit or the quiet
// seconds between waves do not swing it, the same smoothing the DPS line uses
export const PACE_WINDOW_MS = 16000;

// Keys for the damage "source" rows besides real ability hrids
export const SOURCE_AUTO = 'auto';
export const SOURCE_REFLECT = 'reflect';
// Reflected damage given to the party's only known reflecter when the update does not say whose it was
export const SOURCE_REFLECT_GUESS = 'reflect-guess';
export const SOURCE_OVER_TIME = 'over-time';
const SOURCE_AMBIGUOUS = 'ambiguous';

const emptyReceived = () => ({ damage: 0, hits: 0, crits: 0, misses: 0, healed: 0 });
const emptyDealt = () => ({ damage: 0, hits: 0, crits: 0, misses: 0, abilities: new Map() });
const emptyBucket = () => ({ damage: 0, hits: 0 });

/**
 * Count one damage event into a running tally (hits include crits and misses).
 * @param {{damage: number, hits: number, crits: number, misses: number}} tally
 * @param {Object} event - A 'damage' event
 */
function addDamage(tally, event) {
    const hits = event.hits ?? 1;
    tally.damage += event.amount;
    tally.hits += hits;
    if (event.miss) tally.misses += hits;
    else if (event.crit) tally.crits += 1;
}

// Damage-over-time ticks land a little after the nominal duration ends
const DOT_SLACK_MS = 1500;

export class BattleStats {
    constructor() {
        // Looks up how long an ability's damage over time lasts (ms); abilities are unknown until set
        this.dotDurationMs = () => 0;
        // Looks up an ability's mana cost and base cooldown (ms); null when unknown
        this.abilityInfo = () => null;
        // What each player has equipped: name -> {abilities, haste}
        this.loadouts = new Map();
        this.reset();
    }

    /**
     * @param {function(string): number} lookup - Ability hrid to the length of its damage over time in ms
     */
    setDotLookup(lookup) {
        this.dotDurationMs = lookup;
    }

    /**
     * @param {function(string): ?{manaCost: number, cooldownMs: number}} lookup - Ability hrid to its cost
     *     and base cooldown
     */
    setAbilityLookup(lookup) {
        this.abilityInfo = lookup;
    }

    /**
     * @param {Array<{name: string, abilities: string[], abilityHaste: number}>} units - Players of the battle
     */
    setLoadouts(units) {
        this.loadouts = new Map(
            units.map((unit) => [unit.name, { abilities: unit.abilities || [], haste: unit.abilityHaste || 0 }])
        );
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
        // When the current wave's monsters appeared, and the damage each has taken since
        this.waveStart = null;
        this.waveDamage = new Map();
        this.monsters = new Map();
        this.players = new Map();
        this.playerNames = [];
        this.playerCount = 0;
        this.selfName = null;
        this.recentHits = [];
        // Damage per player in 2s steps over the last five minutes, for the DPS line
        this.history = new DamageHistory();
        // Damage-over-time effects cast and still running: {player, key, until}
        this.activeDots = [];
        // Per player: when each ability was last cast, and the casts that were refused for lack of mana
        this.lastCasts = new Map();
        this.refusals = new Map();
        // Players seen reflecting damage, learned from updates where only they were struck
        this.reflecters = new Set();
        this.bestDps = 0;
        this.dealt = new Map();
        this.unattributed = {
            [SOURCE_OVER_TIME]: emptyBucket(),
            [SOURCE_REFLECT]: emptyBucket(),
            [SOURCE_AMBIGUOUS]: emptyBucket(),
        };
    }

    /**
     * Players currently in the battle. Alone, every monster hit is yours; in a party a hit is only
     * credited when one player's action counter identifies them.
     * @param {string[]} names - Player names in battle order
     */
    setPlayers(names) {
        this.playerNames = names;
        this.playerCount = names.length;
    }

    /**
     * A new battle (wave) started: every monster in it is present from now. Kill times and the damage
     * per enemy type are measured from here.
     * @param {number} [at] - Message timestamp in ms
     */
    beginWave(at = Date.now()) {
        this.waveStart = at;
        this.waveDamage = new Map();
    }

    /**
     * The player whose own damage the DPS visual follows.
     * @param {?string} name
     */
    setSelf(name) {
        this.selfName = name || null;
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

        this.trackDots(events, at);
        this.trackRefusals(events, at);
        for (const event of events) {
            if (event.side === SIDE_MONSTER) {
                this.recordMonster(event, at);
            } else if (event.side === SIDE_PLAYER) {
                this.recordPlayer(event);
            }
        }
        this.attributeHits(events, at);
    }

    /**
     * Remember which players have a damage-over-time effect running, from the abilities they cast.
     * @param {Object[]} events - Events from one message
     * @param {number} at - Message timestamp in ms
     */
    trackDots(events, at) {
        this.activeDots = this.activeDots.filter((dot) => dot.until >= at);
        for (const event of events) {
            if (event.side !== SIDE_PLAYER || event.type !== 'attack' || !event.abilityHrid) continue;
            const duration = this.dotDurationMs(event.abilityHrid);
            if (!(duration > 0)) continue;
            // A new cast of the same ability refreshes the old one
            this.activeDots = this.activeDots.filter(
                (dot) => !(dot.player === event.name && dot.key === event.abilityHrid)
            );
            this.activeDots.push({ player: event.name, key: event.abilityHrid, until: at + duration + DOT_SLACK_MS });
        }
    }

    /**
     * Count the casts a player was refused for lack of mana. A unit that cannot afford the first ability
     * that is ready does not drop to a cheaper one: it auto attacks until it can. So an auto attack, while
     * an ability the player has used was off cooldown but cost more than their mana, is a refused cast.
     * An estimate: the abilities' own triggers are not visible, so only abilities the player has actually
     * cast count, and cooldowns use the base time sped up by their ability haste.
     * @param {Object[]} events - Events from one message
     * @param {number} at - Message timestamp in ms
     */
    trackRefusals(events, at) {
        for (const event of events) {
            if (event.side !== SIDE_PLAYER || event.type !== 'attack') continue;
            const casts = this.lastCasts.get(event.name) || new Map();
            this.lastCasts.set(event.name, casts);

            if (event.abilityHrid) {
                casts.set(event.abilityHrid, at);
                continue;
            }
            if (!event.auto || !(event.manaBefore >= 0)) continue;

            const loadout = this.loadouts.get(event.name);
            if (!loadout) continue;
            const refused = [];
            for (const hrid of loadout.abilities) {
                if (!casts.has(hrid)) continue;
                const info = this.abilityInfo(hrid);
                if (!info || !(info.manaCost > event.manaBefore)) continue;
                const cooldown = loadout.haste > 0 ? (info.cooldownMs * 100) / (100 + loadout.haste) : info.cooldownMs;
                if (at - casts.get(hrid) >= cooldown) refused.push(hrid);
            }
            if (!refused.length) continue;

            const row = this.refusals.get(event.name) || { casts: 0, abilities: new Map() };
            row.casts += 1;
            for (const hrid of refused) row.abilities.set(hrid, (row.abilities.get(hrid) || 0) + 1);
            this.refusals.set(event.name, row);
        }
    }

    /**
     * Decide who dealt the monster hits in one message.
     * @param {Object[]} events - Events from one message
     * @param {number} [at] - Message timestamp in ms
     * @returns {{player: ?string, key: string, bucket: ?string}} player + key to credit, or a bucket
     */
    resolveSource(events, at = Date.now()) {
        const attacks = events.filter((event) => event.side === SIDE_PLAYER && event.type === 'attack');
        const solo = this.playerNames.length === 1 ? this.playerNames[0] : null;

        if (attacks.length === 1) {
            const attack = attacks[0];
            return { player: attack.name, key: attack.auto ? SOURCE_AUTO : attack.abilityHrid, bucket: null };
        }
        if (attacks.length === 0) {
            const reflected = events.some((event) => event.side === SIDE_MONSTER && event.type === 'attack');
            // Nobody acted and no monster did: it is a damage-over-time tick. When exactly one player has
            // such an effect running, it is theirs (their latest cast if they have several).
            if (!reflected) {
                const dots = this.activeDots.filter((dot) => dot.until >= at);
                if (new Set(dots.map((dot) => dot.player)).size === 1) {
                    const latest = dots[dots.length - 1];
                    return { player: latest.player, key: latest.key, bucket: null };
                }
            }
            // A monster that acted and lost HP in the same update was hit back by whoever it struck, a miss
            // included. When exactly one player was struck, the reflected damage is theirs.
            if (reflected) {
                const struck = new Set(
                    events
                        .filter((event) => event.side === SIDE_PLAYER && event.type === 'damage')
                        .map((event) => event.name)
                );
                if (struck.size === 1) {
                    const [player] = struck;
                    this.reflecters.add(player);
                    return { player, key: SOURCE_REFLECT, bucket: null };
                }
                // Several were struck. If the party has exactly one known reflecter and they were among
                // them, it is most likely theirs: credited, but marked as an estimate.
                const known = this.playerNames.filter((name) => this.reflecters.has(name));
                if (known.length === 1 && struck.has(known[0])) {
                    return { player: known[0], key: SOURCE_REFLECT_GUESS, bucket: null };
                }
            }
            const key = reflected ? SOURCE_REFLECT : SOURCE_OVER_TIME;
            return solo ? { player: solo, key, bucket: null } : { player: null, key, bucket: key };
        }
        return { player: null, key: SOURCE_AMBIGUOUS, bucket: SOURCE_AMBIGUOUS };
    }

    /**
     * Credit this message's monster hits to a player's ability, or to an unattributed bucket.
     * @param {Object[]} events - Events from one message
     * @param {number} at - Message timestamp in ms
     */
    attributeHits(events, at = Date.now()) {
        const hits = events.filter((event) => event.side === SIDE_MONSTER && event.type === 'damage');
        if (!hits.length) return;

        const source = this.resolveSource(events, at);
        for (const hit of hits) {
            if (source.bucket) {
                const bucket = this.unattributed[source.bucket];
                bucket.damage += hit.amount;
                bucket.hits += hit.hits ?? 1;
                continue;
            }
            const row = this.dealt.get(source.player) || emptyDealt();
            addDamage(row, hit);
            const ability = row.abilities.get(source.key) || { damage: 0, hits: 0, crits: 0, misses: 0 };
            addDamage(ability, hit);
            row.abilities.set(source.key, ability);
            this.dealt.set(source.player, row);
            this.history.add(source.player, hit.amount, at);
            this.recentHits.push({
                t: at,
                player: source.player,
                key: source.key,
                amount: hit.amount,
                crit: Boolean(hit.crit) && !hit.miss,
                miss: Boolean(hit.miss),
            });
        }
        this.pruneRecentHits(at);
        this.trackBestDps(at);
    }

    /**
     * A player's mana per ability, with how often each was refused for lack of mana. An ability that was only
     * ever refused still gets a row.
     * @param {Object} player - Tracked player
     * @returns {Object[]} Largest spender first
     */
    abilityManaRows(player) {
        const rate = (value) => (this.activeMs > 0 ? value / (this.activeMs / 1000) : 0);
        const refused = this.refusals.get(player.name)?.abilities ?? new Map();
        const rows = new Map();
        for (const [abilityHrid, row] of player.abilityMana) {
            rows.set(abilityHrid, { abilityHrid, ...row, refused: refused.get(abilityHrid) ?? 0 });
        }
        for (const [abilityHrid, count] of refused) {
            if (!rows.has(abilityHrid)) rows.set(abilityHrid, { abilityHrid, mana: 0, events: 0, refused: count });
        }
        return [...rows.values()]
            .map((row) => ({ ...row, perSecond: rate(row.mana) }))
            .sort((a, b) => b.mana - a.mana || b.refused - a.refused);
    }

    pruneRecentHits(now) {
        const cutoff = now - RECENT_HIT_MS;
        let drop = 0;
        while (drop < this.recentHits.length && this.recentHits[drop].t < cutoff) drop++;
        const excess = Math.max(0, this.recentHits.length - drop - RECENT_HIT_MAX);
        if (drop + excess > 0) this.recentHits.splice(0, drop + excess);
    }

    /**
     * The player the DPS visual follows: you when known, the only player when alone, else nobody.
     * @returns {?string}
     */
    chartSubject() {
        if (this.selfName && this.playerNames.includes(this.selfName)) return this.selfName;
        return this.playerNames.length === 1 ? this.playerNames[0] : null;
    }

    /**
     * Damage per second over the trailing pace window.
     * @param {?string} player - Whose hits to count
     * @param {number} now - Window end in ms
     * @returns {number}
     */
    windowDps(player, now) {
        const start = now - PACE_WINDOW_MS;
        let total = 0;
        for (const hit of this.recentHits) {
            if (hit.player === player && hit.t > start && hit.t <= now) total += hit.amount;
        }
        // A fight that has only just started has less than a full window behind it
        const seconds = Math.min(PACE_WINDOW_MS / 1000, Math.max(1, this.getActiveSeconds()));
        return total / seconds;
    }

    trackBestDps(at) {
        const subject = this.chartSubject();
        // Not until there is a full window of combat behind it, so one early big hit is not a "best"
        if (!subject || this.activeMs < PACE_WINDOW_MS) return;
        this.bestDps = Math.max(this.bestDps, this.windowDps(subject, at));
    }

    recordMonster(event, at) {
        const key = event.hrid || `monster-${event.index}`;
        const monster = this.monsters.get(key) || {
            hrid: event.hrid,
            ...emptyReceived(),
            kills: 0,
            // Damage taken by the ones that died, and how long they were alive: enemy DPS and kill time
            killedDamage: 0,
            aliveSeconds: 0,
        };
        this.monsters.set(key, monster);

        if (event.type === 'damage') {
            const hits = event.hits ?? 1;
            monster.damage += event.amount;
            this.waveDamage.set(event.index, (this.waveDamage.get(event.index) || 0) + event.amount);
            monster.hits += hits;
            this.partyDamage += event.amount;
            this.partyHits += hits;
            if (event.miss) {
                monster.misses += hits;
                this.partyMisses += hits;
            } else if (event.crit) {
                monster.crits += 1;
                this.partyCrits += 1;
            }
        } else if (event.type === 'heal') {
            monster.healed += event.amount;
        } else if (event.type === 'death') {
            monster.kills += 1;
            this.kills.set(key, (this.kills.get(key) || 0) + 1);
            this.killedMaxHp += event.maxHp || 0;
            // Only a wave whose start we saw can say how long this one was alive
            if (this.waveStart !== null && at >= this.waveStart) {
                monster.killedDamage += this.waveDamage.get(event.index) || 0;
                monster.aliveSeconds += (at - this.waveStart) / 1000;
            }
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
            case 'damage': {
                const hits = event.hits ?? 1;
                player.damage += event.amount;
                player.hits += hits;
                if (event.miss) player.misses += hits;
                else if (event.crit) player.crits += 1;
                break;
            }
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
     * @param {number} now - Window end in ms
     * @param {function(number): number} rate - Damage to per-second over the whole session
     * @param {?string} [player] - Whose chart; the followed player by default
     * @param {boolean} [withSeries] - Also include the smoothed DPS line (the bar's sparkline needs it)
     * @returns {?Object} Recent hits and pace for that player, or null when there is none
     */
    getChartData(now, rate, player = this.chartSubject(), withSeries = false) {
        if (!player) return null;
        const start = now - TAPE_WINDOW_MS;
        return {
            player,
            now,
            hits: this.recentHits.filter((hit) => hit.player === player && hit.t >= start && hit.t <= now),
            currentDps: this.windowDps(player, now),
            // Only the followed player's best is tracked
            bestDps: player === this.chartSubject() ? this.bestDps : 0,
            averageDps: rate((this.dealt.get(player) || emptyDealt()).damage),
            // DPS over the last five minutes in 2s steps, smoothed over 16s; oldest first
            series: withSeries ? smoothSeries(this.history.series(player, now)) : [],
        };
    }

    /**
     * @returns {number} Seconds of combat counted so far
     */
    getActiveSeconds() {
        return this.activeMs / 1000;
    }

    /**
     * @param {number} [now] - Time the summary is for, in ms (the trailing windows end here)
     * @returns {Object} Plain summary for the panels
     */
    getSummary(now = Date.now()) {
        const seconds = this.getActiveSeconds();
        const rate = (value) => (seconds > 0 ? value / seconds : 0);
        const kills = [...this.kills.values()].reduce((sum, count) => sum + count, 0);
        const unattributedDamage = Object.values(this.unattributed).reduce((sum, bucket) => sum + bucket.damage, 0);
        const unattributedHits = Object.values(this.unattributed).reduce((sum, bucket) => sum + bucket.hits, 0);

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
            // Alone, every hit is yours and nothing is left unattributed
            attributionExact: this.playerCount === 1,
            // What the DPS visual draws: the followed player's recent hits and pace
            chart: this.getChartData(now, rate, this.chartSubject(), true),
            // In a party, a chart for every member, the followed player first
            charts:
                this.playerNames.length > 1
                    ? [...this.playerNames]
                          .sort((a, b) => Number(b === this.chartSubject()) - Number(a === this.chartSubject()))
                          .map((name) => this.getChartData(now, rate, name))
                    : [],
            dealt: this.playerNames.map((name) => {
                const row = this.dealt.get(name) || emptyDealt();
                return {
                    name,
                    damage: row.damage,
                    hits: row.hits,
                    crits: row.crits,
                    misses: row.misses,
                    dps: rate(row.damage),
                    share: this.partyDamage > 0 ? row.damage / this.partyDamage : 0,
                    abilities: [...row.abilities.entries()]
                        .map(([key, ability]) => ({
                            key,
                            ...ability,
                            dps: rate(ability.damage),
                            share: row.damage > 0 ? ability.damage / row.damage : 0,
                        }))
                        .sort((a, b) => b.damage - a.damage),
                };
            }),
            unattributed: {
                damage: unattributedDamage,
                hits: unattributedHits,
                share: this.partyDamage > 0 ? unattributedDamage / this.partyDamage : 0,
                overTime: this.unattributed[SOURCE_OVER_TIME].damage,
                reflected: this.unattributed[SOURCE_REFLECT].damage,
                unclear: this.unattributed[SOURCE_AMBIGUOUS].damage,
            },
            monsters: [...this.monsters.values()]
                .map((monster) => ({
                    ...monster,
                    // Damage per second of the time it was alive, and how long one lasts on average
                    dps: monster.aliveSeconds > 0 ? monster.killedDamage / monster.aliveSeconds : 0,
                    killTime:
                        monster.kills > 0 && monster.aliveSeconds > 0 ? monster.aliveSeconds / monster.kills : null,
                }))
                .sort((a, b) => b.damage - a.damage),
            players: [...this.players.values()].map((player) => ({
                ...player,
                damageTakenPerSecond: rate(player.damage),
                deathsPerHour: seconds > 0 ? (player.deaths / seconds) * 3600 : 0,
                manaSpentPerSecond: rate(player.manaSpent),
                manaGainedPerSecond: rate(player.manaGained),
                refusedCasts: this.refusals.get(player.name)?.casts ?? 0,
                abilityMana: this.abilityManaRows(player),
            })),
        };
    }
}

export default BattleStats;
