# Codebase Remediation Roadmap

## Purpose

Provide a long-term, trackable plan to remediate cross-cutting codebase patterns (lifecycle, observers, timers, storage, and module size) without regressing features.

## Scope

**In scope**

- Feature lifecycle consistency (initialize/disable/cleanup)
- Event listener, observer, and timer cleanup hygiene
- DOM mutation handling standardization (dom-observer)
- Storage access consistency (avoid direct localStorage)
- Refactoring oversized feature modules into core/ui/controller layers

**Out of scope (for now)**

- New feature work
- UI redesigns unrelated to remediation
- API-level changes to the game or external services

## Principles

- **Behavioral stability**: no visible feature changes unless required for correctness
- **Incremental and verifiable**: small steps with verification after each batch
- **Single source of truth**: shared utilities for common patterns
- **Reversible**: changes should be isolated and easy to rollback

## Baseline Findings (Summary)

- Multiple feature-local MutationObservers across the codebase
- Inconsistent cleanup patterns for listeners, observers, and intervals
- Direct localStorage usage in features (anti-pattern per AGENTS.md)
- Oversized feature modules that mix UI, logic, and lifecycle

## Phased Plan

### Phase 0 — Audit & Planning (Foundational)

**Objective**: Create visibility and an execution plan.

- Build a feature compliance matrix (lifecycle, observers, timers, storage)
- Define the lifecycle contract and cleanup registry standard
- Seed task tracker for remediation batches

### Phase 1 — Lifecycle & Cleanup Foundation

**Objective**: Establish safe teardown and consistent feature lifecycle.

- Introduce cleanup registry utility
- Standardize `initialize()`/`disable()`/`cleanup()` patterns
- Apply to 1–2 pilot features

### Phase 2 — DOM Mutation Standardization

**Objective**: Reduce feature-local observers and batch DOM updates.

- Migrate selected features to `dom-observer`
- Add throttled UI update helpers where needed

**Progress**

- Migrated listing-price-display to scheduled refresh (no MutationObserver)
- Standardized settings-ui, house-panel-observer, and action-time-display on mutation watcher helper
- Migrated action panel observer, task-icon-filters, and profile export button to domObserver helpers
- Added disable hooks and observer cleanup for missing-materials and required-materials
- Added disable hook for task reroll tracker
- Migrated combat score, enhancement display, and house cost display cleanup observers
- Migrated remaining-xp and inventory-sort timers to timer registry
- Migrated dungeon tracker UI/chat observers and timers to registries
- Migrated alchemy profit, inventory badge prices, enhancement UI, and combat sim timers
- Standardized task module timers (reroll, profit, icons, sorter)
- Standardized market history + auto-fill timers and task sorter lifecycle
- Closed lifecycle gaps for expected value calculator and dungeon token tooltips
- Standardized empty queue notification timer cleanup
- Replaced remaining raw input observers with mutation watcher
- Standardized dungeon tracker UI interaction timers, combat summary retries, and profile panel waits
- Standardized action panel debounced timers (profit, sort, enhancements)
- Standardized networth polling via timer registry
- Standardized remaining profile/market/task timers via registry
- Verified lifecycle cleanup for dungeon tracker, combat score, and action panel observer
- Added lifecycle disable hook and cleanup registry usage to house panel observer
- Added drag listener cleanup to enhancement tracker UI
- Added disable cleanup for combat sim integration and verified house cost display storage usage
- Hardened core retry timers (data-manager/websocket) and reinit fallback tracking; added storage pending-write cleanup

### Phase 3 — Storage Consistency

**Objective**: Remove direct localStorage usage in features.

- Replace feature-local localStorage with storage module
- Document any required core-level exceptions

**Notes**

- Core exceptions documented for data-manager and websocket init fallbacks

### Phase 4 — Module Decomposition

**Objective**: Improve maintainability and testability.

- Split large features into `core` (pure logic), `ui` (rendering), `controller` (lifecycle)
- Extract pure helpers to `utils/` with tests

### Phase 5 — Verification & Documentation

**Objective**: Lock in changes and reduce regression risk.

- Run tests/lint/build for each batch
- Update living-notes with resolved debt and new insights
- Record any major decisions in decisions-log

## Success Metrics

- 100% of features have deterministic cleanup
- Zero feature-local MutationObservers (except documented exceptions)
- Zero direct localStorage usage in features
- Oversized features reduced to < 400 LOC per module

## Tracking & Reporting

- Execution tracked in `.tmp/tasks/codebase-remediation/`
- Use `task-cli.ts status`, `next`, and `validate` to manage progress
- Update `living-notes.md` and `decisions-log.md` after each phase

## Risks & Mitigations

- **Risk**: Feature regression during refactor
    - **Mitigation**: Pilot-first, scoped changes, test after each batch
- **Risk**: Long-running changes lose momentum
    - **Mitigation**: Task tracker + phase milestones

## References

- `docs/ARCHITECTURE.md`
- `AGENTS.md`
- `.tmp/tasks/codebase-remediation/`
