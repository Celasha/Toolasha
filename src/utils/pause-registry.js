import connectionState from '../core/connection-state.js';

/**
 * Create a pause registry for deterministic pause/resume handling.
 * @param {{ connectionState?: { on: Function, off: Function } }} [options] - Optional dependency overrides.
 * @returns {{
 *   register: (id: string, pauseFn: Function, resumeFn: Function) => void,
 *   unregister: (id: string) => void,
 *   pauseAll: () => void,
 *   resumeAll: () => void,
 *   cleanup: () => void
 * }} Pause registry API
 */
export function createPauseRegistry(options = {}) {
    const registry = new Map();
    const connectionStateRef = options.connectionState || connectionState;
    let isPaused = false;

    const normalizeId = (id) => (typeof id === 'string' ? id.trim() : id);
    const isValidId = (id) => typeof id === 'string' && id.trim().length > 0;

    /**
     * Register pausable work by unique id.
     * @param {string} id - Unique identifier for the pausable work.
     * @param {Function} pauseFn - Callback invoked on pause.
     * @param {Function} resumeFn - Callback invoked on resume.
     */
    const register = (id, pauseFn, resumeFn) => {
        if (!isValidId(id) || typeof pauseFn !== 'function' || typeof resumeFn !== 'function') {
            console.warn('[PauseRegistry] register called with invalid arguments');
            return;
        }

        const normalizedId = normalizeId(id);
        if (registry.has(normalizedId)) {
            console.warn(`[PauseRegistry] register called with duplicate id: ${normalizedId}`);
        }

        registry.set(normalizedId, { pauseFn, resumeFn });

        if (isPaused) {
            try {
                pauseFn();
            } catch (error) {
                console.error(`[PauseRegistry] Failed to pause '${normalizedId}' during register:`, error);
            }
        }
    };

    /**
     * Unregister pausable work by id.
     * Note: Unregister does not auto-resume if currently paused.
     * @param {string} id - Identifier to remove.
     */
    const unregister = (id) => {
        if (!isValidId(id)) {
            console.warn('[PauseRegistry] unregister called with invalid id');
            return;
        }

        registry.delete(normalizeId(id));
    };

    const callAll = (actionLabel, handlerKey) => {
        for (const [entryId, entry] of registry.entries()) {
            const handler = entry[handlerKey];
            if (typeof handler !== 'function') {
                continue;
            }

            try {
                handler();
            } catch (error) {
                console.error(`[PauseRegistry] Failed to ${actionLabel} '${entryId}':`, error);
            }
        }
    };

    /**
     * Pause all registered work.
     */
    const pauseAll = () => {
        if (isPaused) {
            return;
        }

        isPaused = true;
        callAll('pause', 'pauseFn');
    };

    /**
     * Resume all registered work.
     */
    const resumeAll = () => {
        if (!isPaused) {
            return;
        }

        isPaused = false;
        callAll('resume', 'resumeFn');
    };

    const handleDisconnected = () => {
        pauseAll();
    };

    const handleReconnected = () => {
        resumeAll();
    };

    if (connectionStateRef && typeof connectionStateRef.on === 'function') {
        connectionStateRef.on('disconnected', handleDisconnected);
        connectionStateRef.on('reconnected', handleReconnected);
    } else {
        console.warn('[PauseRegistry] connectionState unavailable; pause/resume events not wired');
    }

    /**
     * Cleanup registry subscriptions.
     */
    const cleanup = () => {
        if (!connectionStateRef || typeof connectionStateRef.off !== 'function') {
            return;
        }

        connectionStateRef.off('disconnected', handleDisconnected);
        connectionStateRef.off('reconnected', handleReconnected);
    };

    return {
        register,
        unregister,
        pauseAll,
        resumeAll,
        cleanup,
    };
}
