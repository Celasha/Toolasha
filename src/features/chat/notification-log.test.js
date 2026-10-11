/**
 * Tests for the Notification Log feature: infoNotification.* capture, persistence cap, and
 * character-scoped storage. Tab-cloning DOM injection is exercised via _ensureTabInjected using a
 * minimal DOM fixture, but detailed MUI clone shape is left to manual verification (per this
 * repo's chat feature files, none of which have DOM-injection test coverage today).
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const storageData = {};

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => true),
        getSettingValue: vi.fn(() => 100),
    },
}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        getCurrentCharacterId: vi.fn(() => '111111'),
        getItemDetails: vi.fn(() => null),
        getInitClientData: vi.fn(() => ({})),
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/storage.js', () => ({
    default: {
        getJSON: vi.fn(async (key, _area, defaultValue) => storageData[key] ?? defaultValue),
        setJSON: vi.fn(async (key, value) => {
            storageData[key] = value;
        }),
    },
}));

vi.mock('../../core/websocket.js', () => ({
    default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: vi.fn((namespace, hrid, fallback = '') => fallback),
}));

function buildChatDom() {
    document.body.innerHTML = `
        <div class="GamePage_chatPanel__abc">
            <div class="Chat_tabsComponentContainer__abc">
                <div class="MuiTabs-flexContainer-abc">
                    <button role="tab" class="Mui-selected">Beginner</button>
                </div>
            </div>
            <div class="TabsComponent_tabPanelsContainer__abc">
                <div class="TabPanel_tabPanel__abc" role="tabpanel">
                    <div class="Chat_chatInputContainer__abc"></div>
                </div>
            </div>
        </div>
    `;
    return document.querySelector('.Chat_tabsComponentContainer__abc');
}

describe('NotificationLog - capture and persistence', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        config.getSettingValue.mockReturnValue(100);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');
        const webSocketHook = (await import('../../core/websocket.js')).default;
        webSocketHook.on.mockClear();
        webSocketHook.off.mockClear();
    });

    test('captures an info message and persists it under a character-scoped key', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        await feature._onInfoMessage({
            message: 'infoNotification.soldItem',
            variables: [
                { data: '1', name: 'count' },
                { data: '/items/basic_torch', name: 'itemHrid' },
            ],
        });

        expect(feature.entries).toHaveLength(1);
        expect(feature.entries[0].message).toBe('infoNotification.soldItem');
        expect(storageData['notificationLog_entries_111111']).toHaveLength(1);
    });

    test('an entry is captured and rendered without waiting for the debounced storage write to resolve', async () => {
        const storage = (await import('../../core/storage.js')).default;
        let releaseWrite;
        storage.setJSON.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseWrite = resolve;
                })
        );

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });

        // The in-memory capture must be immediate, regardless of how long the (still-pending,
        // debounced) storage write takes to actually flush.
        expect(feature.entries).toHaveLength(1);

        releaseWrite(true);
    });

    test('a message with no "message" field is ignored, not stored as a blank entry', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        await feature._onInfoMessage({ variables: [] });

        expect(feature.entries).toHaveLength(0);
    });

    test('caps stored entries at the configured max, dropping the oldest', async () => {
        const config = (await import('../../core/config.js')).default;
        config.getSettingValue.mockReturnValue(2);

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        await feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });
        await feature._onInfoMessage({ message: 'infoNotification.partyDisbanded', variables: [] });
        await feature._onInfoMessage({ message: 'infoNotification.partyLeft', variables: [] });

        expect(feature.entries).toHaveLength(2);
        // Newest-first: the most recent two survive, the oldest (partyCreated) is dropped.
        expect(feature.entries.map((e) => e.message)).toEqual([
            'infoNotification.partyLeft',
            'infoNotification.partyDisbanded',
        ]);
    });

    test('a second character does not inherit the first character stored entries', async () => {
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');

        const { NotificationLog } = await import('./notification-log.js');
        const charOne = new NotificationLog();
        await charOne.initialize();
        await charOne._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });

        dataManager.getCurrentCharacterId.mockReturnValue('222222');
        const charTwo = new NotificationLog();
        await charTwo.initialize();

        expect(charTwo.entries).toHaveLength(0);
    });

    test('disabled by the master setting never registers a websocket handler', async () => {
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(false);
        const webSocketHook = (await import('../../core/websocket.js')).default;

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        expect(webSocketHook.on).not.toHaveBeenCalled();
        expect(feature.isInitialized).toBe(false);
    });
});

describe('NotificationLog - display filtering', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        config.getSettingValue.mockReturnValue(100);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');
    });

    test('unchecking a category hides matching entries but leaves them in storage', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        await feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });
        await feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });

        expect(feature.listEl.querySelectorAll('.mwi-notiflog-row')).toHaveLength(2);

        feature.activeFilters.delete('trading');
        feature._renderList();

        expect(feature.listEl.querySelectorAll('.mwi-notiflog-row')).toHaveLength(1);
        // Storage still holds both - filtering must never delete data.
        expect(feature.entries).toHaveLength(2);
    });

    test('toggling a filter checkbox persists the new filter set, character-scoped', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        const tradingCheckbox = Array.from(feature.panel.querySelectorAll('.mwi-notiflog-filter'))
            .find((label) => label.textContent.includes('Trading'))
            ?.querySelector('input');

        tradingCheckbox.checked = false;
        tradingCheckbox.dispatchEvent(new Event('change'));

        expect(storageData['notificationLog_filters_111111']).toBeDefined();
        expect(storageData['notificationLog_filters_111111']).not.toContain('trading');
    });
});

describe('NotificationLog - manual deletion', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        config.getSettingValue.mockReturnValue(100);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');
        vi.stubGlobal(
            'confirm',
            vi.fn(() => true)
        );
    });

    test("clicking a row's X button removes only that entry and persists the change", async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });
        feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });
        expect(feature.entries).toHaveLength(2);

        const rows = feature.listEl.querySelectorAll('.mwi-notiflog-row');
        // Display order is oldest-at-top; row 0 is the oldest entry (soldItem).
        rows[0].querySelector('.mwi-notiflog-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(feature.entries).toHaveLength(1);
        // partyCreated (the newer entry) should be the survivor.
        expect(feature.entries[0].message).toBe('infoNotification.partyCreated');
        expect(storageData['notificationLog_entries_111111']).toHaveLength(1);
    });

    test('Clear All prompts for confirmation and, if confirmed, deletes everything', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });
        feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });

        feature.panel
            .querySelector('.mwi-notiflog-clear-all')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(confirm).toHaveBeenCalled();
        expect(feature.entries).toHaveLength(0);
        expect(storageData['notificationLog_entries_111111']).toHaveLength(0);
        expect(feature.listEl.querySelector('.mwi-notiflog-empty')).not.toBeNull();
    });

    test('Clear All does nothing if the user declines the confirmation', async () => {
        vi.stubGlobal(
            'confirm',
            vi.fn(() => false)
        );

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });
        feature.panel
            .querySelector('.mwi-notiflog-clear-all')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(feature.entries).toHaveLength(1);
    });

    test('Clear All with no entries does not show a confirmation prompt', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature.panel
            .querySelector('.mwi-notiflog-clear-all')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(confirm).not.toHaveBeenCalled();
    });
});

describe('NotificationLog - @mentions (logMention)', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        config.getSettingValue.mockReturnValue(100);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');
    });

    test('logMention adds a formatted entry distinct from infoNotification entries', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        feature.logMention({
            channel: '/chat_channel_types/guild',
            channelName: 'Guild',
            sName: 'Someone',
            text: 'hey @You check this out',
            timestamp: 1000,
        });

        expect(feature.entries).toHaveLength(1);
        expect(feature.entries[0]).toMatchObject({
            type: 'mention',
            channel: '/chat_channel_types/guild',
            channelName: 'Guild',
            sName: 'Someone',
            text: 'hey @You check this out',
        });
        expect(storageData['notificationLog_entries_111111']).toHaveLength(1);
    });

    test('a mention is rendered with the sender, channel, and message text', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature.logMention({
            channel: '/chat_channel_types/guild',
            channelName: 'Guild',
            sName: 'Someone',
            text: 'hey @You check this out',
            timestamp: 1000,
        });

        const rowText = feature.listEl.querySelector('.mwi-notiflog-row-text').textContent;
        expect(rowText).toBe('Mentioned by Someone in the Guild channel: hey @You check this out');
    });

    test('a mention channel is translated at render time via the game i18n bridge', async () => {
        const gameI18n = await import('../../utils/game-i18n.js');
        gameI18n.translateGameName.mockImplementation((namespace, hrid, fallback = '') =>
            namespace === 'chatChannelTypeNames' ? '中文' : fallback
        );

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        // Captured before the game i18n was ready: the raw HRID got frozen into channelName.
        feature.logMention({
            channel: '/chat_channel_types/chinese',
            channelName: '/chat_channel_types/chinese',
            sName: 'Someone',
            text: 'hey @You check this out',
            timestamp: 1000,
        });

        const rowText = feature.listEl.querySelector('.mwi-notiflog-row-text').textContent;
        expect(rowText).toBe('Mentioned by Someone in the 中文 channel: hey @You check this out');
    });

    test('mentions and info notifications share the same max-entries cap', async () => {
        const config = (await import('../../core/config.js')).default;
        config.getSettingValue.mockReturnValue(2);

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        feature.logMention({ channel: 'c', channelName: 'C', sName: 'A', text: 'first', timestamp: 1 });
        await feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });
        feature.logMention({ channel: 'c', channelName: 'C', sName: 'B', text: 'second', timestamp: 2 });

        expect(feature.entries).toHaveLength(2);
        expect(feature.entries[0].type).toBe('mention');
        expect(feature.entries[0].sName).toBe('B');
    });

    test('unchecking the Mentions filter hides mention rows but leaves them in storage', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature.logMention({ channel: 'c', channelName: 'C', sName: 'A', text: 'hi', timestamp: 1 });
        await feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });

        expect(feature.listEl.querySelectorAll('.mwi-notiflog-row')).toHaveLength(2);

        feature.activeFilters.delete('mentions');
        feature._renderList();

        expect(feature.listEl.querySelectorAll('.mwi-notiflog-row')).toHaveLength(1);
        expect(feature.entries).toHaveLength(2);
    });

    test('a "Mentions" filter checkbox is offered in the filter bar', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        const label = Array.from(feature.panel.querySelectorAll('.mwi-notiflog-filter')).find((el) =>
            el.textContent.includes('Mentions')
        );
        expect(label).toBeTruthy();
    });

    test('logMention is a no-op when the Log feature itself is disabled', async () => {
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(false);

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        feature.logMention({ channel: 'c', channelName: 'C', sName: 'A', text: 'hi', timestamp: 1 });

        expect(feature.entries).toHaveLength(0);
    });

    test("a mention's X button removes only that entry", async () => {
        vi.stubGlobal(
            'confirm',
            vi.fn(() => true)
        );
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature.logMention({ channel: 'c', channelName: 'C', sName: 'A', text: 'hi', timestamp: 1 });
        await feature._onInfoMessage({ message: 'infoNotification.partyCreated', variables: [] });
        expect(feature.entries).toHaveLength(2);

        // Display order is oldest-at-top; row 0 is the mention (logged first).
        const rows = feature.listEl.querySelectorAll('.mwi-notiflog-row');
        rows[0].querySelector('.mwi-notiflog-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(feature.entries).toHaveLength(1);
        expect(feature.entries[0].message).toBe('infoNotification.partyCreated');
    });
});

describe('NotificationLog - tab activation', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        config.getSettingValue.mockReturnValue(100);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');
    });

    test('clicking the injected tab activates it and adds the active class to the chat panel root', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);
        feature.tabButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const root = document.querySelector('.GamePage_chatPanel__abc');
        expect(root.classList.contains('mwi-notification-log-active')).toBe(true);
        expect(feature.tabActive).toBe(true);
    });

    test('clicking a native game tab deactivates our tab and removes the active class', async () => {
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();

        const container = buildChatDom();
        feature._ensureTabInjected(container);
        feature.tabButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const nativeTab = document.querySelector('button[role="tab"]:not(#mwi-notification-log-tab)');
        nativeTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const root = document.querySelector('.GamePage_chatPanel__abc');
        expect(root.classList.contains('mwi-notification-log-active')).toBe(false);
        expect(feature.tabActive).toBe(false);
    });
});

describe('NotificationLog - timestamp date and age-color ramp (#774)', () => {
    beforeEach(async () => {
        vi.resetModules();
        Object.keys(storageData).forEach((k) => delete storageData[k]);
        const config = (await import('../../core/config.js')).default;
        config.getSetting.mockReturnValue(true);
        config.getSettingValue.mockReturnValue(100);
        const dataManager = (await import('../../core/data-manager.js')).default;
        dataManager.getCurrentCharacterId.mockReturnValue('111111');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("today's entry renders the date alongside the time and the most prominent color", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 15, 14, 0, 0));

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();
        const container = buildChatDom();
        feature._ensureTabInjected(container);

        await feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });

        const timeSpan = feature.listEl.querySelector('.mwi-notiflog-time');
        expect(timeSpan.textContent).toContain('10-15'); // date is now always present
        expect(timeSpan.style.color).toBe('rgb(255, 255, 255)'); // today = most prominent
        expect(timeSpan.dataset.ts).toBe(String(feature.entries[0].timestamp));
    });

    test('an entry from 3+ days ago renders the default muted color, not the prominent one', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 15, 14, 0, 0));

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();
        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._addEntry({
            timestamp: new Date(2026, 9, 10, 9, 0, 0).getTime(), // 5 days before "now"
            type: 'info',
            message: 'infoNotification.soldItem',
            variables: [],
        });

        const timeSpan = feature.listEl.querySelector('.mwi-notiflog-time');
        expect(timeSpan.style.color).toBe('rgb(139, 148, 158)'); // #8b949e, the existing default
    });

    test('a 1-day-old and 2-day-old entry render distinct intermediate colors between today and the default', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 15, 14, 0, 0));

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();
        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._addEntry({
            timestamp: new Date(2026, 9, 14, 9, 0, 0).getTime(), // yesterday
            type: 'info',
            message: 'infoNotification.soldItem',
            variables: [],
        });
        feature._addEntry({
            timestamp: new Date(2026, 9, 13, 9, 0, 0).getTime(), // 2 days ago
            type: 'info',
            message: 'infoNotification.soldItem',
            variables: [],
        });

        const spans = feature.listEl.querySelectorAll('.mwi-notiflog-time');
        const colors = Array.from(spans).map((s) => s.style.color);
        // Oldest-first display order: 2-days-ago row, then yesterday row.
        expect(new Set(colors).size).toBe(2);
        expect(colors).not.toContain('rgb(255, 255, 255)');
        expect(colors).not.toContain('rgb(139, 148, 158)');
    });

    test('_activateTab starts a periodic refresh that advances a color as time passes, without a new entry arriving', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 15, 23, 59, 0));

        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();
        const container = buildChatDom();
        feature._ensureTabInjected(container);

        await feature._onInfoMessage({ message: 'infoNotification.soldItem', variables: [] });
        feature._activateTab();

        const timeSpan = feature.listEl.querySelector('.mwi-notiflog-time');
        expect(timeSpan.style.color).toBe('rgb(255, 255, 255)'); // today

        // Cross midnight without any new entry being added.
        vi.setSystemTime(new Date(2026, 9, 16, 0, 2, 0));
        vi.advanceTimersByTime(60000);

        expect(timeSpan.style.color).toBe('rgb(208, 215, 222)'); // now "yesterday" relative to new now
    });

    test('_deactivateTab stops the periodic refresh so it does not keep running while the tab is hidden', async () => {
        vi.useFakeTimers();
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();
        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._activateTab();
        expect(feature._ageRefreshInterval).not.toBeNull();
        feature._deactivateTab();
        expect(feature._ageRefreshInterval).toBeNull();
    });

    test('disable() clears the periodic refresh timer', async () => {
        vi.useFakeTimers();
        const { NotificationLog } = await import('./notification-log.js');
        const feature = new NotificationLog();
        await feature.initialize();
        const container = buildChatDom();
        feature._ensureTabInjected(container);

        feature._activateTab();
        const clearSpy = vi.spyOn(globalThis, 'clearInterval');
        feature.disable();

        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });
});
