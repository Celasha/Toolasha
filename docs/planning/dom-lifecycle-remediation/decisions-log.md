# Decisions Log (Local Copy)

## Decision: Standardize cleanup and timer registries for feature teardown

**Date**: 2026-02-01
**Status**: Decided
**Owner**: Team

### Context

Feature modules used inconsistent cleanup patterns for listeners, MutationObservers, and polling intervals, which increases the risk of memory leaks and duplicate handlers on re-initialization.

### Decision

Adopt shared cleanup and timer registries as the standard mechanism for feature teardown, and migrate features incrementally starting with high-churn modules.

### Rationale

Centralized registries make teardown deterministic, reduce regression risk during refactors, and simplify auditing across the feature set.

### Alternatives Considered

| Alternative                       | Pros               | Cons                            | Why Rejected?                        |
| --------------------------------- | ------------------ | ------------------------------- | ------------------------------------ |
| Status quo (per-feature teardown) | No refactor effort | Ongoing leaks and inconsistency | Increases long-term maintenance cost |
| Feature-by-feature ad hoc fixes   | Incremental        | No standardized audit trail     | Hard to enforce at scale             |

### Impact

- **Positive**: Predictable cleanup, reduced memory leaks, easier audits
- **Negative**: Requires short-term refactor effort in features
- **Risk**: Missed migrations if feature owners do not follow the standard

### Related

- docs/planning/dom-lifecycle-remediation/REMEDIATION-ROADMAP.md
- docs/planning/dom-lifecycle-remediation/REMEDIATION-LIFECYCLE-STANDARD.md
- src/utils/cleanup-registry.js
- src/utils/timer-registry.js
