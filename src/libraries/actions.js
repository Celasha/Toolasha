/**
 * Actions Library
 * Production, gathering, and alchemy features
 *
 * Exports to: window.Toolasha.Actions
 */

// Action features
import { initActionPanelObserver } from '../features/actions/panel-observer.js';
import actionTimeDisplay from '../features/actions/action-time-display.js';
import actionCountdown from '../features/actions/action-countdown.js';
import quickInputButtons from '../features/actions/quick-input-buttons.js';
import outputTotals from '../features/actions/output-totals.js';
import maxProduceable from '../features/actions/max-produceable.js';
import gatheringStats from '../features/actions/gathering-stats.js';
import requiredMaterials from '../features/actions/required-materials.js';
import missingMaterialsButton from '../features/actions/missing-materials-button.js';
import budgetCalculator from '../features/actions/budget-calculator.js';
import costSummary from '../features/actions/cost-summary.js';
import craftingPlan from '../features/crafting-plan/index.js';
import teaRecommendation from '../features/actions/tea-recommendation.js';
import inventoryCountDisplay from '../features/actions/inventory-count-display.js';
import pinnedActionsPage from '../features/actions/pinned-actions-page.js';
import drinkTimer from '../features/actions/drink-timer.js';

// Alchemy features
import alchemyProfitDisplay from '../features/alchemy/alchemy-profit-display.js';
import alchemyBestItems from '../features/alchemy/alchemy-best-items.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.Actions = {
    initActionPanelObserver,
    actionTimeDisplay,
    actionCountdown,
    quickInputButtons,
    outputTotals,
    maxProduceable,
    gatheringStats,
    requiredMaterials,
    missingMaterialsButton,
    budgetCalculator,
    costSummary,
    craftingPlan,
    alchemyProfitDisplay,
    alchemyBestItems,
    teaRecommendation,
    inventoryCountDisplay,
    pinnedActionsPage,
    drinkTimer,
};

console.log('[Toolasha] Actions library loaded');
