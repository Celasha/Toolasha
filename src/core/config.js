/**
 * Configuration Module
 * Manages all script constants and user settings
 */

import settingsStorage from './settings-storage.js';
import { settingsGroups } from './settings-schema.js';
import dataManager from './data-manager.js';
import { t } from '../utils/i18n.js';

/**
 * Config class manages all script configuration
 * - Constants (colors, URLs, formatters)
 * - User settings with persistence
 */
class Config {
    constructor() {
        // Number formatting separators (locale-aware)
        this.THOUSAND_SEPARATOR = new Intl.NumberFormat().format(1111).replaceAll('1', '').at(0) || '';
        this.DECIMAL_SEPARATOR = new Intl.NumberFormat().format(1.1).replaceAll('1', '').at(0);

        // Extended color palette (configurable)
        // Dark background colors (for UI elements on dark backgrounds)
        this.COLOR_PROFIT = '#047857'; // Emerald green for positive values
        this.COLOR_LOSS = '#f87171'; // Red for negative values
        this.COLOR_WARNING = '#ffa500'; // Orange for warnings
        this.COLOR_INFO = '#60a5fa'; // Blue for informational
        this.COLOR_ESSENCE = '#c084fc'; // Purple for essences

        // Tooltip colors (for text on light/tooltip backgrounds)
        this.COLOR_TOOLTIP_PROFIT = '#047857'; // Green for tooltips
        this.COLOR_TOOLTIP_LOSS = '#dc2626'; // Darker red for tooltips
        this.COLOR_TOOLTIP_INFO = '#2563eb'; // Darker blue for tooltips
        this.COLOR_TOOLTIP_WARNING = '#ea580c'; // Darker orange for tooltips

        // General colors
        this.COLOR_TEXT_PRIMARY = '#ffffff'; // Primary text color
        this.COLOR_TEXT_SECONDARY = '#888888'; // Secondary text color
        this.COLOR_BORDER = '#444444'; // Border color
        this.COLOR_GOLD = '#ffa500'; // Gold/currency color
        this.COLOR_MIRROR = '#ffd700'; // Philosopher's Mirror highlight color
        this.COLOR_LISTING_PRICE_1M = '#ffd700'; // Listing total price 1M+
        this.COLOR_LISTING_PRICE_100K = '#22c55e'; // Listing total price 100K+
        this.COLOR_LISTING_PRICE_10K = '#ffffff'; // Listing total price 10K+
        this.COLOR_LISTING_PRICE_LOW = '#888888'; // Listing total price <10K
        this.COLOR_ACCENT = '#22c55e'; // Script accent color (green)
        this.COLOR_REMAINING_XP = '#FFFFFF'; // Remaining XP text color
        this.COLOR_XP_RATE = '#ffffff'; // XP/hr rate text color
        this.COLOR_HOURS_TO_LEVEL = '#ffffff'; // Hours to level text color
        this.COLOR_INV_COUNT = '#ffffff'; // Inventory count display color

        // Legacy color constants (mapped to COLOR_ACCENT)
        this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
        this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
        this.SCRIPT_COLOR_ALERT = 'red';

        // Z-index tiers
        this.Z_HUD = 50; // In-game HUD overlays — below game interactive UI
        this.Z_FLOATING_PANEL = 1100; // Persistent panels — below MUI modals (game = ~1300)
        this.Z_POPUP = 9000; // Contextual popups / short-lived overlays
        this.Z_MODAL = 9000; // Full-screen intentional modals
        this.Z_NOTIFICATION = 99999; // Transient notifications (above everything)

        // Market API URL
        this.MARKET_API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

        // Settings loaded from settings-schema via settings-storage.js
        this.settingsMap = {};

        // Map of setting keys to callback functions
        this.settingChangeCallbacks = {};

        // Feature toggles with metadata for future UI
        this.features = {
            // Market Features
            tooltipPrices: {
                enabled: true,
                name: t('Market Prices in Tooltips', '工具提示显示市场价格'),
                category: t('Market', '市场'),
                description: t('Shows bid/ask prices in item tooltips', '在物品工具提示中显示买入/卖出价格'),
                settingKey: 'itemTooltip_prices',
            },
            tooltipProfit: {
                enabled: true,
                name: t('Profit Calculator in Tooltips', '工具提示显示利润计算'),
                category: t('Market', '市场'),
                description: t('Shows production cost and profit in tooltips', '在工具提示中显示生产成本和利润'),
                settingKey: 'itemTooltip_profit',
            },
            tooltipConsumables: {
                enabled: true,
                name: t('Consumable Effects in Tooltips', '工具提示显示消耗品效果'),
                category: t('Market', '市场'),
                description: t('Shows buff effects and durations for food/drinks', '显示食物/饮料的增益效果和持续时间'),
                settingKey: 'showConsumTips',
            },
            dungeonTokenTooltips: {
                enabled: true,
                name: t('Currency Token Tooltips', '代币提示'),
                category: t('Inventory', '库存'),
                description: t('Shows shop values for tokens, seals, and cowbells', '显示代币、印章和牛铃的商店价值'),
                settingKey: 'dungeonTokenTooltips',
            },
            expectedValueCalculator: {
                enabled: true,
                name: t('Expected Value Calculator', '期望价值计算器'),
                category: t('Market', '市场'),
                description: t('Shows EV for openable containers (crates, chests)', '显示可开启容器（板条箱、宝箱）的期望价值 (EV)'),
                settingKey: 'itemTooltip_expectedValue',
            },
            market_showListingPrices: {
                enabled: true,
                name: t('Market Listing Price Display', '市场订单价格显示'),
                category: t('Market', '市场'),
                description: t('Shows top order price, total value, and listing age on My Listings', '在“我的挂单”中显示最高订单价、总价值和挂单时间'),
                settingKey: 'market_showListingPrices',
            },
            market_showEstimatedListingAge: {
                enabled: true,
                name: t('Estimated Listing Age', '预计挂单时间'),
                category: t('Market', '市场'),
                description: t('Estimates creation time for all market listings using listing ID interpolation', '通过订单ID估算所有市场挂单的创建时间'),
                settingKey: 'market_showEstimatedListingAge',
            },
            market_showOrderTotals: {
                enabled: true,
                name: t('Market Order Totals', '市场订单总额'),
                category: t('Market', '市场'),
                description: t('Shows buy orders, sell orders, and unclaimed coins in header', '在顶部显示买单、卖单和未领取的金币总额'),
                settingKey: 'market_showOrderTotals',
            },
            market_showHistoryViewer: {
                enabled: true,
                name: t('Market History Viewer', '市场历史记录查看器'),
                category: t('Market', '市场'),
                description: t('View and export all market listing history', '查看并导出所有市场挂单历史'),
                settingKey: 'market_showHistoryViewer',
            },
            market_showPhiloCalculator: {
                enabled: true,
                name: t('Philo Gamba Calculator', '贤者之石炼金计算器'),
                category: t('Market', '市场'),
                description: t("Calculate expected value of transmuting items into Philosopher's Stones", "计算将物品转化为贤者之石的期望价值"),
                settingKey: 'market_showPhiloCalculator',
            },

            // Action Features
            actionTimeDisplay: {
                enabled: true,
                name: t('Action Queue Time Display', '行动队列时间显示'),
                category: t('Actions', '行动'),
                description: t('Shows total time and completion time for queued actions', '显示排队行动的总时间和完成时间'),
                settingKey: 'totalActionTime',
            },
            quickInputButtons: {
                enabled: true,
                name: t('Quick Input Buttons', '快捷输入按钮'),
                category: t('Actions', '行动'),
                description: t('Adds 1/10/100/1000 buttons to action inputs', '在行动输入中添加 1/10/100/1000 按钮'),
                settingKey: 'actionPanel_totalTime_quickInputs',
            },
            actionPanelProfit: {
                enabled: true,
                name: t('Action Profit Display', '行动利润显示'),
                category: t('Actions', '行动'),
                description: t('Shows profit/loss for gathering and production', '显示采集和生产的利润/亏损'),
                settingKey: 'actionPanel_foragingTotal',
            },
            requiredMaterials: {
                enabled: true,
                name: t('Required Materials Display', '所需材料显示'),
                category: t('Actions', '行动'),
                description: t('Shows total required and missing materials for production actions', '显示生产行动所需的总材料和缺失材料'),
                settingKey: 'requiredMaterials',
            },

            // Combat Features
            abilityBookCalculator: {
                enabled: true,
                name: t('Ability Book Requirements', '能力书需求'),
                category: t('Combat', '战斗'),
                description: t('Shows books needed to reach target level', '显示达到目标等级所需的技能书数量'),
                settingKey: 'skillbook',
            },
            zoneIndices: {
                enabled: true,
                name: t('Combat Zone Indices', '战斗区域序号'),
                category: t('Combat', '战斗'),
                description: t('Shows zone numbers in combat location list', '在战斗地点列表中显示区域序号'),
                settingKey: 'mapIndex',
            },
            taskZoneIndices: {
                enabled: true,
                name: t('Task Zone Indices', '任务区域序号'),
                category: t('Tasks', '任务'),
                description: t('Shows zone numbers on combat tasks', '在战斗任务上显示区域序号'),
                settingKey: 'taskMapIndex',
            },
            combatScore: {
                enabled: true,
                name: t('Profile Gear Score', '个人资料装备评分'),
                category: t('Combat', '战斗'),
                description: t('Shows gear score on profile', '在个人资料上显示装备评分'),
                settingKey: 'combatScore',
            },
            dungeonTracker: {
                enabled: true,
                name: t('Dungeon Tracker', '副本追踪器'),
                category: t('Combat', '战斗'),
                description: t('Real-time dungeon progress tracking in top bar with wave times, statistics, and party chat completion messages', '在顶部栏实时追踪副本进度，包含波数时间、统计数据和队伍聊天完成消息'),
                settingKey: 'dungeonTracker',
            },
            combatSimIntegration: {
                enabled: true,
                name: t('Combat Simulator Integration', '战斗模拟器集成'),
                category: t('Combat', '战斗'),
                description: t('Auto-import character/party data into Shykai Combat Simulator', '将角色/队伍数据自动导入到 Shykai 战斗模拟器'),
                settingKey: null, // New feature, no legacy setting
            },
            enhancementSimulator: {
                enabled: true,
                name: t('Enhancement Simulator', '强化模拟器'),
                category: t('Market', '市场'),
                description: t('Shows enhancement cost calculations in item tooltips', '在物品工具提示中显示强化成本计算'),
                settingKey: 'enhanceSim',
            },

            // UI Features
            equipmentLevelDisplay: {
                enabled: true,
                name: t('Equipment Level on Icons', '图标上显示装备等级'),
                category: t('UI', '界面'),
                description: t('Shows item level number on equipment icons', '在装备图标上显示物品等级数字'),
                settingKey: 'itemIconLevel',
            },
            alchemyItemDimming: {
                enabled: true,
                name: t('Alchemy Item Dimming', '炼金物品变暗'),
                category: t('UI', '界面'),
                description: t('Dims items requiring higher Alchemy level', '对需要更高炼金等级的物品进行变暗处理'),
                settingKey: 'alchemyItemDimming',
            },
            skillExperiencePercentage: {
                enabled: true,
                name: t('Skill Experience Percentage', '技能经验百分比'),
                category: t('UI', '界面'),
                description: t('Shows XP progress percentage in left sidebar', '在左侧侧边栏显示经验进度百分比'),
                settingKey: 'expPercentage',
            },
            largeNumberFormatting: {
                enabled: true,
                name: t('Use K/M/B Number Formatting', '使用 K/M/B 数字格式'),
                category: t('UI', '界面'),
                description: t('Display large numbers as 1.5M instead of 1,500,000', '将大数字显示为 1.5M 而不是 1,500,000'),
                settingKey: 'formatting_useKMBFormat',
            },

            // Task Features
            taskProfitDisplay: {
                enabled: true,
                name: t('Task Profit Calculator', '任务利润计算器'),
                category: t('Tasks', '任务'),
                description: t('Shows expected profit from task rewards', '显示任务奖励的预期利润'),
                settingKey: 'taskProfitCalculator',
            },
            taskEfficiencyRating: {
                enabled: true,
                name: t('Task Efficiency Rating', '任务效率评级'),
                category: t('Tasks', '任务'),
                description: t('Shows tokens or profit per hour on task cards', '在任务卡片上显示每小时代币或利润'),
                settingKey: 'taskEfficiencyRating',
            },
            taskRerollTracker: {
                enabled: true,
                name: t('Task Reroll Tracker', '任务重置追踪器'),
                category: t('Tasks', '任务'),
                description: t('Tracks reroll costs and history', '追踪重置成本和历史记录'),
                settingKey: 'taskRerollTracker',
            },
            taskSorter: {
                enabled: true,
                name: t('Task Sorting', '任务排序'),
                category: t('Tasks', '任务'),
                description: t('Adds button to sort tasks by skill type', '添加按技能类型对任务进行排序的按钮'),
                settingKey: 'taskSorter',
            },
            taskIcons: {
                enabled: true,
                name: t('Task Icons', '任务图标'),
                category: t('Tasks', '任务'),
                description: t('Shows visual icons on task cards', '在任务卡片上显示可视图标'),
                settingKey: 'taskIcons',
            },
            taskIconsDungeons: {
                enabled: false,
                name: t('Task Icons - Dungeons', '任务图标 - 副本'),
                category: t('Tasks', '任务'),
                description: t('Shows dungeon icons for combat tasks', '为战斗任务显示副本图标'),
                settingKey: 'taskIconsDungeons',
                dependencies: ['taskIcons'],
            },

            // Skills Features
            skillRemainingXP: {
                enabled: true,
                name: t('Remaining XP Display', '剩余经验显示'),
                category: t('Skills', '技能'),
                description: t('Shows remaining XP to next level on skill bars', '在技能条上显示距离下一级所需的剩余经验'),
                settingKey: 'skillRemainingXP',
            },

            // House Features
            houseCostDisplay: {
                enabled: true,
                name: t('House Upgrade Costs', '房屋升级成本'),
                category: t('House', '房屋'),
                description: t('Shows market value of upgrade materials', '显示升级材料的市场价值'),
                settingKey: 'houseUpgradeCosts',
            },

            // Economy Features
            networth: {
                enabled: true,
                name: t('Net Worth Calculator', '净值计算器'),
                category: t('Economy', '经济'),
                description: t('Shows total asset value in header (Current Assets)', '在顶部显示总资产价值（流动资产）'),
                settingKey: 'networth',
            },
            inventorySummary: {
                enabled: true,
                name: t('Inventory Summary Panel', '库存摘要面板'),
                category: t('Economy', '经济'),
                description: t('Shows detailed networth breakdown below inventory', '在库存下方显示详细的净值明细'),
                settingKey: 'invWorth',
            },
            inventorySort: {
                enabled: true,
                name: t('Inventory Sort', '库存排序'),
                category: t('Economy', '经济'),
                description: t('Sorts inventory by Ask/Bid price', '按买入/卖出价格对库存进行排序'),
                settingKey: 'invSort',
            },
            inventorySortBadges: {
                enabled: false,
                name: t('Inventory Sort Price Badges', '库存排序价格徽章'),
                category: t('Economy', '经济'),
                description: t('Shows stack value badges on items when sorting', '排序时在物品上显示堆叠价值徽章'),
                settingKey: 'invSort_showBadges',
            },
            inventoryBadgePrices: {
                enabled: false,
                name: t('Inventory Price Badges', '库存价格徽章'),
                category: t('Economy', '经济'),
                description: t('Shows stack value badges on items (independent of sorting)', '在物品上显示堆叠价值徽章（独立于排序）'),
                settingKey: 'invBadgePrices',
            },

            // Enhancement Features
            enhancementTracker: {
                enabled: false,
                name: t('Enhancement Tracker', '强化追踪器'),
                category: t('Enhancement', '强化'),
                description: t('Tracks enhancement attempts, costs, and statistics', '追踪强化尝试次数、成本和统计数据'),
                settingKey: 'enhancementTracker',
            },

            // Notification Features
            notifiEmptyAction: {
                enabled: false,
                name: t('Empty Queue Notification', '空队列通知'),
                category: t('Notifications', '通知'),
                description: t('Browser notification when action queue becomes empty', '当行动队列为空时发送浏览器通知'),
                settingKey: 'notifiEmptyAction',
            },
        };

        // Note: loadSettings() must be called separately (async)
    }

