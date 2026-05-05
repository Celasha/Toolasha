/**
 * Combat Simulator Worker Entry
 *
 * This file is bundled into a string at build time by the workerBundlePlugin
 * and runs inside a Web Worker. It receives simulation parameters via
 * postMessage and returns results.
 */

import { setGameData } from './engine/game-data.js';
import CombatSimulator from './engine/combat-simulator.js';
import Player from './engine/player.js';
import Zone from './engine/zone.js';

onmessage = function (event) {
    const { type, taskId } = event.data;

    if (type !== 'start_simulation') return;

    try {
        const { gameData, playerDTOs, zoneHrid, difficultyTier, simulationTimeLimit, extraBuffs } = event.data;

        // Set game data for the engine singleton
        setGameData(gameData);

        // Create Zone
        const zone = new Zone(zoneHrid, difficultyTier);

        // Create Players
        const players = playerDTOs.map((dto) => {
            const player = Player.createFromDTO(structuredClone(dto));
            player.zoneBuffs = zone.buffs;
            player.extraBuffs = extraBuffs;
            return player;
        });

        // Create simulator with progress callback
        const combatSimulator = new CombatSimulator(players, zone, (progressData) => {
            postMessage({
                type: 'progress',
                taskId,
                progress: Math.round(progressData.progress * 100),
            });
        });

        // Run simulation
        const simResult = combatSimulator.simulate(simulationTimeLimit);

        postMessage({
            type: 'result',
            taskId,
            simResult,
        });
    } catch (error) {
        postMessage({
            type: 'error',
            taskId,
            error: error.message || String(error),
        });
    }
};
