# Toolasha TLA-001 Handoff 26.8.23

## Exact continuity state

- Working tree: `/mnt/data/toolasha_tla001_work`
- Upstream source basis supplied for the task: `0cc3c87e`
- Local imported baseline HEAD: `2ba8137e567d2ba5d97eb1774ef53b7e5b7afb13`
- Runtime-confirmed reference: `Toolasha_TLA-001_Runtime_Candidate_26.8.21.txt`
- Runtime candidate version: `2.85.0.10`
- Runtime candidate SHA-256: `fd0e0f73cf007630b8bbeb53221264f8545ae485c2c96eea241db8124212b980`

## User-confirmed runtime results

- Buy autofill works.
- Production layout is correct.
- Enhancing opens on the first click while Target Level is focused.
- Enhancing Return restores selected item/settings.
- Guild Return label and shrine are correct.
- Production, Best Crafting Plan, House, Enhancing, and Guild transitions/Return were exercised during iterative runtime work.

## Current source scope

The complete patch changes/adds 33 JavaScript files and includes:

- Marketplace session service and token ownership;
- exact React-state Buy modal identity;
- central native setter;
- owner lifecycle, native exit, overlay close, remount/reinjection;
- partial/full purchase updates;
- Production/Crafting Plan/House/Enhancing/Guild Return;
- Sell Queue and Ability Book;
- Ask-only Cost Summary and compact layout;
- Alchemy/Enhancing XP/hr;
- enhancement Markov corrections;
- focused tests for the above.

## Final-audit additions after Handoff 26.8.22

- House stale-session check at tab-injection entry.
- Stale-token checks before material navigation across all owners.
- Corrected missing named exports in House/Sell Queue test mocks.
- Replaced obsolete “House Return absent” test.
- Alchemy Experience-row remount self-healing for inline XP/hr.
- Enhancing Experience-row remount refresh and fail-closed stale-output removal.

## Validation completed

- `node --check`: PASS, 33 changed/new JS files.
- `git diff --check`: PASS.
- Relative imports: PASS.
- Static lifecycle/Ask/XP invariants: PASS.
- Actual session-service simulation: PASS.
- Independent enhancement Markov simulation: PASS.

## Mandatory validation still pending

Local dependencies are invalid/empty and network installation is unavailable. Claude Code must run:

```bash
npm ci
npm test
npm run lint
npm run build:dev
npm run build
```

## Next steps

1. Give Claude Code the source patch, validation report, this handoff, and MWI development instructions.
2. Require Claude to confirm that it actually opened/read all files.
3. Claude independently audits and runs every mandatory gate.
4. Claude returns a commit, clean tree, exact dev userscript, and SHA-256.
5. Verify SHA and inspect the built userscript against source.
6. Install that exact dev build and perform the compact runtime acceptance.
7. Give the same SHA-verified build to Celasha for a short smoke test.
8. Approve integration only after both gates and runtime pass.

## Compact runtime acceptance

- Production: layout, first item, autofill, Return keeps quantity.
- Crafting Plan: first item, autofill, Return.
- House: first item, autofill, room/level Return.
- Enhancing: one-click, autofill, all settings Return.
- Guild: autofill, label and shrine Return.
- Partial/full buy: live count and completed-tab disable.
- Lifecycle: native tab, overlay close, remount, cross-owner replacement.
- Sell Queue and Ability Book.
- Ask-only costs, compact spacing, Alchemy/Enhancing XP/hr tooltip.

## Safety artifacts

- `Toolasha_TLA-001_Source_Tree_2026-08-02_2358.tar.gz`
- `Toolasha_TLA-001_Source_Patch_2026-08-02_2358.patch`
- `Toolasha_TLA-001_Validation_Report_2026-08-02_2358.md`
- `Toolasha_TLA-001_Instructions_for_Claude_Code_2026-08-02_2358.md`
- `Toolasha_TLA-001_Node_Check_2026-08-02_2358.log`
- `Toolasha_TLA-001_Static_Audit_2026-08-02_2358.log`
- `Toolasha_TLA-001_Session_Simulation_2026-08-02_2358.log`
- `Toolasha_TLA-001_Enhancement_Markov_Simulation_2026-08-02_2358.log`
