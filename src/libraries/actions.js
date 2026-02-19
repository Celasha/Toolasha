/**
 * Actions Library
 * Production, gathering, and alchemy features
 *
 * Exports to: window.Toolasha.Actions
 */

// Action features
import { initActionPanelObserver } from '../features/actions/panel-observer.js';
import actionTimeDisplay from '../features/actions/action-time-display.js';
import quickInputButtons from '../features/actions/quick-input-buttons.js';
import outputTotals from '../features/actions/output-totals.js';
import maxProduceable from '../features/actions/max-produceable.js';
import gatheringStats from '../features/actions/gathering-stats.js';
import requiredMaterials from '../features/actions/required-materials.js';
import missingMaterialsButton from '../features/actions/missing-materials-button.js';
import teaRecommendation from '../features/actions/tea-recommendation.js';

// Alchemy features
import alchemyProfitDisplay from '../features/alchemy/alchemy-profit-display.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.Actions = {
    initActionPanelObserver,
    actionTimeDisplay,
    quickInputButtons,
    outputTotals,
    maxProduceable,
    gatheringStats,
    requiredMaterials,
    missingMaterialsButton,
    alchemyProfitDisplay,
    teaRecommendation,
};

console.log('[Toolasha] Actions library loaded');
