# Toolasha TLA-001 - Source Validation Report

## Scope

This report covers the source-level port and hardening of TLA-001 on the repository supplied as source commit `0cc3c87e` (local imported baseline HEAD `2ba8137e567d2ba5d97eb1774ef53b7e5b7afb13`).

The patch contains 33 changed/new JavaScript files: 4,714 insertions and 1,851 deletions. It ports the runtime-confirmed candidate 26.8.21 behavior and adds the post-runtime lifecycle and UX work.

## Runtime evidence already confirmed

The user confirmed on candidate 26.8.21:

- Production layout is correct with empty and entered quantities.
- Missing Mats Buy quantity autofill works.
- Enhancing launches on the first click while Target Level is focused.
- Enhancing Return restores the selected item and all relevant settings.
- Guild Return restores the correct shrine and displays the spaced level label.
- Earlier checks confirmed Production, Best Crafting Plan, House, Enhancing, and Guild marketplace transitions/Return.

## Source implementation included

- Central token-safe Marketplace ownership and cross-owner replacement.
- Exact Buy-modal identity verification against live React state before writing quantity.
- One centralized proven native input setter + bubbling `input` event.
- Persistent Missing Mats workflows and one-shot Ability Book workflow.
- Native-tab exits, overlay close, remount grace/reinjection, stale callback rejection, and failed-navigation cleanup.
- Live partial/full purchase updates and completed-tab disabling.
- Production, Best Crafting Plan, House, Enhancing, Guild, Sell Queue, and Ability Book integration.
- Production full-width tools block with deterministic non-overlapping order.
- Ask-only Cost Summary and removal of the pricing footer/divider.
- Local compact spacing for Level Progress, Best Crafting Plan, and Profitability.
- Alchemy XP/hr and expected Enhancing XP/hr with K/M display and full tooltip.
- Enhancement Markov fixes for +20 state sizing, Blessed target clamping/merging, input validation, success-rate clamping, and rebuild visits below the selected starting level.

## Additional issues found during the final audit and fixed

- House remount injection now rejects a stale/replaced House token at function entry.
- Material click handlers for Actions, Crafting Plan, House, Guild, and Sell Queue now reject captured stale tokens before navigation.
- Two Vitest files were missing named exports required by their mocked `marketplace-tabs` module; the mocks were corrected.
- The obsolete test claiming House Return was intentionally absent was replaced with a current stale-House-token fail-closed test.
- Alchemy inline XP/hr now self-heals when React replaces only the native Experience row while Toolasha sections remain mounted.
- Enhancing watches native Experience-row remounts and reattaches the inline expected XP/hr.
- Enhancing now removes stale calculator/inline output if item data becomes unavailable or rendering fails.

## Checks completed in this environment

- `node --check`: PASS for all 33 changed/new JavaScript files.
- `git diff --check`: PASS.
- Relative import audit: PASS for all 33 changed/new JavaScript files.
- Deprecated marketplace autofill production callers: zero.
- TLA-001 Marketplace quantity write path: exactly one centralized native setter path.
- Cost Summary Ask-only invariant and removed footer: PASS.
- XP/hr compact/full-tooltip source invariant: PASS.
- Temporary debug/TODO marker scan: PASS.
- Actual `marketplace-session.js` simulation: PASS for replacement, stale tokens, stale end isolation, persistent vs one-shot consume, and `endAll` teardown.
- Independent enhancement transition-matrix simulation: PASS for +20, Blessed target edge cases, clamped success, row sums, and invalid start rejection.

## Checks not completed locally

The supplied `node_modules` tree contains empty/invalid package directories and no executable Vitest, ESLint, Rollup, or Prettier binaries. Network installation is unavailable in this environment. Therefore these mandatory integrated gates remain for Claude Code:

```bash
npm ci
npm test
npm run lint
npm run build:dev
npm run build
```

These must not be treated as optional or inferred from the static checks.

## Required Claude Code response

Claude Code should return:

- confirmation that it read this report, the patch, and the source instructions;
- any code changes it made after review, with reasoning;
- complete test/lint/dev-build/production-build results;
- final commit hash and subject;
- clean working-tree confirmation;
- exact dev userscript filename and SHA-256;
- exact production artifacts and SHA-256 values;
- any remaining runtime-only risks.

## Final status

Source-level implementation and local static/simulation audit are complete. TLA-001 remains production-blocked until the integrated gates pass and the exact Claude-built dev userscript passes the compact runtime acceptance cycle.
