# Instructions for Claude Code - Toolasha TLA-001

Work from the repository state corresponding to upstream source commit `0cc3c87e`. Read all supplied files before changing code:

1. `Toolasha_TLA-001_Source_Patch_2026-08-02_2358.patch`
2. `Toolasha_TLA-001_Validation_Report_2026-08-02_2358.md`
3. `Toolasha_TLA-001_Handoff_26.8.23.md`
4. `MWI_Export__LLM_Development_Instructions.md`

The archive `Toolasha_TLA-001_Source_Tree_2026-08-02_2358.tar.gz` is a complete checkpoint of the current working tree and may be used for comparison or recovery.

## Task

Independently review the complete patch, apply it to the exact base, correct only confirmed problems, and validate the result. Do not rewrite the runtime-confirmed Buy setter, Production layout, Enhancing one-click/Return, or Guild Return behavior without a demonstrated defect.

Audit especially:

- exact item/enhancement/side/modal identity before autofill;
- stale token rejection and cross-owner replacement;
- every end/cleanup path;
- native Marketplace tabs and overlay close/reopen;
- React remount/reinjection;
- partial/full purchase updates and completed tabs;
- Sell Queue while Marketplace is already open;
- Ability Book one-shot expiry/native exit;
- House/Production/Crafting Plan/Enhancing/Guild Return;
- Ask-only Cost Summary;
- Alchemy/Enhancing XP/hr calculations and remount behavior;
- enhancement +20/Blessed Markov edge cases.

## Mandatory commands

Run from a clean dependency installation:

```bash
npm ci
npm test
npm run lint
npm run build:dev
npm run build
```

Also run:

```bash
git diff --check
rg -n "\\.(setItem|setQuantityProvider)\\(" src --glob '!**/*.test.js'
```

The only unrelated production `setItem` occurrence expected in the repository is `localStorage.setItem` in pop-out chat.

## Required response format

Report:

1. Files read and exact base commit verified.
2. Patch review findings and any amendments.
3. Test totals and failures, if any.
4. Lint errors and warnings, separated.
5. `build:dev` result.
6. Production build result and outputs.
7. Final commit hash, subject, branch, and clean working-tree status.
8. Dev userscript path and SHA-256.
9. Production artifact paths and SHA-256.
10. Remaining runtime-only checks.

Do not push or deploy to production. Return the build for independent runtime acceptance first.
