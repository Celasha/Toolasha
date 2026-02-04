/**
 * Settings Configuration
 * Organizes all script settings into logical groups for the settings UI
 */

export const settingsGroups = {
    general: {
        title: 'General Settings',
        icon: '⚙️',
        settings: {
            networkAlert: {
                id: 'networkAlert',
                label: 'Show alert when market price data cannot be fetched',
                type: 'checkbox',
                default: true,
            },
        },
    },

    actionPanel: {
        title: 'Action Panel Enhancements',
        icon: '⚡',
        settings: {
            totalActionTime: {
                id: 'totalActionTime',
                label: 'Top left: Estimated total time and completion time',
                type: 'checkbox',
                default: true,
            },
            actions_compactActionBar: {
                id: 'actions_compactActionBar',
                label: 'Compact action bar (limit width, truncate long names)',
                type: 'checkbox',
                default: false,
                dependencies: ['totalActionTime'],
                help: 'Limits action bar width to prevent screen-spanning on wide monitors. Long action names will be truncated with "..." - hover to see full text.',
            },
            actionPanel_totalTime: {
                id: 'actionPanel_totalTime',
                label: 'Action panel: Total time, times to reach target level, exp/hour',
                type: 'checkbox',
                default: true,
            },
            actionPanel_totalTime_quickInputs: {
                id: 'actionPanel_totalTime_quickInputs',
                label: 'Action panel: Quick input buttons (hours, count presets, Max)',
                type: 'checkbox',
                default: true,
                dependencies: ['actionPanel_totalTime'],
            },
            actionPanel_foragingTotal: {
                id: 'actionPanel_foragingTotal',
                label: 'Action panel: Overall profit for multi-outcome foraging',
                type: 'checkbox',
                default: true,
                dependencies: ['actionPanel_totalTime'],
            },
            actionQueue: {
                id: 'actionQueue',
                label: 'Queued actions: Show total time and completion time',
                type: 'checkbox',
                default: true,
            },
            actionQueue_valueMode: {
                id: 'actionQueue_valueMode',
                label: 'Queued actions: Value calculation mode',
                type: 'select',
                default: 'profit',
                options: [
                    { value: 'profit', label: 'Total Profit (revenue - all costs)' },
                    { value: 'estimated_value', label: 'Estimated Value (revenue after tax)' },
                ],
                dependencies: ['actionQueue'],
                help: 'Choose how to calculate the total value for queued actions. Profit shows net earnings after materials and drinks. Estimated Value shows gross revenue after market tax (always positive).',
            },
            actionPanel_outputTotals: {
                id: 'actionPanel_outputTotals',
                label: 'Action panel: Show total expected outputs below per-action outputs',
                type: 'checkbox',
                default: true,
                help: 'Displays calculated totals when you enter a quantity in the action input',
            },
            actionPanel_maxProduceable: {
                id: 'actionPanel_maxProduceable',
                label: 'Action panel: Show max produceable count on crafting actions',
                type: 'checkbox',
                default: true,
                help: 'Displays how many items you can make based on current inventory',
            },
            actionPanel_gatheringStats: {
                id: 'actionPanel_gatheringStats',
                label: 'Action panel: Show profit/exp per hour on gathering actions',
                type: 'checkbox',
                default: true,
                help: 'Displays profit/hr and exp/hr on gathering tiles (foraging, woodcutting, milking)',
            },
            actionPanel_hideNegativeProfit: {
                id: 'actionPanel_hideNegativeProfit',
                label: 'Action panel: Hide actions with negative profit',
                type: 'checkbox',
                default: false,
                dependencies: ['actionPanel_maxProduceable', 'actionPanel_gatheringStats'],
                help: 'Hides action panels that would result in a loss (negative profit/hr)',
            },
            actionPanel_sortByProfit: {
                id: 'actionPanel_sortByProfit',
                label: 'Action panel: Sort actions by profit/hr (highest first)',
                type: 'checkbox',
                default: false,
                dependencies: ['actionPanel_maxProduceable', 'actionPanel_gatheringStats'],
                help: 'Sorts action tiles by profit/hr in descending order. Actions without profit data appear at the end.',
            },
            requiredMaterials: {
                id: 'requiredMaterials',
                label: 'Action panel: Show total required and missing materials',
                type: 'checkbox',
                default: true,
                help: 'Displays total materials needed and shortfall when entering quantity',
            },
            alchemy_profitDisplay: {
                id: 'alchemy_profitDisplay',
                label: 'Alchemy panel: Show profit calculator',
                type: 'checkbox',
                default: true,
                help: 'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices',
            },
            actions_missingMaterialsButton: {
                id: 'actions_missingMaterialsButton',
                label: 'Show "Missing Mats Marketplace" button on production panels',
                type: 'checkbox',
                default: true,
                help: 'Adds button to production panels that opens marketplace with tabs for missing materials',
            },
        },
    },

    tooltips: {
        title: 'Item Tooltip Enhancements',
        icon: '💬',
        settings: {
            itemTooltip_prices: {
                id: 'itemTooltip_prices',
                label: 'Show 24-hour average market prices',
                type: 'checkbox',
                default: true,
            },
            itemTooltip_profit: {
                id: 'itemTooltip_profit',
                label: 'Show production cost and profit',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_prices'],
            },
            itemTooltip_detailedProfit: {
                id: 'itemTooltip_detailedProfit',
                label: 'Show detailed materials breakdown in profit display',
                type: 'checkbox',
                default: false,
                dependencies: ['itemTooltip_profit'],
                help: 'Shows material costs table with Ask/Bid prices, actions/hour, and profit breakdown',
            },
            itemTooltip_multiActionProfit: {
                id: 'itemTooltip_multiActionProfit',
                label: 'Show profit comparison for all item actions',
                type: 'checkbox',
                default: false,
                dependencies: ['itemTooltip_prices'],
                help: 'Displays best profit/hr highlighted, with other profitable actions (craft, coinify, decompose, transmute) summarized below',
            },
            itemTooltip_expectedValue: {
                id: 'itemTooltip_expectedValue',
                label: 'Show expected value for openable containers',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_prices'],
            },
            expectedValue_showDrops: {
                id: 'expectedValue_showDrops',
                label: 'Expected value drop display',
                type: 'select',
                default: 'All',
                options: [
                    { value: 'Top 5', label: 'Top 5' },
                    { value: 'Top 10', label: 'Top 10' },
                    { value: 'All', label: 'All Drops' },
                    { value: 'None', label: 'Summary Only' },
                ],
                dependencies: ['itemTooltip_expectedValue'],
            },
            expectedValue_respectPricingMode: {
                id: 'expectedValue_respectPricingMode',
                label: 'Use pricing mode for expected value calculations',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_expectedValue'],
            },
            showConsumTips: {
                id: 'showConsumTips',
                label: 'HP/MP consumables: Restore speed, cost performance',
                type: 'checkbox',
                default: true,
            },
            dungeonTokenTooltips: {
                id: 'dungeonTokenTooltips',
                label: 'Dungeon tokens: Show shop items and costs',
                type: 'checkbox',
                default: true,
            },
            enhanceSim: {
                id: 'enhanceSim',
                label: 'Show enhancement simulator calculations',
                type: 'checkbox',
                default: true,
            },
            enhanceSim_showConsumedItemsDetail: {
                id: 'enhanceSim_showConsumedItemsDetail',
                label: 'Enhancement tooltips: Show detailed breakdown for consumed items',
                type: 'checkbox',
                default: false,
                help: "When enabled, shows base/materials/protection breakdown for each consumed item in Philosopher's Mirror calculations",
                dependencies: ['enhanceSim'],
            },
            itemTooltip_gathering: {
                id: 'itemTooltip_gathering',
                label: 'Show gathering sources and profit',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_profit'],
                help: 'Shows gathering actions that produce this item (foraging, woodcutting, milking)',
            },
            itemTooltip_gatheringRareDrops: {
                id: 'itemTooltip_gatheringRareDrops',
                label: 'Show rare drops from gathering',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_gathering'],
                help: 'Shows rare find drops from gathering zones (e.g., Thread of Expertise from Asteroid Belt)',
            },
        },
    },

    enhancementSimulator: {
        title: 'Enhancement Simulator Settings',
        icon: '✨',
        settings: {
            enhanceSim_autoDetect: {
                id: 'enhanceSim_autoDetect',
                label: 'Auto-detect your stats (false = use market defaults)',
                type: 'checkbox',
                default: false,
                help: 'Most players should use market defaults to see realistic professional enhancer costs',
            },
            enhanceSim_enhancingLevel: {
                id: 'enhanceSim_enhancingLevel',
                label: 'Enhancing skill level',
                type: 'number',
                default: 140,
                min: 1,
                max: 150,
                help: 'Default: 140 (professional enhancer level)',
            },
            enhanceSim_houseLevel: {
                id: 'enhanceSim_houseLevel',
                label: 'Observatory house room level',
                type: 'number',
                default: 8,
                min: 0,
                max: 8,
                help: 'Default: 8 (max level)',
            },
            enhanceSim_toolBonus: {
                id: 'enhanceSim_toolBonus',
                label: 'Tool success bonus %',
                type: 'number',
                default: 6.05,
                min: 0,
                max: 30,
                step: 0.01,
                help: 'Default: 6.05 (Celestial Enhancer +13)',
            },
            enhanceSim_speedBonus: {
                id: 'enhanceSim_speedBonus',
                label: 'Speed bonus %',
                type: 'number',
                default: 48.5,
                min: 0,
                max: 100,
                step: 0.1,
                help: "Default: 48.5 (All enhancing gear +10: Body/Legs/Hands + Philosopher's Necklace)",
            },
            enhanceSim_blessedTea: {
                id: 'enhanceSim_blessedTea',
                label: 'Blessed Tea active',
                type: 'checkbox',
                default: true,
                help: 'Professional enhancers use this to reduce attempts',
            },
            enhanceSim_ultraEnhancingTea: {
                id: 'enhanceSim_ultraEnhancingTea',
                label: 'Ultra Enhancing Tea active',
                type: 'checkbox',
                default: true,
                help: 'Provides +8 base skill levels (scales with drink concentration)',
            },
            enhanceSim_superEnhancingTea: {
                id: 'enhanceSim_superEnhancingTea',
                label: 'Super Enhancing Tea active',
                type: 'checkbox',
                default: false,
                help: 'Provides +6 base skill levels (Ultra is better)',
            },
            enhanceSim_enhancingTea: {
                id: 'enhanceSim_enhancingTea',
                label: 'Enhancing Tea active',
                type: 'checkbox',
                default: false,
                help: 'Provides +3 base skill levels (Ultra is better)',
            },
            enhanceSim_drinkConcentration: {
                id: 'enhanceSim_drinkConcentration',
                label: 'Drink Concentration %',
                type: 'number',
                default: 12.9,
                min: 0,
                max: 20,
                step: 0.1,
                help: 'Default: 12.9 (Guzzling Pouch +10)',
            },
        },
    },

    enhancementTracker: {
        title: 'Enhancement Tracker',
        icon: '📊',
        settings: {
            enhancementTracker: {
                id: 'enhancementTracker',
                label: 'Enable Enhancement Tracker',
                type: 'checkbox',
                default: false,
                help: 'Track enhancement attempts, costs, and statistics',
            },
            enhancementTracker_showOnlyOnEnhancingScreen: {
                id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                label: 'Show tracker only on Enhancing screen',
                type: 'checkbox',
                default: false,
                dependencies: ['enhancementTracker'],
                help: 'Hide tracker when not on the Enhancing screen',
            },
        },
    },

    economy: {
        title: 'Economy & Inventory',
        icon: '💰',
        settings: {
            networth: {
                id: 'networth',
                label: 'Top right: Show current assets (net worth)',
                type: 'checkbox',
                default: true,
                help: 'Enhanced items valued by enhancement simulator',
            },
            invWorth: {
                id: 'invWorth',
                label: 'Below inventory: Show inventory summary',
                type: 'checkbox',
                default: true,
                dependencies: ['networth'],
            },
            invSort: {
                id: 'invSort',
                label: 'Sort inventory items by value',
                type: 'checkbox',
                default: true,
                dependencies: ['networth'],
            },
            invSort_showBadges: {
                id: 'invSort_showBadges',
                label: 'Show stack value badges when sorting by Ask/Bid',
                type: 'checkbox',
                default: false,
                dependencies: ['invSort'],
            },
            invSort_badgesOnNone: {
                id: 'invSort_badgesOnNone',
                label: 'Badge type when "None" sort is selected',
                type: 'select',
                default: 'None',
                options: ['None', 'Ask', 'Bid'],
                dependencies: ['invSort'],
            },
            invSort_sortEquipment: {
                id: 'invSort_sortEquipment',
                label: 'Enable sorting for Equipment category',
                type: 'checkbox',
                default: false,
                dependencies: ['invSort'],
            },
            invBadgePrices: {
                id: 'invBadgePrices',
                label: 'Show price badges on item icons',
                type: 'checkbox',
                default: false,
                help: 'Displays per-item ask or bid price on inventory items',
            },
            invBadgePrices_type: {
                id: 'invBadgePrices_type',
                label: 'Badge price type to display',
                type: 'select',
                default: 'Ask',
                options: ['None', 'Ask', 'Bid'],
                dependencies: ['invBadgePrices'],
                help: 'Ask (instant-buy price), Bid (instant-sell price), or None',
            },
            profitCalc_pricingMode: {
                id: 'profitCalc_pricingMode',
                label: 'Profit calculation pricing mode',
                type: 'select',
                default: 'hybrid',
                options: [
                    { value: 'conservative', label: 'Conservative (Ask/Bid - instant trading)' },
                    { value: 'hybrid', label: 'Hybrid (Ask/Ask - instant buy, patient sell)' },
                    { value: 'optimistic', label: 'Optimistic (Bid/Ask - patient trading)' },
                ],
            },
            networth_highEnhancementUseCost: {
                id: 'networth_highEnhancementUseCost',
                label: 'Use enhancement cost for highly enhanced items',
                type: 'checkbox',
                default: true,
                dependencies: ['networth'],
                help: 'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.',
            },
            networth_highEnhancementMinLevel: {
                id: 'networth_highEnhancementMinLevel',
                label: 'Minimum enhancement level to use cost',
                type: 'select',
                default: 13,
                options: [
                    { value: 10, label: '+10 and above' },
                    { value: 11, label: '+11 and above' },
                    { value: 12, label: '+12 and above' },
                    { value: 13, label: '+13 and above (recommended)' },
                    { value: 15, label: '+15 and above' },
                ],
                dependencies: ['networth_highEnhancementUseCost'],
                help: 'Enhancement level at which to stop trusting market prices',
            },
            networth_includeCowbells: {
                id: 'networth_includeCowbells',
                label: 'Include cowbells in net worth',
                type: 'checkbox',
                default: false,
                dependencies: ['networth'],
                help: 'Cowbells are not tradeable, but they have a value based on Bag of 10 Cowbells market price',
            },
        },
    },

    skills: {
        title: 'Skills',
        icon: '📚',
        settings: {
            skillRemainingXP: {
                id: 'skillRemainingXP',
                label: 'Left sidebar: Show remaining XP to next level',
                type: 'checkbox',
                default: true,
                help: 'Displays how much XP needed to reach the next level under skill progress bars',
            },
            skillRemainingXP_blackBorder: {
                id: 'skillRemainingXP_blackBorder',
                label: 'Remaining XP: Add black text border for better visibility',
                type: 'checkbox',
                default: true,
                dependencies: ['skillRemainingXP'],
                help: 'Adds a black outline/shadow to the XP text for better readability against progress bars',
            },
            skillbook: {
                id: 'skillbook',
                label: 'Skill books: Show books needed to reach target level',
                type: 'checkbox',
                default: true,
            },
        },
    },

    combat: {
        title: 'Combat Features',
        icon: '⚔️',
        settings: {
            combatScore: {
                id: 'combatScore',
                label: 'Profile panel: Show gear score',
                type: 'checkbox',
                default: true,
            },
            characterCard: {
                id: 'characterCard',
                label: 'Profile panel: Show View Card button',
                type: 'checkbox',
                default: true,
                help: 'Adds button to open character sheet in external viewer',
            },
            dungeonTracker: {
                id: 'dungeonTracker',
                label: 'Dungeon Tracker: Real-time progress tracking',
                type: 'checkbox',
                default: true,
                help: 'Tracks dungeon runs with server-validated duration from party messages',
            },
            dungeonTrackerUI: {
                id: 'dungeonTrackerUI',
                label: '  ├─ Show Dungeon Tracker UI panel',
                type: 'checkbox',
                default: true,
                help: 'Displays dungeon progress panel with wave counter, run history, and statistics',
            },
            dungeonTrackerChatAnnotations: {
                id: 'dungeonTrackerChatAnnotations',
                label: '  └─ Show run time in party chat',
                type: 'checkbox',
                default: true,
                help: 'Adds colored timer annotations to "Key counts" messages (green if fast, red if slow)',
            },
            combatSummary: {
                id: 'combatSummary',
                label: 'Combat Summary: Show detailed statistics on return',
                type: 'checkbox',
                default: true,
                help: 'Displays encounters/hour, revenue, experience rates when returning from combat',
            },
            combatStats: {
                id: 'combatStats',
                label: 'Combat Statistics: Show Statistics tab in Combat panel',
                type: 'checkbox',
                default: true,
                help: 'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details',
            },
            combatStatsChatMessage: {
                id: 'combatStatsChatMessage',
                label: 'Combat Statistics: Chat message format',
                type: 'template',
                default: [
                    { type: 'text', value: 'Combat Stats: ' },
                    { type: 'variable', key: '{duration}', label: 'Duration' },
                    { type: 'text', value: ' duration | ' },
                    { type: 'variable', key: '{encountersPerHour}', label: 'Encounters/Hour' },
                    { type: 'text', value: ' EPH | ' },
                    { type: 'variable', key: '{income}', label: 'Total Income' },
                    { type: 'text', value: ' income | ' },
                    { type: 'variable', key: '{dailyIncome}', label: 'Daily Income' },
                    { type: 'text', value: ' income/d | ' },
                    { type: 'variable', key: '{dailyConsumableCosts}', label: 'Daily Consumable Costs' },
                    { type: 'text', value: ' consumables/d | ' },
                    { type: 'variable', key: '{dailyProfit}', label: 'Daily Profit' },
                    { type: 'text', value: ' profit/d | ' },
                    { type: 'variable', key: '{exp}', label: 'EXP/Hour' },
                    { type: 'text', value: ' exp/h | ' },
                    { type: 'variable', key: '{deathCount}', label: 'Deaths' },
                    { type: 'text', value: ' deaths' },
                ],
                help: 'Message format when Ctrl+clicking player card in Statistics. Click "Edit Template" to customize.',
                templateVariables: [
                    { key: '{duration}', label: 'Duration', description: 'Combat session duration' },
                    { key: '{encountersPerHour}', label: 'Encounters/Hour', description: 'Encounters per hour (EPH)' },
                    { key: '{income}', label: 'Total Income', description: 'Total income from combat' },
                    { key: '{dailyIncome}', label: 'Daily Income', description: 'Income per day' },
                    {
                        key: '{dailyConsumableCosts}',
                        label: 'Daily Consumable Costs',
                        description: 'Consumable costs per day',
                    },
                    { key: '{dailyProfit}', label: 'Daily Profit', description: 'Profit per day' },
                    { key: '{exp}', label: 'EXP/Hour', description: 'Experience per hour' },
                    { key: '{deathCount}', label: 'Deaths', description: 'Number of deaths' },
                ],
            },
        },
    },

    tasks: {
        title: 'Tasks',
        icon: '📋',
        settings: {
            taskProfitCalculator: {
                id: 'taskProfitCalculator',
                label: 'Show total profit for gathering/production tasks',
                type: 'checkbox',
                default: true,
            },
            taskEfficiencyRating: {
                id: 'taskEfficiencyRating',
                label: 'Show task efficiency rating (tokens/profit per hour)',
                type: 'checkbox',
                default: true,
                help: 'Displays a color-graded efficiency score based on expected completion time.',
            },
            taskEfficiencyRatingMode: {
                id: 'taskEfficiencyRatingMode',
                label: '  └─ Efficiency algorithm',
                type: 'select',
                default: 'gold',
                options: [
                    { value: 'tokens', label: 'Task tokens per hour' },
                    { value: 'gold', label: 'Task profit per hour' },
                ],
                dependencies: ['taskEfficiencyRating'],
                help: 'Choose whether to rate by task token payout or total profit.',
            },
            taskEfficiencyGradient: {
                id: 'taskEfficiencyGradient',
                label: '  └─ Use relative gradient colors',
                type: 'checkbox',
                default: false,
                dependencies: ['taskEfficiencyRating'],
                help: 'Colors efficiency ratings relative to visible tasks.',
            },
            taskRerollTracker: {
                id: 'taskRerollTracker',
                label: 'Track task reroll costs',
                type: 'checkbox',
                default: true,
                help: 'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)',
            },
            taskMapIndex: {
                id: 'taskMapIndex',
                label: 'Show combat zone index numbers on tasks',
                type: 'checkbox',
                default: true,
            },
            taskIcons: {
                id: 'taskIcons',
                label: 'Show visual icons on task cards',
                type: 'checkbox',
                default: true,
                help: 'Displays semi-transparent item/monster icons on task cards',
            },
            taskIconsDungeons: {
                id: 'taskIconsDungeons',
                label: 'Show dungeon icons on combat tasks',
                type: 'checkbox',
                default: false,
                dependencies: ['taskIcons'],
                help: 'Shows which dungeons contain the monster (requires Task Icons enabled)',
            },
        },
    },

    ui: {
        title: 'UI Enhancements',
        icon: '🎨',
        settings: {
            formatting_useKMBFormat: {
                id: 'formatting_useKMBFormat',
                label: 'Use K/M/B number formatting (e.g., 1.5M instead of 1,500,000)',
                type: 'checkbox',
                default: true,
                help: 'Applies to tooltips, action panels, profit displays, and all number formatting throughout the UI',
            },
            ui_externalLinks: {
                id: 'ui_externalLinks',
                label: 'Left sidebar: Show external tool links',
                type: 'checkbox',
                default: true,
                help: 'Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy',
            },
            expPercentage: {
                id: 'expPercentage',
                label: 'Left sidebar: Show skill XP percentages',
                type: 'checkbox',
                default: true,
            },
            itemIconLevel: {
                id: 'itemIconLevel',
                label: 'Bottom left corner of icons: Show equipment level',
                type: 'checkbox',
                default: true,
            },
            showsKeyInfoInIcon: {
                id: 'showsKeyInfoInIcon',
                label: 'Bottom left corner of key icons: Show zone index',
                type: 'checkbox',
                default: true,
                dependencies: ['itemIconLevel'],
            },
            mapIndex: {
                id: 'mapIndex',
                label: 'Combat zones: Show zone index numbers',
                type: 'checkbox',
                default: true,
            },
            alchemyItemDimming: {
                id: 'alchemyItemDimming',
                label: 'Alchemy panel: Dim items requiring higher level',
                type: 'checkbox',
                default: true,
            },
            marketFilter: {
                id: 'marketFilter',
                label: 'Marketplace: Filter by level, class, slot',
                type: 'checkbox',
                default: true,
            },
            fillMarketOrderPrice: {
                id: 'fillMarketOrderPrice',
                label: 'Auto-fill marketplace orders with optimal price',
                type: 'checkbox',
                default: true,
            },
            market_visibleItemCount: {
                id: 'market_visibleItemCount',
                label: 'Market: Show inventory count on items',
                type: 'checkbox',
                default: true,
                help: 'Displays how many of each item you own when browsing the market',
            },
            market_visibleItemCountOpacity: {
                id: 'market_visibleItemCountOpacity',
                label: 'Market: Opacity for items not in inventory',
                type: 'slider',
                default: 0.25,
                min: 0,
                max: 1,
                step: 0.05,
                dependencies: ['market_visibleItemCount'],
                help: 'How transparent item tiles appear when you own zero of that item',
            },
            market_visibleItemCountIncludeEquipped: {
                id: 'market_visibleItemCountIncludeEquipped',
                label: 'Market: Count equipped items',
                type: 'checkbox',
                default: true,
                dependencies: ['market_visibleItemCount'],
                help: 'Include currently equipped items in the displayed count',
            },
            market_showListingPrices: {
                id: 'market_showListingPrices',
                label: 'Market: Show prices on individual listings',
                type: 'checkbox',
                default: true,
                help: 'Displays top order price and total value on each listing in My Listings table',
            },
            market_tradeHistory: {
                id: 'market_tradeHistory',
                label: 'Market: Show personal trade history',
                type: 'checkbox',
                default: true,
                help: 'Displays your last buy/sell prices for items in marketplace',
            },
            market_listingPricePrecision: {
                id: 'market_listingPricePrecision',
                label: 'Market: Listing price decimal precision',
                type: 'number',
                default: 2,
                min: 0,
                max: 4,
                dependencies: ['market_showListingPrices'],
                help: 'Number of decimal places to show for listing prices',
            },
            market_showListingAge: {
                id: 'market_showListingAge',
                label: 'Market: Show listing age on My Listings',
                type: 'checkbox',
                default: false,
                dependencies: ['market_showListingPrices'],
                help: 'Display how long ago each listing was created on the My Listings tab (e.g., "3h 45m")',
            },
            market_showTopOrderAge: {
                id: 'market_showTopOrderAge',
                label: 'Market: Show top order age on My Listings',
                type: 'checkbox',
                default: false,
                dependencies: ['market_showListingPrices', 'market_showEstimatedListingAge'],
                help: 'Display estimated age of the top competing order for each of your listings (requires estimated listing age feature to be active)',
            },
            market_showEstimatedListingAge: {
                id: 'market_showEstimatedListingAge',
                label: 'Market: Show estimated age on order book',
                type: 'checkbox',
                default: false,
                help: 'Estimates creation time for all market listings using listing ID interpolation',
            },
            market_listingAgeFormat: {
                id: 'market_listingAgeFormat',
                label: 'Market: Listing age display format',
                type: 'select',
                default: 'datetime',
                options: [
                    { value: 'elapsed', label: 'Elapsed Time (e.g., "3h 45m")' },
                    { value: 'datetime', label: 'Date/Time (e.g., "01-13 14:30")' },
                ],
                dependencies: ['market_showEstimatedListingAge'],
                help: 'Choose how to display listing creation times',
            },
            market_listingTimeFormat: {
                id: 'market_listingTimeFormat',
                label: 'Market: Time format for date/time display',
                type: 'select',
                default: '24hour',
                options: [
                    { value: '24hour', label: '24-hour (14:30)' },
                    { value: '12hour', label: '12-hour (2:30 PM)' },
                ],
                dependencies: ['market_showEstimatedListingAge'],
                help: 'Time format when using Date/Time display (only applies if Date/Time format is selected)',
            },
            market_showOrderTotals: {
                id: 'market_showOrderTotals',
                label: 'Market: Show order totals in header',
                type: 'checkbox',
                default: true,
                help: 'Displays buy orders (BO), sell orders (SO), and unclaimed coins (💰) in the header area below gold',
            },
            market_showHistoryViewer: {
                id: 'market_showHistoryViewer',
                label: 'Market: Show history viewer button in settings',
                type: 'checkbox',
                default: true,
                help: 'Adds "View Market History" button to settings panel for viewing and exporting all market listing history',
            },
            itemDictionary_transmuteRates: {
                id: 'itemDictionary_transmuteRates',
                label: 'Item Dictionary: Show transmutation success rates',
                type: 'checkbox',
                default: true,
                help: 'Displays success rate percentages in the "Transmuted From (Alchemy)" section',
            },
            itemDictionary_transmuteIncludeBaseRate: {
                id: 'itemDictionary_transmuteIncludeBaseRate',
                label: 'Item Dictionary: Include base success rate in transmutation percentages',
                type: 'checkbox',
                default: true,
                dependencies: ['itemDictionary_transmuteRates'],
                help: 'When enabled, shows total probability (base rate × drop rate). When disabled, shows conditional probability (drop rate only, matching "Transmutes Into" section)',
            },
        },
    },

    house: {
        title: 'House',
        icon: '🏠',
        settings: {
            houseUpgradeCosts: {
                id: 'houseUpgradeCosts',
                label: 'Show upgrade costs with market prices and inventory comparison',
                type: 'checkbox',
                default: true,
            },
        },
    },

    notifications: {
        title: 'Notifications',
        icon: '🔔',
        settings: {
            notifiEmptyAction: {
                id: 'notifiEmptyAction',
                label: 'Browser notification when action queue is empty',
                type: 'checkbox',
                default: false,
                help: 'Only works when the game page is open',
            },
        },
    },

    colors: {
        title: 'Color Customization',
        icon: '🎨',
        settings: {
            color_profit: {
                id: 'color_profit',
                label: 'Profit/Positive Values',
                type: 'color',
                default: '#047857',
                help: 'Color used for profit, gains, and positive values',
            },
            color_loss: {
                id: 'color_loss',
                label: 'Loss/Negative Values',
                type: 'color',
                default: '#f87171',
                help: 'Color used for losses, costs, and negative values',
            },
            color_warning: {
                id: 'color_warning',
                label: 'Warnings',
                type: 'color',
                default: '#ffa500',
                help: 'Color used for warnings and important notices',
            },
            color_info: {
                id: 'color_info',
                label: 'Informational',
                type: 'color',
                default: '#60a5fa',
                help: 'Color used for informational text and highlights',
            },
            color_essence: {
                id: 'color_essence',
                label: 'Essences',
                type: 'color',
                default: '#c084fc',
                help: 'Color used for essence drops and essence-related text',
            },
            color_tooltip_profit: {
                id: 'color_tooltip_profit',
                label: 'Tooltip Profit/Positive',
                type: 'color',
                default: '#047857',
                help: 'Color for profit/positive values in tooltips (light backgrounds)',
            },
            color_tooltip_loss: {
                id: 'color_tooltip_loss',
                label: 'Tooltip Loss/Negative',
                type: 'color',
                default: '#dc2626',
                help: 'Color for loss/negative values in tooltips (light backgrounds)',
            },
            color_tooltip_info: {
                id: 'color_tooltip_info',
                label: 'Tooltip Informational',
                type: 'color',
                default: '#2563eb',
                help: 'Color for informational text in tooltips (light backgrounds)',
            },
            color_tooltip_warning: {
                id: 'color_tooltip_warning',
                label: 'Tooltip Warnings',
                type: 'color',
                default: '#ea580c',
                help: 'Color for warnings in tooltips (light backgrounds)',
            },
            color_text_primary: {
                id: 'color_text_primary',
                label: 'Primary Text',
                type: 'color',
                default: '#ffffff',
                help: 'Main text color',
            },
            color_text_secondary: {
                id: 'color_text_secondary',
                label: 'Secondary Text',
                type: 'color',
                default: '#888888',
                help: 'Dimmed/secondary text color',
            },
            color_border: {
                id: 'color_border',
                label: 'Borders',
                type: 'color',
                default: '#444444',
                help: 'Border and separator color',
            },
            color_gold: {
                id: 'color_gold',
                label: 'Gold/Currency',
                type: 'color',
                default: '#ffa500',
                help: 'Color used for gold and currency displays',
            },
            color_accent: {
                id: 'color_accent',
                label: 'Script Accent Color',
                type: 'color',
                default: '#22c55e',
                help: 'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)',
            },
            color_remaining_xp: {
                id: 'color_remaining_xp',
                label: 'Remaining XP Text',
                type: 'color',
                default: '#FFFFFF',
                help: 'Color for remaining XP text below skill bars in left navigation',
            },
            color_invBadge_ask: {
                id: 'color_invBadge_ask',
                label: 'Inventory Badge: Ask Price',
                type: 'color',
                default: '#047857',
                help: 'Color for Ask price badges on inventory items (seller asking price - better selling value)',
            },
            color_invBadge_bid: {
                id: 'color_invBadge_bid',
                label: 'Inventory Badge: Bid Price',
                type: 'color',
                default: '#60a5fa',
                help: 'Color for Bid price badges on inventory items (buyer bid price - instant-sell value)',
            },
            color_transmute: {
                id: 'color_transmute',
                label: 'Transmutation Rates',
                type: 'color',
                default: '#ffffff',
                help: 'Color used for transmutation success rate percentages in Item Dictionary',
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
