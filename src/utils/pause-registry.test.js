import { describe, expect, test, vi } from 'vitest';

import { createPauseRegistry } from './pause-registry.js';

const createConnectionStateStub = () => {
    const handlers = {};

    return {
        handlers,
        connectionState: {
            on: vi.fn((event, handler) => {
                handlers[event] = handler;
            }),
            off: vi.fn((event) => {
                delete handlers[event];
            }),
        },
    };
};

describe('pause registry', () => {
    test('pauses and resumes registered work on connection events', () => {
        // Arrange
        const { handlers, connectionState } = createConnectionStateStub();
        const pauseFn = vi.fn();
        const resumeFn = vi.fn();
        const registry = createPauseRegistry({ connectionState });

        registry.register('work', pauseFn, resumeFn);

        // Act
        handlers.disconnected();
        handlers.reconnected();

        // Assert
        expect(pauseFn).toHaveBeenCalledTimes(1);
        expect(resumeFn).toHaveBeenCalledTimes(1);
    });

    test('registers new work in paused state by invoking pause', () => {
        // Arrange
        const { handlers, connectionState } = createConnectionStateStub();
        const pauseFn = vi.fn();
        const resumeFn = vi.fn();
        const registry = createPauseRegistry({ connectionState });

        handlers.disconnected();

        // Act
        registry.register('late-work', pauseFn, resumeFn);

        // Assert
        expect(pauseFn).toHaveBeenCalledTimes(1);
        expect(resumeFn).not.toHaveBeenCalled();
    });
});
