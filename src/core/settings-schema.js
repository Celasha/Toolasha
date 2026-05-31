/**
 * Settings Configuration
 * Organizes all script settings into logical groups for the settings UI
 */

import '../core/i18n-zh-CN.js';
import { t } from '../core/i18n.js';

export const settingsGroups = {
    ironCow: {
        title: t('Iron Cow Mode'),
        icon: '🐄',
        settings: {
            ironCow_enabled: {
                id: 'ironCow_enabled',
                label: t('Iron Cow Mode'),
                type: 'checkbox',
                default: false,
                hidden: true,
                help: t('Disable all market and profit features for a no-marketplace playthrough.'),
            },
        },
    },
    general: {
        title: t('General Settings'),
        icon: '⚙️',
        settings: {
            networkAlert: {
                id: 'networkAlert',
                label: t('Show alert when market price data cannot be fetched'),
                type: 'checkbox',
                default: true,
            },
            chatCommands: {
                id: 'chatCommands',
                label: t('Enable chat commands (/item, /wiki, /market)'),
                type: 'checkbox',
                default: true,
                help: t('Type /item, /wiki, or /market followed by an item name in chat. Example: /item radiant fiber'),
            },
            chat_mentionTracker: {
                id: 'chat_mentionTracker',
                label: t('Show badge when mentioned in chat'),
                type: 'checkbox',
                default: true,
                help: t('Displays a red badge on chat tabs when someone @mentions you'),
            },
            chat_popOut: {
                id: 'chat_popOut',
                label: t('Enable Pop-out Chat Window button'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a button to the chat panel to open chat in a separate browser window with multi-channel split view'
                ),
            },
            chatHistoryExtender: {
                id: 'chatHistoryExtender',
                label: t('Chat: Extend chat history'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Preserves messages that the game removes from the live buffer, keeping them visible above the live chat'
                ),
            },
            chatHistoryExtender_maxHistory: {
                id: 'chatHistoryExtender_maxHistory',
                label: t('Chat: Max messages to retain per tab'),
                type: 'text',
                default: '150',
            },
            altClickNavigation: {
                id: 'altClickNavigation',
                label: t('Alt+click items to navigate to crafting/gathering or dictionary'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Hold Alt/Option and click any item to navigate to its crafting/gathering page, or item dictionary if not craftable'
                ),
            },
            collectionNavigation: {
                id: 'collectionNavigation',
                label: t('Add navigation buttons to collection items'),
                type: 'checkbox',
                default: true,
                help: t('Adds View Action and Item Dictionary buttons when clicking collection items'),
            },
            queueMonitor: {
                id: 'queueMonitor',
                label: t('Cross-character queue monitor'),
                type: 'checkbox',
                default: false,
                help: t('Shows estimated queue time remaining for your other characters in a floating widget'),
            },
        },
    },

    actionPanel: {
        title: t('Action Panel Enhancements'),
        icon: '⚡',
        settings: {
            actionBar_enabled: {
                id: 'actionBar_enabled',
                label: t('Action bar: Enable action bar display'),
                type: 'checkbox',
                default: true,
            },
            actionBar_compactWidth: {
                id: 'actionBar_compactWidth',
                label: t('Action bar: Compact width (800px limit)'),
                type: 'checkbox',
                default: false,
                help: t('Limits action bar width to 800px. Useful for wide monitors.'),
            },
            actionBar_showQueueCount: {
                id: 'actionBar_showQueueCount',
                label: t('Action bar: Queue/remaining count'),
                type: 'checkbox',
                default: true,
            },
            actionBar_showActionDuration: {
                id: 'actionBar_showActionDuration',
                label: t('Action bar: Time per action (e.g. 14.94s/action)'),
                type: 'checkbox',
                default: true,
            },
            actionBar_showActionsPerHour: {
                id: 'actionBar_showActionsPerHour',
                label: t('Action bar: Actions/hr and items/hr'),
                type: 'checkbox',
                default: true,
            },
            actionBar_showTimeRemaining: {
                id: 'actionBar_showTimeRemaining',
                label: t('Action bar: Time remaining and completion ETA'),
                type: 'checkbox',
                default: true,
            },
            actionBar_showRecycleTime: {
                id: 'actionBar_showRecycleTime',
                label: t('Action bar: Transmute recycle time estimate'),
                type: 'checkbox',
                default: true,
                help: t('Shows estimated total time accounting for self-return recycling during transmute actions'),
            },
            actionPanel_liveCountdown: {
                id: 'actionPanel_liveCountdown',
                label: t('Action bar: Live countdown timer'),
                type: 'checkbox',
                default: false,
                help: t('Replaces the static time display on the action progress bar with a live countdown in seconds'),
            },
            actionPanel_totalTime: {
                id: 'actionPanel_totalTime',
                label: t('Action panel: Total time, times to reach target level, exp/hour'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_totalTime_quickInputs: {
                id: 'actionPanel_totalTime_quickInputs',
                label: t('Action panel: Quick input buttons (hours, count presets, Max)'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_quickInputs_countPresets: {
                id: 'actionPanel_quickInputs_countPresets',
                label: t('Action panel: Custom count presets (comma-separated, e.g. 100,1000,1000000)'),
                type: 'text',
                default: '',
            },
            actionPanel_quickInputs_hourPresets: {
                id: 'actionPanel_quickInputs_hourPresets',
                label: t('Action panel: Custom hour presets (comma-separated, e.g. 0.5,1,24,168,720)'),
                type: 'text',
                default: '',
            },
            actionPanel_foragingTotal: {
                id: 'actionPanel_foragingTotal',
                label: t('Action panel: Overall profit for multi-outcome foraging'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_showFilter: {
                id: 'actionPanel_showFilter',
                label: t('Skill page: Filter actions input'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_showSort: {
                id: 'actionPanel_showSort',
                label: t('Skill page: Sort button'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_showPricingMode: {
                id: 'actionPanel_showPricingMode',
                label: t('Skill page: Pricing mode button'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_showCraftToggle: {
                id: 'actionPanel_showCraftToggle',
                label: t('Skill page: Craft toggle button'),
                type: 'checkbox',
                default: true,
            },
            actionQueue: {
                id: 'actionQueue',
                label: t('Queued actions: Show total time and completion time'),
                type: 'checkbox',
                default: true,
            },
            actionQueue_showValue: {
                id: 'actionQueue_showValue',
                label: t('Queued actions: Show profit/value for queued actions'),
                type: 'checkbox',
                default: true,
            },
            actionPanel_enhanceMatLimitProtections: {
                id: 'actionPanel_enhanceMatLimitProtections',
                label: t('Enhancement material limit: Include protection items'),
                type: 'checkbox',
                default: true,
                help: t(
                    'When enabled, protection item availability is factored into the material limit estimate. Disable to see material limit based only on enhancement materials.'
                ),
            },
            actionQueue_valueMode: {
                id: 'actionQueue_valueMode',
                label: t('Queued actions: Value calculation mode'),
                type: 'select',
                default: 'profit',
                options: [
                    { value: 'profit', label: t('Total Profit (revenue - all costs)') },
                    { value: 'estimated_value', label: t('Estimated Value (revenue after tax)') },
                ],
                help: t(
                    'Choose how to calculate the total value for queued actions. Profit shows net earnings after materials and drinks. Estimated Value shows gross revenue after market tax (always positive).'
                ),
            },
            actionPanel_outputTotals: {
                id: 'actionPanel_outputTotals',
                label: t('Action panel: Show total expected outputs below per-action outputs'),
                type: 'checkbox',
                default: true,
                help: t('Displays calculated totals when you enter a quantity in the action input'),
            },
            actionPanel_maxProduceable: {
                id: 'actionPanel_maxProduceable',
                label: t('Action panel: Show max produceable count on crafting actions'),
                type: 'checkbox',
                default: true,
                help: t('Displays how many items you can make based on current inventory'),
            },
            actionPanel_showProfitPerHour: {
                id: 'actionPanel_showProfitPerHour',
                label: t('Action page: Show profit/hr on tiles'),
                type: 'checkbox',
                default: true,
                help: t('Displays profit/hr on each action tile in the action list page'),
            },
            actionPanel_showProfitDetail: {
                id: 'actionPanel_showProfitDetail',
                label: t('Action panel: Show profitability detail'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Displays the profitability breakdown section inside gathering, production, and alchemy action panels'
                ),
            },
            actionPanel_showLevelProgress: {
                id: 'actionPanel_showLevelProgress',
                label: t('Action panel: Show level progress'),
                type: 'checkbox',
                default: true,
                help: t('Displays XP and level progress estimates inside action panels'),
            },
            actionPanel_showExpPerHour: {
                id: 'actionPanel_showExpPerHour',
                label: t('Action page: Show exp/hr on tiles'),
                type: 'checkbox',
                default: true,
                help: t('Displays exp/hr on each action tile in the action list page'),
            },
            actionPanel_hideNegativeProfit: {
                id: 'actionPanel_hideNegativeProfit',
                label: t('Action panel: Hide actions with negative profit'),
                type: 'checkbox',
                default: false,
                help: t('Hides action panels that would result in a loss (negative profit/hr)'),
            },
            requiredMaterials: {
                id: 'requiredMaterials',
                label: t('Action panel: Show total required and missing materials'),
                type: 'checkbox',
                default: true,
                help: t('Displays total materials needed and shortfall when entering quantity'),
            },
            alchemy_profitDisplay: {
                id: 'alchemy_profitDisplay',
                label: t('Alchemy panel: Show profit calculator'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices'
                ),
            },
            alchemy_bestItems: {
                id: 'alchemy_bestItems',
                label: t('Alchemy panel: Show best items button'),
                type: 'checkbox',
                default: true,
                help: t('Adds a button to see items ranked by profit or XP for each alchemy type.'),
            },
            alchemy_transmuteHistory: {
                id: 'alchemy_transmuteHistory',
                label: t('Alchemy panel: Track and view transmute session history'),
                type: 'checkbox',
                default: true,
                help: t('Records transmutation sessions and displays history in a viewer tab in the Alchemy panel'),
            },
            alchemy_coinifyHistory: {
                id: 'alchemy_coinifyHistory',
                label: t('Alchemy panel: Track and view coinify session history'),
                type: 'checkbox',
                default: true,
                help: t('Records coinify sessions and displays history in a viewer tab in the Alchemy panel'),
            },
            alchemy_decomposeHistory: {
                id: 'alchemy_decomposeHistory',
                label: t('Alchemy panel: Track and view decompose session history'),
                type: 'checkbox',
                default: true,
                help: t('Records decompose sessions and displays history in a viewer tab in the Alchemy panel'),
            },
            alchemy_actionProtection: {
                id: 'alchemy_actionProtection',
                label: t('Alchemy panel: Protect categories from accidental alchemy actions'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Blocks alchemy action buttons for 3 seconds when the selected item belongs to a protected category. A shield icon appears in the alchemy panel to configure protected categories.'
                ),
            },
            actions_missingMaterialsButton: {
                id: 'actions_missingMaterialsButton',
                label: t('Show "Missing Mats Marketplace" button on production panels'),
                type: 'checkbox',
                default: true,
                help: t('Adds button to production panels that opens marketplace with tabs for missing materials'),
            },
            actions_missingMaterialsButton_ignoreQueue: {
                id: 'actions_missingMaterialsButton_ignoreQueue',
                label: t('Ignore queued actions when calculating missing materials'),
                type: 'checkbox',
                default: false,
                help: t(
                    'When enabled, missing materials calculation only considers current action request, ignoring materials already reserved by queued actions. Default (off) accounts for queue.'
                ),
            },
            actions_budgetCalculator: {
                id: 'actions_budgetCalculator',
                label: t('Action panel: Budget calculator'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a budget input below the Missing Mats button. Enter a gold budget (e.g. 50m) to calculate how many units you can produce by buying missing tradeable materials at ask price.'
                ),
            },
            actionPanel_bestCraftingPlan: {
                id: 'actionPanel_bestCraftingPlan',
                label: t('Action panel: Show best crafting plan'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Shows the cheapest way to obtain a crafted item by comparing buy vs craft at each material tier.'
                ),
            },
            actionPanel_craftingPlanBuyIntermediates: {
                id: 'actionPanel_craftingPlanBuyIntermediates',
                label: t('Action panel: Crafting plan buys raw materials only'),
                type: 'checkbox',
                default: false,
                help: t('Always craft items that have a recipe — only buy uncraftable raw materials from the market.'),
            },
            actionPanel_craftingPlanNoProcessing: {
                id: 'actionPanel_craftingPlanNoProcessing',
                label: t('Action panel: Crafting plan no processing'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Only craft the final item — buy all sub-materials from the market instead of processing them yourself.'
                ),
            },
            actionPanel_craftingPlanTaskMode: {
                id: 'actionPanel_craftingPlanTaskMode',
                label: t('Action panel: Crafting plan task mode'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Forces the final craft step (for task credit) but allows buying intermediate materials if cheaper.'
                ),
            },
            actionPanel_craftingPlanTimeCost: {
                id: 'actionPanel_craftingPlanTimeCost',
                label: t('Action panel: Crafting plan time cost'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Factor in the time cost of crafting when deciding buy vs craft. Uses your gold/hr value to determine if crafting is worth your time.'
                ),
            },
            actionPanel_craftingPlanGoldPerHour: {
                id: 'actionPanel_craftingPlanGoldPerHour',
                label: t('Action panel: Crafting plan gold/hr value'),
                type: 'number',
                default: 0,
                help: t(
                    'Your time value in gold per hour. Used to calculate if crafting intermediates is worth the time. Set to your typical hourly profit (e.g., 500000).'
                ),
            },
            lootLogStats: {
                id: 'lootLogStats',
                label: t('Loot Log Statistics'),
                type: 'checkbox',
                default: true,
                help: t('Display total value, average time, and daily output in loot logs'),
            },
            lootLogHistory: {
                id: 'lootLogHistory',
                label: t('Loot Log: Persist and display historical entries'),
                type: 'checkbox',
                default: true,
                help: t('Saves loot log entries and displays older entries below current ones in the loot log panel'),
            },
            inventoryCountDisplay: {
                id: 'inventoryCountDisplay',
                label: t('Action panels: Show current inventory count of output item'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Shows how many of the output item you currently own, on action tiles and in the action detail panel'
                ),
            },
            actions_pinnedPage: {
                id: 'actions_pinnedPage',
                label: t('Pinned actions page in navigation bar'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a Pinned button to the left nav bar that shows all pinned actions in one list with skill, level, profit/hr, and XP/hr.'
                ),
            },
        },
    },

    tooltips: {
        title: t('Item Tooltip Enhancements'),
        icon: '💬',
        settings: {
            itemTooltip_prices: {
                id: 'itemTooltip_prices',
                label: t('Show 24-hour average market prices'),
                type: 'checkbox',
                default: true,
            },
            itemTooltip_artisanPrices: {
                id: 'itemTooltip_artisanPrices',
                label: t('Adjust tooltip prices for Artisan Tea reduction'),
                type: 'checkbox',
                default: true,
                help: t(
                    'When viewing a recipe on an action panel, adjusts the total price to reflect actual material cost after Artisan Tea reduction'
                ),
            },
            itemTooltip_profit: {
                id: 'itemTooltip_profit',
                label: t('Show production cost and profit'),
                type: 'checkbox',
                default: true,
            },
            itemTooltip_detailedProfit: {
                id: 'itemTooltip_detailedProfit',
                label: t('Show detailed materials breakdown in profit display'),
                type: 'checkbox',
                default: false,
                help: t('Shows material costs table with Ask/Bid prices, actions/hour, and profit breakdown'),
            },
            itemTooltip_multiActionProfit: {
                id: 'itemTooltip_multiActionProfit',
                label: t('Show profit comparison for all item actions'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Displays best profit/hr highlighted, with other alternative actions (craft, coinify, decompose, transmute) summarized below'
                ),
            },
            profitCalc_craftUpgradeItems: {
                id: 'profitCalc_craftUpgradeItems',
                label: t('Profit: Use crafting cost for upgrade items if cheaper'),
                type: 'checkbox',
                default: true,
                help: t(
                    'When enabled, uses crafting cost instead of market price for upgrade items if cheaper, and factors crafting time into profit/hr calculations.'
                ),
            },
            itemTooltip_expectedValue: {
                id: 'itemTooltip_expectedValue',
                label: t('Show expected value for openable containers'),
                type: 'checkbox',
                default: true,
            },
            expectedValue_showDrops: {
                id: 'expectedValue_showDrops',
                label: t('Expected value drop display'),
                type: 'select',
                default: 'All',
                options: [
                    { value: 'Top 5', label: t('Top 5') },
                    { value: 'Top 10', label: t('Top 10') },
                    { value: 'All', label: t('All Drops') },
                    { value: 'None', label: t('Summary Only') },
                ],
            },
            expectedValue_respectPricingMode: {
                id: 'expectedValue_respectPricingMode',
                label: t('Use pricing mode for expected value calculations'),
                type: 'checkbox',
                default: true,
            },
            expectedValue_includeCowbells: {
                id: 'expectedValue_includeCowbells',
                label: t('Include cowbell value in expected value calculations'),
                type: 'checkbox',
                default: true,
            },
            showConsumTips: {
                id: 'showConsumTips',
                label: t('HP/MP consumables: Restore speed, cost performance'),
                type: 'checkbox',
                default: true,
            },
            dungeonTokenTooltips: {
                id: 'dungeonTokenTooltips',
                label: t('Currency tooltips: Show shop values for tokens, seals, and cowbells'),
                type: 'checkbox',
                default: true,
            },
            enhanceSim: {
                id: 'enhanceSim',
                label: t('Show enhancement simulator calculations'),
                type: 'checkbox',
                default: true,
            },
            enhanceSim_showConsumedItemsDetail: {
                id: 'enhanceSim_showConsumedItemsDetail',
                label: t('Enhancement tooltips: Show detailed breakdown for consumed items'),
                type: 'checkbox',
                default: false,
                help: "When enabled, shows base/materials/protection breakdown for each consumed item in Philosopher's Mirror calculations",
            },
            enhanceSim_baseItemCraftingCost: {
                id: 'enhanceSim_baseItemCraftingCost',
                label: t('Enhancement path: Use crafting cost for base item if cheaper'),
                type: 'checkbox',
                default: false,
                help: t(
                    'When enabled, uses the lower of crafting cost or market price for the base item in enhancement path calculations, applied independently to both the Ask and Bid columns'
                ),
            },
            itemTooltip_gathering: {
                id: 'itemTooltip_gathering',
                label: t('Show gathering sources and profit'),
                type: 'checkbox',
                default: true,
                help: t('Shows gathering actions that produce this item (foraging, woodcutting, milking)'),
            },
            itemTooltip_gatheringRareDrops: {
                id: 'itemTooltip_gatheringRareDrops',
                label: t('Show rare drops from gathering'),
                type: 'checkbox',
                default: true,
                help: t('Shows rare find drops from gathering zones (e.g., Thread of Expertise from Asteroid Belt)'),
            },
            itemTooltip_abilityStatus: {
                id: 'itemTooltip_abilityStatus',
                label: t('Show ability book status'),
                type: 'checkbox',
                default: true,
                help: t('Shows whether ability is learned and current level/progress on ability book tooltips'),
            },
            itemTooltip_enhancementMilestones: {
                id: 'itemTooltip_enhancementMilestones',
                label: t('Show enhancement milestones (+5/+7/+10/+12)'),
                type: 'checkbox',
                default: false,
                help: t('Shows expected cost and XP to reach +5, +7, +10, and +12 on unenhanced equipment tooltips'),
            },
            itemTooltip_enhancementPath: {
                id: 'itemTooltip_enhancementPath',
                label: t('Show enhancement path on enhanced items'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Shows the optimal enhancement path cost breakdown when hovering over enhanced (+1 to +20) items'
                ),
            },
            itemTooltip_pinTop: {
                id: 'itemTooltip_pinTop',
                label: t('Pin tooltips to top-center of screen'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Forces item tooltips to always appear centered at the top of the screen instead of near the hovered item'
                ),
            },
            itemTooltip_hideInEnhanceSelector: {
                id: 'itemTooltip_hideInEnhanceSelector',
                label: t('Hide tooltip extras in enhance item selector'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Suppresses injected tooltip content (prices, profit, milestones) when browsing items in the enhancement selector'
                ),
            },
        },
    },

    enhancementSimulator: {
        title: t('Enhancement Simulator Settings'),
        icon: '✨',
        settings: {
            enhanceSim_autoDetect: {
                id: 'enhanceSim_autoDetect',
                label: t('Auto-detect your stats (false = use settings below)'),
                type: 'checkbox',
                default: false,
                help: t('Most players should leave this off to see realistic professional enhancer costs'),
            },
            // --- ENHANCING ---
            enhanceSim_enhancingLevel: {
                id: 'enhanceSim_enhancingLevel',
                label: t('Enhancing skill level'),
                type: 'number',
                default: 140,
                min: 1,
                max: 200,
                help: t('Default: 140 (professional enhancer level)'),
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_houseLevel: {
                id: 'enhanceSim_houseLevel',
                label: t('Observatory house room level'),
                type: 'number',
                default: 8,
                min: 0,
                max: 8,
                help: t('Default: 8 (max level)'),
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_achievement: {
                id: 'enhanceSim_achievement',
                label: t('Achievement bonus (+0.2%)'),
                type: 'checkbox',
                default: false,
                help: t('Include enhancing achievement success bonus'),
                disabledBy: 'enhanceSim_autoDetect',
            },
            // --- GEAR (compact rows: checkbox + optional tier + enhancement level) ---
            enhanceSim_gear_enhancer: {
                id: 'enhanceSim_gear_enhancer',
                label: t('Enhancer'),
                type: 'enhanceGear',
                default: { enabled: true, tier: 'celestial', level: 13 },
                tiers: [
                    { value: 'cheese', label: t('Cheese') },
                    { value: 'verdant', label: t('Verdant') },
                    { value: 'azure', label: t('Azure') },
                    { value: 'burble', label: t('Burble') },
                    { value: 'crimson', label: t('Crimson') },
                    { value: 'rainbow', label: t('Rainbow') },
                    { value: 'holy', label: t('Holy') },
                    { value: 'celestial', label: t('Celestial') },
                ],
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_gloves: {
                id: 'enhanceSim_gear_gloves',
                label: t('Gloves'),
                type: 'enhanceGear',
                default: { enabled: true, level: 10 },
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_top: {
                id: 'enhanceSim_gear_top',
                label: t('Top'),
                type: 'enhanceGear',
                default: { enabled: true, level: 10 },
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_bottoms: {
                id: 'enhanceSim_gear_bottoms',
                label: t('Bottoms'),
                type: 'enhanceGear',
                default: { enabled: true, level: 10 },
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_neck: {
                id: 'enhanceSim_gear_neck',
                label: t('Neck'),
                type: 'enhanceGear',
                default: { enabled: true, tier: 'philo', level: 10 },
                tiers: [
                    { value: 'philo', label: t('Philo') },
                    { value: 'speed', label: t('Speed') },
                ],
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_ring: {
                id: 'enhanceSim_gear_ring',
                label: t('Ring'),
                type: 'enhanceGear',
                default: { enabled: true, tier: 'philo', level: 10 },
                tiers: [
                    { value: 'philo', label: t('Philo') },
                    { value: 'rarefind', label: t('Rare Find') },
                ],
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_earring: {
                id: 'enhanceSim_gear_earring',
                label: t('Earring'),
                type: 'enhanceGear',
                default: { enabled: true, tier: 'philo', level: 10 },
                tiers: [
                    { value: 'philo', label: t('Philo') },
                    { value: 'rarefind', label: t('Rare Find') },
                ],
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_cape: {
                id: 'enhanceSim_gear_cape',
                label: t('Cape'),
                type: 'enhanceGear',
                default: { enabled: true, tier: 'normal', level: 5 },
                tiers: [
                    { value: 'normal', label: t('Normal') },
                    { value: 'refined', label: t('Refined') },
                ],
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_guzzling: {
                id: 'enhanceSim_gear_guzzling',
                label: t('Guzzling'),
                type: 'enhanceGear',
                default: { enabled: true, level: 10 },
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_gear_charm: {
                id: 'enhanceSim_gear_charm',
                label: t('Charm'),
                type: 'enhanceGear',
                default: { enabled: true, tier: 'grandmaster', level: 0 },
                tiers: [
                    { value: 'trainee', label: t('Trainee') },
                    { value: 'basic', label: t('Basic') },
                    { value: 'advanced', label: t('Advanced') },
                    { value: 'expert', label: t('Expert') },
                    { value: 'master', label: t('Master') },
                    { value: 'grandmaster', label: t('Grandmaster') },
                ],
                disabledBy: 'enhanceSim_autoDetect',
            },
            // --- BUFFS ---
            enhanceSim_tea: {
                id: 'enhanceSim_tea',
                label: t('Enhancing tea'),
                type: 'select',
                default: 'ultra',
                options: [
                    { value: 'none', label: t('None') },
                    { value: 'basic', label: t('Enhancing Tea (+3)') },
                    { value: 'super', label: t('Super Enhancing Tea (+6)') },
                    { value: 'ultra', label: t('Ultra Enhancing Tea (+8)') },
                ],
                help: t('Enhancing tea provides skill level bonus'),
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_blessedTea: {
                id: 'enhanceSim_blessedTea',
                label: t('Blessed Tea active'),
                type: 'checkbox',
                default: true,
                help: t('Professional enhancers use this to reduce attempts'),
                disabledBy: 'enhanceSim_autoDetect',
            },
            enhanceSim_communityBuff: {
                id: 'enhanceSim_communityBuff',
                label: t('Community Buff'),
                type: 'enhanceGear',
                default: { enabled: true, level: 1 },
                help: t('Enhancing speed community buff. Checked = auto-detect from game.'),
                checkedMeansAuto: true,
                disabledBy: 'enhanceSim_autoDetect',
            },
        },
    },

    enhancementTracker: {
        title: t('Enhancement Tracker'),
        icon: '📊',
        settings: {
            enhancementTracker: {
                id: 'enhancementTracker',
                label: t('Enable Enhancement Tracker'),
                type: 'checkbox',
                default: false,
                help: t('Track enhancement attempts, costs, and statistics'),
            },
            enhancementTracker_showOnlyOnEnhancingScreen: {
                id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                label: t('Show tracker only on Enhancing screen'),
                type: 'checkbox',
                default: false,
                help: t('Hide tracker when not on the Enhancing screen'),
            },
            enhancementXPH: {
                id: 'enhancementXPH',
                label: t('Enhancement: XPH calculator'),
                type: 'checkbox',
                default: true,
                help: t('Ranks all enhanceable items by expected XP per hour at your current stats'),
            },
            enhancementXPH_maxLevel: {
                id: 'enhancementXPH_maxLevel',
                label: t('Enhancement XPH: Default max enhancement level (1–20)'),
                type: 'text',
                default: '6',
            },
            enhancementXPH_protectFrom: {
                id: 'enhancementXPH_protectFrom',
                label: t('Enhancement XPH: Default protect from level (0 = no protection)'),
                type: 'text',
                default: '0',
            },
        },
    },

    economy: {
        title: t('Economy & Inventory'),
        icon: '💰',
        settings: {
            networth: {
                id: 'networth',
                label: t('Top right: Show current assets (net worth)'),
                type: 'checkbox',
                default: true,
                help: t('Enhanced items valued by enhancement simulator'),
            },
            invWorth: {
                id: 'invWorth',
                label: t('Below inventory: Show inventory summary'),
                type: 'checkbox',
                default: true,
            },
            invSort: {
                id: 'invSort',
                label: t('Sort inventory items by value'),
                type: 'checkbox',
                default: true,
            },
            invSort_showBadges: {
                id: 'invSort_showBadges',
                label: t('Show stack value badges when sorting by Ask/Bid'),
                type: 'checkbox',
                default: false,
            },
            invSort_badgesOnNone: {
                id: 'invSort_badgesOnNone',
                label: t('Badge type when "None" sort is selected'),
                type: 'select',
                default: 'None',
                options: ['None', 'Ask', 'Bid'],
            },
            invSort_netOfTax: {
                id: 'invSort_netOfTax',
                label: t('Show badge values net of market tax'),
                type: 'checkbox',
                default: false,
            },
            invSort_sortEquipment: {
                id: 'invSort_sortEquipment',
                label: t('Enable sorting for Equipment category'),
                type: 'checkbox',
                default: false,
            },
            invBadgePrices: {
                id: 'invBadgePrices',
                label: t('Show price badges on item icons'),
                type: 'checkbox',
                default: false,
                help: t('Displays per-item ask and bid prices on inventory items'),
            },
            invCategoryTotals: {
                id: 'invCategoryTotals',
                label: t('Show category totals in inventory'),
                type: 'checkbox',
                default: true,
                help: t('Displays the total market value of all items in each inventory category'),
            },
            profitCalc_pricingMode: {
                id: 'profitCalc_pricingMode',
                label: t('Profit calculation pricing mode'),
                type: 'select',
                default: 'hybrid',
                options: [
                    { value: 'conservative', label: t('Buy: Ask / Sell: Bid (Instant Buy / Instant Sell)') },
                    { value: 'hybrid', label: t('Buy: Ask / Sell: Ask (Instant Buy / Patient Sell)') },
                    { value: 'optimistic', label: t('Buy: Bid / Sell: Ask (Patient Buy / Patient Sell)') },
                    { value: 'patientBuy', label: t('Buy: Bid / Sell: Bid (Patient Buy / Instant Sell)') },
                ],
            },
            profitCalc_pricingNaming: {
                id: 'profitCalc_pricingNaming',
                label: t('Pricing mode naming convention'),
                type: 'checkbox',
                default: false,
                help: t('Show pricing modes as "Instant Buy / Instant Sell" instead of "Buy: Ask / Sell: Bid"'),
            },
            profitCalc_keyPricingMode: {
                id: 'profitCalc_keyPricingMode',
                label: t('Key pricing mode'),
                type: 'select',
                default: 'ask',
                options: ['ask', 'bid'],
                help: t(
                    'Whether to use ask (instant buy) or bid (patient buy) prices when valuing dungeon keys in tooltips, networth, and combat income calculations.'
                ),
            },
            profitCalc_customPriceOverrides: {
                id: 'profitCalc_customPriceOverrides',
                label: t('Custom price overrides'),
                type: 'customPriceOverrides',
                default: {},
                help: t(
                    'Set custom buy/sell prices for specific items. Overrides marketplace prices in profit calculations.'
                ),
            },
            actions_artisanMaterialMode: {
                id: 'actions_artisanMaterialMode',
                label: t('Missing materials: Artisan requirement mode'),
                type: 'select',
                default: 'expected',
                options: [
                    { value: 'expected', label: t('Expected value (average)') },
                    { value: 'worst-case', label: t('Worst-case per action (ceil per craft)') },
                ],
                help: t(
                    'Choose how missing materials accounts for Artisan Tea reductions when suggesting what to buy.'
                ),
            },
            networth_highEnhancementUseCost: {
                id: 'networth_highEnhancementUseCost',
                label: t('Use enhancement cost for highly enhanced items'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.'
                ),
            },
            networth_highEnhancementMinLevel: {
                id: 'networth_highEnhancementMinLevel',
                label: t('Minimum enhancement level to use cost'),
                type: 'select',
                default: 13,
                options: [
                    { value: 10, label: t('+10 and above') },
                    { value: 11, label: t('+11 and above') },
                    { value: 12, label: t('+12 and above') },
                    { value: 13, label: t('+13 and above (recommended)') },
                    { value: 15, label: t('+15 and above') },
                ],
                help: t('Enhancement level at which to stop trusting market prices'),
            },
            networth_includeCowbells: {
                id: 'networth_includeCowbells',
                label: t('Include cowbells in net worth'),
                type: 'checkbox',
                default: false,
                help: t('Cowbells are not tradeable, but they have a value based on Bag of 10 Cowbells market price'),
            },
            networth_includeTaskTokens: {
                id: 'networth_includeTaskTokens',
                label: t('Include task tokens in net worth'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Value task tokens based on expected value from Task Shop chests. Disable to exclude them from net worth.'
                ),
            },
            networth_abilityBooksAsInventory: {
                id: 'networth_abilityBooksAsInventory',
                label: t('Count ability books as inventory (Current Assets)'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Move ability books from Fixed Assets to Current Assets inventory value. Useful if you plan to sell them.'
                ),
            },
            networth_historyChart: {
                id: 'networth_historyChart',
                label: t('Enable net worth history chart'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Records hourly net worth snapshots and shows a chart icon next to Total Net Worth. Disable to stop tracking and hide the chart button.'
                ),
            },
            autoAllButton: {
                id: 'autoAllButton',
                label: t('Auto-click "All" button when opening loot boxes'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Automatically clicks the "All" button when opening openable containers (crates, chests, caches)'
                ),
            },
            autoAllButton_excludeSeals: {
                id: 'autoAllButton_excludeSeals',
                label: t('Auto-click "All": Skip Scroll of... items'),
                type: 'checkbox',
                default: true,
                help: t('When enabled, Scroll of... items from the Labyrinth are not auto-opened'),
            },
        },
    },

    inventoryTabs: {
        title: t('Custom Inventory Tabs'),
        icon: '🗂️',
        settings: {
            inventoryTabs: {
                id: 'inventoryTabs',
                label: t('Custom Inventory Tabs: Enable'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a Toolasha tab to the character panel where you can organize inventory items into personal tabs.'
                ),
            },
            inventoryTabs_showUnorganized: {
                id: 'inventoryTabs_showUnorganized',
                label: t('Custom Inventory Tabs: Show Unorganized bucket'),
                type: 'checkbox',
                default: true,
                help: t('Show an "Unorganized" section containing all items not assigned to any tab.'),
            },
            inventoryTabs_categoryAddAll: {
                id: 'inventoryTabs_categoryAddAll',
                label: t('Custom Inventory Tabs: Add all items when adding category'),
                type: 'checkbox',
                default: false,
                hidden: true,
                help: t(
                    'When adding a category to a tab, add every item in that category (including items not in your inventory). When disabled, only items currently in your inventory are added.'
                ),
            },
            inventoryTabs_defaultTab: {
                id: 'inventoryTabs_defaultTab',
                label: t('Custom Inventory Tabs: Show Toolasha tab by default'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Hides the native Inventory tab and automatically activates the Toolasha tab whenever the character panel opens.'
                ),
            },
            inventoryTabs_tileGap: {
                id: 'inventoryTabs_tileGap',
                label: t('Custom Inventory Tabs: Item spacing (px)'),
                type: 'number',
                default: 4,
                min: 0,
                max: 20,
                step: 1,
                help: t('Pixel gap between item tiles on the Toolasha tab.'),
            },
            inventoryTabs_loadoutIncludeConsumables: {
                id: 'inventoryTabs_loadoutIncludeConsumables',
                label: t('Custom Inventory Tabs: Include food & drinks when adding from loadout'),
                type: 'checkbox',
                default: false,
                help: t('When adding items from a loadout to a tab, also include food and drink items.'),
            },
            inventoryTabs_topTabPriority: {
                id: 'inventoryTabs_topTabPriority',
                label: t('Custom Inventory Tabs: Items visible in topmost tab only'),
                type: 'checkbox',
                default: true,
                help: t(
                    'When an item appears in multiple tabs, it only shows in the highest (topmost) tab that contains it. When disabled, collapsing a tab releases its items to lower tabs.'
                ),
            },
        },
    },

    skills: {
        title: t('Skills'),
        icon: '📚',
        settings: {
            simulateScrollEffects: {
                id: 'simulateScrollEffects',
                label: t('Skills: Simulate missing scroll effects in calculations'),
                type: 'checkboxWithButton',
                buttonLabel: t('Defaults...'),
                default: false,
                help: t(
                    'When enabled, profit/XP/speed calculations show hypothetical results as if selected scrolls were active. Configure default scrolls with the button; override per-loadout from the Loadouts panel.'
                ),
            },
            xpTracker: {
                id: 'xpTracker',
                label: t('Left sidebar: Show XP/hr rate on skill bars'),
                type: 'checkbox',
                default: true,
                help: t('Displays live XP/hr rate under each skill bar in the navigation panel'),
            },
            xpTracker_timeTillLevel: {
                id: 'xpTracker_timeTillLevel',
                label: t('Skill tooltip: Show time till next level'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Shows estimated time remaining until the next level in the skill hover tooltip (based on current XP/hr)'
                ),
            },
            skillRemainingXP: {
                id: 'skillRemainingXP',
                label: t('Left sidebar: Show remaining XP to next level'),
                type: 'checkbox',
                default: true,
                help: t('Displays how much XP needed to reach the next level under skill progress bars'),
            },
            skillRemainingXP_blackBorder: {
                id: 'skillRemainingXP_blackBorder',
                label: t('Remaining XP: Add black text border for better visibility'),
                type: 'checkbox',
                default: true,
                help: t('Adds a black outline/shadow to the XP text for better readability against progress bars'),
            },
            skillbook: {
                id: 'skillbook',
                label: t(
                    'Skill books: Show books needed to reach target level (in the ability book item dictionary window)'
                ),
                type: 'checkbox',
                default: true,
            },
        },
    },

    combat: {
        title: t('Combat Features'),
        icon: '⚔️',
        settings: {
            combatScore: {
                id: 'combatScore',
                label: t('Profile panel: Show gear score'),
                type: 'checkbox',
                default: true,
            },
            abilitiesTriggers: {
                id: 'abilitiesTriggers',
                label: t('Profile panel: Show abilities & triggers'),
                type: 'checkbox',
                default: true,
                help: t('Displays equipped abilities, consumables, and their combat triggers below the profile'),
            },
            characterCard: {
                id: 'characterCard',
                label: t('Profile panel: Show View Card button'),
                type: 'checkbox',
                default: true,
                help: t('Adds button to open character sheet in external viewer'),
            },
            dungeonTracker: {
                id: 'dungeonTracker',
                label: t('Dungeon Tracker: Real-time progress tracking'),
                type: 'checkbox',
                default: true,
                help: t('Tracks dungeon runs with server-validated duration from party messages'),
            },
            dungeonTrackerUI: {
                id: 'dungeonTrackerUI',
                label: t('Show Dungeon Tracker UI panel'),
                type: 'checkbox',
                default: true,
                help: t('Displays dungeon progress panel with wave counter, run history, and statistics'),
            },
            dungeonTrackerChatAnnotations: {
                id: 'dungeonTrackerChatAnnotations',
                label: t('Show run time in party chat'),
                type: 'checkbox',
                default: true,
                help: t('Adds colored timer annotations to "Key counts" messages (green if fast, red if slow)'),
            },
            labyrinthTracker: {
                id: 'labyrinthTracker',
                label: t('Labyrinth best level tracker'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Tracks the highest recommended level enemy defeated per monster type and shows it in the Automation tab'
                ),
            },
            labyrinthShopPrices: {
                id: 'labyrinthShopPrices',
                label: t('Labyrinth Shop: Show market prices'),
                type: 'checkbox',
                default: true,
                help: t('Shows ask/bid market prices on tradeable items in the Labyrinth Shop tab'),
            },
            labyrinthClearRate: {
                id: 'labyrinthClearRate',
                label: t('Labyrinth clear rate calculator'),
                type: 'checkbox',
                default: true,
                help: t('Shows expected clear time and success rate on labyrinth skilling room tiles'),
            },
            labyrinthRecommendTargetRate: {
                id: 'labyrinthRecommendTargetRate',
                label: t('Labyrinth: Recommend target clear rate (%)'),
                type: 'number',
                default: 70,
                min: 1,
                max: 100,
                step: 1,
                help: t('Default target clear rate for labyrinth skip threshold recommendations'),
            },
            labyrinthRecommendSimHours: {
                id: 'labyrinthRecommendSimHours',
                label: t('Labyrinth: Recommend sim hours per step'),
                type: 'number',
                default: 1,
                min: 1,
                max: 100,
                step: 1,
                help: t('Default hours of combat simulation per binary search step in recommendations'),
            },
            labyrinthLiveProgress: {
                id: 'labyrinthLiveProgress',
                label: t('Labyrinth: Show live clear chance'),
                type: 'checkbox',
                default: true,
                help: t('Shows live clear chance during active labyrinth skilling/enhancing rooms'),
            },
            combatBattleCounter: {
                id: 'combatBattleCounter',
                label: t('Show battle/wave counter in current action panel during combat'),
                type: 'checkbox',
                default: true,
                help: t('Displays "Battle #N" for regular zones or "Wave N" for dungeons in the top-left action panel'),
            },
            combatSummary: {
                id: 'combatSummary',
                label: t('Combat Summary: Show detailed statistics on return'),
                type: 'checkbox',
                default: true,
                help: t('Displays encounters/hour, revenue, experience rates when returning from combat'),
            },
            combatSim: {
                id: 'combatSim',
                label: t('Combat Simulator'),
                type: 'checkbox',
                default: true,
                help: t('Simulate combat encounters to estimate XP/hr, deaths, and consumable usage'),
            },
            combatSim_defaultHours: {
                id: 'combatSim_defaultHours',
                label: t('Combat Simulator: Default hours (single zone)'),
                type: 'number',
                default: 100,
                min: 1,
                max: 10000,
                step: 1,
                help: t('Default simulation duration in hours for single-zone runs'),
            },
            combatSim_allZonesDefaultHours: {
                id: 'combatSim_allZonesDefaultHours',
                label: t('Combat Simulator: Default hours (All Zones)'),
                type: 'number',
                default: 10,
                min: 1,
                max: 10000,
                step: 1,
                help: t('Default simulation duration in hours for All Zones runs'),
            },
            combatSim_seekDefaultHours: {
                id: 'combatSim_seekDefaultHours',
                label: t('Combat Simulator: Default hours (Seek)'),
                type: 'number',
                default: 10,
                min: 1,
                max: 10000,
                step: 1,
                help: t('Default simulation duration in hours for Seek Best Source runs'),
            },
            combatSim_decimalMinutes: {
                id: 'combatSim_decimalMinutes',
                label: t('Combat Simulator: Show completion time as decimal minutes'),
                type: 'checkbox',
                default: false,
                help: t('Display avg completion time as "X.XX min" instead of "Xm Ys"'),
            },
            combatStats: {
                id: 'combatStats',
                label: t('Combat Statistics: Show Statistics tab in Combat panel'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details'
                ),
            },
            combatStatsChatMessage: {
                id: 'combatStatsChatMessage',
                label: t('Combat Statistics: Chat message format'),
                type: 'template',
                default: [
                    { type: 'text', value: 'Combat Stats: ' },
                    { type: 'variable', key: '{duration}', label: t('Duration') },
                    { type: 'text', value: ' duration | ' },
                    { type: 'variable', key: '{encountersPerHour}', label: t('Encounters/Hour') },
                    { type: 'text', value: ' EPH | ' },
                    { type: 'variable', key: '{income}', label: t('Total Income') },
                    { type: 'text', value: ' income | ' },
                    { type: 'variable', key: '{dailyIncome}', label: t('Daily Income') },
                    { type: 'text', value: ' income/d | ' },
                    { type: 'variable', key: '{dailyConsumableCosts}', label: t('Daily Consumable Costs') },
                    { type: 'text', value: ' consumables/d | ' },
                    { type: 'variable', key: '{dailyProfit}', label: t('Daily Profit') },
                    { type: 'text', value: ' profit/d | ' },
                    { type: 'variable', key: '{exp}', label: t('EXP/Hour') },
                    { type: 'text', value: ' exp/h | ' },
                    { type: 'variable', key: '{deathCount}', label: t('Deaths') },
                    { type: 'text', value: ' deaths' },
                ],
                help: t(
                    'Message format when Ctrl+clicking player card in Statistics. Click "Edit Template" to customize.'
                ),
                templateVariables: [
                    { key: '{duration}', label: t('Duration'), description: 'Combat session duration' },
                    {
                        key: '{encountersPerHour}',
                        label: t('Encounters/Hour'),
                        description: 'Encounters per hour (EPH)',
                    },
                    { key: '{income}', label: t('Total Income'), description: 'Total income from combat' },
                    { key: '{dailyIncome}', label: t('Daily Income'), description: 'Income per day' },
                    {
                        key: '{dailyConsumableCosts}',
                        label: t('Daily Consumable Costs'),
                        description: 'Consumable costs per day',
                    },
                    { key: '{dailyProfit}', label: t('Daily Profit'), description: 'Profit per day' },
                    { key: '{exp}', label: t('EXP/Hour'), description: 'Experience per hour' },
                    { key: '{deathCount}', label: t('Deaths'), description: 'Number of deaths' },
                ],
            },
        },
    },

    tasks: {
        title: t('Tasks'),
        icon: '📋',
        settings: {
            taskProfitCalculator: {
                id: 'taskProfitCalculator',
                label: t('Show total profit for gathering/production tasks'),
                type: 'checkbox',
                default: true,
            },
            taskEfficiencyRating: {
                id: 'taskEfficiencyRating',
                label: t('Show task efficiency rating (tokens/profit per hour)'),
                type: 'checkbox',
                default: true,
                help: t('Displays a color-graded efficiency score based on expected completion time.'),
            },
            taskMaterialsIndicator: {
                id: 'taskMaterialsIndicator',
                label: t('Show materials availability on production tasks'),
                type: 'checkbox',
                default: true,
                help: t('Shows how many task actions you can complete with current inventory.'),
            },
            taskEfficiencyRatingMode: {
                id: 'taskEfficiencyRatingMode',
                label: t('Efficiency algorithm'),
                type: 'select',
                default: 'gold',
                options: [
                    { value: 'tokens', label: t('Task tokens per hour') },
                    { value: 'gold', label: t('Task profit per hour') },
                ],
                help: t('Choose whether to rate by task token payout or total profit.'),
            },
            taskEfficiencyGradient: {
                id: 'taskEfficiencyGradient',
                label: t('Use relative gradient colors'),
                type: 'checkbox',
                default: false,
                help: t('Colors efficiency ratings relative to visible tasks.'),
            },
            taskQueuedIndicator: {
                id: 'taskQueuedIndicator',
                label: t('Show "Queued" indicator on task cards'),
                type: 'checkbox',
                default: true,
                help: t('Displays a status message on task cards when their action is in your action queue'),
            },
            taskRerollTracker: {
                id: 'taskRerollTracker',
                label: t('Track task reroll costs'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)'
                ),
            },
            taskMapIndex: {
                id: 'taskMapIndex',
                label: t('Show combat zone index numbers on tasks'),
                type: 'checkbox',
                default: true,
            },
            taskIcons: {
                id: 'taskIcons',
                label: t('Show visual icons on task cards'),
                type: 'checkbox',
                default: true,
                help: t('Displays semi-transparent item/monster icons on task cards'),
            },
            taskIconsDungeons: {
                id: 'taskIconsDungeons',
                label: t('Show dungeon icons on combat tasks'),
                type: 'checkbox',
                default: false,
                help: t('Shows which dungeons contain the monster (requires Task Icons enabled)'),
            },
            taskSorter_autoSort: {
                id: 'taskSorter_autoSort',
                label: t('Automatically sort tasks when opening task panel'),
                type: 'checkbox',
                default: false,
                help: t('Automatically sorts tasks by skill type when you open the task panel'),
            },
            taskSorter_hideButton: {
                id: 'taskSorter_hideButton',
                label: t('Hide Sort Tasks button'),
                type: 'checkbox',
                default: false,
                help: t('Hides the Sort Tasks button while keeping auto-sort functional'),
            },
            taskSorter_sortMode: {
                id: 'taskSorter_sortMode',
                label: t('Task sort mode'),
                type: 'select',
                default: 'skill',
                options: [
                    { value: 'skill', label: t('Skill / Zone') },
                    { value: 'time', label: t('Time to Completion') },
                ],
                help: t(
                    'How tasks are ordered when clicking Sort Tasks. "Time to Completion" sorts fastest tasks first; combat and completed tasks go to the bottom.'
                ),
            },
            taskInventoryHighlighter: {
                id: 'taskInventoryHighlighter',
                label: t('Enable Task Inventory Highlighter button'),
                type: 'checkbox',
                default: true,
                help: t('Adds a button to dim inventory items not needed for your current non-combat tasks'),
            },
            taskStatistics: {
                id: 'taskStatistics',
                label: t('Show task statistics button on Tasks panel'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a Statistics button to the Tasks panel showing overflow time, expected rewards, and completion estimates'
                ),
            },
            taskClaimCollector: {
                id: 'taskClaimCollector',
                label: t('Move Claim Reward buttons to top of task list'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Moves all Claim Reward buttons to a stack at the top of the task list so you can click the same spot repeatedly to claim all completed tasks'
                ),
            },
            taskGoMerge: {
                id: 'taskGoMerge',
                label: t('Merge duplicate tasks on Go'),
                type: 'checkbox',
                default: true,
                help: t(
                    'When clicking Go on a task, combines the required amounts of all in-progress tasks for the same action into a single pre-filled count'
                ),
            },
            taskRerollProtection: {
                id: 'taskRerollProtection',
                label: t('Task reroll protection'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Protect specific tasks from accidental rerolling. Protected tasks get a green highlight and require a confirmation click before rerolling. A shield icon appears in the task panel to configure protected zones.'
                ),
            },
            taskRerollProtection_hideHighlight: {
                id: 'taskRerollProtection_hideHighlight',
                label: t('Task reroll protection: Hide green highlight'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Removes the green outline/glow from protected tasks while keeping the reroll confirmation active.'
                ),
            },
            taskAutoReroll: {
                id: 'taskAutoReroll',
                label: t('Task auto-reroll reminder'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Highlights tasks you want to reroll with a red border and reminder badge. Configure per-character via the target icon in the task panel.'
                ),
            },
        },
    },

    ui: {
        title: t('UI Enhancements'),
        icon: '🎨',
        settings: {
            formatting_useKMBFormat: {
                id: 'formatting_useKMBFormat',
                label: t('Use K/M/B number formatting (e.g., 1.5M instead of 1,500,000)'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Applies to tooltips, action panels, profit displays, and all number formatting throughout the UI'
                ),
            },
            ui_externalLinks: {
                id: 'ui_externalLinks',
                label: t('Left sidebar: Show external tool links'),
                type: 'checkbox',
                default: true,
                help: t('Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy'),
            },
            hideLabyrinthBadge: {
                id: 'hideLabyrinthBadge',
                label: t('Left sidebar: Hide Labyrinth ping badge'),
                type: 'checkbox',
                default: false,
            },
            tabReorder: {
                id: 'tabReorder',
                label: t('Character panel: Drag-and-drop tab reordering'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Drag tabs to rearrange the order of Inventory, Toolasha, Equipment, Houses, Abilities, and Loadout. Order persists through refresh.'
                ),
            },
            expPercentage: {
                id: 'expPercentage',
                label: t('Left sidebar: Show skill XP percentages'),
                type: 'checkbox',
                default: true,
            },
            itemIconLevel: {
                id: 'itemIconLevel',
                label: t('Bottom left corner of icons: Show equipment level'),
                type: 'checkbox',
                default: true,
            },
            loadoutEnhancementDisplay: {
                id: 'loadoutEnhancementDisplay',
                label: t('Loadout panel: Show highest-owned enhancement level on equipment icons'),
                type: 'checkbox',
                default: true,
            },
            loadout_sortEnabled: {
                id: 'loadout_sortEnabled',
                label: t('Loadout panel: Enable drag-and-drop reordering'),
                type: 'checkbox',
                default: true,
            },
            loadoutSnapshot: {
                id: 'loadoutSnapshot',
                label: t('Loadout panel: Use saved loadout snapshots in profit calculations'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Saves your loadout equipment when you view loadouts, so profit/hr calculations use the correct tool bonuses even when that loadout is not equipped. Disable to always use currently-equipped gear.'
                ),
            },
            showsKeyInfoInIcon: {
                id: 'showsKeyInfoInIcon',
                label: t('Bottom left corner of key icons: Show zone index'),
                type: 'checkbox',
                default: true,
            },
            mapIndex: {
                id: 'mapIndex',
                label: t('Combat zones: Show zone index numbers'),
                type: 'checkbox',
                default: true,
            },
            alchemyItemDimming: {
                id: 'alchemyItemDimming',
                label: t('Alchemy panel: Dim items requiring higher level'),
                type: 'checkbox',
                default: true,
            },
            marketFilter: {
                id: 'marketFilter',
                label: t('Marketplace: Filter by level, class, slot'),
                type: 'checkbox',
                default: true,
            },
            marketSort: {
                id: 'marketSort',
                label: t('Marketplace: Sort items by profitability'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a button to sort marketplace items by profit/hour. Items without profit data (drop-only) appear at the end.'
                ),
            },
            fillMarketOrderPrice: {
                id: 'fillMarketOrderPrice',
                label: t('Auto-fill marketplace orders with optimal price'),
                type: 'checkbox',
                default: true,
            },
            market_autoFillSellStrategy: {
                id: 'market_autoFillSellStrategy',
                label: t('Auto-fill sell price strategy'),
                type: 'select',
                default: 'match',
                options: [
                    { value: 'match', label: t('Match best sell price') },
                    { value: 'undercut', label: t('Undercut by 1 (best sell - 1)') },
                ],
                help: t('When creating sell listings, choose whether to match or undercut the current best sell price'),
            },
            market_autoFillBuyStrategy: {
                id: 'market_autoFillBuyStrategy',
                label: t('Auto-fill buy price strategy'),
                type: 'select',
                default: 'outbid',
                options: [
                    { value: 'outbid', label: t('Outbid by 1 (best buy + 1)') },
                    { value: 'match', label: t('Match best buy price') },
                    { value: 'undercut', label: t('Undercut by 1 (best buy - 1)') },
                ],
                help: t(
                    'When creating buy listings, choose whether to outbid, match, or undercut the current best buy price'
                ),
            },
            market_autoClickMax: {
                id: 'market_autoClickMax',
                label: t('Auto-click Max button on sell listing dialogs'),
                type: 'checkbox',
                default: true,
                help: t('Automatically clicks the Max button in the quantity field when opening Sell listing dialogs'),
            },
            market_quickInputButtons: {
                id: 'market_quickInputButtons',
                label: t('Marketplace: Quick input buttons on order dialogs'),
                type: 'checkbox',
                default: true,
                help: t('Adds 10, 100, 1000 preset quantity buttons to buy/sell dialogs'),
            },
            market_quickInputButtons_presets: {
                id: 'market_quickInputButtons_presets',
                label: t('Marketplace: Custom quick input presets'),
                type: 'text',
                default: '',
                help: t(
                    'Comma-separated preset values (e.g. 50,500,5000). Leave blank for defaults (10, 100, 1000). Max 8 values.'
                ),
            },
            market_multiplierButtons: {
                id: 'market_multiplierButtons',
                label: t('Marketplace: ÷2 and ×2 buttons on order dialogs'),
                type: 'checkbox',
                default: true,
                help: t('Adds ÷2 and ×2 buttons to the price and quantity rows in buy/sell dialogs'),
            },
            market_showOwnedInBuyModal: {
                id: 'market_showOwnedInBuyModal',
                label: t('Marketplace: Show owned count in buy dialogs'),
                type: 'checkbox',
                default: true,
                help: t('Displays how many of the item you currently own in Buy Now and Buy Listing modals'),
            },
            market_marketplaceShortcuts: {
                id: 'market_marketplaceShortcuts',
                label: t('Marketplace: Show "Marketplace Action" button on item menus'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds a Marketplace Action dropdown to item menus with Sell Now, Buy Now, and listing shortcuts'
                ),
            },
            market_visibleItemCount: {
                id: 'market_visibleItemCount',
                label: t('Market: Show inventory count on items'),
                type: 'checkbox',
                default: true,
                help: t('Displays how many of each item you own when browsing the market'),
            },
            market_visibleItemCountOpacity: {
                id: 'market_visibleItemCountOpacity',
                label: t('Market: Opacity for items not in inventory'),
                type: 'slider',
                default: 0.25,
                min: 0,
                max: 1,
                step: 0.05,
                help: t('How transparent item tiles appear when you own zero of that item'),
            },
            market_visibleItemCountIncludeEquipped: {
                id: 'market_visibleItemCountIncludeEquipped',
                label: t('Market: Count equipped items'),
                type: 'checkbox',
                default: true,
                help: t('Include currently equipped items in the displayed count'),
            },
            market_showListingPrices: {
                id: 'market_showListingPrices',
                label: t('Market: Show prices on individual listings'),
                type: 'checkbox',
                default: true,
                help: t('Displays top order price and total value on each listing in My Listings table'),
            },
            market_tradeHistory: {
                id: 'market_tradeHistory',
                label: t('Market: Show personal trade history'),
                type: 'checkbox',
                default: true,
                help: t('Displays your last buy/sell prices for items in marketplace'),
            },
            market_tradeHistoryComparisonMode: {
                id: 'market_tradeHistoryComparisonMode',
                label: t('Market: Trade history comparison mode'),
                type: 'select',
                default: 'instant',
                options: [
                    { value: 'instant', label: t('Instant') },
                    { value: 'listing', label: t('Orders') },
                ],
                help: t('Instant: Compare to instant buy/sell prices. Orders: Compare to buy/sell orders.'),
            },
            market_listingPricePrecision: {
                id: 'market_listingPricePrecision',
                label: t('Market: Listing price decimal precision'),
                type: 'number',
                default: 2,
                min: 0,
                max: 4,
                help: t('Number of decimal places to show for listing prices'),
            },
            market_showListingAge: {
                id: 'market_showListingAge',
                label: t('Market: Show listing age on My Listings'),
                type: 'checkbox',
                default: false,
                help: t('Display how long ago each listing was created on the My Listings tab (e.g., "3h 45m")'),
            },
            market_showTopOrderAge: {
                id: 'market_showTopOrderAge',
                label: t('Market: Show top order age on My Listings'),
                type: 'checkbox',
                default: false,
                help: t(
                    'Display estimated age of the top competing order for each of your listings (requires estimated listing age feature to be active)'
                ),
            },
            market_showEstimatedListingAge: {
                id: 'market_showEstimatedListingAge',
                label: t('Market: Show estimated age on order book'),
                type: 'checkbox',
                default: true,
                help: t('Estimates creation time for all market listings using listing ID interpolation'),
            },
            market_listingAgeFormat: {
                id: 'market_listingAgeFormat',
                label: t('Market: Listing age display format'),
                type: 'select',
                default: 'datetime',
                options: [
                    { value: 'elapsed', label: t('Elapsed Time (e.g., "3h 45m")') },
                    { value: 'datetime', label: t('Date/Time (e.g., "01-13 14:30")') },
                ],
                help: t('Choose how to display listing creation times'),
            },
            market_listingTimeFormat: {
                id: 'market_listingTimeFormat',
                label: t('Market: Time format for date/time display'),
                type: 'select',
                default: '24hour',
                options: [
                    { value: '24hour', label: t('24-hour (14:30)') },
                    { value: '12hour', label: t('12-hour (2:30 PM)') },
                ],
                help: t('Time format when using Date/Time display (only applies if Date/Time format is selected)'),
            },
            market_listingDateFormat: {
                id: 'market_listingDateFormat',
                label: t('Market: Date format for date/time display'),
                type: 'select',
                default: 'MM-DD',
                options: [
                    { value: 'MM-DD', label: t('MM-DD (01-13)') },
                    { value: 'DD-MM', label: t('DD-MM (13-01)') },
                ],
                help: t('Date format when using Date/Time display (only applies if Date/Time format is selected)'),
            },
            market_showOrderTotals: {
                id: 'market_showOrderTotals',
                label: t('Market: Show order totals in header'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Displays buy orders (BO), sell orders (SO), and unclaimed coins (💰) in the header area below gold'
                ),
            },
            market_showHistoryViewer: {
                id: 'market_showHistoryViewer',
                label: t('Market: Show history viewer button in settings'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds "View Market History" button to settings panel for viewing and exporting all market listing history'
                ),
            },
            market_showPhiloCalculator: {
                id: 'market_showPhiloCalculator',
                label: t('Market: Show Philo Gamba calculator button in settings'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Adds "Philo Gamba" button to settings panel for calculating transmutation ROI into Philosopher\'s Stones'
                ),
            },
            market_showQueueLength: {
                id: 'market_showQueueLength',
                label: t('Market: Show queue length estimates'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Displays total quantity at best price below Buy/Sell buttons. Estimated values (20+ orders at same price) are shown in a different color.'
                ),
            },
            market_milkywayMarketLink: {
                id: 'market_milkywayMarketLink',
                label: t('Market: Show MilkyWay Market link'),
                type: 'checkbox',
                default: false,
                help: t('Adds a small link to view the current item on milkyway.market'),
            },
            itemDictionary_transmuteRates: {
                id: 'itemDictionary_transmuteRates',
                label: t('Item Dictionary: Show transmutation success rates'),
                type: 'checkbox',
                default: true,
                help: t('Displays success rate percentages in the "Transmuted From (Alchemy)" section'),
            },
            itemDictionary_transmuteIncludeBaseRate: {
                id: 'itemDictionary_transmuteIncludeBaseRate',
                label: t('Item Dictionary: Include base success rate in transmutation percentages'),
                type: 'checkbox',
                default: true,
                help: t(
                    'When enabled, shows total probability (base rate × drop rate). When disabled, shows conditional probability (drop rate only, matching "Transmutes Into" section)'
                ),
            },
        },
    },

    guild: {
        title: t('Guild'),
        icon: '👥',
        settings: {
            guildXPTracker: {
                id: 'guildXPTracker',
                label: t('Track guild and member XP over time'),
                type: 'checkbox',
                default: true,
                help: t('Records guild and member XP data from WebSocket messages for XP/hr calculations'),
            },
            guildXPDisplay: {
                id: 'guildXPDisplay',
                label: t('Show XP/hr stats on Guild panel and Leaderboard'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Displays XP/hr rates, rankings, and a weekly chart on the Guild Overview, Members, and Guild Leaderboard tabs. Disable the standalone Guild XP/h userscript if using this.'
                ),
            },
        },
    },

    house: {
        title: t('House'),
        icon: '🏠',
        settings: {
            houseUpgradeCosts: {
                id: 'houseUpgradeCosts',
                label: t('Show upgrade costs with market prices and inventory comparison'),
                type: 'checkbox',
                default: true,
            },
        },
    },

    notifications: {
        title: t('Notifications'),
        icon: '🔔',
        settings: {
            notifiEmptyAction: {
                id: 'notifiEmptyAction',
                label: t('Browser notification when action queue is empty'),
                type: 'checkbox',
                default: false,
                help: t('Only works when the game page is open'),
            },
        },
    },

    colors: {
        title: t('Color Customization'),
        icon: '🎨',
        settings: {
            color_profit: {
                id: 'color_profit',
                label: t('Profit/Positive Values'),
                type: 'color',
                default: '#047857',
                help: t('Color used for profit, gains, and positive values'),
            },
            color_loss: {
                id: 'color_loss',
                label: t('Loss/Negative Values'),
                type: 'color',
                default: '#f87171',
                help: t('Color used for losses, costs, and negative values'),
            },
            color_warning: {
                id: 'color_warning',
                label: t('Warnings'),
                type: 'color',
                default: '#ffa500',
                help: t('Color used for warnings and important notices'),
            },
            color_info: {
                id: 'color_info',
                label: t('Informational'),
                type: 'color',
                default: '#60a5fa',
                help: t('Color used for informational text and highlights'),
            },
            color_essence: {
                id: 'color_essence',
                label: t('Essences'),
                type: 'color',
                default: '#c084fc',
                help: t('Color used for essence drops and essence-related text'),
            },
            color_tooltip_profit: {
                id: 'color_tooltip_profit',
                label: t('Tooltip Profit/Positive'),
                type: 'color',
                default: '#047857',
                help: t('Color for profit/positive values in tooltips (light backgrounds)'),
            },
            color_tooltip_loss: {
                id: 'color_tooltip_loss',
                label: t('Tooltip Loss/Negative'),
                type: 'color',
                default: '#dc2626',
                help: t('Color for loss/negative values in tooltips (light backgrounds)'),
            },
            color_tooltip_info: {
                id: 'color_tooltip_info',
                label: t('Tooltip Informational'),
                type: 'color',
                default: '#2563eb',
                help: t('Color for informational text in tooltips (light backgrounds)'),
            },
            color_tooltip_warning: {
                id: 'color_tooltip_warning',
                label: t('Tooltip Warnings'),
                type: 'color',
                default: '#ea580c',
                help: t('Color for warnings in tooltips (light backgrounds)'),
            },
            color_text_primary: {
                id: 'color_text_primary',
                label: t('Primary Text'),
                type: 'color',
                default: '#ffffff',
                help: t('Main text color'),
            },
            color_text_secondary: {
                id: 'color_text_secondary',
                label: t('Secondary Text'),
                type: 'color',
                default: '#888888',
                help: t('Dimmed/secondary text color'),
            },
            color_border: {
                id: 'color_border',
                label: t('Borders'),
                type: 'color',
                default: '#444444',
                help: t('Border and separator color'),
            },
            color_gold: {
                id: 'color_gold',
                label: t('Gold/Currency'),
                type: 'color',
                default: '#ffa500',
                help: t('Color used for gold and currency displays'),
            },
            color_mirror: {
                id: 'color_mirror',
                label: "Philosopher's Mirror",
                type: 'color',
                default: '#ffd700',
                help: "Color for the Philosopher's Mirror usage line in enhancement tooltips",
            },
            color_listing_price_1m: {
                id: 'color_listing_price_1m',
                label: t('Listing Total: 1M+'),
                type: 'color',
                default: '#ffd700',
                help: t('Color for market listing total prices of 1 million or more'),
            },
            color_listing_price_100k: {
                id: 'color_listing_price_100k',
                label: t('Listing Total: 100K+'),
                type: 'color',
                default: '#22c55e',
                help: t('Color for market listing total prices of 100K or more'),
            },
            color_listing_price_10k: {
                id: 'color_listing_price_10k',
                label: t('Listing Total: 10K+'),
                type: 'color',
                default: '#ffffff',
                help: t('Color for market listing total prices of 10K or more'),
            },
            color_listing_price_low: {
                id: 'color_listing_price_low',
                label: t('Listing Total: <10K'),
                type: 'color',
                default: '#888888',
                help: t('Color for market listing total prices under 10K'),
            },
            color_accent: {
                id: 'color_accent',
                label: t('Script Accent Color'),
                type: 'color',
                default: '#22c55e',
                help: t(
                    'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)'
                ),
            },
            color_remaining_xp: {
                id: 'color_remaining_xp',
                label: t('Remaining XP Text'),
                type: 'color',
                default: '#FFFFFF',
                help: t('Color for remaining XP text below skill bars in left navigation'),
            },
            color_xp_rate: {
                id: 'color_xp_rate',
                label: t('XP Rate Text'),
                type: 'color',
                default: '#ffffff',
                help: t('Color for XP/hr rate text on skill bars in left navigation'),
            },
            color_hours_to_level: {
                id: 'color_hours_to_level',
                label: t('Hours to Level Text'),
                type: 'color',
                default: '#ffffff',
                help: t('Color for "hours till next level" text in skill tooltips'),
            },
            color_inv_count: {
                id: 'color_inv_count',
                label: t('Inventory Count Text'),
                type: 'color',
                default: '#ffffff',
                help: t('Color for inventory count shown on action tiles and in the action detail panel'),
            },
            color_invBadge_ask: {
                id: 'color_invBadge_ask',
                label: t('Inventory Badge: Ask Price'),
                type: 'color',
                default: '#047857',
                help: t('Color for Ask price badges on inventory items (seller asking price - better selling value)'),
            },
            color_invBadge_bid: {
                id: 'color_invBadge_bid',
                label: t('Inventory Badge: Bid Price'),
                type: 'color',
                default: '#60a5fa',
                help: t('Color for Bid price badges on inventory items (buyer bid price - instant-sell value)'),
            },
            color_transmute: {
                id: 'color_transmute',
                label: t('Transmutation Rates'),
                type: 'color',
                default: '#ffffff',
                help: t('Color used for transmutation success rate percentages in Item Dictionary'),
            },
            color_queueLength_known: {
                id: 'color_queueLength_known',
                label: t('Queue Length: Known Value'),
                type: 'color',
                default: '#ffffff',
                help: t('Color for known queue lengths (when all visible orders are counted)'),
            },
            color_queueLength_estimated: {
                id: 'color_queueLength_estimated',
                label: t('Queue Length: Estimated Value'),
                type: 'color',
                default: '#60a5fa',
                help: t('Color for estimated queue lengths (extrapolated from 20+ orders at same price)'),
            },
        },
    },

    collectionFilters: {
        title: t('Collection Filters'),
        icon: '⭐',
        settings: {
            collectionFilters: {
                id: 'collectionFilters',
                label: t('Collection Filters: Count-range, dungeon, and skilling-outfit filters'),
                type: 'checkbox',
                default: true,
            },
            collectionFavorites: {
                id: 'collectionFavorites',
                label: t('Collection Favorites: Star (★) items to mark and filter favorites'),
                type: 'checkbox',
                default: true,
            },
            collectionFavoritesSection: {
                id: 'collectionFavoritesSection',
                label: t('Collection Favorites: Show favorites section at top of grid'),
                type: 'checkbox',
                default: true,
            },
            collectionFilters_skillingBadges: {
                id: 'collectionFilters_skillingBadges',
                label: t('Show collection count badges on skilling action tiles'),
                type: 'checkbox',
                default: true,
                help: t(
                    'Displays your collection count on skilling actions (open Collections once to populate counts)'
                ),
            },
        },
    },
};

/**
 * Get all setting IDs in order
 * @returns {string[]} Array of setting IDs
 */
export function getAllSettingIds() {
    const ids = [];
    for (const group of Object.values(settingsGroups)) {
        for (const settingId of Object.keys(group.settings)) {
            ids.push(settingId);
        }
    }
    return ids;
}

/**
 * Get a setting definition by ID
 * @param {string} settingId - Setting ID
 * @returns {Object|null} Setting definition or null
 */
export function getSettingDefinition(settingId) {
    for (const group of Object.values(settingsGroups)) {
        if (group.settings[settingId]) {
            return group.settings[settingId];
        }
    }
    return null;
}

/**
 * Check if a setting has dependencies
 * @param {string} settingId - Setting ID
 * @returns {string[]} Array of dependency setting IDs
 */
export function getSettingDependencies(settingId) {
    const def = getSettingDefinition(settingId);
    return def?.dependencies || [];
}
