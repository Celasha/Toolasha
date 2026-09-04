/**
 * Tests for the Notification Log feature: infoNotification.* capture, persistence cap, and
 * character-scoped storage. Tab-cloning DOM injection is exercised via _ensureTabInjected using a
 * minimal DOM fixture, but detailed MUI clone shape is left to manual verification (per this
 * repo's chat feature files, none of which have DOM-injection test coverage today).
 */

/* @vitest-environment jsdom */

import { describe, test, expect, vi, beforeEach } from 'vitest';

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
