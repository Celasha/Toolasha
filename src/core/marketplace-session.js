/**
 * Marketplace Session Service
 * Shared cross-bundle session management for marketplace workflows.
 * Ensures only one owner can run a marketplace workflow at a time.
 * Exported to window.Toolasha.Core via src/libraries/core.js.
 */

/**
 * Stable keys for marketplace session owners.
 * Use these constants — never compare raw strings.
 */
export const MARKETPLACE_OWNER = Object.freeze({
    ACTIONS: 'ACTIONS',
    CRAFTING_PLAN: 'CRAFTING_PLAN',
    HOUSE: 'HOUSE',
    GUILD: 'GUILD',
    ABILITY_BOOK: 'ABILITY_BOOK',
    SELL_QUEUE: 'SELL_QUEUE',
    SHORTCUTS: 'SHORTCUTS',
});

class MarketplaceSessionService {
    constructor() {
        this._active = null; // { sessionId, owner, onEnd, consumeOnFill }
        this._counter = 0;
    }

    /**
     * Start a new session, atomically replacing any existing session.
     * The previous session's onEnd callback is called synchronously (exception-safe)
     * before the new session is created.
     *
     * @param {Object} opts
     * @param {string} opts.owner - MARKETPLACE_OWNER constant
     * @param {Function} [opts.onEnd] - Called with reason ('replaced'|'ended') when session ends.
     *   Must not call start()/end() on this service.
     * @param {boolean} [opts.consumeOnFill] - If true, session ends after first successful autofill
     * @returns {number} sessionId — store this token; use isActive() to verify ownership
     */
    start({ owner, onEnd, consumeOnFill = false }) {
        const sessionId = ++this._counter;

        if (this._active) {
            const prev = this._active;
            this._active = null; // clear before onEnd to prevent re-entrance
            try {
                prev.onEnd?.('replaced');
            } catch (err) {
                console.error('[MarketplaceSession] onEnd threw during replacement:', err);
            }
        }

        this._active = { sessionId, owner, onEnd, consumeOnFill };
        return sessionId;
    }

    /**
     * End a session by token. No-op if the token does not match the active session.
     * Calls onEnd with reason 'ended'.
     * @param {number} sessionId
     * @returns {boolean} True when the active session was ended
     */
    end(sessionId) {
        if (!this._active || this._active.sessionId !== sessionId) return false;
        const current = this._active;
        this._active = null;
        try {
            current.onEnd?.('ended');
        } catch (err) {
            console.error('[MarketplaceSession] onEnd threw during end:', err);
        }
        return true;
    }

    /**
     * End any active session unconditionally (e.g., on character switch).
     * Calls onEnd with reason 'ended'.
     * @returns {boolean} True when an active session was ended
     */
    endAll() {
        if (!this._active) return false;
        const current = this._active;
        this._active = null;
        try {
            current.onEnd?.('ended');
        } catch (err) {
            console.error('[MarketplaceSession] onEnd threw during endAll:', err);
        }
        return true;
    }

    /**
     * Check if a session token is still the active session.
     * @param {number} sessionId
     * @returns {boolean}
     */
    isActive(sessionId) {
        return this._active?.sessionId === sessionId;
    }

    /**
     * Get the active session info (owner + sessionId only).
     * Returns null if no active session.
     * @returns {{ sessionId: number, owner: string }|null}
     */
    getActive() {
        if (!this._active) return null;
        return { sessionId: this._active.sessionId, owner: this._active.owner };
    }

    /**
     * Consume a one-shot session (consumeOnFill: true) after a successful autofill.
     * No-op if the session is not active or not one-shot.
     * @param {number} sessionId
     * @returns {boolean} True if consumed and ended
     */
    consume(sessionId) {
        if (!this._active || this._active.sessionId !== sessionId) return false;
        if (!this._active.consumeOnFill) return false;
        this.end(sessionId);
        return true;
    }

    /**
     * Remove all custom marketplace UI nodes from the DOM.
     * Call this on endAll / character switch to ensure a clean slate.
     */
    clearAllMarketplaceUI() {
        document.querySelectorAll('[data-mwi-custom-tab]').forEach((el) => el.remove());
        document.querySelectorAll('[data-mwi-shrine-tab]').forEach((el) => el.remove());
    }
}

export const marketplaceSession = new MarketplaceSessionService();
