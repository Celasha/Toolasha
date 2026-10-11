/**
 * Tests for Shop Max Buy Button: injecting a "Max" button into Shop/Task Shop/Labyrinth
 * Shop/Cowbell Store buy dialogs and filling in the most affordable quantity.
 */

/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const settingValues = { shop_maxBuyButton: true };
const observerRegistrations = [];

const {
    mockResolveCostLines,
    mockComputeMaxAffordable,
    mockSetReactInputValue,
    mockT,
    mockAddStyles,
    mockRemoveStyles,
} = vi.hoisted(() => ({
    mockResolveCostLines: vi.fn(),
    mockComputeMaxAffordable: vi.fn(),
    mockSetReactInputValue: vi.fn(),
    mockT: vi.fn((key) => key),
    mockAddStyles: vi.fn(),
    mockRemoveStyles: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn((key) => settingValues[key]) },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((name, classNames, callback) => {
            observerRegistrations.push({ name, classNames, callback });
            return () => {
                const index = observerRegistrations.findIndex((r) => r.name === name);
                if (index !== -1) observerRegistrations.splice(index, 1);
            };
        }),
    },
}));

vi.mock('../../core/i18n.js', () => ({ t: mockT }));

vi.mock('../../utils/dom.js', () => ({
    addStyles: mockAddStyles,
    removeStyles: mockRemoveStyles,
}));

vi.mock('../../utils/shop-max-buy.js', () => ({
    resolveCostLines: mockResolveCostLines,
    computeMaxAffordable: mockComputeMaxAffordable,
}));

vi.mock('../../utils/react-input.js', () => ({
    setReactInputValue: mockSetReactInputValue,
}));

import shopMaxBuyButton from './shop-max-buy-button.js';

function buildModal(disabled = false) {
    // The real Buy button is a sibling of the input *row*, not of inputContainer itself -
    // container.parentElement only reaches TasksPanel_buyRow, NOT the Buy button one level up.
    // Only the broader TasksPanel_modalContent ancestor (found via .closest()) actually contains
    // both - this mirrors the real bug (parentElement was too narrow to reach the real button).
    document.body.innerHTML = `
        <div class="TasksPanel_modalContent__2_F_Z">
            <div class="TasksPanel_buyRow__1Xyz">
                <div class="TasksPanel_inputContainer__1DTU-">
                    <div class="None">
                        <div class="Input_inputContainer__22GnD">
                            <input type="number" value="1">
                        </div>
                        <div class="TasksPanel_error__32YiV"></div>
                    </div>
                </div>
                <div class="None">You Pay: 50</div>
            </div>
            <button class="Button_button__1Fe9z Button_success__6d6kU" ${disabled ? 'disabled' : ''}>Buy</button>
        </div>
    `;
    const buyButton = document.querySelector('button[class*="Button_success"]');
    // jsdom never computes layout, so offsetParent is always null unless stubbed - stub it here
    // so every test's "real" Buy button passes the visibility filter by default.
    Object.defineProperty(buyButton, 'offsetParent', { value: document.body, configurable: true });
    return document.querySelector('[class*="TasksPanel_inputContainer"]');
}

