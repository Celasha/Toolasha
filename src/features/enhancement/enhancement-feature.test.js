import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tracker: {
        isInitialized: false,
        initialize: vi.fn(),
        disable: vi.fn(),
    },
    uiInitialize: vi.fn(),
    uiCleanup: vi.fn(),
    setupHandlers: vi.fn(),
    cleanupHandlers: vi.fn(),
}));

vi.mock('./enhancement-tracker.js', () => ({
    default: mocks.tracker,
}));

vi.mock('./enhancement-ui.js', () => ({
    default: {
        initialize: mocks.uiInitialize,
        cleanup: mocks.uiCleanup,
    },
}));

vi.mock('./enhancement-handlers.js', () => ({
    setupEnhancementHandlers: mocks.setupHandlers,
    cleanupEnhancementHandlers: mocks.cleanupHandlers,
}));

import { EnhancementFeature } from './enhancement-feature.js';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.tracker.isInitialized = false;
});

describe('EnhancementFeature async lifecycle', () => {
    test('does not install handlers after disable invalidates a pending initialize', async () => {
        let resolveInitialize;
        mocks.tracker.initialize.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveInitialize = resolve;
                })
        );
        const feature = new EnhancementFeature();
        const pending = feature.initialize();

        feature.disable();
        mocks.tracker.isInitialized = true;
        resolveInitialize();
        await pending;

        expect(mocks.setupHandlers).not.toHaveBeenCalled();
        expect(mocks.uiInitialize).not.toHaveBeenCalled();
        expect(feature.isInitialized).toBe(false);
    });

    test('does not install handlers when the tracker rejects stale character state', async () => {
        mocks.tracker.initialize.mockResolvedValueOnce();
        mocks.tracker.isInitialized = false;
        const feature = new EnhancementFeature();

        await feature.initialize();

        expect(mocks.setupHandlers).not.toHaveBeenCalled();
        expect(mocks.uiInitialize).not.toHaveBeenCalled();
        expect(feature.isInitialized).toBe(false);
    });
});
