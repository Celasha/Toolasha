import { describe, expect, test, vi, beforeEach } from 'vitest';

let messageHandlers;
let socketHandlers;

vi.mock('./websocket.js', () => {
    messageHandlers = new Map();
    socketHandlers = new Map();

    return {
        default: {
            on: vi.fn((event, handler) => {
                messageHandlers.set(event, handler);
            }),
            onSocketEvent: vi.fn((event, handler) => {
                socketHandlers.set(event, handler);
            }),
        },
    };
});

beforeEach(() => {
    vi.resetModules();
});

describe('ConnectionState', () => {
    test('transitions to connected on init_character_data', async () => {
        // Arrange
        const { default: connectionState } = await import('./connection-state.js');
        const onReconnected = vi.fn();
        connectionState.on('reconnected', onReconnected);

        // Act
        const handler = messageHandlers.get('init_character_data');
        handler({});

        // Assert
        expect(connectionState.isConnected()).toBe(true);
        expect(onReconnected).toHaveBeenCalledTimes(1);
    });

    test('moves to reconnecting on socket open after connected', async () => {
        // Arrange
        const { default: connectionState } = await import('./connection-state.js');
        const initHandler = messageHandlers.get('init_character_data');
        const openHandler = socketHandlers.get('open');

        // Act
        initHandler({});
        openHandler({});

        // Assert
        expect(connectionState.isConnected()).toBe(false);
        expect(connectionState.getState()).toBe('reconnecting');
    });

    test('emits disconnected on socket close', async () => {
        // Arrange
        const { default: connectionState } = await import('./connection-state.js');
        const onDisconnected = vi.fn();
        connectionState.on('disconnected', onDisconnected);

        // Act
        const closeHandler = socketHandlers.get('close');
        closeHandler({ code: 1006 });

        // Assert
        expect(connectionState.getState()).toBe('disconnected');
        expect(onDisconnected).toHaveBeenCalledTimes(1);
    });
});
