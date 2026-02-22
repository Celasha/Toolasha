/**
 * DOM Selector Constants
 * Centralized selector strings for querying game elements
 * If game class names change, update here only
 */

/**
 * Game UI Selectors (class names from game code)
 */
export const GAME = {
    // Header
    TOTAL_LEVEL: '[class*="Header_totalLevel"]',

    // Settings Panel
    SETTINGS_PANEL_TITLE: '[class*="SettingsPanel_title"]',
    SETTINGS_TABS_CONTAINER: 'div[class*="SettingsPanel_tabsComponentContainer"]',
    TABS_FLEX_CONTAINER: '[class*="MuiTabs-flexContainer"]',
    TAB_PANELS_CONTAINER: '[class*="TabsComponent_tabPanelsContainer"]',
    TAB_PANEL: '[class*="TabPanel_tabPanel"]',

    // Game Panel
    GAME_PANEL: 'div[class*="GamePage_gamePanel"]',

    // Skill Action Detail
    SKILL_ACTION_DETAIL: '[class*="SkillActionDetail_skillActionDetail"]',
    SKILL_ACTION_NAME: '[class*="SkillActionDetail_name"]',
    ENHANCING_COMPONENT: 'div.SkillActionDetail_enhancingComponent__17bOx',

    // Action Queue
    QUEUED_ACTIONS: '[class*="QueuedActions_action"]',
    MAX_ACTION_COUNT_INPUT: '[class*="maxActionCountInput"]',

    // Tasks
    TASK_PANEL: '[class*="TasksPanel_taskSlotCount"]',
    TASK_LIST: '[class*="TasksPanel_taskList"]',
    TASK_CARD: '[class*="RandomTask_randomTask"]',
    TASK_NAME: '[class*="RandomTask_name"]',
    TASK_INFO: '.RandomTask_taskInfo__1uasf',
    TASK_ACTION: '.RandomTask_action__3eC6o',
    TASK_REWARDS: '.RandomTask_rewards__YZk7D',
    TASK_CONTENT: '[class*="RandomTask_content"]',
    TASK_NAME_DIV: 'div[class*="RandomTask_name"]',

    // House Panel
    HOUSE_HEADER: '[class*="HousePanel_header"]',
    HOUSE_COSTS: '[class*="HousePanel_costs"]',
    HOUSE_ITEM_REQUIREMENTS: '[class*="HousePanel_itemRequirements"]',

    // Loot Log
    LOOT_LOG_CONTAINER: '.LootLogPanel_actionLoots__3oTid',
    LOOT_LOG_ENTRY: '.LootLogPanel_actionLoot__32gl_',

    // Inventory
    INVENTORY_ITEMS: '[class*="Inventory_items"]',
    INVENTORY_CATEGORY_BUTTON: '.Inventory_categoryButton__35s1x',
    INVENTORY_LABEL: '.Inventory_label__XEOAx',

    // Items
    ITEM_CONTAINER: '.Item_itemContainer__x7kH1',
    ITEM_ITEM: '.Item_item__2De2O',
    ITEM_COUNT: '.Item_count__1HVvv',
    ITEM_TOOLTIP_TEXT: '.ItemTooltipText_itemTooltipText__zFq3A',

    // Navigation/Experience Bars
    NAV_LEVEL: '[class*="NavigationBar_level"]',
    NAV_CURRENT_EXPERIENCE: '[class*="NavigationBar_currentExperience"]',

    // Enhancement
    PROTECTION_ITEM_INPUT: '[class*="protectionItemInputContainer"]',

    // Tooltips
    MUI_TOOLTIP: '.MuiTooltip-tooltip',
};

/**
 * Toolasha-specific selectors (our injected elements)
 */
export const TOOLASHA = {
    // Settings
    SETTINGS_TAB: '#toolasha-settings-tab',
    SETTING_WITH_DEPS: '.toolasha-setting[data-dependencies]',

    // Task features
    TASK_PROFIT: '.mwi-task-profit',
    REROLL_COST_DISPLAY: '.mwi-reroll-cost-display',
    TASK_STATS_BTN: '.toolasha-task-stats-btn',
    TASK_STATS_OVERLAY: '.toolasha-task-stats-overlay',

    // Action features
    QUEUE_TOTAL_TIME: '#mwi-queue-total-time',
    FORAGING_PROFIT: '#mwi-foraging-profit',
    PRODUCTION_PROFIT: '#mwi-production-profit',

    // House features
    HOUSE_PRICING: '.mwi-house-pricing',
    HOUSE_PRICING_EMPTY: '.mwi-house-pricing-empty',
    HOUSE_TOTAL: '.mwi-house-total',
    HOUSE_TO_LEVEL: '.mwi-house-to-level',

    // Profile/Combat Score
    SCORE_CLOSE_BTN: '#mwi-score-close-btn',
    SCORE_TOGGLE: '#mwi-score-toggle',
    SCORE_DETAILS: '#mwi-score-details',
    HOUSE_TOGGLE: '#mwi-house-toggle',
    HOUSE_BREAKDOWN: '#mwi-house-breakdown',
    ABILITY_TOGGLE: '#mwi-ability-toggle',
    ABILITY_BREAKDOWN: '#mwi-ability-breakdown',
    EQUIPMENT_TOGGLE: '#mwi-equipment-toggle',
    EQUIPMENT_BREAKDOWN: '#mwi-equipment-breakdown',

    // Market features
    MARKET_PRICE_INJECTED: '.market-price-injected',
    MARKET_PROFIT_INJECTED: '.market-profit-injected',
    MARKET_EV_INJECTED: '.market-ev-injected',
    MARKET_ENHANCEMENT_INJECTED: '.market-enhancement-injected',

    // UI features
    ALCHEMY_DIMMED: '.mwi-alchemy-dimmed',
    EXP_PERCENTAGE: '.mwi-exp-percentage',
    STACK_PRICE: '.mwi-stack-price',
    NETWORTH_HEADER: '.mwi-networth-header',

    // Enhancement
    ENHANCEMENT_STATS: '#mwi-enhancement-stats',

    // Generic
    COLLAPSIBLE_SECTION: '.mwi-collapsible-section',
    EXPANDABLE_HEADER: '.mwi-expandable-header',
    SECTION_HEADER_NEXT: '.mwi-section-header + div',

    // Legacy/cleanup markers
    INSERTED_SPAN: '.insertedSpan',
    SCRIPT_INJECTED: '.script-injected',
    CONSUMABLE_STATS_INJECTED: '.consumable-stats-injected',
};

/**
 * Enhancement-specific input IDs
 */
export const ENHANCEMENT = {
    TILL_LEVEL: '#tillLevel',
    TILL_LEVEL_INPUT: '#tillLevelInput',
    TILL_LEVEL_NUMBER: '#tillLevelNumber',
};

/**
 * Combat Sim Integration
 */
export const COMBAT_SIM = {
    GROUP_COMBAT_TAB: 'a#group-combat-tab',
    GET_PRICES_BUTTON: 'button#buttonGetPrices',
};
