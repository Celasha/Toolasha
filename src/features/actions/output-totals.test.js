// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';
import { OutputTotals } from './output-totals.js';

describe('OutputTotals panel lifecycle', () => {
    test('releases cleanup closures for detached inputs', () => {
        const feature = new OutputTotals();
        const connectedInput = document.createElement('input');
        const detachedInput = document.createElement('input');
        const connectedCleanup = vi.fn();
        const detachedCleanup = vi.fn();
        document.body.appendChild(connectedInput);

        feature.observedInputs.set(connectedInput, connectedCleanup);
        feature.observedInputs.set(detachedInput, detachedCleanup);
        feature.pruneDisconnectedInputs();

        expect(feature.observedInputs.has(connectedInput)).toBe(true);
        expect(feature.observedInputs.has(detachedInput)).toBe(false);
        expect(connectedCleanup).not.toHaveBeenCalled();
        expect(detachedCleanup).toHaveBeenCalledTimes(1);
    });
});
