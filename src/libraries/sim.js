/**
 * Sim Library
 * The headless combat simulator: engine, DTO adapter, worker runners and the inlined worker scripts.
 * The runners hold module-level worker state and the engine holds the game-data singleton, so this
 * library is their single owner. Combat, UI and UI2 reach them through Rollup externals
 * (Toolasha.Sim.*) instead of bundling private copies.
 *
 * Exports to: window.Toolasha.Sim
 *
 * Must be @required AFTER core, utils and market (it depends on them) and BEFORE actions, combat,
 * ui and ui2 (they depend on it). The simulator UIs stay in the Combat library: they import back
 * from Combat and enhancement code, which would make a cycle.
 */

import * as combatSimAdapter from '../features/combat-sim/combat-sim-adapter.js';
import * as combatSimRunner from '../features/combat-sim/combat-sim-runner.js';
import * as allZonesRunner from '../features/combat-sim/all-zones-runner.js';
import * as abilityTimingCalculator from '../features/combat-sim/ability-timing-calculator.js';
import * as skillingSimHelpers from '../features/combat-sim/skilling-sim-helpers.js';
import * as engineGameData from '../features/combat-sim/engine/game-data.js';
import enginePlayer from '../features/combat-sim/engine/player.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.Sim = {
    combatSimAdapter,
    combatSimRunner,
    allZonesRunner,
    abilityTimingCalculator,
    skillingSimHelpers,
    engineGameData,
    // Default-exported class: consumers import it as a default, so expose the class itself
    enginePlayer,
};

console.log('[Toolasha] Sim library loaded');
