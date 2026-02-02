# Remediation Compliance Matrix

**Status**: Baseline (static scan)

This matrix tracks feature compliance against remediation focus areas:

- Feature lifecycle cleanup
- MutationObserver usage
- setInterval usage
- direct localStorage usage

**Source**: Feature registry + static grep scan. Results require verification during remediation.

## References

- [Remediation Roadmap](REMEDIATION-ROADMAP.md)
- [Architecture Overview](../ARCHITECTURE.md)
- [Developer Guide](../../AGENTS.md)

## Legend

- **Lifecycle**: ✅ disable/cleanup present, ⚠️ cleanup only, ❌ not found
- **Observer**: ✅ uses MutationObserver
- **Timer**: ✅ uses setInterval
- **Storage**: ✅ uses localStorage
- **Flags**: LIFECYCLE, OBS, TIMER, LS

## Market Features

| Feature Key                    | Module                                                        | Lifecycle | Observer | Timer | Storage | Flags | Notes                                       |
| ------------------------------ | ------------------------------------------------------------- | --------- | -------- | ----- | ------- | ----- | ------------------------------------------- |
| tooltipPrices                  | `market/tooltip-prices.js`                                    | ✅        | —        | —     | —       | —     |                                             |
| expectedValueCalculator        | `market/expected-value-calculator.js`                         | ✅        | —        | —     | —       | —     | cleanup/disable added.                      |
| tooltipConsumables             | `market/tooltip-consumables.js`                               | ✅        | —        | —     | —       | —     |                                             |
| dungeonTokenTooltips           | `inventory/dungeon-token-tooltips.js`                         | ✅        | —        | —     | —       | —     | disable added for cleanup.                  |
| marketFilter                   | `market/market-filter.js`                                     | ✅        | —        | —     | —       | —     |                                             |
| fillMarketOrderPrice           | `market/auto-fill-price.js`                                   | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for price adjust delay. |
| market_visibleItemCount        | `market/item-count-display.js`                                | ✅        | —        | —     | —       | —     |                                             |
| market_showListingPrices       | `market/listing-price-display.js`                             | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for refresh checks.     |
| market_showEstimatedListingAge | `market/estimated-listing-age.js`                             | ✅        | —        | —     | —       | —     |                                             |
| market_showOrderTotals         | `market/market-order-totals.js`                               | ✅        | —        | —     | —       | —     |                                             |
| market_showHistoryViewer       | `market/market-history-viewer.js`                             | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for popup delay.        |
| market_tradeHistory            | `market/trade-history.js` + `market/trade-history-display.js` | ✅        | —        | —     | —       | —     | Composite feature.                          |

## Action Features

| Feature Key                    | Module                                | Lifecycle | Observer | Timer | Storage | Flags | Notes                                         |
| ------------------------------ | ------------------------------------- | --------- | -------- | ----- | ------- | ----- | --------------------------------------------- |
| actionPanelProfit              | `actions/panel-observer.js`           | ✅        | ✅       | ✅    | —       | OBS   | Verified cleanup via disablePanelObserver.    |
| actionTimeDisplay              | `actions/action-time-display.js`      | ✅        | ✅       | ✅    | —       | OBS   | Uses timer registry for panel retry.          |
| quickInputButtons              | `actions/quick-input-buttons.js`      | ✅        | ✅       | —     | —       | OBS   | Uses mutation watcher for input updates.      |
| actionPanel_outputTotals       | `actions/output-totals.js`            | ✅        | —        | —     | —       | —     | cleanup helper present.                       |
| actionPanel_maxProduceable     | `actions/max-produceable.js`          | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for profit debounce.      |
| actionPanel_gatheringStats     | `actions/gathering-stats.js`          | ✅        | —        | —     | —       | —     |                                               |
| requiredMaterials              | `actions/required-materials.js`       | ✅        | —        | —     | —       | —     | disable added for cleanup.                    |
| alchemy_profitDisplay          | `alchemy/alchemy-profit-display.js`   | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for polling and debounce. |
| actions_missingMaterialsButton | `actions/missing-materials-button.js` | ✅        | ✅       | ✅    | —       | OBS   | Uses timer registry for delays.               |

## Combat Features

| Feature Key           | Module                                              | Lifecycle | Observer | Timer | Storage | Flags | Notes                                       |
| --------------------- | --------------------------------------------------- | --------- | -------- | ----- | ------- | ----- | ------------------------------------------- |
| abilityBookCalculator | `abilities/ability-book-calculator.js`              | ✅        | —        | —     | —       | —     |                                             |
| zoneIndices           | `combat/zone-indices.js`                            | ✅        | —        | —     | —       | —     |                                             |
| combatScore           | `profile/combat-score.js`                           | ✅        | ✅       | ✅    | —       | OBS   | Verified cleanup via disable.               |
| characterCard         | `profile/character-card-button.js`                  | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for profile wait.       |
| dungeonTracker        | `combat/dungeon-tracker.js` + UI + chat annotations | ✅        | ✅       | ✅    | —       | OBS   | Cleanup verified (cleanup resets handlers). |
| combatSummary         | `combat/combat-summary.js`                          | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for retry.              |

## UI Features

