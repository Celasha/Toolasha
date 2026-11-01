import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The combat simulator's runners keep module-level worker state and the engine keeps the game-data
 * singleton, so exactly one library (toolasha-sim.js) may contain them. Combat, UI and UI2 must
 * reach them through Toolasha.Sim, and toolasha-sim.js must load before the libraries that use it.
 * This is what keeps the duplicated copies (and their 200+ KB inlined worker scripts) from creeping
 * back into the bundles that sit close to the 2 MiB @require cap.
 */

const librariesDir = 'dist/libraries';
if (!existsSync(librariesDir)) {
    console.error('❌ dist/libraries is missing; run the production build first.');
    process.exit(1);
}

const libraryFiles = readdirSync(librariesDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, text: readFileSync(join(librariesDir, name), 'utf8') }));

const sim = libraryFiles.find(({ name }) => name === 'toolasha-sim.js');
if (!sim) {
    console.error('❌ dist/libraries/toolasha-sim.js is missing; run the production build first.');
    process.exit(1);
}

const failures = [];

// Implementation markers that must live in the Sim library and nowhere else
const implementationMarkers = [
    ['CombatSimulator engine class', /class\s+CombatSimulator\b/],
    ['combat-sim-runner worker state', /toolasha-sim-runner-state-v1/],
    ['all-zones-runner worker state', /toolasha-sim-all-zones-state-v1/],
    ['runSimulation', /function\s+runSimulation\s*\(/],
    ['runAllZonesSimulation', /function\s+runAllZonesSimulation\s*\(/],
];
for (const [label, pattern] of implementationMarkers) {
    const owners = libraryFiles.filter(({ text }) => pattern.test(text)).map(({ name }) => name);
    if (owners.length !== 1 || owners[0] !== 'toolasha-sim.js') {
        failures.push(`${label} must exist only in toolasha-sim.js; found in: ${owners.join(', ') || 'none'}`);
    }
}

// Consumers must resolve the simulator through Toolasha.Sim
const requiredConsumers = {
    'toolasha-combat.js': ['combatSimAdapter', 'combatSimRunner', 'allZonesRunner', 'enginePlayer'],
    'toolasha-ui.js': ['combatSimAdapter', 'combatSimRunner', 'allZonesRunner'],
};
for (const [name, members] of Object.entries(requiredConsumers)) {
    const file = libraryFiles.find((entry) => entry.name === name);
    if (!file) {
        failures.push(`Expected production artifact ${name} is missing; run the production build first.`);
        continue;
    }
    for (const member of members) {
        if (!file.text.includes(`Toolasha.Sim.${member}`)) {
            failures.push(`${name} does not resolve ${member} through Toolasha.Sim.${member}`);
        }
    }
}

// Rollup may suffix the local name (toolashaRoot$2) when libraries are merged, so match the property
const definesSim = (text) => /\.Sim\s*=\s*\{/.test(text);
if (!definesSim(sim.text)) {
    failures.push('toolasha-sim.js does not expose Toolasha.Sim');
}

// Sim depends on core/utils/market and is depended on by actions/combat/ui/ui2: order matters
const entrypoint = 'dist/Toolasha.user.js';
if (!existsSync(entrypoint)) {
    failures.push(`${entrypoint} is missing; run the production build first.`);
} else {
    const requires = [...readFileSync(entrypoint, 'utf8').matchAll(/@require\s+\S*\/(toolasha-[a-z0-9-]+\.js)/g)].map(
        (match) => match[1]
    );
    const position = (name) => requires.indexOf(name);
    if (position('toolasha-sim.js') === -1) {
        failures.push('Toolasha.user.js has no @require for toolasha-sim.js');
    } else {
        if (position('toolasha-sim.js') < position('toolasha-market.js')) {
            failures.push('toolasha-sim.js must be @required after toolasha-market.js (it depends on Market)');
        }
        for (const consumer of ['toolasha-actions.js', 'toolasha-combat.js', 'toolasha-ui.js', 'toolasha-ui2.js']) {
            if (position(consumer) !== -1 && position(consumer) < position('toolasha-sim.js')) {
                failures.push(`${consumer} must be @required after toolasha-sim.js (it uses Toolasha.Sim)`);
            }
        }
    }
}

// The dev standalone bundles every library into one file; it must define Toolasha.Sim too, or the
// entrypoint guard reports a missing library and stops
const devBundle = 'dist/Toolasha-dev.user.js';
if (existsSync(devBundle) && !definesSim(readFileSync(devBundle, 'utf8'))) {
    failures.push(`${devBundle} does not define Toolasha.Sim; src/dev-entrypoint.js must import ./libraries/sim.js`);
}

if (failures.length > 0) {
    for (const failure of failures) console.error(`❌ ${failure}`);
    process.exit(1);
}

console.log('✅ Combat sim singleton integrity verified: one Sim-owned engine and runner state, correct load order.');
