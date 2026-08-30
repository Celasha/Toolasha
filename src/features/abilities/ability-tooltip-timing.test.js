/* @vitest-environment jsdom */

/**
 * Tests for ability tooltip timing injection: only shows effective values that differ from
 * base, resolves ability name -> hrid correctly, and respects the settings gate.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const settingsMap = { abilityTooltip_effectiveTiming: true };

const { subscribeMock, unsubscribeMock } = vi.hoisted(() => ({
    subscribeMock: vi.fn(),
    unsubscribeMock: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: {
        COLOR_TOOLTIP_INFO: '#2563eb',
        getSetting: (key) => settingsMap[key] ?? false,
    },
}));

vi.mock('../../core/tooltip-observer.js', () => ({
    default: { subscribe: subscribeMock, unsubscribe: unsubscribeMock },
}));

const abilityDetailMap = {
    '/abilities/frost_surge': {
        hrid: '/abilities/frost_surge',
        name: 'Frost Surge',
        cooldownDuration: 15_000_000_000,
        castDuration: 2_000_000_000,
    },
};

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getInitClientData: vi.fn(() => ({ abilityDetailMap })),
    },
}));

const statsMock = vi.hoisted(() => ({ stats: null }));

vi.mock('../combat-sim/ability-timing-calculator.js', () => ({
    getCurrentAbilityTimingStats: vi.fn(() => statsMock.stats),
    calculateEffectiveAbilityTiming: (cooldownNs, castNs, stats) => {
        const baseCooldown = cooldownNs / 1e9;
        const baseCastTime = castNs / 1e9;
        const effectiveCooldown =
            stats.abilityHaste > 0 ? (baseCooldown * 100) / (100 + stats.abilityHaste) : baseCooldown;
        const effectiveCastTime = baseCastTime / (1 + stats.castSpeed);
        return { baseCooldown, effectiveCooldown, baseCastTime, effectiveCastTime };
    },
}));

const abilityTooltipTiming = (await import('./ability-tooltip-timing.js')).default;

function makeAbilityTooltip(name = 'Frost Surge') {
    const popper = document.createElement('div');
    popper.className = 'MuiTooltip-popper';

    const abilityTooltip = document.createElement('div');
    abilityTooltip.className = 'Ability_abilityTooltip__2K255';

    const nameEl = document.createElement('div');
    nameEl.className = 'Ability_name__abc';
    nameEl.textContent = name;

    const cooldownEl = document.createElement('div');
    cooldownEl.textContent = 'Cooldown: 15s';

    const castTimeEl = document.createElement('div');
    castTimeEl.textContent = 'Cast Time: 2s';

    abilityTooltip.appendChild(nameEl);
    abilityTooltip.appendChild(cooldownEl);
    abilityTooltip.appendChild(castTimeEl);
    popper.appendChild(abilityTooltip);
    return { popper, abilityTooltip, cooldownEl, castTimeEl };
}

describe('AbilityTooltipTiming', () => {
    beforeEach(() => {
        abilityTooltipTiming.disable();
        vi.clearAllMocks();
        settingsMap.abilityTooltip_effectiveTiming = true;
        statsMock.stats = { abilityHaste: 0, castSpeed: 0, attackLevel: 1 };
    });

    test('does not subscribe when the setting is off', () => {
        settingsMap.abilityTooltip_effectiveTiming = false;
        abilityTooltipTiming.initialize();
        expect(subscribeMock).not.toHaveBeenCalled();
    });

    test('subscribes to the shared tooltip observer when enabled', () => {
        abilityTooltipTiming.initialize();
        expect(subscribeMock).toHaveBeenCalledWith('AbilityTooltipTiming', expect.any(Function));
    });

    test('injects nothing when effective values match base (no haste/cast speed contribution)', () => {
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, abilityTooltip } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(abilityTooltip.querySelector('.mwi-ability-timing-injected')).toBeNull();
    });

    test('injects only the differing value (Ability Haste reduces cooldown, cast speed unaffected)', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl, castTimeEl } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s (12.5s)');
        expect(castTimeEl.textContent).toBe('Cast Time: 2s');
    });

    test('injects both values inline when both differ from base', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0.25, attackLevel: 1 };
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl, castTimeEl } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s (12.5s)');
        expect(castTimeEl.textContent).toBe('Cast Time: 2s (1.6s)');
    });

    test('ignores close events', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip();

        callback(popper, 'closed');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s');
    });

    test('does not inject twice for the same tooltip element', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip();

        callback(popper, 'opened');
        callback(popper, 'opened');

        expect(cooldownEl.querySelectorAll('.mwi-ability-timing-injected')).toHaveLength(1);
    });

    test('skips non-ability tooltips silently', () => {
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const popper = document.createElement('div');
        popper.className = 'MuiTooltip-popper';
        popper.innerHTML = '<div class="ItemTooltipText_itemTooltipText__zFq3A">Some Item</div>';

        expect(() => callback(popper, 'opened')).not.toThrow();
    });

    test('skips unrecognized ability names (no hrid match) without throwing', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipTiming.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip('Unknown Ability');

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s');
    });

    test('unsubscribes on disable', () => {
        abilityTooltipTiming.initialize();
        abilityTooltipTiming.disable();
        expect(unsubscribeMock).toHaveBeenCalledWith('AbilityTooltipTiming');
    });
});
