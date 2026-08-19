// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeWebSocketHook, settingValues, mockGetInitClientData } = vi.hoisted(() => {
    const listeners = new Map();
    return {
        settingValues: { eliteAchievementReminder: true, eliteAchievementReminderMessage: null },
        mockGetInitClientData: vi.fn(),
        fakeWebSocketHook: {
            on: (event, handler) => {
                if (!listeners.has(event)) listeners.set(event, new Set());
                listeners.get(event).add(handler);
            },
            off: (event, handler) => {
                listeners.get(event)?.delete(handler);
            },
            emit: (event, data) => {
                for (const handler of Array.from(listeners.get(event) || [])) handler(data);
            },
            listenerCount: (event) => listeners.get(event)?.size || 0,
        },
    };
});

vi.mock('../../core/websocket.js', () => ({ default: fakeWebSocketHook }));
vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn((key) => settingValues[key] ?? true),
        getSettingValue: vi.fn((key, def) => settingValues[key] ?? def),
        onSettingChange: vi.fn(),
    },
}));

vi.mock('../../core/data-manager.js', () => ({ default: { getInitClientData: mockGetInitClientData } }));

let capturedMutationCallback = null;
vi.mock('../../utils/dom-observer-helpers.js', () => ({
    createMutationWatcher: vi.fn((_element, callback) => {
        capturedMutationCallback = callback;
        return vi.fn();
    }),
}));

import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import eliteAchievementReminder, { isEliteTierIncomplete } from './elite-achievement-reminder.js';

const achievementDetailMap = {
    '/achievements/elite_a': { tierHrid: '/achievement_tiers/elite' },
    '/achievements/elite_b': { tierHrid: '/achievement_tiers/elite' },
    '/achievements/novice_a': { tierHrid: '/achievement_tiers/novice' },
};

describe('isEliteTierIncomplete', () => {
    test('returns true when at least one Elite achievement is not completed', () => {
        const characterAchievements = [
            { achievementHrid: '/achievements/elite_a', isCompleted: true },
            { achievementHrid: '/achievements/elite_b', isCompleted: false },
            { achievementHrid: '/achievements/novice_a', isCompleted: true },
        ];
        expect(isEliteTierIncomplete(characterAchievements, achievementDetailMap)).toBe(true);
    });

    test('returns false when all Elite achievements are completed', () => {
        const characterAchievements = [
            { achievementHrid: '/achievements/elite_a', isCompleted: true },
            { achievementHrid: '/achievements/elite_b', isCompleted: true },
        ];
        expect(isEliteTierIncomplete(characterAchievements, achievementDetailMap)).toBe(false);
    });

    test('returns false when data is missing rather than throwing', () => {
        expect(isEliteTierIncomplete(null, achievementDetailMap)).toBe(false);
        expect(isEliteTierIncomplete([], null)).toBe(false);
    });
});

function buildProfileModal() {
    document.body.innerHTML = `
        <div class="SharableProfile_modalContainer__1">
            <div class="SharableProfile_modal__2OmCQ">
                <div class="SharableProfile_modalContent__1">
                    <div class="SharableProfile_header__1">
                        <div class="CharacterName_characterName__1">
                            <div class="CharacterName_name__1"><span>siuuuuuuuuu</span></div>
                        </div>
                    </div>
                    <div class="TabsComponent_tabPanelsContainer__1">
                        <div class="SharableProfile_overviewTab__W4dCV"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="Chat_chatInputContainer__1"><input value="" /></div>
    `;
}

function buildProfileData(characterAchievements) {
    return {
        profile: {
            sharableCharacter: { name: 'siuuuuuuuuu' },
            characterAchievements,
        },
    };
}

describe('elite-achievement-reminder — icon injection', () => {
    beforeEach(() => {
        settingValues.eliteAchievementReminder = true;
        settingValues.eliteAchievementReminderMessage = null;
        mockGetInitClientData.mockReturnValue({ achievementDetailMap });
    });

    afterEach(() => {
        eliteAchievementReminder.disable();
        document.body.innerHTML = '';
        capturedMutationCallback = null;
    });

    test('injects the icon next to the name when Elite achievements are incomplete', async () => {
        buildProfileModal();
        const profileData = buildProfileData([
            { achievementHrid: '/achievements/elite_a', isCompleted: false },
            { achievementHrid: '/achievements/elite_b', isCompleted: true },
        ]);

        await eliteAchievementReminder.handleProfileShared(profileData);

        const icon = document.querySelector('#mwi-elite-achievement-reminder-icon');
        expect(icon).not.toBeNull();
        expect(icon.closest('.CharacterName_characterName__1')).not.toBeNull();
    });

    test('does not inject the icon when Elite achievements are already complete', async () => {
        buildProfileModal();
        const profileData = buildProfileData([
            { achievementHrid: '/achievements/elite_a', isCompleted: true },
            { achievementHrid: '/achievements/elite_b', isCompleted: true },
        ]);

        await eliteAchievementReminder.handleProfileShared(profileData);

        expect(document.querySelector('#mwi-elite-achievement-reminder-icon')).toBeNull();
    });

    test('does nothing when the feature setting is disabled', async () => {
        settingValues.eliteAchievementReminder = false;
        buildProfileModal();
        const profileData = buildProfileData([{ achievementHrid: '/achievements/elite_a', isCompleted: false }]);

        await eliteAchievementReminder.handleProfileShared(profileData);

        expect(document.querySelector('#mwi-elite-achievement-reminder-icon')).toBeNull();
    });

    test('clicking the icon fills the chat input with the configured whisper and does not submit', async () => {
        settingValues.eliteAchievementReminderMessage = 'Be Elite. Do your Elite achievements.';
        buildProfileModal();
        const profileData = buildProfileData([{ achievementHrid: '/achievements/elite_a', isCompleted: false }]);
        await eliteAchievementReminder.handleProfileShared(profileData);

        const icon = document.querySelector('#mwi-elite-achievement-reminder-icon');
        icon.dispatchEvent(new Event('click', { bubbles: true }));

        const chatInput = document.querySelector('.Chat_chatInputContainer__1 input');
        expect(chatInput.value).toBe('/w siuuuuuuuuu Be Elite. Do your Elite achievements.');
    });

    test('removes the icon and unregisters the mutation watcher once the profile modal closes', async () => {
        buildProfileModal();
        const profileData = buildProfileData([{ achievementHrid: '/achievements/elite_a', isCompleted: false }]);
        await eliteAchievementReminder.handleProfileShared(profileData);

        expect(eliteAchievementReminder.currentIcon).not.toBeNull();
        const unregister = createMutationWatcher.mock.results.at(-1).value;

        document.querySelector('.SharableProfile_modal__2OmCQ').remove();
        capturedMutationCallback();

        expect(eliteAchievementReminder.currentIcon).toBeNull();
        expect(unregister).toHaveBeenCalledTimes(1);
    });

    test('initialize -> disable -> initialize registers exactly one profile_shared listener', () => {
        eliteAchievementReminder.initialize();
        eliteAchievementReminder.disable();
        eliteAchievementReminder.initialize();

        expect(fakeWebSocketHook.listenerCount('profile_shared')).toBe(1);
    });
});
