/**
 * Combat Library
 * Combat, abilities, and combat stats features
 *
 * Exports to: window.Toolasha.Combat
 */

// Combat features
import zoneIndices from '../features/combat/zone-indices.js';
import loadoutExportButton from '../features/combat/loadout-export-button.js';
import loadoutEnhancementDisplay from '../features/combat/loadout-enhancement-display.js';
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
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.Combat = {
    zoneIndices,
    loadoutExportButton,
    loadoutEnhancementDisplay,
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
