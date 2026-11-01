/**
 * Combat Live Recorder
 *
 * Optional diagnostic: keeps the most recent battle messages in a compact form so who-hit-whom
 * rules can be tested offline against real fights (the game never says which attacker landed a
 * hit, so any rule for it is a guess until it has been checked against recordings).
 *
 * Bounded (MAX_ENTRIES, oldest dropped first). A recording contains player names and character ids
 * from the battle, so look it over before sharing it.
 */

const MAX_ENTRIES = 5000;
const FORMAT = 'toolasha-combat-live-recording';
const FORMAT_VERSION = 1;

/**
 * @param {Object} entry - Raw pMap/mMap entry from battle_updated
 * @returns {Array} [cHP, cMP, atkCounter, isAutoAtk, abilityHrid, dmgCounter, critCounter]
 */
function compactUnit(entry) {
    return [
        entry?.cHP ?? null,
        entry?.cMP ?? null,
        entry?.atkCounter ?? null,
        entry?.isAutoAtk ? 1 : 0,
        entry?.abilityHrid || '',
        entry?.dmgCounter ?? null,
        entry?.critCounter ?? null,
    ];
}

function compactMap(map) {
    const out = {};
    for (const [index, entry] of Object.entries(map || {})) {
        out[index] = compactUnit(entry);
    }
    return out;
}

export class CombatLiveRecorder {
    constructor(maxEntries = MAX_ENTRIES) {
        this.maxEntries = maxEntries;
        this.entries = [];
    }

    /**
     * @param {Object} data - new_battle payload
     * @param {number} at - Timestamp in ms
     * @param {string|number|null} selfCharacterId - The recording player's character id
     */
    recordNewBattle(data, at, selfCharacterId = null) {
        this.push({
            k: 'nb',
            t: at,
            id: data?.battleId ?? null,
            w: data?.wave ?? null,
            self: selfCharacterId,
            p: (data?.players || []).map((unit) => ({
                n: unit?.name ?? unit?.character?.name ?? null,
                c: unit?.character?.id ?? null,
                hp: unit?.currentHitpoints ?? null,
                mp: unit?.currentManapoints ?? null,
                atk: unit?.attackAttemptCounter ?? null,
            })),
            m: (data?.monsters || []).map((unit) => ({
                h: unit?.hrid ?? null,
                hp: unit?.currentHitpoints ?? null,
            })),
        });
    }

    /**
     * @param {Object} data - battle_updated payload
     * @param {number} at - Timestamp in ms
     */
    recordBattleUpdated(data, at) {
        this.push({
            k: 'bu',
            t: at,
            id: data?.battleId ?? null,
            p: compactMap(data?.pMap),
            m: compactMap(data?.mMap),
        });
    }

    push(entry) {
        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.splice(0, this.entries.length - this.maxEntries);
        }
    }

    clear() {
        this.entries = [];
    }

    /**
     * @param {number} [now] - Timestamp in ms for the header
     * @returns {string} JSON text of everything recorded so far
     */
    exportJSON(now = Date.now()) {
        return JSON.stringify({
            format: FORMAT,
            version: FORMAT_VERSION,
            recordedAt: new Date(now).toISOString(),
            // Order of each [..] row in `p` / `m` entries of a 'bu' record
            unitFields: ['cHP', 'cMP', 'atkCounter', 'isAutoAtk', 'abilityHrid', 'dmgCounter', 'critCounter'],
            entries: this.entries,
        });
    }
}

export default CombatLiveRecorder;
