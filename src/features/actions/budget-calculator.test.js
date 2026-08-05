// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';
import { BudgetCalculator } from './budget-calculator.js';

describe('BudgetCalculator panel lifecycle', () => {
    test('disconnects observers for detached action panels', () => {
        const feature = new BudgetCalculator();
        const connectedPanel = document.createElement('div');
        const detachedPanel = document.createElement('div');
        const connectedObserver = { disconnect: vi.fn() };
        const detachedObserver = { disconnect: vi.fn() };
        document.body.appendChild(connectedPanel);

        feature.panelObservers.set(connectedPanel, connectedObserver);
        feature.panelObservers.set(detachedPanel, detachedObserver);
        feature._pruneDisconnectedPanels();

        expect(feature.panelObservers.has(connectedPanel)).toBe(true);
        expect(feature.panelObservers.has(detachedPanel)).toBe(false);
        expect(connectedObserver.disconnect).not.toHaveBeenCalled();
        expect(detachedObserver.disconnect).toHaveBeenCalledTimes(1);
    });
});
