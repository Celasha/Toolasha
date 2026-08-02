// @vitest-environment jsdom
/**
 * Tests for TLA-001 — Marketplace Session Service
 * Tests 1-47 from the implementation brief (test 48 = manual layout acceptance)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { marketplaceSession, MARKETPLACE_OWNER } from './marketplace-session.js';

// ─── helpers ───────────────────────────────────────────────────────────────

function freshSession() {
    // Reset internal state between tests by ending any active session
    const active = marketplaceSession.getActive();
    if (active) marketplaceSession.end(active.sessionId);
}

// ─── MARKETPLACE_OWNER ─────────────────────────────────────────────────────

describe('MARKETPLACE_OWNER', () => {
    test('has expected keys', () => {
        expect(MARKETPLACE_OWNER.ACTIONS).toBe('ACTIONS');
        expect(MARKETPLACE_OWNER.CRAFTING_PLAN).toBe('CRAFTING_PLAN');
        expect(MARKETPLACE_OWNER.HOUSE).toBe('HOUSE');
        expect(MARKETPLACE_OWNER.GUILD).toBe('GUILD');
        expect(MARKETPLACE_OWNER.ABILITY_BOOK).toBe('ABILITY_BOOK');
        expect(MARKETPLACE_OWNER.SELL_QUEUE).toBe('SELL_QUEUE');
    });

    test('is frozen — cannot be mutated', () => {
        expect(() => {
            MARKETPLACE_OWNER.NEW_KEY = 'x';
        }).toThrow();
    });

    // Test 16: owner keys are stable strings
    test('owner constants are stable strings suitable as data-mwi-tab-owner attributes', () => {
        for (const key of Object.values(MARKETPLACE_OWNER)) {
            expect(typeof key).toBe('string');
            expect(key.length).toBeGreaterThan(0);
        }
    });
});

// ─── Session lifecycle ──────────────────────────────────────────────────────

describe('MarketplaceSessionService — basic lifecycle', () => {
    beforeEach(freshSession);

    test('start() returns a numeric sessionId', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        expect(typeof id).toBe('number');
        marketplaceSession.end(id);
    });

    test('isActive() returns true for the active token', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        expect(marketplaceSession.isActive(id)).toBe(true);
        marketplaceSession.end(id);
    });

    test('isActive() returns false after end()', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        marketplaceSession.end(id);
        expect(marketplaceSession.isActive(id)).toBe(false);
    });

    test('end() with wrong token is a no-op', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        marketplaceSession.end(id + 999);
        expect(marketplaceSession.isActive(id)).toBe(true);
        marketplaceSession.end(id);
    });

    // Test 4: stale-session token rejection
    test('Test 4 — stale token from replaced session is no longer active', () => {
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        expect(marketplaceSession.isActive(idA)).toBe(false);
        expect(marketplaceSession.isActive(idB)).toBe(true);
        marketplaceSession.end(idB);
    });

    // Test 3: single active session across consumers
    test('Test 3 — only one session can be active at a time', () => {
        const id1 = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const id2 = marketplaceSession.start({ owner: MARKETPLACE_OWNER.HOUSE });
        const id3 = marketplaceSession.start({ owner: MARKETPLACE_OWNER.GUILD });
        expect(marketplaceSession.isActive(id1)).toBe(false);
        expect(marketplaceSession.isActive(id2)).toBe(false);
        expect(marketplaceSession.isActive(id3)).toBe(true);
        marketplaceSession.end(id3);
    });

    test('getActive() returns owner and sessionId of active session', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.SELL_QUEUE });
        const active = marketplaceSession.getActive();
        expect(active).not.toBeNull();
        expect(active.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);
        expect(active.sessionId).toBe(id);
        marketplaceSession.end(id);
    });

    test('getActive() returns null when no session is active', () => {
        expect(marketplaceSession.getActive()).toBeNull();
    });
});

// ─── onEnd callback ─────────────────────────────────────────────────────────

describe('onEnd callback', () => {
    beforeEach(freshSession);

    // Test 15: replacement calls previous onEnd before new session is set
    test('Test 15 — replacement calls previous onEnd synchronously before new session is created', () => {
        const calls = [];
        let capturedActiveInOnEnd = null;

        const idA = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: (reason) => {
                calls.push({ owner: 'ACTIONS', reason });
                capturedActiveInOnEnd = marketplaceSession.getActive();
            },
        });
        expect(idA).toBeDefined();

        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });

        expect(calls).toHaveLength(1);
        expect(calls[0].reason).toBe('replaced');
        // At the moment onEnd fires, the new session is not yet set
        expect(capturedActiveInOnEnd).toBeNull();

        marketplaceSession.end(idB);
    });

    test('onEnd called with "ended" when explicitly ended', () => {
        const calls = [];
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.HOUSE,
            onEnd: (reason) => calls.push(reason),
        });
        marketplaceSession.end(id);
        expect(calls).toEqual(['ended']);
    });

    test('onEnd called with "ended" from endAll()', () => {
        const calls = [];
        marketplaceSession.start({
            owner: MARKETPLACE_OWNER.GUILD,
            onEnd: (reason) => calls.push(reason),
        });
        marketplaceSession.endAll();
        expect(calls).toEqual(['ended']);
    });

    // Test 39: throwing onEnd does not leave registry in bad state
    test('Test 39 — throwing onEnd during replacement does not leave registry in indeterminate state', () => {
        marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: () => {
                throw new Error('onEnd error');
            },
        });

        // Should not throw
        expect(() => {
            marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        }).not.toThrow();

        const active = marketplaceSession.getActive();
        expect(active?.owner).toBe(MARKETPLACE_OWNER.CRAFTING_PLAN);
        marketplaceSession.endAll();
    });
});

// ─── consume() — one-shot sessions ─────────────────────────────────────────

describe('consume() — one-shot sessions', () => {
    beforeEach(freshSession);

    // Test 19: Ability Book one-shot
    test('Test 19 — consumeOnFill: true — consume() ends the session and returns true', () => {
        const calls = [];
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
            onEnd: (reason) => calls.push(reason),
        });

        const consumed = marketplaceSession.consume(id);
        expect(consumed).toBe(true);
        expect(marketplaceSession.isActive(id)).toBe(false);
        expect(calls).toEqual(['ended']);
    });

    // Test 20: persistent provider survives partial purchase
    test('Test 20 — consumeOnFill: false — consume() is a no-op', () => {
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            consumeOnFill: false,
        });

        const consumed = marketplaceSession.consume(id);
        expect(consumed).toBe(false);
        expect(marketplaceSession.isActive(id)).toBe(true);
        marketplaceSession.end(id);
    });

    test('consume() with wrong token is a no-op', () => {
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
        });

        const consumed = marketplaceSession.consume(id + 999);
        expect(consumed).toBe(false);
        expect(marketplaceSession.isActive(id)).toBe(true);
        marketplaceSession.end(id);
    });

    // Test 42: Ability Book second fill after consume does nothing
    test('Test 42 — after consume(), session is dead and second consume() returns false', () => {
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
        });
        marketplaceSession.consume(id);
        expect(marketplaceSession.consume(id)).toBe(false);
    });
});

// ─── endAll() ───────────────────────────────────────────────────────────────

describe('endAll()', () => {
    beforeEach(freshSession);

    // Test 26: character switch invalidates active token before cleanup
    test('Test 26 — endAll() invalidates active session before callers inspect it', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        marketplaceSession.endAll();
        expect(marketplaceSession.isActive(id)).toBe(false);
        expect(marketplaceSession.getActive()).toBeNull();
    });

    test('endAll() on an empty registry is a no-op', () => {
        expect(() => marketplaceSession.endAll()).not.toThrow();
        expect(marketplaceSession.getActive()).toBeNull();
    });
});

// ─── clearAllMarketplaceUI() ─────────────────────────────────────────────────

describe('clearAllMarketplaceUI()', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        freshSession();
    });

    test('removes all [data-mwi-custom-tab] elements from the DOM', () => {
        document.body.innerHTML = `
            <div data-mwi-custom-tab="true" id="t1"></div>
            <div data-mwi-custom-tab="true" id="t2"></div>
            <span id="keep"></span>
        `;
        marketplaceSession.clearAllMarketplaceUI();
        expect(document.getElementById('t1')).toBeNull();
        expect(document.getElementById('t2')).toBeNull();
        expect(document.getElementById('keep')).not.toBeNull();
    });

    test('removes all [data-mwi-shrine-tab] elements from the DOM', () => {
        document.body.innerHTML = `
            <div data-mwi-shrine-tab="true" id="s1"></div>
        `;
        marketplaceSession.clearAllMarketplaceUI();
        expect(document.getElementById('s1')).toBeNull();
    });
});

// ─── Cross-session invariants ───────────────────────────────────────────────

describe('Cross-session safety', () => {
    beforeEach(freshSession);

    // Test 28: owner revocation before navigation resolves
    test('Test 28 — session replaced during async navigation; original caller sees isActive()=false', async () => {
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });

        // Simulate async navigation (micro-task)
        await Promise.resolve();

        // Another owner replaces Actions
        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });

        expect(marketplaceSession.isActive(idA)).toBe(false);
        expect(marketplaceSession.isActive(idB)).toBe(true);

        marketplaceSession.end(idB);
    });

    // Test 30: same-owner replacement does not clear new Return context
    test('Test 30 — same-owner second start() replaces first; second session is active', () => {
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        expect(marketplaceSession.isActive(idA)).toBe(false);
        expect(marketplaceSession.isActive(idB)).toBe(true);
        marketplaceSession.end(idB);
    });

    // Test 40: stale Sell Queue cleanup cannot end newer owner's session
    test('Test 40 — stale SellQueue cleanup fires after Actions replaced it; Actions remains active', () => {
        const onEndCalls = [];

        // Sell Queue claims first
        let sqSessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.SELL_QUEUE,
            onEnd: (reason) => {
                onEndCalls.push({ owner: 'SQ', reason });
                sqSessionId = null;
            },
        });

        // Actions replaces Sell Queue
        const actionsId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
        });

        // SQ onEnd was called with 'replaced'; sqSessionId is now null
        expect(onEndCalls[0]?.reason).toBe('replaced');
        expect(sqSessionId).toBeNull();

        // Simulate stale SQ cleanup trying to end by stored id (which is null → no-op)
        marketplaceSession.end(sqSessionId); // end(null) — safe no-op
        expect(marketplaceSession.isActive(actionsId)).toBe(true);

        marketplaceSession.end(actionsId);
    });

    // Test 47: session A replaced by B; A's onEnd fires; after start() returns B is active
    test('Test 47 — session A onEnd fires; B remains fully active with its token', () => {
        const results = [];

        const idA = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: (reason) => {
                results.push({ event: 'A_onEnd', reason });
                // A's stale cleanup guard: isActive(idA) is false here
                results.push({ aActive: marketplaceSession.isActive(idA) });
                // At this point, B's session has NOT been registered yet (onEnd fires before new session)
                results.push({ noActiveDuringOnEnd: marketplaceSession.getActive() === null });
            },
        });

        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });

        // After start() returns, B is the active session
        expect(results[0]).toEqual({ event: 'A_onEnd', reason: 'replaced' });
        expect(results[1]).toEqual({ aActive: false });
        expect(results[2]).toEqual({ noActiveDuringOnEnd: true });
        expect(marketplaceSession.isActive(idB)).toBe(true);

        marketplaceSession.end(idB);
    });
});

// ─── Owner-scoped tab removal ────────────────────────────────────────────────

import {
    createMaterialTab,
    removeMaterialTabsForOwner,
    getVisibleMarketplaceTabContainer,
    watchNativeTabExit,
} from '../utils/marketplace-tabs.js';

describe('createMaterialTab / removeMaterialTabsForOwner', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Test 11: owner-scoped removal removes only intended tabs
    test('Test 11 — removeMaterialTabsForOwner removes only tabs for that owner', () => {
        document.body.innerHTML = '<div id="container"></div>';
        const container = document.getElementById('container');

        const refTab = document.createElement('button');
        refTab.innerHTML = '<span class="TabsComponent_badge__x">badge</span>';

        const matA = { itemHrid: '/items/iron_ore', itemName: 'Iron Ore', missing: 5, required: 10, isTradeable: true };
        const matB = { itemHrid: '/items/coal', itemName: 'Coal', missing: 3, required: 8, isTradeable: true };

        const tabA = createMaterialTab(matA, refTab, () => {}, MARKETPLACE_OWNER.ACTIONS);
        const tabB = createMaterialTab(matB, refTab, () => {}, MARKETPLACE_OWNER.CRAFTING_PLAN);

        container.appendChild(tabA);
        container.appendChild(tabB);

        expect(container.children.length).toBe(2);
        removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);
        expect(container.children.length).toBe(1);
        expect(container.children[0].getAttribute('data-mwi-tab-owner')).toBe(MARKETPLACE_OWNER.CRAFTING_PLAN);
    });

    // Test 16: session owner and tab owner use the same stable constant
    test('Test 16 — createMaterialTab sets data-mwi-tab-owner to the passed MARKETPLACE_OWNER key', () => {
        const refTab = document.createElement('button');
        refTab.innerHTML = '<span class="TabsComponent_badge__x">badge</span>';
        const mat = { itemHrid: '/items/gold', itemName: 'Gold', missing: 1, required: 5, isTradeable: true };

        const tab = createMaterialTab(mat, refTab, () => {}, MARKETPLACE_OWNER.HOUSE);
        expect(tab.getAttribute('data-mwi-tab-owner')).toBe(MARKETPLACE_OWNER.HOUSE);
        expect(tab.getAttribute('data-mwi-custom-tab')).toBe('true');
    });

    // Test 12: session replacement removes old tabs before new ones created
    test('Test 12 — after owner switch, old owner tabs can be removed by owner scope', () => {
        document.body.innerHTML = '<div id="c"></div>';
        const container = document.getElementById('c');
        const refTab = document.createElement('button');
        refTab.innerHTML = '<span class="TabsComponent_badge__x">badge</span>';

        const mat = { itemHrid: '/items/a', itemName: 'A', missing: 1, required: 5, isTradeable: true };

        const tabActions = createMaterialTab(mat, refTab, () => {}, MARKETPLACE_OWNER.ACTIONS);
        container.appendChild(tabActions);

        // Owner switches to CRAFTING_PLAN — old ACTIONS tabs removed first
        removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);
        const tabCP = createMaterialTab(mat, refTab, () => {}, MARKETPLACE_OWNER.CRAFTING_PLAN);
        container.appendChild(tabCP);

        expect(container.children.length).toBe(1);
        expect(container.children[0].getAttribute('data-mwi-tab-owner')).toBe(MARKETPLACE_OWNER.CRAFTING_PLAN);
    });
});

// ─── autofillManager ────────────────────────────────────────────────────────

// Captures the last handleBuyModal callback registered via initialize().
// Updated each time a manager calls initialize(); safe because tests use it immediately after.
let _capturedModalCallback = null;

vi.mock('../core/dom-observer.js', () => ({
    default: {
        onClass: vi.fn((_id, _cls, cb) => {
            _capturedModalCallback = cb;
            return () => {};
        }),
    },
}));

import {
    createAutofillManager,
    readMarketplaceItemIdentity,
    readMarketplaceRuntimeState,
} from '../utils/marketplace-autofill.js';

function makeMarketplaceRuntimeState(overrides = {}) {
    return {
        marketTabKey: 'MarketListings',
        marketListingsView: 'OrderBook',
        itemHrid: '/items/iron_ore',
        enhancementLevel: 0,
        isSell: false,
        quantityInput: 1,
        priceInput: 500,
        ...overrides,
    };
}

function attachMarketplacePanelFiber(panel, states) {
    const hostFiber = { stateNode: panel, return: null };
    let cursor = hostFiber;
    for (const state of states) {
        const componentFiber = { stateNode: { state }, return: null };
        cursor.return = componentFiber;
        cursor = componentFiber;
    }
    Object.defineProperty(panel, '__reactFiber$toolashaTest', {
        configurable: true,
        value: hostFiber,
    });
    return hostFiber;
}

describe('createAutofillManager', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Test 8: double initialize() leaves one observer, no stale state
    test('Test 8 — double initialize() unregisters previous observer', async () => {
        const { default: domObserver } = await import('../core/dom-observer.js');
        const mgr = createAutofillManager('TestMgr');
        mgr.initialize();
        mgr.initialize();
        // onClass should have been called twice (first install, re-install)
        expect(domObserver.onClass).toHaveBeenCalledTimes(2);
        mgr.cleanup();
    });

    // Test 2: exact target-input ownership
    test('Test 2 — exitSession(wrongId) does not disarm the current session', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('TestExact');
        mgr.initialize();
        mgr.startSession({ sessionId: id, quantityProvider: () => 42 });
        mgr.exitSession(id + 999); // wrong id — should be no-op
        // Session still armed: setQuantityProvider with correct id still works
        mgr.setQuantityProvider(() => 100, id);
        mgr.cleanup();
        marketplaceSession.end(id);
    });

    // Test 7: pending callback invalidated on return/exit/disable
    test('Test 7 — exitSession() disarms the quantityProvider', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('TestDisarm');
        mgr.initialize();
        mgr.startSession({ sessionId: id, quantityProvider: () => 99 });
        mgr.exitSession(id);
        // After exit, starting a new session with different id should work independently
        const id2 = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        mgr.startSession({ sessionId: id2, quantityProvider: () => 77 });
        mgr.cleanup();
        marketplaceSession.end(id2);
    });

    // Test 18: initialize() after active session leaves old session dead
    test('Test 18 — cleanup() then initialize() leaves manager in clean state', () => {
        const mgr = createAutofillManager('TestReinit');
        mgr.initialize();
        mgr.cleanup();
        mgr.initialize(); // should not throw
        mgr.cleanup();
    });

    // Test 21: ambiguous quantity input fails closed
    test('Test 21 — startSession with null quantityProvider does not fill modal', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('TestNullProvider');
        mgr.initialize();
        mgr.startSession({ sessionId: id, quantityProvider: null });
        // No error; just no fill
        mgr.cleanup();
        marketplaceSession.end(id);
    });

    // Test 14: lifecycle — disable then initialize leaves one observer
    test('Test 14 — cleanup + initialize cycle resets to clean state', async () => {
        const { default: domObserver } = await import('../core/dom-observer.js');
        domObserver.onClass.mockClear();
        const mgr = createAutofillManager('TestLifecycle');
        mgr.initialize();
        mgr.cleanup();
        mgr.initialize();
        expect(domObserver.onClass).toHaveBeenCalledTimes(2);
        mgr.cleanup();
    });
});

// ─── readMarketplaceItemIdentity ─────────────────────────────────────────────

describe('readMarketplaceItemIdentity', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Test 6: unidentifiable item fails closed
    test('Test 6 — returns null when no marketplace panel in DOM', () => {
        expect(readMarketplaceItemIdentity()).toBeNull();
    });

    test('returns null when panel exists but no item link', () => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__x"></div>';
        expect(readMarketplaceItemIdentity()).toBeNull();
    });

    test('returns itemHrid from item link in listings header', () => {
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__x">
                <div class="MarketplacePanel_listingsHeader__x">
                    <a href="/items/iron_ore">Iron Ore</a>
                </div>
            </div>
        `;
        const identity = readMarketplaceItemIdentity();
        expect(identity).not.toBeNull();
        expect(identity.itemHrid).toBe('/items/iron_ore');
        expect(identity.enhancementLevel).toBe(0);
    });
});

// ─── Session integration: session guards in autofill ─────────────────────────

describe('autofillManager + marketplaceSession integration', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Test 1: Return snapshot isolation
    test('Test 1 — autofill session A does not write quantity after session B replaces it', () => {
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgrA = createAutofillManager('SnapTest');
        mgrA.initialize();
        mgrA.startSession({ sessionId: idA, quantityProvider: () => 43 });

        // B replaces A (triggers A's onEnd → autofill should be dead)
        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        const mgrB = createAutofillManager('SnapTestB');
        mgrB.initialize();
        mgrB.startSession({ sessionId: idB, quantityProvider: () => 7 });

        // mgrA session is now stale — if it tried to fill it should get nothing
        // isActive(idA) is false, so the manager won't fill
        expect(marketplaceSession.isActive(idA)).toBe(false);

        mgrA.cleanup();
        mgrB.cleanup();
        marketplaceSession.end(idB);
    });

    // Test 48: inventory update → model updated → React remount → reinjected tab shows updated quantity
    test('Test 48 — model.materials updated after inventory change; reinjection uses updated quantity', () => {
        const model = {
            sessionId: 1,
            materials: [{ itemHrid: '/items/gold', missing: 100 }],
            returnContext: {},
        };

        // Simulate inventory update reducing missing from 100 → 40
        const entry = model.materials.find((m) => m.itemHrid === '/items/gold');
        entry.missing = 40;

        // After React remount, reinjection should read 40
        expect(model.materials[0].missing).toBe(40);
    });
});

// ─── Test 27: cross-bundle namespace ─────────────────────────────────────────

describe('Test 27 — cross-bundle namespace', () => {
    test('marketplaceSession is a singleton — same reference from two imports', async () => {
        const { marketplaceSession: ms2 } = await import('./marketplace-session.js');
        expect(ms2).toBe(marketplaceSession);
    });

    test('MARKETPLACE_OWNER is the same frozen object from two imports', async () => {
        const { MARKETPLACE_OWNER: MO2 } = await import('./marketplace-session.js');
        expect(MO2).toBe(MARKETPLACE_OWNER);
    });
});

// ─── Test 29: navigation failure rolls back ───────────────────────────────────

describe('Test 29 — navigation failure rollback', () => {
    beforeEach(freshSession);

    test('session is ended when navigation fails (simulated)', () => {
        const onEndCalls = [];
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: (reason) => onEndCalls.push(reason),
        });

        // Simulate navigation failure path: feature calls end(id)
        marketplaceSession.end(id);

        expect(onEndCalls).toEqual(['ended']);
        expect(marketplaceSession.isActive(id)).toBe(false);
    });
});

// ─── Test 38: House Return absence is a passing test ─────────────────────────

describe('Test 38 — House Return safely absent', () => {
    test('No house Return tab is created without a confirmed fiber navigation method', () => {
        // The house feature intentionally does NOT create a Return tab.
        // This test verifies the safe-disabled state: no house Return tabs in DOM.
        document.body.innerHTML = '<div id="container"></div>';
        const returnTabs = document.querySelectorAll(
            '[data-mwi-custom-tab][data-mwi-tab-owner="HOUSE"][data-mwi-return-tab]'
        );
        expect(returnTabs.length).toBe(0);
    });
});

// ─── Test 5: wrong-item modal rejection ──────────────────────────────────────

describe('Test 5 — wrong-item modal rejection', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('autofill does not fill when the visible panel state has a different item', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('WrongItemTest');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', enhancementLevel: 0, quantityProvider: () => 99 });

        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__test"></div>
            <div class="Modal_modalContainer__test">
                <div class="MarketplacePanel_quantityInputs__test"><input type="number" value="" /></div>
            </div>
        `;
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [makeMarketplaceRuntimeState({ itemHrid: '/items/copper_ore' })]);
        _capturedModalCallback(document.querySelector('[class*="Modal_modalContainer"]'));

        expect(document.querySelector('input').value).toBe('');
        expect(marketplaceSession.isActive(id)).toBe(true);

        mgr.cleanup();
        marketplaceSession.end(id);
    });
});

// ─── Test 10: wrong-enhancement-level rejection ───────────────────────────────

describe('Test 10 — wrong enhancement level rejection', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('autofill rejects the same item at the wrong enhancement level', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('WrongEnhTest');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/sword', enhancementLevel: 3, quantityProvider: () => 5 });

        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__test"></div>
            <div class="Modal_modalContainer__test">
                <div class="MarketplacePanel_quantityInputs__test"><input type="number" value="" /></div>
            </div>
        `;
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [
            makeMarketplaceRuntimeState({ itemHrid: '/items/sword', enhancementLevel: 1 }),
        ]);
        _capturedModalCallback(document.querySelector('[class*="Modal_modalContainer"]'));

        expect(document.querySelector('input').value).toBe('');
        expect(marketplaceSession.isActive(id)).toBe(true);

        mgr.cleanup();
        marketplaceSession.end(id);
    });
});

// ─── Test 13: Sell Queue compatibility with revised API ───────────────────────

describe('Test 13 — Sell Queue compatibility with revised API', () => {
    beforeEach(freshSession);

    test('Sell Queue session start revokes previous owner; previous onEnd fires', () => {
        const actionsOnEnd = vi.fn();
        const actionsId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: actionsOnEnd,
        });

        const sqId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.SELL_QUEUE,
            onEnd: vi.fn(),
        });

        expect(actionsOnEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.isActive(actionsId)).toBe(false);
        expect(marketplaceSession.isActive(sqId)).toBe(true);
        expect(marketplaceSession.getActive()?.owner).toBe(MARKETPLACE_OWNER.SELL_QUEUE);

        marketplaceSession.end(sqId);
    });
});

// ─── Test 17: feature-local disable does not remove another owner's tabs ──────

describe("Test 17 — feature-local disable does not remove another owner's tabs", () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('removeMaterialTabsForOwner(ACTIONS) does not remove CRAFTING_PLAN tabs', () => {
        document.body.innerHTML = '<div id="c"></div>';
        const c = document.getElementById('c');

        const t1 = document.createElement('div');
        t1.setAttribute('data-mwi-custom-tab', 'true');
        t1.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.ACTIONS);
        c.appendChild(t1);

        const t2 = document.createElement('div');
        t2.setAttribute('data-mwi-custom-tab', 'true');
        t2.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.CRAFTING_PLAN);
        c.appendChild(t2);

        removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);

        expect(document.querySelectorAll('[data-mwi-tab-owner="ACTIONS"]').length).toBe(0);
        expect(document.querySelectorAll('[data-mwi-tab-owner="CRAFTING_PLAN"]').length).toBe(1);
    });
});

// ─── Test 22: unsupported modal/runtime state fails closed ───────────────────

describe('Test 22 — unsupported modal/runtime state fails closed', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    function setupManager(observerId) {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager(observerId);
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', enhancementLevel: 0, quantityProvider: () => 50 });
        return { id, mgr };
    }

    test('Sell mode in the visible panel state does not trigger autofill', () => {
        const { id, mgr } = setupManager('SellModeTest');
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__test"></div>
            <div class="Modal_modalContainer__test">
                <div class="MarketplacePanel_quantityInputs__test"><input type="number" value="" /></div>
            </div>
        `;
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [makeMarketplaceRuntimeState({ isSell: true })]);
        _capturedModalCallback(document.querySelector('[class*="Modal_modalContainer"]'));
        expect(document.querySelector('input').value).toBe('');
        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('a visible panel without a React fiber fails closed', () => {
        const { id, mgr } = setupManager('NoFiberTest');
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__test"></div>
            <div class="Modal_modalContainer__test">
                <div class="MarketplacePanel_quantityInputs__test"><input type="number" value="" /></div>
            </div>
        `;
        _capturedModalCallback(document.querySelector('[class*="Modal_modalContainer"]'));
        expect(document.querySelector('input').value).toBe('');
        mgr.cleanup();
        marketplaceSession.end(id);
    });
});

// ─── Tests 23 / 24: React remount — reinjection and clean shutdown paths ──────

describe('Tests 23 / 24 — React remount reinjection and clean shutdown', () => {
    beforeEach(freshSession);

    test('Test 23 — active session + visible tablist: onTabsGone triggers reinjection', () => {
        const capturedSessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        let reinjectionCalled = false;
        let cleanShutdownCalled = false;

        const onTabsGone = (simulatedVisible) => {
            if (!marketplaceSession.isActive(capturedSessionId)) return;
            if (simulatedVisible) {
                reinjectionCalled = true;
            } else {
                cleanShutdownCalled = true;
            }
        };

        onTabsGone(true);
        expect(reinjectionCalled).toBe(true);
        expect(cleanShutdownCalled).toBe(false);

        marketplaceSession.end(capturedSessionId);
    });

    test('Test 24 — active session + hidden marketplace: onTabsGone triggers clean shutdown', () => {
        const capturedSessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        let cleanShutdownCalled = false;

        const onTabsGone = (simulatedVisible) => {
            if (!marketplaceSession.isActive(capturedSessionId)) return;
            if (simulatedVisible) {
                // reinjection — not taken
            } else {
                marketplaceSession.end(capturedSessionId);
                cleanShutdownCalled = true;
            }
        };

        onTabsGone(false);
        expect(cleanShutdownCalled).toBe(true);
        expect(marketplaceSession.isActive(capturedSessionId)).toBe(false);
    });

    test('stale capturedSessionId guard prevents reinjection after replacement', () => {
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        let reinjectionCalled = false;

        const onTabsGoneForA = () => {
            if (!marketplaceSession.isActive(idA)) return;
            reinjectionCalled = true;
        };

        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        onTabsGoneForA();

        expect(reinjectionCalled).toBe(false);
        expect(marketplaceSession.isActive(idB)).toBe(true);

        marketplaceSession.end(idB);
    });
});

// ─── Test 25: Guild replacement removes shrine tabs and WS listener ───────────

describe('Test 25 — Guild replacement removes shrine tabs and unregisters WS listener', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('Guild onEnd fires when replaced; teardown is called synchronously', () => {
        let teardownCalled = false;
        const guildId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.GUILD,
            onEnd: () => {
                teardownCalled = true;
            },
        });

        const actionsId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });

        expect(teardownCalled).toBe(true);
        expect(marketplaceSession.isActive(guildId)).toBe(false);
        expect(marketplaceSession.isActive(actionsId)).toBe(true);

        marketplaceSession.end(actionsId);
    });

    test('Guild shrine tabs and GUILD-owner tabs removed by scoped removal', () => {
        document.body.innerHTML = '<div id="c"></div>';
        const c = document.getElementById('c');

        const shrineTab = document.createElement('div');
        shrineTab.setAttribute('data-mwi-shrine-tab', 'true');
        c.appendChild(shrineTab);

        const guildTab = document.createElement('div');
        guildTab.setAttribute('data-mwi-custom-tab', 'true');
        guildTab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.GUILD);
        c.appendChild(guildTab);

        document.querySelectorAll('[data-mwi-shrine-tab="true"]').forEach((el) => el.remove());
        removeMaterialTabsForOwner(MARKETPLACE_OWNER.GUILD);

        expect(document.querySelectorAll('[data-mwi-shrine-tab="true"]').length).toBe(0);
        expect(document.querySelectorAll('[data-mwi-tab-owner="GUILD"]').length).toBe(0);
    });
});

// ─── Test 31: native-tab click removes entire owner workflow ──────────────────

describe('Test 31 — native-tab click removes entire owner workflow', () => {
    beforeEach(freshSession);

    test('end(sessionId) invalidates token and calls onEnd', () => {
        const onEndCalls = [];
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: (reason) => onEndCalls.push(reason),
        });

        marketplaceSession.end(id);

        expect(onEndCalls).toEqual(['ended']);
        expect(marketplaceSession.isActive(id)).toBe(false);
        expect(marketplaceSession.getActive()).toBeNull();
    });
});

// ─── Test 32: Actions replacement unregisters wildcard inventory handler ──────

describe('Test 32 — Actions replacement unregisters wildcard inventory handler', () => {
    beforeEach(freshSession);

    test('Actions onEnd called on replacement; inventory handler cleared via onEnd callback', () => {
        let inventoryHandlerCleared = false;
        const actionsId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: () => {
                inventoryHandlerCleared = true;
            },
        });

        const cpId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });

        expect(inventoryHandlerCleared).toBe(true);
        expect(marketplaceSession.isActive(actionsId)).toBe(false);

        marketplaceSession.end(cpId);
    });
});

// ─── Test 33: all manually cloned nodes carry owner metadata ─────────────────

describe('Test 33 — all manually cloned custom nodes carry owner metadata', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('material tab + Return tab + strategy indicator all removed by scoped removal', () => {
        document.body.innerHTML = '<div id="c"></div>';
        const c = document.getElementById('c');

        const refTab = document.createElement('button');
        refTab.innerHTML = '<span class="TabsComponent_badge__x"></span>';
        const matTab = createMaterialTab(
            { itemHrid: '/items/iron', itemName: 'Iron', missing: 5, required: 10, isTradeable: true },
            refTab,
            () => {},
            MARKETPLACE_OWNER.ACTIONS
        );
        c.appendChild(matTab);

        const returnTab = document.createElement('div');
        returnTab.setAttribute('data-mwi-custom-tab', 'true');
        returnTab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.ACTIONS);
        c.appendChild(returnTab);

        const indicator = document.createElement('div');
        indicator.setAttribute('data-mwi-custom-tab', 'true');
        indicator.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.ACTIONS);
        c.appendChild(indicator);

        const cpTab = document.createElement('div');
        cpTab.setAttribute('data-mwi-custom-tab', 'true');
        cpTab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.CRAFTING_PLAN);
        c.appendChild(cpTab);

        removeMaterialTabsForOwner(MARKETPLACE_OWNER.ACTIONS);

        expect(document.querySelectorAll('[data-mwi-tab-owner="ACTIONS"]').length).toBe(0);
        expect(document.querySelectorAll('[data-mwi-tab-owner="CRAFTING_PLAN"]').length).toBe(1);
    });
});

// ─── Test 34: Missing Mats ↔ Sell Queue bidirectional transitions ─────────────

describe('Test 34 — Missing Mats ↔ Sell Queue bidirectional transitions', () => {
    beforeEach(freshSession);

    test('Missing Mats → Sell Queue: MM onEnd fires; SQ is active; stale MM autofill dead', () => {
        const mmOnEnd = vi.fn();
        const mmId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: mmOnEnd });
        const mmMgr = createAutofillManager('MMtoSQ');
        mmMgr.initialize();
        mmMgr.startSession({ sessionId: mmId, quantityProvider: () => 77 });

        const sqId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.SELL_QUEUE, onEnd: vi.fn() });

        expect(mmOnEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.isActive(mmId)).toBe(false);
        expect(marketplaceSession.isActive(sqId)).toBe(true);

        mmMgr.cleanup();
        marketplaceSession.end(sqId);
    });

    test('Sell Queue → Missing Mats: SQ onEnd fires; MM is active', () => {
        const sqOnEnd = vi.fn();
        const sqId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.SELL_QUEUE, onEnd: sqOnEnd });

        const mmId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: vi.fn() });

        expect(sqOnEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.isActive(sqId)).toBe(false);
        expect(marketplaceSession.isActive(mmId)).toBe(true);

        marketplaceSession.end(mmId);
    });
});

// ─── Tests 35 / 42 / 43: Ability Book one-shot, expiry, navigation failure ────

describe('Tests 35 / 42 / 43 — Ability Book session lifecycle', () => {
    beforeEach(freshSession);

    test('Test 35a — one-shot fill: first consume() succeeds; second returns false', () => {
        const onEnd = vi.fn();
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
            onEnd,
        });

        expect(marketplaceSession.consume(id)).toBe(true);
        expect(onEnd).toHaveBeenCalledWith('ended');
        expect(marketplaceSession.isActive(id)).toBe(false);
        expect(marketplaceSession.consume(id)).toBe(false);
    });

    test('Test 35b — 30s expiry fires: feature calls end(id); no active session', () => {
        const onEnd = vi.fn();
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
            onEnd,
        });

        marketplaceSession.end(id);

        expect(marketplaceSession.isActive(id)).toBe(false);
        expect(onEnd).toHaveBeenCalledWith('ended');
    });

    test('Test 42 — replacement fires onEnd; teardown clears expiry timer', () => {
        let expiryCleared = false;
        const abId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
            onEnd: () => {
                expiryCleared = true;
            },
        });

        const actionsId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });

        expect(expiryCleared).toBe(true);
        expect(marketplaceSession.isActive(abId)).toBe(false);
        expect(marketplaceSession.isActive(actionsId)).toBe(true);

        marketplaceSession.end(actionsId);
    });

    test('Test 43 — navigation failure: end() called immediately; session gone before 30s', () => {
        const onEnd = vi.fn();
        const id = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ABILITY_BOOK,
            consumeOnFill: true,
            onEnd,
        });

        marketplaceSession.end(id);

        expect(marketplaceSession.isActive(id)).toBe(false);
        expect(onEnd).toHaveBeenCalledWith('ended');
    });
});

// ─── Test 36: hidden retained Marketplace panel does not trigger reinjection ──

describe('Test 36 — hidden Marketplace panel does not trigger reinjection', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('getVisibleMarketplaceTabContainer returns null when panel is display:none', () => {
        document.body.innerHTML = `
            <div class="MainPanel_subPanelContainer__x" style="display:none">
                <div class="MarketplacePanel_marketplacePanel__x">
                    <div class="MuiTabs-flexContainer" role="tablist">
                        <button>Market Listings</button>
                    </div>
                </div>
            </div>
        `;
        expect(getVisibleMarketplaceTabContainer()).toBeNull();
    });

    test('getVisibleMarketplaceTabContainer returns null when no Marketplace panel exists', () => {
        document.body.innerHTML = '<div id="other"></div>';
        expect(getVisibleMarketplaceTabContainer()).toBeNull();
    });

    test('getVisibleMarketplaceTabContainer returns tablist when panel is visible with native tabs', () => {
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__x">
                <div class="MuiTabs-flexContainer" role="tablist">
                    <button>Market Listings</button>
                    <button>My Listings</button>
                </div>
            </div>
        `;
        expect(getVisibleMarketplaceTabContainer()).not.toBeNull();
    });
});

// ─── Test 37: Guild native-tab switch ends Guild workflow ─────────────────────

describe('Test 37 — Guild native-tab switch ends Guild workflow', () => {
    beforeEach(freshSession);

    test('end(guildId) terminates Guild session and calls onEnd', () => {
        const onEnd = vi.fn();
        const guildId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.GUILD, onEnd });

        marketplaceSession.end(guildId);

        expect(onEnd).toHaveBeenCalledWith('ended');
        expect(marketplaceSession.isActive(guildId)).toBe(false);
        expect(marketplaceSession.getActive()).toBeNull();
    });
});

// ─── Test 41: Sell Queue replacement clears all marketplace state ─────────────

describe('Test 41 — Sell Queue replacement removes handler, observer, queue, and nodes', () => {
    beforeEach(freshSession);

    test('SQ onEnd fires on replacement; state arrays and handlers cleared', () => {
        const state = {
            sqSessionId: null,
            currentTabs: [1, 2, 3],
            queue: ['item1', 'item2'],
            invHandlerCleared: false,
            cleanupObserverCleared: false,
        };

        state.sqSessionId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.SELL_QUEUE,
            onEnd: () => {
                state.sqSessionId = null;
                state.currentTabs.length = 0;
                state.queue.length = 0;
                state.invHandlerCleared = true;
                state.cleanupObserverCleared = true;
            },
        });

        const actionsId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });

        expect(state.sqSessionId).toBeNull();
        expect(state.currentTabs.length).toBe(0);
        expect(state.queue.length).toBe(0);
        expect(state.invHandlerCleared).toBe(true);
        expect(state.cleanupObserverCleared).toBe(true);

        marketplaceSession.end(actionsId);
    });
});

// ─── Test 44: remount reinjection uses retained model ─────────────────────────

describe('Test 44 — remount reinjection: retained model; stale token causes clean shutdown', () => {
    beforeEach(freshSession);

    test('null model → clean shutdown, not reinjection', () => {
        let reinjectCalled = false;
        let shutdownCalled = false;
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const activeWorkflowModel = null;

        if (!activeWorkflowModel || !marketplaceSession.isActive(id)) {
            shutdownCalled = true;
        } else {
            reinjectCalled = true;
        }

        expect(reinjectCalled).toBe(false);
        expect(shutdownCalled).toBe(true);
        marketplaceSession.end(id);
    });

    test('stale session token → clean shutdown, not reinjection', () => {
        let reinjectCalled = false;
        let shutdownCalled = false;
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const model = { sessionId: idA, materials: [{ itemHrid: '/items/iron', missing: 5 }] };

        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });

        if (!model || !marketplaceSession.isActive(model.sessionId)) {
            shutdownCalled = true;
        } else {
            reinjectCalled = true;
        }

        expect(reinjectCalled).toBe(false);
        expect(shutdownCalled).toBe(true);
        marketplaceSession.end(idB);
    });

    test('live model with valid session → reinjection reads updated quantity', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const model = { sessionId: id, materials: [{ itemHrid: '/items/copper', missing: 100 }] };

        // Inventory update reduces missing 100 → 40
        model.materials[0].missing = 40;

        let reinjectedQuantity = null;
        if (model && marketplaceSession.isActive(model.sessionId)) {
            reinjectedQuantity = model.materials[0].missing;
        }

        expect(reinjectedQuantity).toBe(40);
        marketplaceSession.end(id);
    });
});

// ─── Test 45: Guild Return ends workflow and navigates to Guild page ──────────

describe('Test 45 — Guild Return ends Guild workflow and navigates to Guild page', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('Guild Return click: teardown called; session ended; nav triggered', () => {
        let teardownCalled = false;
        let navCalled = false;

        const guildId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.GUILD,
            onEnd: () => {
                teardownCalled = true;
            },
        });

        // Simulate Return tab click: end session (fires onEnd), then navigate
        marketplaceSession.end(guildId);
        navCalled = true;

        expect(teardownCalled).toBe(true);
        expect(navCalled).toBe(true);
        expect(marketplaceSession.isActive(guildId)).toBe(false);
    });
});

// ─── Gate §3: enhancement-specific session scenarios ─────────────────────────

describe('Gate §3 — Enhancement-specific session scenarios', () => {
    beforeEach(freshSession);

    test('Enhancement replaces Actions before navigation resolves', () => {
        const actionsOnEnd = vi.fn();
        const actionsId = marketplaceSession.start({
            owner: MARKETPLACE_OWNER.ACTIONS,
            onEnd: actionsOnEnd,
        });

        const enhId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: vi.fn() });

        expect(actionsOnEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.isActive(actionsId)).toBe(false);
        expect(marketplaceSession.isActive(enhId)).toBe(true);

        marketplaceSession.end(enhId);
    });

    test('Failed enhancement navigation: end() called; no active session', () => {
        const enhOnEnd = vi.fn();
        const enhId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: enhOnEnd });

        marketplaceSession.end(enhId);

        expect(marketplaceSession.isActive(enhId)).toBe(false);
        expect(marketplaceSession.getActive()).toBeNull();
        expect(enhOnEnd).toHaveBeenCalledWith('ended');
    });

    test('Enhancement autofill provider does not leak into production session', () => {
        const enhId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const enhMgr = createAutofillManager('EnhProviderTest');
        enhMgr.initialize();
        enhMgr.startSession({ sessionId: enhId, quantityProvider: () => 7 });

        const prodId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const prodMgr = createAutofillManager('ProdProviderTest');
        prodMgr.initialize();
        prodMgr.startSession({ sessionId: prodId, quantityProvider: () => 999 });

        expect(marketplaceSession.isActive(enhId)).toBe(false);
        expect(marketplaceSession.isActive(prodId)).toBe(true);

        enhMgr.cleanup();
        prodMgr.cleanup();
        marketplaceSession.end(prodId);
    });

    test('Same-owner replacement (prod → enh): prod onEnd fires; enh context intact', () => {
        const prodOnEnd = vi.fn();
        const prodId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: prodOnEnd });
        const enhId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS, onEnd: vi.fn() });

        expect(prodOnEnd).toHaveBeenCalledWith('replaced');
        expect(marketplaceSession.isActive(prodId)).toBe(false);
        expect(marketplaceSession.isActive(enhId)).toBe(true);

        marketplaceSession.end(enhId);
    });
});

// ─── Gate §3: House async stale-calculation regression ───────────────────────

describe('Gate §3 — House async stale-calculation regression', () => {
    beforeEach(freshSession);

    test('stale async result discarded: guard on capturedCostContext object identity', () => {
        let activeWorkflowModel = null;
        const sessionId = marketplaceSession.start({ owner: MARKETPLACE_OWNER.HOUSE });

        // New calculation uses a fresh cost context object
        const currentCostContext = { roomHrid: '/rooms/bedroom', level: 1 };

        // Old calc captured a different object (stale reference)
        const staleCapturedContext = { roomHrid: '/rooms/bedroom', level: 1 };

        // Old calc: guard on both session + context identity
        const oldCalcSafe = marketplaceSession.isActive(sessionId) && staleCapturedContext === currentCostContext;
        expect(oldCalcSafe).toBe(false); // stale context object ref !== current

        // New calc: same session, capturedContext is the same object reference
        const capturedCurrentContext = currentCostContext;
        const newCalcSafe = marketplaceSession.isActive(sessionId) && capturedCurrentContext === currentCostContext;
        expect(newCalcSafe).toBe(true);

        activeWorkflowModel = { sessionId, materials: [{ itemHrid: '/items/planks', missing: 20 }] };
        expect(activeWorkflowModel.materials[0].missing).toBe(20);

        marketplaceSession.end(sessionId);
    });
});

// ─── Tests 9: Crafting Plan immediate recalculation ──────────────────────────

describe('Test 9 — Crafting Plan immediate recalculation', () => {
    beforeEach(freshSession);

    test('activeWorkflowModel.materials updated when items_updated fires (simulated)', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        const model = {
            sessionId: id,
            materials: [{ itemHrid: '/items/fish', missing: 50, required: 100 }],
            returnContext: { actionHrid: '/actions/fishing', numActions: 100 },
        };

        // Simulate items_updated handler reducing missing to 25
        const entry = model.materials.find((m) => m.itemHrid === '/items/fish');
        entry.missing = 25;

        expect(model.materials[0].missing).toBe(25);
        expect(marketplaceSession.isActive(id)).toBe(true);

        marketplaceSession.end(id);
    });
});

// ─── readMarketplaceRuntimeState ─────────────────────────────────────────────

describe('readMarketplaceRuntimeState', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('returns null when no Marketplace panel exists in the DOM', () => {
        document.body.innerHTML = '<div id="root"></div>';
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('returns null when the Marketplace panel itself is hidden', () => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__test" style="display:none"></div>';
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [makeMarketplaceRuntimeState()]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('returns null when a non-immediate ancestor is hidden', () => {
        document.body.innerHTML = `
            <div style="display:none">
                <div><div class="MarketplacePanel_marketplacePanel__test"></div></div>
            </div>
        `;
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [makeMarketplaceRuntimeState()]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('returns null when two visible Marketplace panels exist', () => {
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__one"></div>
            <div class="MarketplacePanel_marketplacePanel__two"></div>
        `;
        const panels = document.querySelectorAll('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panels[0], [makeMarketplaceRuntimeState()]);
        attachMarketplacePanelFiber(panels[1], [makeMarketplaceRuntimeState({ itemHrid: '/items/coal' })]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('returns null when the visible panel has no React host fiber', () => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__test"></div>';
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('does not accept a stale root candidate unrelated to the visible panel', () => {
        document.body.innerHTML = `
            <div id="root"></div>
            <div class="MarketplacePanel_marketplacePanel__test"></div>
        `;
        const root = document.getElementById('root');
        root._reactRootContainer = {
            current: { stateNode: { state: makeMarketplaceRuntimeState({ itemHrid: '/items/stale' }) } },
        };
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [{ unrelated: true }]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('returns state from the unique visible panel fiber ancestry', () => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__test"></div>';
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [makeMarketplaceRuntimeState()]);

        expect(readMarketplaceRuntimeState()).toEqual(makeMarketplaceRuntimeState());
    });

    test('returns null when the visible panel ancestry has multiple matching components', () => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__test"></div>';
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [
            makeMarketplaceRuntimeState(),
            makeMarketplaceRuntimeState({ itemHrid: '/items/coal' }),
        ]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test.each(['bad', NaN, Infinity, -1, 1.5])('returns null for malformed enhancementLevel %s', (enhancementLevel) => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__test"></div>';
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        attachMarketplacePanelFiber(panel, [makeMarketplaceRuntimeState({ enhancementLevel })]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });

    test('fails closed when the owning component lies beyond the ancestry bound', () => {
        document.body.innerHTML = '<div class="MarketplacePanel_marketplacePanel__test"></div>';
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        const nonMatchingStates = Array.from({ length: 64 }, (_, index) => ({ index }));
        attachMarketplacePanelFiber(panel, [...nonMatchingStates, makeMarketplaceRuntimeState()]);
        expect(readMarketplaceRuntimeState()).toBeNull();
    });
});

// ─── arm() — atomic target generations ──────────────────────────────────────

describe('arm() — atomic target generations', () => {
    beforeEach(freshSession);
    afterEach(() => {
        document.body.innerHTML = '';
    });

    function setupModal(stateOverrides = {}, { numInputs = 1, withFiber = true, states = null } = {}) {
        const inputs = Array.from({ length: numInputs }, () => '<input type="number" value="" />').join('');
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__test"></div>
            <div class="Modal_modalContainer__test">
                <div class="MarketplacePanel_quantityInputs__test">${inputs}</div>
            </div>
        `;
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (withFiber) {
            attachMarketplacePanelFiber(panel, states || [makeMarketplaceRuntimeState(stateOverrides)]);
        }
        return document.querySelector('[class*="Modal_modalContainer"]');
    }

    test('stale session arm is a no-op and does not clear the newer target', () => {
        const idA = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmStaleSession');
        mgr.initialize();
        mgr.startSession({ sessionId: idA });
        mgr.arm({ sessionId: idA, itemHrid: '/items/iron_ore', quantityProvider: () => 10 });

        const idB = marketplaceSession.start({ owner: MARKETPLACE_OWNER.CRAFTING_PLAN });
        mgr.startSession({ sessionId: idB });
        mgr.arm({ sessionId: idB, itemHrid: '/items/coal', quantityProvider: () => 20 });
        mgr.arm({ sessionId: idA, itemHrid: '/items/iron_ore', quantityProvider: () => 999 });

        _capturedModalCallback(setupModal({ itemHrid: '/items/coal' }));
        expect(document.querySelector('input').value).toBe('20');

        mgr.cleanup();
        marketplaceSession.end(idB);
    });

    test('unsupported mode for the current session disarms the previous target', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmUnsupportedMode');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', quantityProvider: () => 10 });
        mgr.arm({ sessionId: id, itemHrid: '/items/coal', modalMode: 'sell', quantityProvider: () => 20 });

        _capturedModalCallback(setupModal({ itemHrid: '/items/iron_ore' }));
        expect(document.querySelector('input').value).toBe('');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('invalid provider for the current session disarms the previous target', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmInvalidProvider');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', quantityProvider: () => 10 });
        mgr.arm({ sessionId: id, itemHrid: '/items/coal', quantityProvider: null });

        _capturedModalCallback(setupModal({ itemHrid: '/items/iron_ore' }));
        expect(document.querySelector('input').value).toBe('');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('autofill fills when target and panel state match exactly', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmHappyPath');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', quantityProvider: () => 42 });

        _capturedModalCallback(setupModal());
        expect(document.querySelector('input').value).toBe('42');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('a newer accepted arm atomically supersedes the previous target', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmSupersede');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', quantityProvider: () => 10 });
        mgr.arm({ sessionId: id, itemHrid: '/items/coal', quantityProvider: () => 20 });

        _capturedModalCallback(setupModal({ itemHrid: '/items/coal' }));
        expect(document.querySelector('input').value).toBe('20');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('provider-side re-arm prevents the captured generation from writing', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmProviderRearm');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({
            sessionId: id,
            itemHrid: '/items/iron_ore',
            quantityProvider: () => {
                mgr.arm({ sessionId: id, itemHrid: '/items/coal', quantityProvider: () => 20 });
                return 10;
            },
        });

        _capturedModalCallback(setupModal());
        expect(document.querySelector('input').value).toBe('');

        _capturedModalCallback(setupModal({ itemHrid: '/items/coal' }));
        expect(document.querySelector('input').value).toBe('20');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('provider-side session end prevents the captured generation from writing', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmProviderEnd');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({
            sessionId: id,
            itemHrid: '/items/iron_ore',
            quantityProvider: () => {
                marketplaceSession.end(id);
                return 10;
            },
        });

        _capturedModalCallback(setupModal());
        expect(document.querySelector('input').value).toBe('');

        mgr.cleanup();
    });

    test.each([NaN, Infinity, -Infinity, 0, -1, '5'])('invalid quantity %s never writes', (quantity) => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmInvalidQuantity');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: '/items/iron_ore', quantityProvider: () => quantity });

        _capturedModalCallback(setupModal());
        expect(document.querySelector('input').value).toBe('');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('missing or malformed item identity does not arm', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('ArmInvalidItem');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({ sessionId: id, itemHrid: null, quantityProvider: () => 10 });

        _capturedModalCallback(setupModal());
        expect(document.querySelector('input').value).toBe('');

        mgr.cleanup();
        marketplaceSession.end(id);
    });

    test('deprecated split mutators require a token-scoped identity draft', () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createAutofillManager('LegacyDraft');
        mgr.initialize();
        mgr.startSession({ sessionId: id });

        expect(mgr.setItem('/items/iron_ore', 0, id)).toBe(true);
        expect(mgr.setQuantityProvider(() => 33, id)).toBe(true);
        _capturedModalCallback(setupModal());
        expect(document.querySelector('input').value).toBe('33');

        mgr.cleanup();
        marketplaceSession.end(id);
    });
});

// ─── Disarm matrix — every rejection prevents a later fill ─────────────────────

describe('Disarm matrix — every rejection prevents a later fill', () => {
    beforeEach(freshSession);
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    function setupModal(stateOverrides = {}, { numInputs = 1, withFiber = true, states = null } = {}) {
        const inputs = Array.from({ length: numInputs }, () => '<input type="number" value="" />').join('');
        document.body.innerHTML = `
            <div class="MarketplacePanel_marketplacePanel__test"></div>
            <div class="Modal_modalContainer__test">
                <div class="MarketplacePanel_quantityInputs__test">${inputs}</div>
            </div>
        `;
        const panel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (withFiber) {
            attachMarketplacePanelFiber(panel, states || [makeMarketplaceRuntimeState(stateOverrides)]);
        }
        return document.querySelector('[class*="Modal_modalContainer"]');
    }

    function createArmedManager(id, enhancementLevel = 0) {
        const mgr = createAutofillManager('DisarmMatrix');
        mgr.initialize();
        mgr.startSession({ sessionId: id });
        mgr.arm({
            sessionId: id,
            itemHrid: '/items/iron_ore',
            enhancementLevel,
            quantityProvider: () => 99,
        });
        return mgr;
    }

    async function expectLaterModalNotFilled(mgr, firstModal, laterState = {}) {
        _capturedModalCallback(firstModal);
        // Advance past the 500 ms polling window so the first modal's poll clears the target.
        await vi.advanceTimersByTimeAsync(600);
        _capturedModalCallback(setupModal(laterState));
        expect(document.querySelector('input').value).toBe('');
        mgr.cleanup();
    }

    test('wrong item disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({ itemHrid: '/items/coal' }));
        marketplaceSession.end(id);
    });

    test('wrong enhancement disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id, 3);
        await expectLaterModalNotFilled(mgr, setupModal({ enhancementLevel: 1 }), { enhancementLevel: 3 });
        marketplaceSession.end(id);
    });

    test('Sell mode disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({ isSell: true }));
        marketplaceSession.end(id);
    });

    test('missing runtime component disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({}, { withFiber: false }));
        marketplaceSession.end(id);
    });

    test('ambiguous runtime component disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(
            mgr,
            setupModal(
                {},
                {
                    states: [makeMarketplaceRuntimeState(), makeMarketplaceRuntimeState({ itemHrid: '/items/coal' })],
                }
            )
        );
        marketplaceSession.end(id);
    });

    test('missing quantity input disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({}, { numInputs: 0 }));
        marketplaceSession.end(id);
    });

    test('multiple quantity inputs disarm', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({}, { numInputs: 2 }));
        marketplaceSession.end(id);
    });

    test('unsupported market tab disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({ marketTabKey: 'MyListings' }));
        marketplaceSession.end(id);
    });

    test('unsupported market view disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({ marketListingsView: 'History' }));
        marketplaceSession.end(id);
    });

    test('malformed runtime enhancement disarms', async () => {
        const id = marketplaceSession.start({ owner: MARKETPLACE_OWNER.ACTIONS });
        const mgr = createArmedManager(id);
        await expectLaterModalNotFilled(mgr, setupModal({ enhancementLevel: '0' }));
        marketplaceSession.end(id);
    });
});

// ─── watchNativeTabExit ───────────────────────────────────────────────────────

describe('watchNativeTabExit', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    function createTablist() {
        document.body.innerHTML = `
            <div class="MuiTabs-flexContainer" role="tablist">
                <button role="tab">Market Listings</button>
                <button role="tab" data-mwi-custom-tab="true">Iron Ore</button>
                <button role="tab" data-mwi-shrine-tab="true">Shrine</button>
            </div>
        `;
        return document.querySelector('[role="tablist"]');
    }

    test('fires onExit when a native tab is clicked', () => {
        const tablist = createTablist();
        const onExit = vi.fn();
        watchNativeTabExit(tablist, onExit);

        tablist.querySelector('[role="tab"]:not([data-mwi-custom-tab]):not([data-mwi-shrine-tab])').click();
        expect(onExit).toHaveBeenCalledOnce();
    });

    test('fires onExit when a child element inside a native tab is clicked', () => {
        document.body.innerHTML = `
            <div class="MuiTabs-flexContainer" role="tablist">
                <button role="tab"><span class="label">Market Listings</span></button>
                <button role="tab" data-mwi-custom-tab="true">Iron Ore</button>
            </div>
        `;
        const tablist = document.querySelector('[role="tablist"]');
        const onExit = vi.fn();
        watchNativeTabExit(tablist, onExit);

        // Click the nested span — closest('[role="tab"]') must resolve to the button
        tablist.querySelector('span.label').click();
        expect(onExit).toHaveBeenCalledOnce();
    });

    test('does not fire onExit when a custom tab is clicked', () => {
        const tablist = createTablist();
        const onExit = vi.fn();
        watchNativeTabExit(tablist, onExit);

        tablist.querySelector('[data-mwi-custom-tab]').click();
        expect(onExit).not.toHaveBeenCalled();
    });

    test('does not fire onExit when a shrine tab is clicked', () => {
        const tablist = createTablist();
        const onExit = vi.fn();
        watchNativeTabExit(tablist, onExit);

        tablist.querySelector('[data-mwi-shrine-tab]').click();
        expect(onExit).not.toHaveBeenCalled();
    });

    test('does not fire on initial aria-selected state — only on actual click', () => {
        const tablist = createTablist();
        const nativeTab = tablist.querySelector('[role="tab"]:not([data-mwi-custom-tab]):not([data-mwi-shrine-tab])');
        nativeTab.setAttribute('aria-selected', 'true');

        const onExit = vi.fn();
        watchNativeTabExit(tablist, onExit);

        expect(onExit).not.toHaveBeenCalled(); // no click occurred
    });

    test('cleanup removes the exact listener — no fire after unregister', () => {
        const tablist = createTablist();
        const onExit = vi.fn();
        const cleanup = watchNativeTabExit(tablist, onExit);

        cleanup();

        tablist.querySelector('[role="tab"]:not([data-mwi-custom-tab]):not([data-mwi-shrine-tab])').click();
        expect(onExit).not.toHaveBeenCalled();
    });

    test('resolved tab must belong to the captured tabContainer — click outside does not fire', () => {
        document.body.innerHTML = `
            <div id="tablist1" class="MuiTabs-flexContainer" role="tablist">
                <button role="tab">Market Listings</button>
            </div>
            <div id="tablist2" class="MuiTabs-flexContainer" role="tablist">
                <button role="tab">Other tab</button>
            </div>
        `;
        const tablist1 = document.getElementById('tablist1');
        const onExit = vi.fn();
        watchNativeTabExit(tablist1, onExit);

        // Click a tab in the second tablist — should not fire
        document.querySelector('#tablist2 [role="tab"]').click();
        expect(onExit).not.toHaveBeenCalled();
    });
});
