// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { settings } = vi.hoisted(() => ({ settings: { combatLive_buffIcons: true, combatLive_unitBadges: true } }));
vi.mock('../../core/config.js', () => ({ default: { Z_HUD: 50, getSetting: (key) => settings[key] } }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));
vi.mock('../../utils/game-i18n.js', () => ({ getAbilityName: (hrid, fallback) => fallback }));

const { UnitOverlay, countdownText, findAbilitySprite } = await import('./unit-overlay.js');

function buildBattle(players = 2, monsters = 2) {
    document.body.innerHTML = `
        <div class="BattlePanel_playersArea__x">${Array.from(
            { length: players },
            () => '<div class="CombatUnit_combatUnit__x"><div class="CombatUnit_status__x"></div></div>'
        ).join('')}</div>
        <div class="BattlePanel_monstersArea__x">${Array.from(
            { length: monsters },
            () => '<div class="CombatUnit_combatUnit__x"><div class="CombatUnit_status__x"></div></div>'
        ).join('')}</div>`;
    document.querySelectorAll('[class*="CombatUnit_status"]').forEach((el, i) => {
        el.getBoundingClientRect = () => ({
            left: 100 + i * 120,
            right: 210 + i * 120,
            top: 283,
            bottom: 301,
            width: 110,
            height: 18,
        });
    });
}

describe('countdownText', () => {
    test('whole seconds up to a minute, minutes after, nothing when open-ended', () => {
        expect(countdownText(12400)).toBe('13');
        expect(countdownText(59000)).toBe('59');
        expect(countdownText(61000)).toBe('2m');
        expect(countdownText(null)).toBe('');
        expect(countdownText(-50)).toBe('0');
    });
});

describe('findAbilitySprite', () => {
    test('reads the ability sheet from any ability icon on the page, without the icon name', () => {
        document.body.innerHTML = '<svg><use href="/static/media/abilities_sprite.abc.svg#fireball"></use></svg>';
        expect(findAbilitySprite()).toBe('/static/media/abilities_sprite.abc.svg');
        document.body.innerHTML = '';
        expect(findAbilitySprite()).toBeNull();
    });
});

