/**
 * Foundation Utils Library
 * All utility modules
 *
 * Exports to: window.Toolasha.Utils
 */

// All utils
import * as formatters from '../utils/formatters.js';
import * as efficiency from '../utils/efficiency.js';
import * as profitHelpers from '../utils/profit-helpers.js';
import * as profitConstants from '../utils/profit-constants.js';
import * as dom from '../utils/dom.js';
import * as domObserverHelpers from '../utils/dom-observer-helpers.js';
import * as timerRegistry from '../utils/timer-registry.js';
import * as bonusRevenueCalculator from '../utils/bonus-revenue-calculator.js';
import * as enhancementMultipliers from '../utils/enhancement-multipliers.js';
import * as experienceParser from '../utils/experience-parser.js';
import * as marketListings from '../utils/market-listings.js';
import * as actionCalculator from '../utils/action-calculator.js';
import * as actionPanelHelper from '../utils/action-panel-helper.js';
import * as teaParser from '../utils/tea-parser.js';
import * as buffParser from '../utils/buff-parser.js';
import * as selectors from '../utils/selectors.js';
import * as houseEfficiency from '../utils/house-efficiency.js';
import * as experienceCalculator from '../utils/experience-calculator.js';
import * as marketData from '../utils/market-data.js';
import * as abilityCalc from '../utils/ability-cost-calculator.js';
import * as equipmentParser from '../utils/equipment-parser.js';
import * as uiComponents from '../utils/ui-components.js';
import * as enhancementConfig from '../utils/enhancement-config.js';
import * as enhancementGearDetector from '../utils/enhancement-gear-detector.js';
import * as reactInput from '../utils/react-input.js';
import * as materialCalculator from '../utils/material-calculator.js';
import * as tokenValuation from '../utils/token-valuation.js';
import * as pricingHelper from '../utils/pricing-helper.js';
import * as cleanupRegistry from '../utils/cleanup-registry.js';
import * as houseCostCalculator from '../utils/house-cost-calculator.js';
import * as enhancementCalculator from '../utils/enhancement-calculator.js';

// Export to global namespace
const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

if (!targetWindow.Toolasha) {
    targetWindow.Toolasha = {};
}

targetWindow.Toolasha.Utils = {
    formatters,
    efficiency,
    profitHelpers,
    profitConstants,
    dom,
    domObserverHelpers,
    timerRegistry,
    bonusRevenueCalculator,
    enhancementMultipliers,
    experienceParser,
    marketListings,
    actionCalculator,
    actionPanelHelper,
    teaParser,
    buffParser,
    selectors,
    houseEfficiency,
    experienceCalculator,
    marketData,
    abilityCalc,
    equipmentParser,
    uiComponents,
    enhancementConfig,
    enhancementGearDetector,
    reactInput,
    materialCalculator,
    tokenValuation,
    pricingHelper,
    cleanupRegistry,
    houseCostCalculator,
    enhancementCalculator,
};

console.log('[Toolasha] Utils library loaded');