    /**
     * Initialize config (async) - loads settings from storage
     * @returns {Promise<void>}
     */
    async initialize() {
        await this.loadSettings();
        this.applyColorSettings();
    }

    /**
     * Load settings from storage (async)
     * @returns {Promise<void>}
     */
    async loadSettings() {
        // Set character ID in settings storage for per-character settings
        const characterId = dataManager.getCurrentCharacterId();

        // Before character ID is known, only populate schema defaults (no storage access)
        // This prevents loading from the wrong storage key during early initialization
        if (!characterId) {
            this.settingsMap = settingsStorage.buildDefaults();
            return;
        }

        settingsStorage.setCharacterId(characterId);

        // Load settings from settings-storage (which uses settings-schema as source of truth)
        this.settingsMap = await settingsStorage.loadSettings();
    }

    /**
     * Clear settings cache (for character switching)
     */
    clearSettingsCache() {
        this.settingsMap = {};
    }

    /**
     * Save settings to storage (immediately)
     */
    saveSettings() {
        settingsStorage.saveSettings(this.settingsMap);
    }

    /**
     * Get a setting value
     * @param {string} key - Setting key
     * @returns {boolean} Setting value
     */
    getSetting(key) {
        // Check loaded settings first
        if (this.settingsMap[key]) {
            return this.settingsMap[key].isTrue ?? false;
        }

        // Fallback: Check settings-schema for default (fixes race condition on load)
        for (const group of Object.values(settingsGroups)) {
            if (group.settings[key]) {
                return group.settings[key].default ?? false;
            }
        }

        // Ultimate fallback
        return false;
    }

