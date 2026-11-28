// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ classCallback: null, unregister: vi.fn() }));

vi.mock('../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_name, _classes, callback) => {
            mocks.classCallback = callback;
            return mocks.unregister;
        }),
    },
}));

const { installMarketplaceTab } = await import('./marketplace-tab-host.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mountMarketplace({ hidden = false } = {}) {
    document.body.insertAdjacentHTML(
        'beforeend',
        `<div class="MarketplacePanel_marketplacePanel__x" ${hidden ? 'style="display:none"' : ''}>
            <div class="MuiTabs-flexContainer" role="tablist">
                <button role="tab" class="MuiTab-root Mui-selected" aria-selected="true" id="t1" aria-controls="p1">
                    <span class="TabsComponent_badge__x">Market Listings</span>
                </button>
                <button role="tab" class="MuiTab-root" aria-selected="false" id="t2" aria-controls="p2">
                    <span class="TabsComponent_badge__x">My Listings</span>
                </button>
            </div>
        </div>`
    );
    return document.querySelector('.MuiTabs-flexContainer');
}

const labels = () => [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent.trim());

describe('installMarketplaceTab', () => {
    let hosts;

    function install(overrides = {}) {
        const host = installMarketplaceTab({
            name: 'Test',
            attr: 'data-mwi-test-tab',
            order: 10,
            getLabel: () => 'Test Tab',
            onClick: vi.fn(),
            ...overrides,
        });
        hosts.push(host);
        return host;
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        hosts = [];
        mocks.unregister.mockClear();
    });

    afterEach(() => {
        hosts.forEach((host) => host.stop());
    });

    test('adds a native-looking tab to the marketplace tab bar', () => {
        mountMarketplace();
        const host = install();

        const tab = document.querySelector('[data-mwi-test-tab]');
        expect(host.tab).toBe(tab);
        expect(labels()).toEqual(['Market Listings', 'My Listings', 'Test Tab']);
        // The clone must not carry the native tab/panel identity or the selected look
        expect(tab.hasAttribute('id')).toBe(false);
        expect(tab.hasAttribute('aria-controls')).toBe(false);
        expect(tab.classList.contains('Mui-selected')).toBe(false);
        expect(tab.getAttribute('aria-selected')).toBe('false');
        expect(tab.querySelector('.mwi-marketplace-tab-label').textContent).toBe('Test Tab');
    });

    test('clicking it calls onClick and stops the click reaching the game', () => {
        mountMarketplace();
        const onClick = vi.fn();
        const bubbled = vi.fn();
        document.body.addEventListener('click', bubbled);
        install({ onClick });

        document.querySelector('[data-mwi-test-tab]').click();

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(bubbled).not.toHaveBeenCalled();
        document.body.removeEventListener('click', bubbled);
    });

    test('is idempotent', () => {
        mountMarketplace();
        const host = install();

        host.ensure();
        host.ensure();

        expect(document.querySelectorAll('[data-mwi-test-tab]')).toHaveLength(1);
    });

    test('tabs are ordered by their order value whichever installs first, and before material tabs', () => {
        const tablist = mountMarketplace();
        tablist.insertAdjacentHTML('beforeend', '<button role="tab" data-mwi-custom-tab="true">Cheese</button>');

        install({ name: 'B', attr: 'data-mwi-b-tab', order: 20, getLabel: () => 'B' });
        install({ name: 'A', attr: 'data-mwi-a-tab', order: 10, getLabel: () => 'A' });

        expect(labels()).toEqual(['Market Listings', 'My Listings', 'A', 'B', 'Cheese']);
    });

    test('works when the marketplace is mounted hidden', () => {
        mountMarketplace({ hidden: true });

        install();

        expect(document.querySelector('[data-mwi-test-tab]')).not.toBeNull();
    });

    test('installs when the marketplace appears later, with no class-observer event', async () => {
        install();
        expect(document.querySelector('[data-mwi-test-tab]')).toBeNull();

        mountMarketplace();
        await sleep(400);

        expect(document.querySelector('[data-mwi-test-tab]')).not.toBeNull();
    });

    test('the class observer installs it straight away on a remount', () => {
        mountMarketplace();
        install();

        document.body.innerHTML = '';
        mountMarketplace();
        mocks.classCallback();

        expect(document.querySelectorAll('[data-mwi-test-tab]')).toHaveLength(1);
    });

    test('a replaced tab bar gets a fresh tab on the recheck', async () => {
        mountMarketplace();
        install();

        document.body.innerHTML = '';
        mountMarketplace();
        await sleep(400);

        expect(document.querySelectorAll('[data-mwi-test-tab]')).toHaveLength(1);
    });

    test('also installs into the visible marketplace when it was first put into a hidden one', async () => {
        mountMarketplace({ hidden: true });
        const host = install();
        const hiddenTab = host.tab;

        const visible = mountMarketplace();
        await sleep(400);

        expect(visible.querySelector('[data-mwi-test-tab]')).not.toBeNull();
        expect(hiddenTab).not.toBe(host.tab);
    });

    test('calls onEnsure with the tab and its label element, and respects isHealthy', async () => {
        mountMarketplace();
        const onEnsure = vi.fn();
        let healthy = true;
        install({ onEnsure, isHealthy: () => healthy });
        expect(onEnsure).toHaveBeenCalledTimes(1);
        const { tab, labelEl } = { tab: onEnsure.mock.calls[0][0], labelEl: onEnsure.mock.calls[0][1].labelEl };
        expect(tab.hasAttribute('data-mwi-test-tab')).toBe(true);
        expect(labelEl.textContent).toBe('Test Tab');

        // Healthy: a page change does not call it again
        document.body.appendChild(document.createElement('div'));
        await sleep(400);
        expect(onEnsure).toHaveBeenCalledTimes(1);

        // Unhealthy: the next page change repairs it
        healthy = false;
        document.body.appendChild(document.createElement('div'));
        await sleep(400);
        expect(onEnsure.mock.calls.length).toBeGreaterThan(1);
    });

    test('stop removes the tab, unregisters, cancels a pending recheck and calls onStop', async () => {
        const onStop = vi.fn();
        const host = install({ onStop });
        document.body.appendChild(document.createElement('div'));
        mountMarketplace();

        host.stop();
        await sleep(400);

        expect(document.querySelector('[data-mwi-test-tab]')).toBeNull();
        expect(mocks.unregister).toHaveBeenCalled();
        expect(onStop).toHaveBeenCalled();
    });

    test('does nothing without a marketplace', () => {
        const host = install();

        expect(host.ensure()).toBeNull();
    });
});
