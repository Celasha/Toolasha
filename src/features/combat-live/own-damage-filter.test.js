// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { settings } = vi.hoisted(() => ({ settings: { combatLive_ownDamageOnly: true } }));
vi.mock('../../core/config.js', () => ({ default: { getSetting: (key) => settings[key] } }));

const { OwnDamageFilter, splatKind } = await import('./own-damage-filter.js');

const SPLAT = {
    damage: 'CombatUnit_splat__a CombatUnit_damage__b',
    crit: 'CombatUnit_splat__a CombatUnit_criticalDamage__b',
};

function buildMonsters(count = 2) {
    document.body.innerHTML = `<div class="BattlePanel_monstersArea__x">${Array.from(
        { length: count },
        () =>
            `<div class="CombatUnit_combatUnit__x"><div class="CombatUnit_splatsContainer__x">${'<div></div>'.repeat(
                3
            )}</div></div>`
    ).join('')}</div>`;
}

const slot = (monster, i) =>
    document.querySelectorAll('[class*="CombatUnit_combatUnit"]')[monster].querySelector('[class*="splatsContainer"]')
        .children[i];

function show(monster, i, className, text) {
    const el = slot(monster, i);
    el.className = className;
    el.textContent = text;
    return el;
}

describe('splatKind', () => {
    test('tells damage, critical and miss numbers apart and ignores the rest', () => {
        const el = (className) => Object.assign(document.createElement('div'), { className });
        expect(splatKind(el(SPLAT.damage))).toBe('damage');
        expect(splatKind(el(SPLAT.crit))).toBe('criticalDamage');
        expect(splatKind(el('CombatUnit_splat__a CombatUnit_miss__b'))).toBe('miss');
        expect(splatKind(el('CombatUnit_splat__a CombatUnit_heal__b'))).toBeNull();
        expect(splatKind(el(''))).toBeNull();
    });
});

describe('OwnDamageFilter', () => {
    let filter;
    let party;

    beforeEach(() => {
        vi.useFakeTimers();
        settings.combatLive_ownDamageOnly = true;
        party = { self: 'Me', size: 2 };
        buildMonsters();
        filter = new OwnDamageFilter();
        filter.initialize({ getSelf: () => party.self, getPartySize: () => party.size, rosterSize: () => 2 });
    });

    afterEach(() => {
        filter.cleanup();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    const hit = (player, amount = 100, extra = {}) => ({
        index: 0,
        amount,
        crit: false,
        miss: false,
        player,
        ...extra,
    });

    test("hides a teammate's number and keeps the viewer's", () => {
        const theirs = show(0, 0, SPLAT.damage, '100');
        const mine = show(0, 1, SPLAT.damage, '250');
        filter.noteHits([hit('Them', 100), hit('Me', 250)]);

        expect(theirs.style.visibility).toBe('hidden');
        expect(mine.style.visibility).toBe('');
    });

    test('works when the game draws the number before the owner is known', () => {
        const el = show(0, 0, SPLAT.damage, '100');
        filter.reconcile();
        expect(el.style.visibility).toBe('');

        filter.noteHits([hit('Them', 100)]);
        expect(el.style.visibility).toBe('hidden');
    });

    test('matches by kind and by monster', () => {
        const crit = show(0, 0, SPLAT.crit, '100');
        const other = show(1, 0, SPLAT.damage, '100');
        filter.noteHits([hit('Them', 100, { crit: true })]);

        expect(crit.style.visibility).toBe('hidden');
        expect(other.style.visibility).toBe('');
    });

    test('hides a hit nobody owns', () => {
        const el = show(0, 0, SPLAT.damage, '40');
        filter.noteHits([hit(null, 40)]);
        expect(el.style.visibility).toBe('hidden');
    });

    test('shows the slot again once the game reuses it', () => {
        const el = show(0, 0, SPLAT.damage, '100');
        filter.noteHits([hit('Them', 100)]);
        expect(el.style.visibility).toBe('hidden');

        el.className = '';
        el.textContent = '';
        filter.reconcile();
        expect(el.style.visibility).toBe('');

        show(0, 0, SPLAT.damage, '100');
        filter.noteHits([hit('Me', 100)]);
        expect(el.style.visibility).toBe('');
    });

    test('hides nothing alone, with the setting off, or when the viewer is unknown', () => {
        for (const change of [
            () => (party.size = 1),
            () => (settings.combatLive_ownDamageOnly = false),
            () => (party.self = null),
        ]) {
            const el = show(0, 0, SPLAT.damage, '100');
            change();
            filter.noteHits([hit('Them', 100)]);
            expect(el.style.visibility).toBe('');
            party.size = 2;
            party.self = 'Me';
            settings.combatLive_ownDamageOnly = true;
            el.className = '';
            filter.reconcile();
        }
    });

    test('turning the setting off shows what was hidden', () => {
        const el = show(0, 0, SPLAT.damage, '100');
        filter.noteHits([hit('Them', 100)]);
        expect(el.style.visibility).toBe('hidden');

        settings.combatLive_ownDamageOnly = false;
        filter.reconcile();
        expect(el.style.visibility).toBe('');
    });

    test('leaves the cards alone when the DOM and the roster disagree', () => {
        buildMonsters(3);
        const el = show(0, 0, SPLAT.damage, '100');
        filter.noteHits([hit('Them', 100)]);
        expect(el.style.visibility).toBe('');
    });

    test('forgets hits whose number never showed up', () => {
        filter.noteHits([hit('Them', 100)]);
        vi.advanceTimersByTime(5000);
        const el = show(0, 0, SPLAT.damage, '100');
        filter.reconcile();
        expect(el.style.visibility).toBe('');
    });
});
