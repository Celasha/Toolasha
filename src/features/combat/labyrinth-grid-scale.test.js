// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fakeConfig = vi.hoisted(() => {
    const state = { enabled: true, scale: 1, handlers: new Set() };
    return {
        state,
        getSetting: vi.fn(() => state.enabled),
        getSettingValue: vi.fn(() => state.scale),
        setSettingValue: vi.fn((key, value) => {
            state.scale = value;
            for (const handler of state.handlers) handler(value);
        }),
        onSettingChange: vi.fn((key, handler) => state.handlers.add(handler)),
        offSettingChange: vi.fn((key, handler) => state.handlers.delete(handler)),
    };
});

const fakeDomObserver = vi.hoisted(() => ({ onClass: vi.fn(() => vi.fn()) }));

vi.mock('../../core/config.js', () => ({ default: fakeConfig }));
vi.mock('../../core/dom-observer.js', () => ({ default: fakeDomObserver }));
vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));

const { initialize, cleanup, injectControl, normalizeScale } = await import('./labyrinth-grid-scale.js');

function renderHeader() {
    document.body.innerHTML = `
        <div class="LabyrinthPanel_chargeLeft__x">
            <div>1 / 5 Entries</div>
            <div>6 Max Path <button class="Button_button__abc Button_small__def">Upgrade</button></div>
        </div>`;
    return document.querySelector('[class*="LabyrinthPanel_chargeLeft"]');
}

const styleText = () => document.getElementById('mwi-labyrinth-grid-scale-style')?.textContent ?? null;

describe('normalizeScale', () => {
    test('snaps to quarter steps within 1x-2x', () => {
        expect(normalizeScale(1.3)).toBe(1.25);
        expect(normalizeScale('1.5')).toBe(1.5);
        expect(normalizeScale(0.5)).toBe(1);
        expect(normalizeScale(3)).toBe(2);
    });

    test('falls back to 1x for unusable values', () => {
        expect(normalizeScale(undefined)).toBe(1);
        expect(normalizeScale('abc')).toBe(1);
    });
});

describe('labyrinth grid scale control', () => {
    beforeEach(() => {
        fakeConfig.state.enabled = true;
        fakeConfig.state.scale = 1;
        fakeConfig.state.handlers.clear();
        fakeDomObserver.onClass.mockClear();
        document.head.innerHTML = '';
    });

    afterEach(() => {
        cleanup();
        document.body.innerHTML = '';
    });

    test('injects one stepper into the header row and not twice', () => {
        const header = renderHeader();
        injectControl(header);
        injectControl(header);

        expect(header.querySelectorAll('.mwi-labyrinth-grid-scale')).toHaveLength(1);
        expect(header.querySelector('[data-role="value"]').textContent).toBe('100%');
    });

    test('reuses the native button classes', () => {
        const header = renderHeader();
        injectControl(header);

        expect(header.querySelector('[data-role="larger"]').className).toBe('Button_button__abc Button_small__def');
    });

    test('plus and minus step the scale, apply zoom to the grid and disable at the limits', () => {
        const header = renderHeader();
        initialize();
        const larger = header.querySelector('[data-role="larger"]');
        const smaller = header.querySelector('[data-role="smaller"]');

        expect(smaller.disabled).toBe(true);
        expect(styleText()).toBeNull();

        larger.click();
        expect(fakeConfig.setSettingValue).toHaveBeenLastCalledWith('labyrinthGridScale', 1.25);
        expect(header.querySelector('[data-role="value"]').textContent).toBe('125%');
        expect(styleText()).toContain('zoom: 1.25');
        expect(smaller.disabled).toBe(false);

        larger.click();
        larger.click();
        larger.click();
        expect(header.querySelector('[data-role="value"]').textContent).toBe('200%');
        expect(larger.disabled).toBe(true);

        smaller.click();
        expect(header.querySelector('[data-role="value"]').textContent).toBe('175%');
    });

    test('a saved scale is applied on initialize', () => {
        fakeConfig.state.scale = 1.5;
        renderHeader();
        initialize();

        expect(styleText()).toContain('zoom: 1.5');
    });

    test('does nothing when the control setting is off', () => {
        fakeConfig.state.enabled = false;
        renderHeader();
        initialize();

        expect(fakeDomObserver.onClass).not.toHaveBeenCalled();
        expect(document.querySelector('.mwi-labyrinth-grid-scale')).toBeNull();
        expect(styleText()).toBeNull();
    });

    test('cleanup removes the control, the style and the setting listener', () => {
        fakeConfig.state.scale = 1.5;
        renderHeader();
        initialize();
        cleanup();

        expect(document.querySelector('.mwi-labyrinth-grid-scale')).toBeNull();
        expect(styleText()).toBeNull();
        expect(fakeConfig.state.handlers.size).toBe(0);
    });
});
