# Claude Instructions for Toolasha

This file contains general workflow and behavioral guidelines for AI assistants working on this project.

## General Workflow Rules

### Git & Version Control

- **Always rebase, never merge**: When pulling changes, always use `git pull --rebase`

### Code Changes

- **Never add code without approval**: Only add debuggers without approval; all other code requires explicit user permission
- **Always build after implementing**: Run `npm run build:dev` immediately after every approved code change

### Communication

- **No time estimates**: Never give estimates for how long something will take

## Project-Specific Context

### Recent Breaking Changes

**February 21, 2026 Game Update:**

- Game removed `__reactFiber$...` keys from DOM elements
- Chat commands `/item` and `/mp` no longer work (game core inaccessible via old method)
- Marketplace navigation required new approach using `_reactRootContainer`

**React Fiber Navigation Pattern:**

```javascript
const rootEl = document.getElementById('root');
const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;

function find(fiber) {
    if (!fiber) return null;
    if (fiber.stateNode?.handleGoToMarketplace) return fiber.stateNode;
    return find(fiber.child) || find(fiber.sibling);
}
```

This approach traverses the React fiber tree to find game methods without depending on obfuscated property names.

### Common Bugs to Watch For

1. **Pricing mode not passed through**: Always ensure `pricingMode` is included in calculator return objects and passed to display formatters
2. **MutationObserver missing attributes**: When watching for item changes, include `attributes: true` and `attributeFilter` for SVG href changes
3. **Early returns in switch statements**: Use variable assignment instead of returning directly in switch cases
4. **Unreachable code after return**: Lint will catch console.logs after return statements

## MWI Development References

The authoritative MWI client and game-data references live in `~/Downloads/MWIClaude`.

**At the start of each session** (and whenever new MWI references are added), read:

1. `~/Downloads/MWIClaude/MWI_Export__LLM_Development_Instructions.md`
2. `~/Downloads/MWIClaude/reference/mwi/REFERENCE_STATUS.md`

**Available references:**

- Client Code: `~/Downloads/MWIClaude/reference/mwi/client_code/current/`
- Game Reference: `~/Downloads/MWIClaude/reference/mwi/game_reference/current/MWI_Game_Reference.json`

**When the user says new MWI references were added**, run `~/Downloads/MWIClaude/update_mwi_references.sh`,
validate the results, and report the new build fingerprint, game version, and any coverage or
schema changes.

**Request a fresh Runtime/DOM Snapshot** when a task depends on the current game UI, open modal,
selected item or action, React component state, or available class-instance methods. Specify
exactly which page to open and which state to reproduce before the snapshot is taken.

## Technical Details

For code style, architecture patterns, build commands, and technical guidelines, see:

@AGENTS.md
