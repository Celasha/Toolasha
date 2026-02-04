# Living Notes (Local Copy)

> Local project notes for the remediation effort. Mirrors the structure of the global template.

## Technical Debt

| Item                                                                 | Impact                                           | Priority | Mitigation                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------ | -------- | ---------------------------------------------------------- |
| Feature lifecycle cleanup inconsistency (observers/timers/listeners) | Memory leaks, duplicate handlers, UI regressions | High     | Standardize cleanup registry + migrate features in batches |

## Open Questions

| Question | Stakeholders | Status | Next Action |
| -------- | ------------ | ------ | ----------- |

## Known Issues

| Issue | Severity | Workaround | Status |
| ----- | -------- | ---------- | ------ |

## Insights & Lessons Learned

### What Works Well

- Cleanup registry pattern reduces teardown complexity.
- Observer migrations are safer with mutation watcher helper.
- domObserver debouncing replaces polling and reduces churn.
- Adding disable hooks makes cleanup behavior predictable.
- Mutation watcher cleanup patterns are working well for modal lifecycles.
- Timer registry migration keeps polling centralized.
- Dungeon tracker cleanup now covers observers, timers, and visibility handler.
- Timer registry adoption reduces orphaned intervals in UI modules.
- Task module delays now use timer registry for cleanup safety.
- Market UI delays now use timer registry for cleanup safety.
- Lifecycle gaps are narrowing with new disable hooks.
- Notification timers now use registry cleanup.
- Core localStorage fallbacks documented as exceptions (init data load).
- Raw input observers have been replaced with mutation watcher helpers.
- Small UI retry timers now use timer registry.
- Action panel debounces now use timer registry cleanup.
- Networth polling now uses timer registry cleanup.
- Remaining profile/market/task timers now use registry cleanup.
- Verified dungeon tracker, combat score, and action panel observer cleanup lifecycle.
- House panel observer now has a disable hook and cleanup registry coverage.
- Enhancement tracker UI now cleans up drag listeners on teardown.
- Combat sim integration now exposes disable cleanup and timers are cleared.
- Core retry timers are now tracked and cleanable (data-manager/websocket), with storage pending-write cleanup added.
- Action time display now matches current actions by output/drop item name for header time stats.

### What Could Be Better

- Feature lifecycle consistency remains uneven; requires enforced standards.

## Active Projects

| Project                      | Goal                                                            | Owner | Timeline         |
| ---------------------------- | --------------------------------------------------------------- | ----- | ---------------- |
| Codebase Remediation Program | Standardize lifecycle cleanup, observers, timers, storage usage | Team  | Ongoing (phased) |
