/**
 * Combat Library
 * Combat, abilities, and combat stats features
 *
 * Exports to: window.Toolasha.Combat
 */

// Combat features
import zoneIndices from '../features/combat/zone-indices.js';
import dungeonTracker from '../features/combat/dungeon-tracker.js';
import dungeonTrackerUI from '../features/combat/dungeon-tracker-ui.js';
import dungeonTrackerChatAnnotations from '../features/combat/dungeon-tracker-chat-annotations.js';
import combatSummary from '../features/combat/combat-summary.js';
import * as combatSimIntegration from '../features/combat/combat-sim-integration.js';
import { constructExportObject } from '../features/combat/combat-sim-export.js';
import { constructMilkonomyExport } from '../features/combat/milkonomy-export.js';

// Combat stats
import combatStats from '../features/combat-stats/combat-stats.js';

// Abilities
import abilityBookCalculator from '../features/abilities/ability-book-calculator.js';

// Profile (combat score)
import combatScore from '../features/profile/combat-score.js';
import characterCardButton from '../features/profile/character-card-button.js';

// Export to global namespace
const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

if (!targetWindow.Toolasha) {
    targetWindow.Toolasha = {};
}

targetWindow.Toolasha.Combat = {
    zoneIndices,
    dungeonTracker,
    dungeonTrackerUI,
    dungeonTrackerChatAnnotations,
    combatSummary,
    combatSimIntegration,
    combatSimExport: {
        constructExportObject,
        constructMilkonomyExport,
    },
    combatStats,
    abilityBookCalculator,
    combatScore,
    characterCardButton,
};

console.log('[Toolasha] Combat library loaded');
