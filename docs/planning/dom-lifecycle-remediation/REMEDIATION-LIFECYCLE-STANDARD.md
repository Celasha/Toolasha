# Remediation Lifecycle & Cleanup Standard

**Status**: Draft (applies to remediation work)

This standard defines how features must manage lifecycle, listeners, observers, and timers to ensure deterministic teardown and safe re-initialization.

## Goals

- Ensure every feature can be cleanly disabled/re-enabled (including character switch).
- Prevent memory leaks from event listeners, MutationObservers, and intervals.
- Standardize cleanup patterns for consistency and easier audits.

## Required Lifecycle Contract

Every feature must expose:

```js
initialize: async () => { /* setup */ },
disable: () => { /* teardown */ },
```

Optional:

```js
cleanup: () => { /* internal teardown */ },
```

**Rules**:

1. `initialize()` must be idempotent or guard against duplicate setup.
2. `disable()` must remove ALL listeners, observers, timers, and injected DOM.
3. If `cleanup()` exists, `disable()` must call it.
4. `disable()` must be safe to call even if `initialize()` failed partially.

## Cleanup Registry Standard

All features must register teardown operations using a shared cleanup registry utility.

### Required cleanup categories

- **Event listeners** (`addEventListener`)
- **MutationObservers** (feature-local observers only while migrating)
- **Intervals/Timeouts** (`setInterval`, long-lived `setTimeout` loops)
- **Injected DOM references**

### Required API (cleanup registry)

```js
const registry = createCleanupRegistry();

registry.registerListener(target, event, handler, options);
registry.registerObserver(observer);
registry.registerInterval(intervalId);
registry.registerTimeout(timeoutId);
registry.registerCleanup(() => {
    /* custom teardown */
});

registry.cleanupAll();
```

**Rule**: `disable()` must call `registry.cleanupAll()` once and nullify references.

## DOM Mutation Standard

**Preferred**: `dom-observer` utility for observing DOM changes.  
**Temporary exception**: feature-local `MutationObserver` allowed only if it is registered with cleanup registry.

**Rule**: If a feature uses MutationObserver, it must be registered with cleanup registry and documented for future migration.

## Timer Standard

Intervals or long-running timers must:

- be registered in cleanup registry
- be cleared during disable
- avoid silent infinite polling without guard

## Storage Standard

- **No direct `localStorage` access in features**.
- Use `storage` module for persistence.
- Core fallback logic (e.g., for game state) must be documented as an exception.

## Logging & Error Handling

- Use try/catch around async operations.
- Prefix logs with feature name.
- Fail gracefully when cleanup encounters errors.

## Acceptance Checklist

Feature is compliant when:

- [ ] `initialize()` and `disable()` exist
- [ ] `disable()` removes all listeners/observers/timers
- [ ] `cleanup registry` is used consistently
- [ ] No direct `localStorage` use
- [ ] DOM observers are centralized or flagged for migration

## References

- [Remediation Roadmap](REMEDIATION-ROADMAP.md)
- [Compliance Matrix](REMEDIATION-COMPLIANCE-MATRIX.md)
- [Developer Guide](../../AGENTS.md)
