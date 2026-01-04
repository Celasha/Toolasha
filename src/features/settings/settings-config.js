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
                default: true
            }
        }
    },

    actionPanel: {
        title: 'Action Panel Enhancements',
        icon: '⚡',
        settings: {
            totalActionTime: {
                id: 'totalActionTime',
                label: 'Top left: Estimated total time and completion time',
                type: 'checkbox',
                default: true
            },
            actionPanel_totalTime: {
                id: 'actionPanel_totalTime',
                label: 'Action panel: Total time, times to reach target level, exp/hour',
                type: 'checkbox',
                default: true
            },
            actionPanel_totalTime_quickInputs: {
                id: 'actionPanel_totalTime_quickInputs',
                label: 'Action panel: Quick input buttons (hours, count presets, Max)',
                type: 'checkbox',
                default: true,
                dependencies: ['actionPanel_totalTime']
            },
            actionPanel_foragingTotal: {
                id: 'actionPanel_foragingTotal',
                label: 'Action panel: Overall profit for multi-outcome foraging',
                type: 'checkbox',
                default: true,
                dependencies: ['actionPanel_totalTime']
            },
            actionQueue: {
                id: 'actionQueue',
                label: 'Queued actions: Show total time and completion time',
                type: 'checkbox',
                default: true
            }
        }
    },

    tooltips: {
        title: 'Item Tooltip Enhancements',
        icon: '💬',
        settings: {
            itemTooltip_prices: {
                id: 'itemTooltip_prices',
                label: 'Show 24-hour average market prices',
                type: 'checkbox',
                default: true
            },
            itemTooltip_profit: {
                id: 'itemTooltip_profit',
                label: 'Show production cost and profit',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_prices']
            },
            itemTooltip_expectedValue: {
                id: 'itemTooltip_expectedValue',
                label: 'Show expected value for openable containers',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_prices']
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
                    { value: 'None', label: 'Summary Only' }
                ],
                dependencies: ['itemTooltip_expectedValue']
            },
            expectedValue_respectPricingMode: {
                id: 'expectedValue_respectPricingMode',
                label: 'Use pricing mode for expected value calculations',
                type: 'checkbox',
                default: true,
                dependencies: ['itemTooltip_expectedValue']
            },
            showConsumTips: {
                id: 'showConsumTips',
                label: 'HP/MP consumables: Restore speed, cost performance',
                type: 'checkbox',
                default: true
            },
            enhanceSim: {
                id: 'enhanceSim',
                label: 'Show enhancement simulator calculations',
                type: 'checkbox',
                default: true
            }
        }
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
                help: 'Most players should use market defaults to see realistic professional enhancer costs'
            },
            enhanceSim_enhancingLevel: {
                id: 'enhanceSim_enhancingLevel',
                label: 'Enhancing skill level',
                type: 'number',
                default: 125,
                min: 1,
                max: 150,
                help: 'Default: 125 (professional enhancer level)'
            },
            enhanceSim_houseLevel: {
                id: 'enhanceSim_houseLevel',
                label: 'Observatory house room level',
                type: 'number',
                default: 6,
                min: 0,
                max: 8,
                help: 'Default: 6 (realistic market level)'
            },
            enhanceSim_toolBonus: {
                id: 'enhanceSim_toolBonus',
                label: 'Tool success bonus %',
                type: 'number',
                default: 5.42,
                min: 0,
                max: 30,
                step: 0.01,
                help: 'Default: 5.42 (Celestial Enhancer +10)'
            },
            enhanceSim_speedBonus: {
                id: 'enhanceSim_speedBonus',
                label: 'Speed bonus %',
                type: 'number',
                default: 0,
                min: 0,
                max: 50,
                step: 0.01,
                help: 'Default: 0 (not critical for cost calculations)'
            },
            enhanceSim_blessedTea: {
                id: 'enhanceSim_blessedTea',
                label: 'Blessed Tea active',
                type: 'checkbox',
                default: true,
                help: 'Professional enhancers use this to reduce attempts'
            },
            enhanceSim_ultraEnhancingTea: {
                id: 'enhanceSim_ultraEnhancingTea',
                label: 'Ultra Enhancing Tea active',
                type: 'checkbox',
                default: true,
                help: 'Provides +8 base skill levels (scales with drink concentration)'
            },
            enhanceSim_superEnhancingTea: {
                id: 'enhanceSim_superEnhancingTea',
                label: 'Super Enhancing Tea active',
                type: 'checkbox',
                default: false,
                help: 'Provides +6 base skill levels (Ultra is better)'
            },
            enhanceSim_enhancingTea: {
                id: 'enhanceSim_enhancingTea',
                label: 'Enhancing Tea active',
                type: 'checkbox',
                default: false,
                help: 'Provides +3 base skill levels (Ultra is better)'
            },
            enhanceSim_drinkConcentration: {
                id: 'enhanceSim_drinkConcentration',
                label: 'Drink Concentration %',
                type: 'number',
                default: 10.32,
                min: 0,
                max: 20,
                step: 0.01,
                help: 'Default: 10.32 (Guzzling Pouch +10)'
            }
        }
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
                requiresRefresh: true,
                help: 'Track enhancement attempts, costs, and statistics'
            },
            enhancementTracker_showOnlyOnEnhancingScreen: {
                id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                label: 'Show tracker only on Enhancing screen',
                type: 'checkbox',
                default: false,
                dependencies: ['enhancementTracker'],
                help: 'Hide tracker when not on the Enhancing screen'
            }
        }
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
                help: 'Enhanced items valued by enhancement simulator'
            },
            invWorth: {
                id: 'invWorth',
                label: 'Below inventory: Show inventory summary',
                type: 'checkbox',
                default: true,
                dependencies: ['networth']
            },
            invSort: {
                id: 'invSort',
                label: 'Sort inventory items by value',
                type: 'checkbox',
                default: true,
                dependencies: ['networth']
            },
            invSort_showBadges: {
                id: 'invSort_showBadges',
                label: 'Show stack value badges when sorting by Ask/Bid',
                type: 'checkbox',
                default: false,
                dependencies: ['invSort']
            },
            invSort_badgesOnNone: {
                id: 'invSort_badgesOnNone',
                label: 'Badge type when "None" sort is selected',
                type: 'select',
                default: 'None',
                options: ['None', 'Ask', 'Bid'],
                dependencies: ['invSort']
            },
            profitCalc_pricingMode: {
                id: 'profitCalc_pricingMode',
                label: 'Profit calculation pricing mode',
                type: 'select',
                default: 'hybrid',
                options: [
                    { value: 'conservative', label: 'Conservative (Ask/Bid - instant trading)' },
                    { value: 'hybrid', label: 'Hybrid (Ask/Ask - instant buy, patient sell)' },
                    { value: 'optimistic', label: 'Optimistic (Bid/Ask - patient trading)' }
                ]
            },
            networth_pricingMode: {
                id: 'networth_pricingMode',
                label: 'Networth pricing mode',
                type: 'select',
                default: 'ask',
                options: [
                    { value: 'ask', label: 'Ask (Replacement value - what you\'d pay to rebuy)' },
                    { value: 'bid', label: 'Bid (Liquidation value - what you\'d get selling now)' },
                    { value: 'average', label: 'Average (Middle ground between ask and bid)' }
                ],
                dependencies: ['networth'],
                help: 'Choose how to value items in networth calculations. Ask = insurance/replacement cost, Bid = quick-sale value, Average = balanced estimate.'
            }
        }
    },

    skills: {
        title: 'Skills',
        icon: '📚',
        settings: {
            skillbook: {
                id: 'skillbook',
                label: 'Skill books: Show books needed to reach target level',
                type: 'checkbox',
                default: true
            }
        }
    },

    combat: {
        title: 'Combat Features',
        icon: '⚔️',
        settings: {
            combatScore: {
                id: 'combatScore',
                label: 'Profile panel: Show gear score',
                type: 'checkbox',
                default: true
            }
        }
    },

    tasks: {
        title: 'Tasks',
        icon: '📋',
        settings: {
            taskProfitCalculator: {
                id: 'taskProfitCalculator',
                label: 'Show total profit for gathering/production tasks',
                type: 'checkbox',
                default: true
            },
            taskRerollTracker: {
                id: 'taskRerollTracker',
                label: 'Track task reroll costs',
                type: 'checkbox',
                default: true,
                requiresRefresh: true,
                help: 'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)'
            },
            taskMapIndex: {
                id: 'taskMapIndex',
                label: 'Show combat zone index numbers on tasks',
                type: 'checkbox',
                default: true
            }
        }
    },

    ui: {
        title: 'UI Enhancements',
        icon: '🎨',
        settings: {
            expPercentage: {
                id: 'expPercentage',
                label: 'Left sidebar: Show skill XP percentages',
                type: 'checkbox',
                default: true
            },
            itemIconLevel: {
                id: 'itemIconLevel',
                label: 'Bottom left corner of icons: Show equipment level',
                type: 'checkbox',
                default: true
            },
            showsKeyInfoInIcon: {
                id: 'showsKeyInfoInIcon',
                label: 'Bottom left corner of key icons: Show zone index',
                type: 'checkbox',
                default: true,
                dependencies: ['itemIconLevel']
            },
            mapIndex: {
                id: 'mapIndex',
                label: 'Combat zones: Show zone index numbers',
                type: 'checkbox',
                default: true
            },
            alchemyItemDimming: {
                id: 'alchemyItemDimming',
                label: 'Alchemy panel: Dim items requiring higher level',
                type: 'checkbox',
                default: true
            },
            marketFilter: {
                id: 'marketFilter',
                label: 'Marketplace: Filter by level, class, slot',
                type: 'checkbox',
                default: true
            },
            fillMarketOrderPrice: {
                id: 'fillMarketOrderPrice',
                label: 'Auto-fill marketplace orders with optimal price',
                type: 'checkbox',
                default: true
            }
        }
    },

    house: {
        title: 'House',
        icon: '🏠',
        settings: {
            houseUpgradeCosts: {
                id: 'houseUpgradeCosts',
                label: 'Show upgrade costs with market prices and inventory comparison',
                type: 'checkbox',
                default: true
            }
        }
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
                help: 'Only works when the game page is open'
            }
        }
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
                help: 'Color used for profit, gains, and positive values'
            },
            color_loss: {
                id: 'color_loss',
                label: 'Loss/Negative Values',
                type: 'color',
                default: '#f87171',
                help: 'Color used for losses, costs, and negative values'
            },
            color_warning: {
                id: 'color_warning',
                label: 'Warnings',
                type: 'color',
                default: '#ffa500',
                help: 'Color used for warnings and important notices'
            },
            color_info: {
                id: 'color_info',
                label: 'Informational',
                type: 'color',
                default: '#60a5fa',
                help: 'Color used for informational text and highlights'
            },
            color_text_primary: {
                id: 'color_text_primary',
                label: 'Primary Text',
                type: 'color',
                default: '#ffffff',
                help: 'Main text color'
            },
            color_text_secondary: {
                id: 'color_text_secondary',
                label: 'Secondary Text',
                type: 'color',
                default: '#888888',
                help: 'Dimmed/secondary text color'
            },
            color_border: {
                id: 'color_border',
                label: 'Borders',
                type: 'color',
                default: '#444444',
                help: 'Border and separator color'
            },
            color_gold: {
                id: 'color_gold',
                label: 'Gold/Currency',
                type: 'color',
                default: '#ffa500',
                help: 'Color used for gold and currency displays'
            },
            color_accent: {
                id: 'color_accent',
                label: 'Script Accent Color',
                type: 'color',
                default: '#22c55e',
                help: 'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)'
            }
        }
    }
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
