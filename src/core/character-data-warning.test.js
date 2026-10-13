// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let webSocketHandlers = new Map();

vi.mock('./websocket.js', () => {
    webSocketHandlers = new Map();

    return {
        default: {
            on: vi.fn((event, handler) => {
                webSocketHandlers.set(event, handler);
            }),
            off: vi.fn(),
            onSocketEvent: vi.fn(),
            offSocketEvent: vi.fn(),
        },
    };
});

vi.mock('./storage.js', () => ({
    default: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => true),
    },
}));

import { showCharacterDataWarning, hideCharacterDataWarning } from './character-data-warning.js';

const BANNER_SELECTOR = '#mwi-character-data-warning';

describe('character-data-warning banner', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('shows a single alert banner even when called repeatedly', () => {
        showCharacterDataWarning();
        showCharacterDataWarning();

        const banners = document.querySelectorAll(BANNER_SELECTOR);
        expect(banners).toHaveLength(1);
        expect(banners[0].getAttribute('role')).toBe('alert');
        expect(banners[0].textContent.length).toBeGreaterThan(10);
    });

    test('dismiss button removes the banner', () => {
        showCharacterDataWarning();

        const dismiss = document.querySelector(`${BANNER_SELECTOR} button[aria-label]`);
        dismiss.click();

        expect(document.querySelector(BANNER_SELECTOR)).toBeNull();
    });

    test('reload button reloads the page', () => {
        const reload = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', { configurable: true, value: { reload } });

        try {
            showCharacterDataWarning();
            document.querySelector(`${BANNER_SELECTOR} button:not([aria-label])`).click();
            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
        }
    });

    test('hide removes the banner and tolerates it being absent', () => {
        showCharacterDataWarning();
        hideCharacterDataWarning();
        expect(document.querySelector(BANNER_SELECTOR)).toBeNull();

        expect(() => hideCharacterDataWarning()).not.toThrow();
    });
});

describe('DataManager character data timeout', () => {
    let dataManager;
    let errorSpy;

    beforeEach(async () => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        ({ default: dataManager } = await import('./data-manager.js'));
        dataManager.cleanupIntervals();
        dataManager.characterData = null;
        dataManager.currentCharacterId = null;
        dataManager.currentCharacterName = null;
        dataManager.lastCharacterSwitchTime = 0;
    });

    afterEach(() => {
        dataManager.cleanupIntervals();
        errorSpy.mockRestore();
        vi.useRealTimers();
    });

    test('shows the banner when no character data arrives within 30 seconds', () => {
        dataManager.initialize();

        vi.advanceTimersByTime(29_000);
        expect(document.querySelector(BANNER_SELECTOR)).toBeNull();

        vi.advanceTimersByTime(1_500);
        expect(document.querySelector(BANNER_SELECTOR)).not.toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Character data not received'));
    });

    test.each([
        ['login form', 'AuthComponent_authComponent__abc'],
        ['Character Select', 'CharacterSelectPage_characterSelectPage__abc'],
    ])('does not warn while the player is on the %s, then warns once they leave it', (_label, className) => {
        const screen = document.createElement('div');
        screen.className = className;
        document.body.appendChild(screen);

        dataManager.initialize();
        vi.advanceTimersByTime(65_000);

        expect(document.querySelector(BANNER_SELECTOR)).toBeNull();
        expect(errorSpy).not.toHaveBeenCalled();

        screen.remove();
        vi.advanceTimersByTime(31_000);

        expect(document.querySelector(BANNER_SELECTOR)).not.toBeNull();
    });

    test('removes the banner when character data arrives late', async () => {
        dataManager.initialize();
        vi.advanceTimersByTime(31_000);
        expect(document.querySelector(BANNER_SELECTOR)).not.toBeNull();

        const handler = webSocketHandlers.get('init_character_data');
        await handler({
            character: { id: 'character-late', name: 'Late' },
            characterSkills: [],
            characterItems: [],
            characterActions: [],
            characterQuests: [],
            characterHouseRoomMap: {},
            actionTypeDrinkSlotsMap: {},
            characterGuildBuffMap: {},
            guildBuildingLevelMap: {},
        });

        expect(document.querySelector(BANNER_SELECTOR)).toBeNull();
    });
});
