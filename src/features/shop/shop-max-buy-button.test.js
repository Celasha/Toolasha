/**
 * Tests for Shop Max Buy Button: injecting a "Max" button into Shop/Task Shop/Labyrinth
 * Shop/Cowbell Store buy dialogs and filling in the most affordable quantity.
 */

/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const settingValues = { shop_maxBuyButton: true };
const observerRegistrations = [];

const { mockResolveCostLines, mockComputeMaxAffordable, mockSetReactInputValue, mockT } = vi.hoisted(() => ({
    mockResolveCostLines: vi.fn(),
    mockComputeMaxAffordable: vi.fn(),
    mockSetReactInputValue: vi.fn(),
    mockT: vi.fn((key) => key),
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

vi.mock('../../utils/shop-max-buy.js', () => ({
    resolveCostLines: mockResolveCostLines,
    computeMaxAffordable: mockComputeMaxAffordable,
}));

vi.mock('../../utils/react-input.js', () => ({
    setReactInputValue: mockSetReactInputValue,
}));

import shopMaxBuyButton from './shop-max-buy-button.js';

function buildModal(disabled = false) {
    document.body.innerHTML = `
        <div class="TasksPanel_modalContent__2_F_Z">
            <div class="TasksPanel_inputContainer__1DTU-">
                <div class="None">
                    <div class="Input_inputContainer__22GnD">
                        <input type="number" value="1">
                    </div>
                    <div class="TasksPanel_error__32YiV"></div>
                </div>
            </div>
            <div class="None">You Pay: 50</div>
            <button class="Button_button__1Fe9z Button_success__6d6kU" ${disabled ? 'disabled' : ''}>Buy</button>
        </div>
    `;
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
        const buyButton = container.parentElement.querySelector('button[class*="Button_success"]');
        // Simulate a Convenience-style cap of 6: Buy is disabled for any quantity above 6.
        const disabledThreshold = 6;

        mockSetReactInputValue.mockImplementation((targetInput, value) => {
            targetInput.value = String(value);
            buyButton.disabled = value > disabledThreshold;
        });

        await shopMaxBuyButton.handleMaxClick(container, input, 'icon');

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
});
