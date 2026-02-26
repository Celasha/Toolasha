// ==UserScript==
// @name         Toolasha
// @namespace    http://tampermonkey.net/
// @version      1.18.1
// @downloadURL  https://greasyfork.org/scripts/562662-toolasha/code/Toolasha.user.js
// @updateURL    https://greasyfork.org/scripts/562662-toolasha/code/Toolasha.meta.js
// @description  Toolasha - Enhanced tools for Milky Way Idle.
// @author       Celasha and Claude, thank you to bot7420, DrDucky, Frotty, Truth_Light, AlphB, qu, and sentientmilk, for providing the basis for a lot of this. Thank you to Miku, Orvel, Jigglymoose, Incinarator, Knerd, and others for their time and help. Thank you to Steez for testing and helping me figure out where I'm wrong! Thank you to Tib for his generous contribution of the Character Cards. Thank you to Sapnas for -deeply- testing and singlehandedly help me improve performance. Special thanks to Zaeter for the name.
// @license      CC-BY-NC-SA-4.0
// @run-at       document-start
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0/dist/chartjs-plugin-datalabels.min.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@d7620d0c583e0f30f0efc4b39fd6c70ff7766357/dist/libraries/toolasha-core.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@d7620d0c583e0f30f0efc4b39fd6c70ff7766357/dist/libraries/toolasha-utils.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@d7620d0c583e0f30f0efc4b39fd6c70ff7766357/dist/libraries/toolasha-market.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@d7620d0c583e0f30f0efc4b39fd6c70ff7766357/dist/libraries/toolasha-actions.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@d7620d0c583e0f30f0efc4b39fd6c70ff7766357/dist/libraries/toolasha-combat.js
// @require      https://cdn.jsdelivr.net/gh/Celasha/Toolasha@d7620d0c583e0f30f0efc4b39fd6c70ff7766357/dist/libraries/toolasha-ui.js
// ==/UserScript==
// Note: Combat Sim auto-import requires Tampermonkey for cross-domain storage. Not available on Steam (use manual clipboard copy/paste instead).