| Feature Key               | Module                              | Lifecycle | Observer | Timer | Storage | Flags | Notes             |
| ------------------------- | ----------------------------------- | --------- | -------- | ----- | ------- | ----- | ----------------- |
| equipmentLevelDisplay     | `ui/equipment-level-display.js`     | ✅        | —        | —     | —       | —     | cleanup present.  |
| alchemyItemDimming        | `ui/alchemy-item-dimming.js`        | ✅        | —        | —     | —       | —     |                   |
| skillExperiencePercentage | `ui/skill-experience-percentage.js` | ✅        | —        | ✅    | —       | TIMER | Polling interval. |
| ui_externalLinks          | `ui/external-links.js`              | ✅        | —        | —     | —       | —     |                   |

## Task Features

| Feature Key       | Module                         | Lifecycle | Observer | Timer | Storage | Flags | Notes                               |
| ----------------- | ------------------------------ | --------- | -------- | ----- | ------- | ----- | ----------------------------------- |
| taskProfitDisplay | `tasks/task-profit-display.js` | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for DOM delays. |
| taskRerollTracker | `tasks/task-reroll-tracker.js` | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for DOM delays. |
| taskSorter        | `tasks/task-sorter.js`         | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for DOM delays. |
| taskIcons         | `tasks/task-icons.js`          | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for DOM delays. |

## Skills Features

| Feature Key      | Module                   | Lifecycle | Observer | Timer | Storage | Flags | Notes                            |
| ---------------- | ------------------------ | --------- | -------- | ----- | ------- | ----- | -------------------------------- |
| skillRemainingXP | `skills/remaining-xp.js` | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for updates. |

## House Features

| Feature Key      | Module                          | Lifecycle | Observer | Timer | Storage | Flags | Notes                                    |
| ---------------- | ------------------------------- | --------- | -------- | ----- | ------- | ----- | ---------------------------------------- |
| houseCostDisplay | `house/house-panel-observer.js` | ✅        | ✅       | —     | —       | OBS   | Uses cleanup registry with disable hook. |

## Economy Features

| Feature Key           | Module                                 | Lifecycle | Observer | Timer | Storage | Flags | Notes                            |
| --------------------- | -------------------------------------- | --------- | -------- | ----- | ------- | ----- | -------------------------------- |
| networth              | `networth/index.js`                    | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for polling. |
| inventoryBadgeManager | `inventory/inventory-badge-manager.js` | ✅        | —        | —     | —       | —     |                                  |
| inventorySort         | `inventory/inventory-sort.js`          | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for retries. |
| inventoryBadgePrices  | `inventory/inventory-badge-prices.js`  | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for retries. |

## Enhancement Features

| Feature Key        | Module                                      | Lifecycle | Observer | Timer | Storage | Flags | Notes                          |
| ------------------ | ------------------------------------------- | --------- | -------- | ----- | ------- | ----- | ------------------------------ |
| enhancementTracker | `enhancement/enhancement-feature.js` (+ UI) | ✅        | —        | ✅    | —       | TIMER | UI module uses timer registry. |

## Notification Features

| Feature Key       | Module                                      | Lifecycle | Observer | Timer | Storage | Flags | Notes                               |
| ----------------- | ------------------------------------------- | --------- | -------- | ----- | ------- | ----- | ----------------------------------- |
| notifiEmptyAction | `notifications/empty-queue-notification.js` | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for auto-close. |

## Dictionary Features

| Feature Key                   | Module                          | Lifecycle | Observer | Timer | Storage | Flags | Notes                                       |
| ----------------------------- | ------------------------------- | --------- | -------- | ----- | ------- | ----- | ------------------------------------------- |
| itemDictionary_transmuteRates | `dictionary/transmute-rates.js` | ✅        | —        | ✅    | —       | TIMER | Uses timer registry for injection debounce. |

## Supporting Modules (Non-Registry)

These modules are not directly registered as features but affect remediation scope.

| Module                             | Observer | Timer | Storage | Notes                                                                  |
| ---------------------------------- | -------- | ----- | ------- | ---------------------------------------------------------------------- |
| `settings/settings-ui.js`          | ✅       | —     | —       | IndexedDB storage; uses createMutationWatcher.                         |
| `tasks/task-icon-filters.js`       | ✅       | —     | ✅      | Uses storage module; localStorage only for one-time migration cleanup. |
| `combat/combat-sim-export.js`      | —        | —     | —       | Relies on dataManager fallback.                                        |
| `core/data-manager.js`             | —        | ✅    | ✅      | Core exception: uses localStorageUtil fallback; retry timers tracked.  |
| `core/websocket.js`                | —        | ✅    | ✅      | Core exception: retry timeout tracked with cleanup.                    |
| `core/storage.js`                  | —        | ✅    | —       | Debounced writes tracked; cleanupPendingWrites available.              |
| `combat/profile-export-button.js`  | —        | —     | —       | Uses domObserver (no polling/MutationObserver).                        |
| `actions/enhancement-display.js`   | ✅       | —     | —       | Uses mutation watcher for modal cleanup.                               |
| `house/house-cost-display.js`      | ✅       | —     | —       | Uses timer registry for modal delays (no localStorage).                |
| `enhancement/enhancement-ui.js`    | —        | ✅    | —       | Interval/polling with drag listener cleanup.                           |
| `combat/combat-sim-integration.js` | —        | ✅    | —       | Interval-based readiness check with disable cleanup.                   |

## Next Actions

1. Verify lifecycle compliance for items flagged **LIFECYCLE**.
2. Prioritize observer migration for **OBS** flagged features.
3. Replace localStorage usage in supporting modules.
4. Establish cleanup/timer registries and migrate pilot features.
