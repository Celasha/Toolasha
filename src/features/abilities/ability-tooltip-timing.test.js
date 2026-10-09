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

// Localized (non-English) display names, e.g. translations['/abilities/frost_surge'] = '霜涌'.
const { translations, tooltipText } = vi.hoisted(() => ({ translations: {}, tooltipText: {} }));

vi.mock('../../utils/game-i18n.js', () => ({
    getAbilityName: (hrid, fallback) => translations[hrid] ?? fallback,
    translateGameName: (namespace, key, fallback) => tooltipText[key] ?? fallback,
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

const { default: abilityTooltipFeature, abilityTooltipTiming: instance } = await import('./ability-tooltip-timing.js');

function makeAbilityTooltip(name = 'Frost Surge', cooldownText = 'Cooldown: 15s', castTimeText = 'Cast Time: 2s') {
    const popper = document.createElement('div');
    popper.className = 'MuiTooltip-popper';

    const abilityTooltip = document.createElement('div');
    abilityTooltip.className = 'Ability_abilityTooltip__2K255';

    const nameEl = document.createElement('div');
    nameEl.className = 'Ability_name__abc';
    nameEl.textContent = name;

    const cooldownEl = document.createElement('div');
    cooldownEl.textContent = cooldownText;

    const castTimeEl = document.createElement('div');
    castTimeEl.textContent = castTimeText;

    abilityTooltip.appendChild(nameEl);
    abilityTooltip.appendChild(cooldownEl);
    abilityTooltip.appendChild(castTimeEl);
    popper.appendChild(abilityTooltip);
    return { popper, abilityTooltip, cooldownEl, castTimeEl };
}

describe('AbilityTooltipTiming', () => {
    beforeEach(() => {
        abilityTooltipFeature.disable();
        vi.clearAllMocks();
        for (const key of Object.keys(translations)) {
            delete translations[key];
        }
        for (const key of Object.keys(tooltipText)) {
            delete tooltipText[key];
        }
        // The name→hrid cache is instance state keyed on the module-level detail map,
        // so it never invalidates between tests - reset it explicitly.
        instance.abilityNameToHridCache = null;
        settingsMap.abilityTooltip_effectiveTiming = true;
        statsMock.stats = { abilityHaste: 0, castSpeed: 0, attackLevel: 1 };
    });

    test('does not subscribe when the setting is off', () => {
        settingsMap.abilityTooltip_effectiveTiming = false;
        abilityTooltipFeature.initialize();
        expect(subscribeMock).not.toHaveBeenCalled();
    });

    test('subscribes to the shared tooltip observer when enabled', () => {
        abilityTooltipFeature.initialize();
        expect(subscribeMock).toHaveBeenCalledWith('AbilityTooltipTiming', expect.any(Function));
    });

    test('injects nothing when effective values match base (no haste/cast speed contribution)', () => {
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, abilityTooltip } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(abilityTooltip.querySelector('.mwi-ability-timing-injected')).toBeNull();
    });

    test('injects only the differing value (Ability Haste reduces cooldown, cast speed unaffected)', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl, castTimeEl } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s (12.5s)');
        expect(castTimeEl.textContent).toBe('Cast Time: 2s');
    });

    test('injects both values inline when both differ from base', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0.25, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl, castTimeEl } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s (12.5s)');
        expect(castTimeEl.textContent).toBe('Cast Time: 2s (1.6s)');
    });

    test('ignores close events', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip();

        callback(popper, 'closed');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s');
    });

    test('does not inject twice for the same tooltip element', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip();

        callback(popper, 'opened');
        callback(popper, 'opened');

        expect(cooldownEl.querySelectorAll('.mwi-ability-timing-injected')).toHaveLength(1);
    });

    test('skips non-ability tooltips silently', () => {
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const popper = document.createElement('div');
        popper.className = 'MuiTooltip-popper';
        popper.innerHTML = '<div class="ItemTooltipText_itemTooltipText__zFq3A">Some Item</div>';

        expect(() => callback(popper, 'opened')).not.toThrow();
    });

    test('skips unrecognized ability names (no hrid match) without throwing', () => {
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip('Unknown Ability');

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s');
    });

    test('resolves the ability by its localized (non-English) tooltip name', () => {
        // zh client: the tooltip renders the game's translated name while the
        // game data only carries the English name.
        translations['/abilities/frost_surge'] = '霜涌';
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip('霜涌');

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s (12.5s)');
    });

    test('injects into localized (zh-Hans) tooltip lines end to end', () => {
        // zh client: name, line labels and line text all localized. Real zh-Hans
        // templates from the game's language chunk (note the half-width colon).
        translations['/abilities/frost_surge'] = '霜涌';
        tooltipText.cooldown = '冷却: {{duration}}';
        tooltipText.castTime = '施法时间: {{duration}}';
        statsMock.stats = { abilityHaste: 20, castSpeed: 0.25, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl, castTimeEl } = makeAbilityTooltip('霜涌', '冷却: 15s', '施法时间: 2s');

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('冷却: 15s (12.5s)');
        expect(castTimeEl.textContent).toBe('施法时间: 2s (1.6s)');
    });

    test('matches a full-width colon variant of the localized line label', () => {
        // The prefix matcher strips both half- and full-width colons, so locales
        // rendering "冷却： 15s" still get the injection.
        translations['/abilities/frost_surge'] = '霜涌';
        tooltipText.cooldown = '冷却： {{duration}}';
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip('霜涌', '冷却： 15s');

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('冷却： 15s (12.5s)');
    });

    test('still matches English lines while a translation is active (prefix dedup)', () => {
        // English clients never regress: both prefixes are tried against each line.
        tooltipText.cooldown = '冷却: {{duration}}';
        statsMock.stats = { abilityHaste: 20, castSpeed: 0, attackLevel: 1 };
        abilityTooltipFeature.initialize();
        const callback = subscribeMock.mock.calls[0][1];
        const { popper, cooldownEl } = makeAbilityTooltip();

        callback(popper, 'opened');

        expect(cooldownEl.textContent).toBe('Cooldown: 15s (12.5s)');
    });

    test('unsubscribes on disable', () => {
        abilityTooltipFeature.initialize();
        abilityTooltipFeature.disable();
        expect(unsubscribeMock).toHaveBeenCalledWith('AbilityTooltipTiming');
    });
});
