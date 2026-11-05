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
const FORMAT_VERSION = 2;

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

/**
 * A bounded copy of a unit's buff map as the game sent it.
 * @param {*} map
 * @returns {*} null when there is none
 */
function trimBuffMap(map) {
    if (!map || typeof map !== 'object') return null;
    const entries = Array.isArray(map) ? map.slice(0, 25) : Object.entries(map).slice(0, 25);
    return JSON.parse(JSON.stringify(entries));
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
            // The same for every wave of one combat; a different value is a new combat
            cs: data?.combatStartTime ?? null,
            // Every unit's starting point: the first action of a battle is judged against what it
            // was already preparing and its counters when the battle began.
            p: (data?.players || []).map((unit) => ({
                n: unit?.name ?? unit?.character?.name ?? null,
                c: unit?.character?.id ?? null,
                hp: unit?.currentHitpoints ?? null,
                mp: unit?.currentManapoints ?? null,
                atk: unit?.attackAttemptCounter ?? null,
                ab: unit?.preparingAbilityHrid || '',
                auto: unit?.isPreparingAutoAttack ? 1 : 0,
                dmg: unit?.damageSplatCounter ?? null,
                crit: unit?.criticalDamageSplatCounter ?? null,
                // What is equipped, and how much faster the abilities come off cooldown: casts refused
                la: (unit?.combatAbilities || []).map((ability) => ability?.abilityHrid).filter(Boolean),
                hs: unit?.combatDetails?.combatStats?.abilityHaste ?? 0,
                // The game's own buff list for the unit, kept so its real shape can be checked
                bm: trimBuffMap(unit?.combatBuffMap),
            })),
            m: (data?.monsters || []).map((unit) => ({
                h: unit?.hrid ?? null,
                hp: unit?.currentHitpoints ?? null,
                maxHp: unit?.maxHitpoints ?? null,
                mp: unit?.currentManapoints ?? null,
                atk: unit?.attackAttemptCounter ?? null,
                ab: unit?.preparingAbilityHrid || '',
                auto: unit?.isPreparingAutoAttack ? 1 : 0,
                dmg: unit?.damageSplatCounter ?? null,
                crit: unit?.criticalDamageSplatCounter ?? null,
                // Debuffs on a monster (e.g. curse) live here, as for players
                bm: trimBuffMap(unit?.combatBuffMap),
            })),
            // Which fields a new_battle unit really carries (the names the game uses)
            fields: {
                p: Object.keys(data?.players?.[0] || {}),
                m: Object.keys(data?.monsters?.[0] || {}),
            },
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