    /**
     * Get the display label for a pricing mode key, respecting the naming convention setting.
     * @param {string} mode - Pricing mode key ('conservative', 'hybrid', 'optimistic', 'patientBuy')
     * @returns {string} Display label
     */
    getPricingModeLabel(mode) {
        const useInstant = this.getSetting('profitCalc_pricingNaming');
        const labels = useInstant
            ? {
                conservative: 'Instant Buy / Instant Sell',
                hybrid: 'Instant Buy / Patient Sell',
                optimistic: 'Patient Buy / Patient Sell',
                patientBuy: 'Patient Buy / Instant Sell',
            }
            : {
                conservative: 'Buy: Ask / Sell: Bid',
                hybrid: 'Buy: Ask / Sell: Ask',
                optimistic: 'Buy: Bid / Sell: Ask',
                patientBuy: 'Buy: Bid / Sell: Bid',
            };
        return labels[mode] || labels.hybrid;
    }

    /**
     * Get a setting value (for non-boolean settings)
     * @param {string} key - Setting key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {*} Setting value
     */
    getSettingValue(key, defaultValue = null) {
        const setting = this.settingsMap[key];
        if (!setting) {
            return defaultValue;
        }
        // Handle both boolean (isTrue) and value-based settings
        if (setting.hasOwnProperty('value')) {
            let value = setting.value;

            // Parse JSON strings for template-type settings
            if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                try {
                    value = JSON.parse(value);
                } catch (e) {
                    console.warn(`[Config] Failed to parse JSON for setting '${key}':`, e);
                    // Return as-is if parsing fails
                }
            }

            return value;
        } else if (setting.hasOwnProperty('isTrue')) {
            return setting.isTrue;
        }
        return defaultValue;
    }

    /**
     * Set a setting value (auto-saves)
     * @param {string} key - Setting key
     * @param {boolean} value - Setting value
     */
    setSetting(key, value) {
        if (this.settingsMap[key]) {
            this.settingsMap[key].isTrue = value;
            this.saveSettings();

            // Re-apply colors if color setting changed
            if (key === 'useOrangeAsMainColor') {
                this.applyColorSettings();
            }

            // Trigger registered callbacks for this setting
            if (this.settingChangeCallbacks[key]) {
                for (const cb of this.settingChangeCallbacks[key]) cb(value);
            }
        }
    }

    /**
     * Set a setting value (for non-boolean settings, auto-saves)
     * @param {string} key - Setting key
     * @param {*} value - Setting value
     */
    setSettingValue(key, value) {
        if (this.settingsMap[key]) {
            this.settingsMap[key].value = value;
            this.saveSettings();

            // Re-apply color settings if this is a color setting
            if (key.startsWith('color_')) {
                this.applyColorSettings();
            }

            // Trigger registered callbacks for this setting
            if (this.settingChangeCallbacks[key]) {
                for (const cb of this.settingChangeCallbacks[key]) cb(value);
            }
        }
    }

    /**
     * Register a callback to be called when a specific setting changes.
     * Multiple callbacks per key are supported.
     * @param {string} key - Setting key to watch
     * @param {Function} callback - Callback function to call when setting changes
     */
    onSettingChange(key, callback) {
        if (!this.settingChangeCallbacks[key]) {
            this.settingChangeCallbacks[key] = [];
        }
        this.settingChangeCallbacks[key].push(callback);
    }

    /**
     * Unregister a specific callback for a setting change
     * @param {string} key - Setting key to stop watching
     * @param {Function} callback - The exact callback reference to remove
     */
    offSettingChange(key, callback) {
        if (this.settingChangeCallbacks[key]) {
            this.settingChangeCallbacks[key] = this.settingChangeCallbacks[key].filter((cb) => cb !== callback);
        }
    }

    /**
     * Toggle a setting (auto-saves)
     * @param {string} key - Setting key
     * @returns {boolean} New value
     */
    toggleSetting(key) {
        const newValue = !this.getSetting(key);
        this.setSetting(key, newValue);
        return newValue;
    }

    /**
     * Get all settings as an array (useful for UI)
     * @returns {Array} Array of setting objects
     */
    getAllSettings() {
        return Object.values(this.settingsMap);
    }

    /**
     * Reset all settings to defaults
     */
    async resetToDefaults() {
        this.settingsMap = settingsStorage.buildDefaults();
        await settingsStorage.saveSettings(this.settingsMap);
        this.applyColorSettings();
    }

    /**
     * Sync current settings to all other characters
     * @returns {Promise<{success: boolean, count: number, error?: string}>} Result object
     */
    async syncSettingsToAllCharacters() {
        try {
            // Ensure character ID is set
            const characterId = dataManager.getCurrentCharacterId();
            if (!characterId) {
                return {
                    success: false,
                    count: 0,
                    error: 'No character ID available',
                };
            }

            // Set character ID in settings storage
            settingsStorage.setCharacterId(characterId);

            // Sync settings to all other characters
            const syncedCount = await settingsStorage.syncSettingsToAllCharacters(this.settingsMap);

            return {
                success: true,
                count: syncedCount,
            };
        } catch (error) {
            console.error('[Config] Failed to sync settings:', error);
            return {
                success: false,
                count: 0,
                error: error.message,
            };
        }
    }

    /**
     * Get number of known characters (including current)
     * @returns {Promise<number>} Number of characters
     */
    async getKnownCharacterCount() {
        try {
            const knownCharacters = await settingsStorage.getKnownCharacters();
            return knownCharacters.length;
        } catch (error) {
            console.error('[Config] Failed to get character count:', error);
            return 0;
        }
    }

    /**
     * Apply color settings to color constants
     */
    applyColorSettings() {
        // Apply extended color palette from settings
        this.COLOR_PROFIT = this.getSettingValue('color_profit', '#047857');
        this.COLOR_LOSS = this.getSettingValue('color_loss', '#f87171');
        this.COLOR_WARNING = this.getSettingValue('color_warning', '#ffa500');
        this.COLOR_INFO = this.getSettingValue('color_info', '#60a5fa');
        this.COLOR_ESSENCE = this.getSettingValue('color_essence', '#c084fc');
        this.COLOR_TOOLTIP_PROFIT = this.getSettingValue('color_tooltip_profit', '#047857');
        this.COLOR_TOOLTIP_LOSS = this.getSettingValue('color_tooltip_loss', '#dc2626');
        this.COLOR_TOOLTIP_INFO = this.getSettingValue('color_tooltip_info', '#2563eb');
        this.COLOR_TOOLTIP_WARNING = this.getSettingValue('color_tooltip_warning', '#ea580c');
        this.COLOR_TEXT_PRIMARY = this.getSettingValue('color_text_primary', '#ffffff');
        this.COLOR_TEXT_SECONDARY = this.getSettingValue('color_text_secondary', '#888888');
        this.COLOR_BORDER = this.getSettingValue('color_border', '#444444');
        this.COLOR_GOLD = this.getSettingValue('color_gold', '#ffa500');
        this.COLOR_MIRROR = this.getSettingValue('color_mirror', '#ffd700');
        this.COLOR_LISTING_PRICE_1M = this.getSettingValue('color_listing_price_1m', '#ffd700');
        this.COLOR_LISTING_PRICE_100K = this.getSettingValue('color_listing_price_100k', '#22c55e');
        this.COLOR_LISTING_PRICE_10K = this.getSettingValue('color_listing_price_10k', '#ffffff');
        this.COLOR_LISTING_PRICE_LOW = this.getSettingValue('color_listing_price_low', '#888888');
        this.COLOR_ACCENT = this.getSettingValue('color_accent', '#22c55e');
        this.COLOR_REMAINING_XP = this.getSettingValue('color_remaining_xp', '#FFFFFF');
        this.COLOR_XP_RATE = this.getSettingValue('color_xp_rate', '#ffffff');
        this.COLOR_HOURS_TO_LEVEL = this.getSettingValue('color_hours_to_level', '#ffffff');
        this.COLOR_INV_COUNT = this.getSettingValue('color_inv_count', '#ffffff');
        this.COLOR_INVBADGE_ASK = this.getSettingValue('color_invBadge_ask', '#047857');
        this.COLOR_INVBADGE_BID = this.getSettingValue('color_invBadge_bid', '#60a5fa');
        this.COLOR_TRANSMUTE = this.getSettingValue('color_transmute', '#ffffff');

        // Set legacy SCRIPT_COLOR_MAIN to accent color
        this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
        this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT; // Keep tooltip same as main
    }

    /**
     * Check if a feature is enabled
     * Uses legacy settingKey if available, otherwise uses feature.enabled
     * @param {string} featureKey - Feature key (e.g., 'tooltipPrices')
     * @returns {boolean} Whether feature is enabled
     */
    isFeatureEnabled(featureKey) {
        const feature = this.features?.[featureKey];
        if (!feature) {
            return true; // Default to enabled if not found
        }

        // Check legacy setting first (for backward compatibility)
        if (feature.settingKey && this.settingsMap[feature.settingKey]) {
            return this.settingsMap[feature.settingKey].isTrue ?? true;
        }

        // Otherwise use feature.enabled
        return feature.enabled ?? true;
    }

    /**
     * Enable or disable a feature
     * @param {string} featureKey - Feature key
     * @param {boolean} enabled - Enable state
     */
    async setFeatureEnabled(featureKey, enabled) {
        const feature = this.features?.[featureKey];
        if (!feature) {
            console.warn(`Feature '${featureKey}' not found`);
            return;
        }

        // Update legacy setting if it exists
        if (feature.settingKey && this.settingsMap[feature.settingKey]) {
            this.settingsMap[feature.settingKey].isTrue = enabled;
        }

        // Update feature registry
        feature.enabled = enabled;

        await this.saveSettings();
    }

    /**
     * Toggle a feature
     * @param {string} featureKey - Feature key
     * @returns {boolean} New enabled state
     */
    async toggleFeature(featureKey) {
        const current = this.isFeatureEnabled(featureKey);
        await this.setFeatureEnabled(featureKey, !current);
        return !current;
    }

    /**
     * Get all features grouped by category
     * @returns {Object} Features grouped by category
     */
    getFeaturesByCategory() {
        const grouped = {};

        for (const [key, feature] of Object.entries(this.features)) {
            const category = feature.category || 'Other';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push({
                key,
                name: feature.name,
                description: feature.description,
                enabled: this.isFeatureEnabled(key),
            });
        }

        return grouped;
    }

    /**
     * Get all feature keys
     * @returns {string[]} Array of feature keys
     */
    getFeatureKeys() {
        return Object.keys(this.features || {});
    }

    /**
     * Get feature info
     * @param {string} featureKey - Feature key
     * @returns {Object|null} Feature info with current enabled state
     */
    getFeatureInfo(featureKey) {
        const feature = this.features?.[featureKey];
        if (!feature) {
            return null;
        }

        return {
            key: featureKey,
            name: feature.name,
            category: feature.category,
            description: feature.description,
            enabled: this.isFeatureEnabled(featureKey),
        };
    }
}

const config = new Config();

export default config;
