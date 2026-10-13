import { afterEach, describe, expect, test, vi } from 'vitest';
import {
    getCatalystChoice,
    getCatalystWhatIfResult,
    onCatalystWhatIfChange,
    publishCatalystWhatIfResult,
    resetCatalystWhatIf,
    setCatalystChoice,
} from './alchemy-catalyst-whatif.js';

afterEach(() => resetCatalystWhatIf());

describe('alchemy catalyst what-if state', () => {
    test('defaults to the equipped catalyst with no result', () => {
        expect(getCatalystChoice()).toBe('equipped');
        expect(getCatalystWhatIfResult()).toBeNull();
    });

    test('rejects unknown choices and notifies only on a real change', () => {
        const listener = vi.fn();
        onCatalystWhatIfChange(listener);

        setCatalystChoice('bogus');
        setCatalystChoice('equipped');
        expect(listener).not.toHaveBeenCalled();

        setCatalystChoice('prime');
        expect(getCatalystChoice()).toBe('prime');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test('a published result is only visible while a what-if is active', () => {
        publishCatalystWhatIfResult({ catalystHrid: '/items/prime_catalyst', successRate: 0.75 });
        expect(getCatalystWhatIfResult()).toBeNull();

        setCatalystChoice('prime');
        publishCatalystWhatIfResult({ catalystHrid: '/items/prime_catalyst', successRate: 0.75 });
        expect(getCatalystWhatIfResult()).toEqual({ catalystHrid: '/items/prime_catalyst', successRate: 0.75 });

        setCatalystChoice('equipped');
        expect(getCatalystWhatIfResult()).toBeNull();
    });

    test('republishing an identical result does not notify again', () => {
        setCatalystChoice('none');
        const listener = vi.fn();
        onCatalystWhatIfChange(listener);

        publishCatalystWhatIfResult({ catalystHrid: null, successRate: 0.6 });
        publishCatalystWhatIfResult({ catalystHrid: null, successRate: 0.6 });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    test('unsubscribe stops notifications', () => {
        const listener = vi.fn();
        const unsubscribe = onCatalystWhatIfChange(listener);
        unsubscribe();

        setCatalystChoice('prime');

        expect(listener).not.toHaveBeenCalled();
    });
});
