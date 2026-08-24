import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'src');

function listJavaScriptFiles(dir) {
    const result = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) result.push(...listJavaScriptFiles(full));
        else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) result.push(full);
    }
    return result;
}

function source(file) {
    return readFileSync(file, 'utf8');
}

describe('Loadout State architecture invariants', () => {
    test('there is exactly one stateful LoadoutState construction and no legacy LoadoutSnapshot class', () => {
        const files = listJavaScriptFiles(SRC);
        const combined = files.map(source).join('\n');

        expect((combined.match(/new\s+LoadoutState\s*\(/g) || []).length).toBe(1);
        expect(combined).not.toMatch(/class\s+LoadoutSnapshot\b/);
        expect(combined).not.toMatch(/new\s+LoadoutSnapshot\s*\(/);
    });

    test('raw MWI loadout payload semantics remain private to Core Loadout State', () => {
        const allowed = resolve(SRC, 'core/loadout-state.js');
        const forbiddenTokens = [
            'characterLoadoutMap',
            'wearableMap',
            'useExactEnhancement',
            'savedItemHash',
            'suppressValidation',
            'rawSnapshots',
        ];
        const offenders = [];

        for (const file of listJavaScriptFiles(SRC)) {
            if (file === allowed) continue;
            const text = source(file);
            const rel = relative(ROOT, file);
            for (const token of forbiddenTokens) {
                if (text.includes(token)) offenders.push(`${rel}: ${token}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    test('saved-loadout consumers subscribe through Core updates rather than raw loadouts_updated WebSocket events', () => {
        const allowed = resolve(SRC, 'core/loadout-state.js');
        const rawSubscription = /webSocketHook\.(?:on|off)\(\s*['"]loadouts_updated['"]/;
        const offenders = listJavaScriptFiles(SRC)
            .filter((file) => file !== allowed)
            .filter((file) => rawSubscription.test(source(file)))
            .map((file) => relative(ROOT, file));

        expect(offenders).toEqual([]);
    });

    test('loadout server ownership is bound to WebSocket origin and WebSocket dedup remains socket-scoped', () => {
        const loadoutState = source(join(SRC, 'core/loadout-state.js'));
        const webSocket = source(join(SRC, 'core/websocket.js'));

        expect(loadoutState).toContain('this.activeSocket = context.socket');
        expect(loadoutState).toContain('context?.socket !== this.activeSocket');
        expect(webSocket).toContain('processMessage(message, socket = null)');
        expect(webSocket).toContain('handler(data, { socket })');
        expect(webSocket).toContain('const socketKey = this.getSocketDedupKey(socket)');
    });

    test('only Core Loadout State interprets useExactEnhancement semantics', () => {
        const allowed = resolve(SRC, 'core/loadout-state.js');
        const offenders = listJavaScriptFiles(SRC)
            .filter((file) => file !== allowed)
            .filter((file) => source(file).includes('useExactEnhancement'))
            .map((file) => relative(ROOT, file));

        expect(offenders).toEqual([]);
    });

    test('feature consumers cannot access raw/historical enhancement semantics', () => {
        const allowed = resolve(SRC, 'core/loadout-state.js');
        const offenders = [];

        for (const file of listJavaScriptFiles(SRC)) {
            if (file === allowed) continue;
            const text = source(file);
            const rel = relative(ROOT, file);
            if (text.includes('savedEnhancementLevel')) offenders.push(`${rel}: savedEnhancementLevel`);
            if (text.includes('enhancementResolution')) offenders.push(`${rel}: enhancementResolution`);
            if (text.includes('.rawSnapshots')) offenders.push(`${rel}: rawSnapshots`);
            // Scope the zero-heuristic check to code actually near loadout/snapshot resolution
            // rather than the whole file: some consumers (e.g. Networth) import loadoutState for
            // an unrelated feature (loadout exclusions) while also containing a completely
            // unrelated `enhancementLevel === 0` check elsewhere (base-item market price
            // fallback), which is not the raw-+0-promoted-to-Highest anti-pattern this guards.
            const zeroHeuristicPattern = /enhancementLevel\s*={2,3}\s*0/g;
            let match;
            while ((match = zeroHeuristicPattern.exec(text))) {
                const windowStart = Math.max(0, match.index - 400);
                const windowEnd = Math.min(text.length, match.index + match[0].length + 400);
                if (/loadoutState|snapshot/i.test(text.slice(windowStart, windowEnd))) {
                    offenders.push(`${rel}: enhancementLevel zero heuristic`);
                    break;
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    test('loadout-derived numeric consumers cannot coerce unresolved enhancement levels to +0', () => {
        const coercionPattern =
            /(?:enhancementLevel:\s*|const\s+enhLevel\s*=\s*)(?:equip|eq)\.enhancementLevel\s*(?:\|\||\?\?)\s*0/;
        const slices = [
            {
                name: 'Combat Sim loadout adapter',
                text: source(join(SRC, 'features/combat-sim/combat-sim-adapter.js')),
                start: 'export function applyLoadoutSnapshotToDTO',
            },
            {
                name: 'Character Card loadout',
                text: source(join(SRC, 'features/profile/character-card-button.js')),
                start: 'export async function handleViewCardFromSnapshot',
            },
            {
                name: 'Labyrinth loadout equipment',
                text: source(join(SRC, 'features/combat/labyrinth-clear-rate.js')),
                start: '    getLoadoutEquipmentBuffs(',
            },
            {
                name: 'Skilling Optimizer loadout consumers',
                text: source(join(SRC, 'features/skilling-optimizer/skilling-optimizer-ui.js')),
                start: 'class SkillingSimulatorUI',
                throughEnd: true,
            },
        ];
        const offenders = [];

        for (const entry of slices) {
            const start = entry.text.indexOf(entry.start);
            expect(start, `${entry.name} source marker`).toBeGreaterThan(-1);
            const end = entry.throughEnd ? -1 : entry.text.indexOf('\n    /**', start + entry.start.length);
            const scoped = end > start ? entry.text.slice(start, end) : entry.text.slice(start);
            if (coercionPattern.test(scoped)) offenders.push(entry.name);
        }

        expect(offenders).toEqual([]);
    });

    test('Profile Combat Sim export uses the shared native-slot mapper and cannot compact saved ability holes', () => {
        const combatScore = source(join(SRC, 'features/profile/combat-score.js'));
        const methodStart = combatScore.indexOf('async handleCombatSimExportFromSnapshot');
        const methodEnd = combatScore.indexOf('\n    /**', methodStart + 1);
        const method = combatScore.slice(methodStart, methodEnd);

        expect(methodStart).toBeGreaterThan(-1);
        expect(method).toContain('mapLoadoutAbilitiesToNativeSlots');
        expect(method).not.toMatch(/normalAbilityIndex/);
    });

    test('production consumers use the Core singleton API rather than named exports from the externalized module', () => {
        const allowed = resolve(SRC, 'core/loadout-state.js');
        const offenders = listJavaScriptFiles(SRC)
            .filter((file) => file !== allowed)
            .filter((file) => /import\s*\{[^}]+\}\s*from\s*['"][^'"]*core\/loadout-state\.js['"]/.test(source(file)))
            .map((file) => relative(ROOT, file));

        expect(offenders).toEqual([]);
    });

    test('legacy snapshot mutation, DOM scraping, and cross-bundle stateful imports stay forbidden', () => {
        const offenders = [];
        for (const file of listJavaScriptFiles(SRC)) {
            const text = source(file);
            const rel = relative(ROOT, file);
            if (/\.updateEnhancementLevel\s*\(/.test(text)) offenders.push(`${rel}: updateEnhancementLevel`);
            if (text.includes('loadout-snapshot.js') && rel !== 'src/libraries/combat.js') {
                offenders.push(`${rel}: loadout-snapshot import/reference`);
            }
            if (rel === 'src/utils/loadout-scraper.js') offenders.push(`${rel}: legacy DOM loadout scraper`);
            if (/\bscrape(?:Equipment|Abilities|Consumables)\s*\(/.test(text)) {
                offenders.push(`${rel}: legacy DOM loadout semantic scraper`);
            }
        }

        expect(offenders).toEqual([]);
    });

    test('character-scoped Custom Tabs replays already-authoritative loadout state after re-subscribing', () => {
        const customTabs = source(join(SRC, 'features/inventory/custom-tabs/custom-tabs-ui.js'));
        const subscribe = customTabs.indexOf('loadoutState.onUpdate(this._loadoutBindingHandler)');
        const stateCheck = customTabs.indexOf("loadoutStateInfo.authority !== 'none'", subscribe);
        const replay = customTabs.indexOf('this._onLoadoutSnapshotUpdate()', stateCheck);

        expect(subscribe).toBeGreaterThan(-1);
        expect(stateCheck).toBeGreaterThan(subscribe);
        expect(replay).toBeGreaterThan(stateCheck);
    });

    test('Combat Lab Sim blocks a persisted unavailable loadout instead of simulating the previous DTO', () => {
        const labSim = source(join(SRC, 'features/combat-sim/lab-sim-ui.js'));
        const simEditor = source(join(SRC, 'features/combat-sim/sim-editor.js'));

        expect(simEditor).toContain('getUnavailableLoadoutName()');
        expect(simEditor).toContain('Simulation is blocked until you choose another loadout or Current Gear.');
        expect(labSim).toContain('this._getBlockedCombatLoadoutName()');
        expect(labSim).toContain('Configured combat loadout unavailable:');
        expect(labSim).toContain("this._editor.applyLoadoutByName('')");
    });

    test('Rollup externalizes Core Loadout State and the entrypoint starts capture before async storage initialization', () => {
        const rollup = source(join(ROOT, 'rollup.config.js'));
        const entrypoint = source(join(SRC, 'entrypoint.js'));

        expect(rollup).toContain("src/core/loadout-state.js')), 'Toolasha.Core.loadoutState'");

        const webSocketInstall = entrypoint.indexOf('webSocketHook.install()');
        const startCapture = entrypoint.indexOf('loadoutState.startCapture()');
        const storageInitialize = entrypoint.indexOf('await storage.initialize()');
        const hydratePersistence = entrypoint.indexOf('await loadoutState.hydratePersistence()');
        expect(webSocketInstall).toBeGreaterThan(-1);
        expect(startCapture).toBeGreaterThan(webSocketInstall);
        expect(storageInitialize).toBeGreaterThan(startCapture);
        expect(hydratePersistence).toBeGreaterThan(storageInitialize);
        expect(entrypoint).not.toMatch(/key:\s*['"]loadoutSnapshot['"]/);
    });
});