(function () {
    'use strict';

    window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";

    /**
     * Toolasha Entrypoint
     * Minimal bootstrap script that loads libraries and initializes features
     *
     * Libraries are loaded via @require in userscript header:
     * - Core (core modules, API)
     * - Utils (all utilities)
     * - Market (market, inventory, economy)
     * - Actions (production, gathering, alchemy)
     * - Combat (combat, stats, abilities)
     * - UI (tasks, skills, settings, misc)
     */

    // Environment mismatch detection
    (function checkBuildEnvironment() {
        const buildTarget = window.Toolasha?.__buildTarget;
        // Check for GM_info specifically - the Steam polyfill provides GM but not GM_info
        const hasScriptManager = typeof GM_info !== 'undefined';

        if (buildTarget === 'browser' && !hasScriptManager) {
            alert(
                'Toolasha: Wrong build installed!\n\n' +
                    'You have the BROWSER build installed, but you are running on Steam.\n' +
                    'The browser build requires Tampermonkey and will not work on Steam.\n\n' +
                    'Please install the Steam build instead.'
            );
            throw new Error('[Toolasha] Browser build cannot run on Steam. Install the Steam build.');
        }
        if (buildTarget === 'steam' && hasScriptManager) {
            alert(
                'Toolasha: Wrong build installed!\n\n' +
                    'You have the STEAM build installed, but you are running in a browser.\n' +
                    'The Steam build is unnecessarily large for browser use.\n\n' +
                    'Please install the browser build instead.'
            );
            throw new Error('[Toolasha] Steam build should not run in a browser. Install the browser build.');
        }
    })();

    // Access libraries from global namespace
    const Core = window.Toolasha.Core;
    const Utils = window.Toolasha.Utils;
    const Market = window.Toolasha.Market;
    const Actions = window.Toolasha.Actions;
    const Combat = window.Toolasha.Combat;
    const UI = window.Toolasha.UI;

    // Destructure core modules
    const { storage, config, webSocketHook, domObserver, dataManager, featureRegistry } = Core;

    const { setupScrollTooltipDismissal } = Utils.dom;

    /**
     * Detect if running on Combat Simulator page
     * @returns {boolean} True if on Combat Simulator
     */
    function isCombatSimulatorPage() {
        const url = window.location.href;
        // Only work on test Combat Simulator for now
        return url.includes('shykai.github.io/MWICombatSimulatorTest/dist/');
    }

    /**
     * Register all features from libraries into the feature registry
     */
    function registerFeatures() {
        // Market Features
        const marketFeatures = [
            { key: 'tooltipPrices', name: 'Tooltip Prices', category: 'Market', module: Market.tooltipPrices, async: true },
            {
                key: 'expectedValueCalculator',
                name: 'Expected Value Calculator',
                category: 'Market',
                module: Market.expectedValueCalculator,
                async: true,
            },
            {
                key: 'tooltipConsumables',
                name: 'Tooltip Consumables',
                category: 'Market',
                module: Market.tooltipConsumables,
                async: true,
            },
            {
                key: 'dungeonTokenTooltips',
                name: 'Dungeon Token Tooltips',
                category: 'Inventory',
                module: Market.dungeonTokenTooltips,
                async: true,
            },
            { key: 'marketFilter', name: 'Market Filter', category: 'Market', module: Market.marketFilter, async: false },
            { key: 'marketSort', name: 'Market Sort', category: 'Market', module: Market.marketSort, async: false },
            {
                key: 'autoFillPrice',
                name: 'Auto Fill Price',
                category: 'Market',
                module: Market.autoFillPrice,
                async: false,
            },
            {
                key: 'autoClickMax',
                name: 'Auto Click Max',
                category: 'Market',
                module: Market.autoClickMax,
                async: false,
            },
            {
                key: 'itemCountDisplay',
                name: 'Item Count Display',
                category: 'Market',
                module: Market.itemCountDisplay,
                async: false,
            },
            {
                key: 'listingPriceDisplay',
                name: 'Listing Price Display',
                category: 'Market',
                module: Market.listingPriceDisplay,
                async: false,
            },
            {
                key: 'estimatedListingAge',
                name: 'Estimated Listing Age',
                category: 'Market',
                module: Market.estimatedListingAge,
                async: false,
            },
            {
                key: 'queueLengthEstimator',
                name: 'Queue Length Estimator',
                category: 'Market',
                module: Market.queueLengthEstimator,
                async: false,
            },
            {
                key: 'marketOrderTotals',
                name: 'Market Order Totals',
                category: 'Market',
                module: Market.marketOrderTotals,
                async: false,
            },
            {
                key: 'marketHistoryViewer',
                name: 'Market History Viewer',
                category: 'Market',
                module: Market.marketHistoryViewer,
                async: false,
            },
            {
                key: 'philoCalculator',
                name: 'Philo Calculator',
                category: 'Market',
                module: Market.philoCalculator,
                async: false,
            },
            { key: 'tradeHistory', name: 'Trade History', category: 'Market', module: Market.tradeHistory, async: false },
            {
                key: 'tradeHistoryDisplay',
                name: 'Trade History Display',
                category: 'Market',
                module: Market.tradeHistoryDisplay,
                async: false,
            },
            { key: 'networth', name: 'Net Worth', category: 'Economy', module: Market.networthFeature, async: false },
            {
                key: 'inventoryBadgeManager',
                name: 'Inventory Badge Manager',
                category: 'Inventory',
                module: Market.inventoryBadgeManager,
                async: false,
            },
            {
                key: 'inventorySort',
                name: 'Inventory Sort',
                category: 'Inventory',
                module: Market.inventorySort,
                async: false,
            },
            {
                key: 'inventoryBadgePrices',
                name: 'Inventory Badge Prices',
                category: 'Inventory',
                module: Market.inventoryBadgePrices,
                async: false,
            },
            {
                key: 'autoAllButton',
                name: 'Auto All Button',
                category: 'Inventory',
                module: Market.autoAllButton,
                async: false,
            },
        ];

        // Actions Features
        const actionsFeatures = [
            {
                key: 'actionTimeDisplay',
                name: 'Action Time Display',
                category: 'Actions',
                module: Actions.actionTimeDisplay,
                async: false,
            },
            {
                key: 'quickInputButtons',
                name: 'Quick Input Buttons',
                category: 'Actions',
                module: Actions.quickInputButtons,
                async: false,
            },
            { key: 'outputTotals', name: 'Output Totals', category: 'Actions', module: Actions.outputTotals, async: false },
            {
                key: 'maxProduceable',
                name: 'Max Produceable',
                category: 'Actions',
                module: Actions.maxProduceable,
                async: false,
            },
            {
                key: 'gatheringStats',
                name: 'Gathering Stats',
                category: 'Actions',
                module: Actions.gatheringStats,
                async: false,
            },
            {
                key: 'requiredMaterials',
                name: 'Required Materials',
                category: 'Actions',
                module: Actions.requiredMaterials,
                async: false,
            },
            {
                key: 'missingMaterialsButton',
                name: 'Missing Materials Button',
                category: 'Actions',
                module: Actions.missingMaterialsButton,
                async: false,
            },
            {
                key: 'alchemyProfitDisplay',
                name: 'Alchemy Profit Display',
                category: 'Alchemy',
                module: Actions.alchemyProfitDisplay,
                async: false,
            },
            {
                key: 'teaRecommendation',
                name: 'Tea Recommendation',
                category: 'Actions',
                module: Actions.teaRecommendation,
                async: false,
            },
            {
                key: 'lootLogStats',
                name: 'Loot Log Statistics',
                category: 'Actions',
                module: UI.lootLogStats,
                async: false,
            },
            {
                key: 'inventoryCountDisplay',
                name: 'Inventory Count Display',
                category: 'Actions',
                module: Actions.inventoryCountDisplay,
                async: false,
            },
        ];

        // Combat Features
        const combatFeatures = [
            {
                key: 'abilityBookCalculator',
                name: 'Ability Book Calculator',
                category: 'Combat',
                module: Combat.abilityBookCalculator,
                async: false,
            },
            { key: 'zoneIndices', name: 'Zone Indices', category: 'Combat', module: Combat.zoneIndices, async: false },
            { key: 'combatScore', name: 'Combat Score', category: 'Profile', module: Combat.combatScore, async: false },
            {
                key: 'characterCardButton',
                name: 'Character Card Button',
                category: 'Profile',
                module: Combat.characterCardButton,
                async: false,
            },
            {
                key: 'loadoutExportButton',
                name: 'Loadout Export Button',
                category: 'Combat',
                module: Combat.loadoutExportButton,
                async: false,
            },
            {
                key: 'loadoutEnhancementDisplay',
                name: 'Loadout Enhancement Display',
                category: 'Combat',
                module: Combat.loadoutEnhancementDisplay,
                async: false,
            },
            {
                key: 'dungeonTracker',
                name: 'Dungeon Tracker',
                category: 'Combat',
                module: Combat.dungeonTracker,
                async: false,
            },
            {
                key: 'dungeonTrackerUI',
                name: 'Dungeon Tracker UI',
                category: 'Combat',
                module: Combat.dungeonTrackerUI,
                async: false,
            },
            {
                key: 'dungeonTrackerChatAnnotations',
                name: 'Dungeon Tracker Chat',
                category: 'Combat',
                module: Combat.dungeonTrackerChatAnnotations,
                async: false,
            },
            {
                key: 'combatSummary',
                name: 'Combat Summary',
                category: 'Combat',
                module: Combat.combatSummary,
                async: false,
            },
            { key: 'combatStats', name: 'Combat Stats', category: 'Combat', module: Combat.combatStats, async: true },
        ];

        // UI Features
        const uiFeatures = [
            {
                key: 'equipmentLevelDisplay',
                name: 'Equipment Level Display',
                category: 'UI',
                module: UI.equipmentLevelDisplay,
                async: false,
            },
            {
                key: 'alchemyItemDimming',
                name: 'Alchemy Item Dimming',
                category: 'UI',
                module: UI.alchemyItemDimming,
                async: false,
            },
            {
                key: 'skillExperiencePercentage',
                name: 'Skill Experience Percentage',
                category: 'UI',
                module: UI.skillExperiencePercentage,
                async: false,
            },
            { key: 'externalLinks', name: 'External Links', category: 'UI', module: UI.externalLinks, async: false },
            {
                key: 'altClickNavigation',
                name: 'Alt+Click Navigation',
                category: 'Navigation',
                module: UI.altClickNavigation,
                async: false,
            },
            { key: 'chatCommands', name: 'Chat Commands', category: 'Chat', module: UI.chatCommands, async: true },
            { key: 'mentionTracker', name: 'Mention Tracker', category: 'Chat', module: UI.mentionTracker, async: true },
            { key: 'popOutChat', name: 'Pop-Out Chat', category: 'Chat', module: UI.popOutChat, async: true },
            {
                key: 'taskProfitDisplay',
                name: 'Task Profit Display',
                category: 'Tasks',
                module: UI.taskProfitDisplay,
                async: false,
            },
            {
                key: 'taskRerollTracker',
                name: 'Task Reroll Tracker',
                category: 'Tasks',
                module: UI.taskRerollTracker,
                async: false,
            },
            { key: 'taskSorter', name: 'Task Sorter', category: 'Tasks', module: UI.taskSorter, async: false },
            { key: 'taskIcons', name: 'Task Icons', category: 'Tasks', module: UI.taskIcons, async: false },
            {
                key: 'taskInventoryHighlighter',
                name: 'Task Inventory Highlighter',
                category: 'Tasks',
                module: UI.taskInventoryHighlighter,
                async: false,
            },
            {
                key: 'taskStatistics',
                name: 'Task Statistics',
                category: 'Tasks',
                module: UI.taskStatistics,
                async: false,
            },
            { key: 'skillRemainingXP', name: 'Remaining XP', category: 'Skills', module: UI.remainingXP, async: false },
            { key: 'xpTracker', name: 'XP/hr Tracker', category: 'Skills', module: UI.xpTracker, async: false },
            {
                key: 'housePanelObserver',
                name: 'House Panel Observer',
                category: 'House',
                module: UI.housePanelObserver,
                async: false,
            },
            {
                key: 'transmuteRates',
                name: 'Transmute Rates',
                category: 'Dictionary',
                module: UI.transmuteRates,
                async: false,
            },
            {
                key: 'enhancementFeature',
                name: 'Enhancement Tracker',
                category: 'Enhancement',
                module: UI.enhancementFeature,
                async: false,
            },
            {
                key: 'emptyQueueNotification',
                name: 'Empty Queue Notification',
                category: 'Notifications',
                module: UI.emptyQueueNotification,
                async: false,
            },
        ];

        // Combine all features
        const allFeatures = [...marketFeatures, ...actionsFeatures, ...combatFeatures, ...uiFeatures];

        // Convert to feature registry format
        const features = allFeatures.map((feature) => ({
            key: feature.key,
            name: feature.name,
            category: feature.category,
            initialize: () => feature.module.initialize(),
            async: feature.async,
        }));

        // Replace feature registry's features array
        featureRegistry.replaceFeatures(features);
    }

    if (isCombatSimulatorPage()) {
        // Initialize combat sim integration only
        Combat.combatSimIntegration.initialize();

        // Skip all other initialization
    } else {
        // CRITICAL: Install WebSocket hook FIRST, before game connects
        webSocketHook.install();

        // CRITICAL: Start centralized DOM observer SECOND, before features initialize
        domObserver.start();

        // Set up scroll listener to dismiss stuck tooltips
        setupScrollTooltipDismissal();

        // Initialize network alert (must be early, before market features)
        Market.networkAlert.initialize();

        // Start capturing client data from localStorage (for Combat Sim export)
        webSocketHook.captureClientDataFromLocalStorage();

        // Register all features from libraries
        registerFeatures();

        // Initialize action panel observer (special case - not a regular feature)
        Actions.initActionPanelObserver();

        // Initialize storage and config THIRD (async)
        (async () => {
            try {
                // Initialize storage (opens IndexedDB)
                await storage.initialize();

                // Initialize config (loads settings from storage)
                await config.initialize();

                // Add beforeunload handler to flush all pending writes
                window.addEventListener('beforeunload', () => {
                    storage.flushAll();
                });

                // Initialize Data Manager immediately
                // Don't wait for localStorageUtil - it handles missing data gracefully
                dataManager.initialize();
            } catch (error) {
                console.error('[Toolasha] Storage/config initialization failed:', error);
                // Initialize anyway
                dataManager.initialize();
            }
        })();

        // Setup character switch handler once (NOT inside character_initialized listener)
        featureRegistry.setupCharacterSwitchHandler();

        dataManager.on('character_initialized', (_data) => {
            // Skip full initialization during character switches
            // The character_switched handler in feature-registry already handles reinitialization
            if (_data._isCharacterSwitch) {
                return;
            }

            // Initialize all features using the feature registry
            setTimeout(async () => {
                try {
                    // Reload config settings with character-specific data
                    await config.loadSettings();
                    config.applyColorSettings();

                    // Initialize Settings UI after character data is loaded
                    await UI.settingsUI.initialize().catch((error) => {
                        console.error('[Toolasha] Settings UI initialization failed:', error);
                    });

                    await featureRegistry.initializeFeatures();

                    // Health check after initialization
                    setTimeout(async () => {
                        const failedFeatures = featureRegistry.checkFeatureHealth();

                        // Note: Settings tab health check removed - tab only appears when user opens settings panel

                        if (failedFeatures.length > 0) {
                            console.warn(
                                '[Toolasha] Health check found failed features:',
                                failedFeatures.map((f) => f.name)
                            );

                            setTimeout(async () => {
                                await featureRegistry.retryFailedFeatures(failedFeatures);

                                // Final health check
                                const stillFailed = featureRegistry.checkFeatureHealth();
                                if (stillFailed.length > 0) {
                                    console.warn(
                                        '[Toolasha] These features could not initialize:',
                                        stillFailed.map((f) => f.name)
                                    );
                                    console.warn(
                                        '[Toolasha] Try refreshing the page or reopening the relevant game panels'
                                    );
                                }
                            }, 1000);
                        }
                    }, 500); // Wait 500ms after initialization to check health
                } catch (error) {
                    console.error('[Toolasha] Feature initialization failed:', error);
                }
            }, 100);
        });

        // Expose minimal user-facing API
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        targetWindow.Toolasha.version = '0.14.3';

        // Feature toggle API (for users to manage settings via console)
        targetWindow.Toolasha.features = {
            list: () => config.getFeaturesByCategory(),
            enable: (key) => config.setFeatureEnabled(key, true),
            disable: (key) => config.setFeatureEnabled(key, false),
            toggle: (key) => config.toggleFeature(key),
            status: (key) => config.isFeatureEnabled(key),
            info: (key) => config.getFeatureInfo(key),
        };
    }

})();