describe('UnitOverlay', () => {
    let overlay;
    let deps;

    beforeEach(() => {
        vi.useFakeTimers();
        settings.combatLive_buffIcons = true;
        settings.combatLive_unitBadges = true;
        buildBattle();
        document.body.insertAdjacentHTML(
            'beforeend',
            '<svg><use href="/static/media/abilities_sprite.abc.svg#fireball"></use></svg>'
        );
        deps = {
            getBuffs: vi.fn((side, index) =>
                side === 'p' && index === 0
                    ? [
                          {
                              id: 'b1',
                              kind: 'buff',
                              abilityHrid: '/abilities/berserk',
                              remainingMs: 9500,
                              durationMs: 20000,
                          },
                      ]
                    : []
            ),
            getBadge: vi.fn((index) => ({
                text: `${index + 1}00 dps`,
                healText: index === 1 ? '5 hps' : '',
                color: '#4fc3ff',
            })),
            isActive: vi.fn(() => true),
            rosterSize: vi.fn((side) => (side === 'p' ? 2 : 2)),
        };
        overlay = new UnitOverlay();
        overlay.initialize(deps);
    });

    afterEach(() => {
        overlay.cleanup();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    const layer = () => document.getElementById('toolasha-combat-live-units');

    test('puts a click-through layer on the HUD level, outside the game elements', () => {
        expect(layer().parentElement).toBe(document.body);
        expect(layer().style.pointerEvents).toBe('none');
        expect(layer().style.zIndex).toBe('50');
    });

    test('a row under every unit, placed inside the unit status row', () => {
        overlay.update();

        expect(layer().children).toHaveLength(4);
        const first = layer().children[0];
        expect(first.style.left).toBe('100px');
        expect(first.style.top).toBe('283px');
        expect(first.style.width).toBe('110px');
    });

    test('a player gets a DPS badge, with HPS when they heal', () => {
        overlay.update();

        expect(layer().children[0].textContent).toContain('100 dps');
        expect(layer().children[1].textContent).toContain('200 dps · 5 hps');
        // Monsters get no badge
        expect(layer().children[2].children[0].style.display).toBe('none');
    });

    test('a buff shows as an icon with its countdown, using the game ability sheet', () => {
        overlay.update(0);

        const row = layer().children[0];
        expect(row.querySelectorAll('svg')).toHaveLength(1);
        expect(row.querySelector('use').getAttribute('href')).toBe('/static/media/abilities_sprite.abc.svg#berserk');
        expect(row.textContent).toContain('10');
    });

    test('the icon stays while the countdown ticks and goes when the buff does', () => {
        overlay.update(0);
        const icon = layer().children[0].querySelector('span');

        deps.getBuffs.mockImplementation((side, index) =>
            side === 'p' && index === 0
                ? [{ id: 'b1', kind: 'buff', abilityHrid: '/abilities/berserk', remainingMs: 4200, durationMs: 20000 }]
                : []
        );
        overlay.update(5000);
        expect(layer().children[0].querySelector('span')).toBe(icon);
        expect(layer().children[0].textContent).toContain('5');

        deps.getBuffs.mockReturnValue([]);
        overlay.update(10000);
        expect(layer().children[0].querySelector('svg')).toBeNull();
    });

    test('a status shows an emoji and, with no countdown, no number', () => {
        deps.getBuffs.mockImplementation((side, index) =>
            side === 'm' && index === 1
                ? [{ id: 's', kind: 'status', status: 'stunned', abilityHrid: '', remainingMs: null, durationMs: null }]
                : []
        );

        overlay.update();

        expect(layer().children[3].textContent).toContain('💫');
    });

    test('a side whose roster does not match the screen is left alone', () => {
        deps.rosterSize.mockImplementation((side) => (side === 'p' ? 5 : 2));

        overlay.update();

        expect(layer().children).toHaveLength(2);
    });

    test('hides when the fight has gone quiet, and when the settings are off', () => {
        deps.isActive.mockReturnValue(false);
        overlay.update();
        expect(layer().style.display).toBe('none');

        deps.isActive.mockReturnValue(true);
        settings.combatLive_buffIcons = false;
        settings.combatLive_unitBadges = false;
        overlay.update();
        expect(layer().children[0].querySelector('svg')).toBeNull();
        expect(layer().children[0].children[0].style.display).toBe('none');
    });

    test('a unit with no size on screen (the combat tab is not showing) gets no label', () => {
        document.querySelectorAll('[class*="CombatUnit_status"]').forEach((el) => {
            el.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 0, width: 0, height: 0 });
        });

        overlay.update();

        expect([...layer().children].every((row) => row.style.display === 'none')).toBe(true);
    });

    describe('a unit scrolled out of view', () => {
        const scrollBox = (top, bottom) => {
            const box = document.querySelector('.BattlePanel_monstersArea__x');
            box.style.overflowY = 'auto';
            box.getBoundingClientRect = () => ({ left: 0, right: 900, top, bottom, width: 900, height: bottom - top });
        };
        const displays = () => [...layer().children].map((row) => row.style.display);

        test('gets no label, while the units still inside the scroll box keep theirs', () => {
            // Monster rows sit at y 283-301; a box that ends at 290 cuts them both off
            scrollBox(0, 290);
            overlay.update();
            expect(displays()).toEqual(['flex', 'flex', 'none', 'none']);
        });

        test('gets its label back when it scrolls into the box', () => {
            scrollBox(0, 290);
            overlay.update();
            scrollBox(0, 400);
            overlay.update();
            expect(displays()).toEqual(['flex', 'flex', 'flex', 'flex']);
        });

        test('a unit below the bottom of the page gets no label', () => {
            document.querySelectorAll('[class*="CombatUnit_status"]').forEach((el) => {
                el.getBoundingClientRect = () => ({
                    left: 100,
                    right: 210,
                    top: 2000,
                    bottom: 2018,
                    width: 110,
                    height: 18,
                });
            });
            overlay.update();
            expect(displays().every((display) => display === 'none')).toBe(true);
        });
    });

    test('cleanup removes the layer', () => {
        overlay.cleanup();
        expect(layer()).toBeNull();
    });
});