describe('ShopMaxBuyButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        observerRegistrations.length = 0;
        settingValues.shop_maxBuyButton = true;
        document.body.innerHTML = '';
        shopMaxBuyButton.disable();
        globalThis.requestAnimationFrame = vi.fn((cb) => {
            cb();
            return 1;
        });
    });

    afterEach(() => {
        shopMaxBuyButton.disable();
    });

    test('registers an observer for each of the 4 buy-dialog panels', () => {
        shopMaxBuyButton.initialize();

        const classNames = observerRegistrations.map((r) => r.classNames);
        expect(classNames).toEqual(
            expect.arrayContaining([
                'ShopPanel_inputContainer',
                'TasksPanel_inputContainer',
                'LabyrinthPanel_inputContainer',
                'CowbellStorePanel_inputContainer',
            ])
        );
    });

    test('does nothing when the setting is disabled', () => {
        settingValues.shop_maxBuyButton = false;

        shopMaxBuyButton.initialize();

        expect(observerRegistrations).toEqual([]);
    });

    test('injects exactly one Max button next to the input, after the Input_inputContainer wrapper', () => {
        shopMaxBuyButton.initialize();
        const container = buildModal();

        const tasksRegistration = observerRegistrations.find((r) => r.classNames === 'TasksPanel_inputContainer');
        tasksRegistration.callback(container);

        const buttons = container.querySelectorAll('.toolasha-shop-max-buy-button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].previousElementSibling.className).toContain('Input_inputContainer');
    });

    test('is idempotent: calling the observer callback twice does not duplicate the button', () => {
        shopMaxBuyButton.initialize();
        const container = buildModal();
        const tasksRegistration = observerRegistrations.find((r) => r.classNames === 'TasksPanel_inputContainer');

        tasksRegistration.callback(container);
        tasksRegistration.callback(container);

        expect(container.querySelectorAll('.toolasha-shop-max-buy-button')).toHaveLength(1);
    });

    test('clicking Max fills the computed candidate when Buy stays enabled', async () => {
        mockResolveCostLines.mockReturnValue([{ itemHrid: '/items/task_token', perUnitAmount: 50 }]);
        mockComputeMaxAffordable.mockReturnValue(4);

        shopMaxBuyButton.initialize();
        const container = buildModal(false);
        const tasksRegistration = observerRegistrations.find((r) => r.classNames === 'TasksPanel_inputContainer');
        tasksRegistration.callback(container);

        container.querySelector('.toolasha-shop-max-buy-button').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockSetReactInputValue).toHaveBeenCalledWith(expect.anything(), 4, { focus: false });
        expect(mockSetReactInputValue).toHaveBeenCalledTimes(1);
    });

    test('does nothing when computeMaxAffordable returns null (cannot afford even 1)', async () => {
        mockResolveCostLines.mockReturnValue([{ itemHrid: '/items/task_token', perUnitAmount: 999 }]);
        mockComputeMaxAffordable.mockReturnValue(null);

        shopMaxBuyButton.initialize();
        const container = buildModal(false);
        const tasksRegistration = observerRegistrations.find((r) => r.classNames === 'TasksPanel_inputContainer');
        tasksRegistration.callback(container);

        container.querySelector('.toolasha-shop-max-buy-button').click();
        await Promise.resolve();

        expect(mockSetReactInputValue).not.toHaveBeenCalled();
    });

    test('binary-searches down to the largest quantity that leaves Buy enabled when the candidate is rejected', async () => {
        mockComputeMaxAffordable.mockReturnValue(10);

        const container = buildModal(false);
        const input = container.querySelector('input[type="number"]');
        const buyButton = document.querySelector('button[class*="Button_success"]');
        const disabledThreshold = 6;

        mockSetReactInputValue.mockImplementation((targetInput, value) => {
            targetInput.value = String(value);
            buyButton.disabled = value > disabledThreshold;
        });

        await shopMaxBuyButton.handleMaxClick(container, input, {
            costStyle: 'icon',
            modalContentClass: 'TasksPanel_modalContent',
        });

        const finalCalls = mockSetReactInputValue.mock.calls;
        const lastValue = finalCalls[finalCalls.length - 1][1];
        expect(lastValue).toBe(disabledThreshold);
        expect(buyButton.disabled).toBe(false);
    });

    test('disable() unregisters all 4 observers', () => {
        shopMaxBuyButton.initialize();
        expect(observerRegistrations).toHaveLength(4);

        shopMaxBuyButton.disable();

        expect(observerRegistrations).toHaveLength(0);
    });

    test('initialize() injects the button stylesheet; disable() removes it', () => {
        shopMaxBuyButton.initialize();
        expect(mockAddStyles).toHaveBeenCalledWith(
            expect.stringContaining('toolasha-shop-max-buy-button'),
            expect.any(String)
        );
        const styleId = mockAddStyles.mock.calls[0][1];

        shopMaxBuyButton.disable();
        expect(mockRemoveStyles).toHaveBeenCalledWith(styleId);
    });

    test('does not let a same-styled decoy button entirely outside the modal content root affect the result', async () => {
        mockComputeMaxAffordable.mockReturnValue(4);
        const container = buildModal(false); // the real Buy button is enabled
        const input = container.querySelector('input[type="number"]');

        // Decoy: a DISABLED Button_success button living entirely outside TasksPanel_modalContent
        // (e.g. some other dialog's button mounted elsewhere on the page). If this were
        // erroneously consulted instead of the real button, it would trigger an unnecessary
        // binary search instead of stopping immediately.
        const decoy = document.createElement('button');
        decoy.className = 'Button_button__1Fe9z Button_success__6d6kU';
        decoy.disabled = true;
        Object.defineProperty(decoy, 'offsetParent', { value: document.body, configurable: true });
        document.body.appendChild(decoy);

        await shopMaxBuyButton.handleMaxClick(container, input, {
            costStyle: 'icon',
            modalContentClass: 'TasksPanel_modalContent',
        });

        expect(mockSetReactInputValue).toHaveBeenCalledWith(expect.anything(), 4, { focus: false });
        expect(mockSetReactInputValue).toHaveBeenCalledTimes(1);
    });

    test('degrades to fill-only (no binary search) when zero visible Buy buttons are found in scope', async () => {
        mockComputeMaxAffordable.mockReturnValue(4);
        const container = buildModal(false);
        const input = container.querySelector('input[type="number"]');
        const buyButton = document.querySelector('button[class*="Button_success"]');
        // Not visible per the offsetParent filter.
        Object.defineProperty(buyButton, 'offsetParent', { value: null, configurable: true });

        await shopMaxBuyButton.handleMaxClick(container, input, {
            costStyle: 'icon',
            modalContentClass: 'TasksPanel_modalContent',
        });

        expect(mockSetReactInputValue).toHaveBeenCalledTimes(1);
        expect(mockSetReactInputValue).toHaveBeenCalledWith(expect.anything(), 4, { focus: false });
    });

    test('degrades to fill-only (no binary search) when multiple visible Buy buttons are found in scope', async () => {
        mockComputeMaxAffordable.mockReturnValue(4);
        const container = buildModal(true); // first button disabled
        const input = container.querySelector('input[type="number"]');

        const secondButton = document.createElement('button');
        secondButton.className = 'Button_button__1Fe9z Button_success__6d6kU';
        Object.defineProperty(secondButton, 'offsetParent', { value: document.body, configurable: true });
        document.querySelector('[class*="TasksPanel_modalContent"]').appendChild(secondButton);

        await shopMaxBuyButton.handleMaxClick(container, input, {
            costStyle: 'icon',
            modalContentClass: 'TasksPanel_modalContent',
        });

        expect(mockSetReactInputValue).toHaveBeenCalledTimes(1);
        expect(mockSetReactInputValue).toHaveBeenCalledWith(expect.anything(), 4, { focus: false });
    });
});
