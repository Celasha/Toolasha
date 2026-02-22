/**
 * Loot Log Statistics Module
 * Adds total value, average time, and daily output statistics to loot logs
 * Port of Edible Tools loot tracker feature, integrated into Toolasha architecture
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import { getItemPrices } from '../../utils/market-data.js';
import { formatKMB } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class LootLogStats {
    constructor() {
        this.unregisterHandlers = [];
        this.initialized = false;
        this.timerRegistry = createTimerRegistry();
        this.processedLogs = new WeakSet();
        this.currentLootLogData = null;
    }

    /**
     * Initialize loot log statistics feature
     */
    async initialize() {
        if (this.initialized) return;

        const enabled = config.getSetting('lootLogStats');
        if (!enabled) return;

        // Listen for loot_log_updated messages from WebSocket
        const wsHandler = (data) => this.handleLootLogUpdate(data);
        webSocketHook.on('loot_log_updated', wsHandler);
        this.unregisterHandlers.push(() => {
            webSocketHook.off('loot_log_updated', wsHandler);
        });

        // Watch for loot log elements in DOM
        const unregisterObserver = domObserver.onClass('LootLogStats', 'LootLogPanel_actionLoot__32gl_', (element) =>
            this.processLootLogElement(element)
        );
        this.unregisterHandlers.push(unregisterObserver);

        this.initialized = true;
    }

    /**
     * Handle loot_log_updated WebSocket message
     * @param {Object} data - WebSocket message data
     */
    handleLootLogUpdate(data) {
        if (!data || !Array.isArray(data.lootLog)) return;

        // Store loot log data for matching with DOM elements
        this.currentLootLogData = data.lootLog;

        // Process existing loot log elements after short delay
        const timeout = setTimeout(() => {
            const lootLogElements = document.querySelectorAll('.LootLogPanel_actionLoot__32gl_');
            lootLogElements.forEach((element) => this.processLootLogElement(element));
        }, 200);

        this.timerRegistry.registerTimeout(timeout);
    }

    /**
     * Process a single loot log DOM element
     * @param {HTMLElement} lootElem - Loot log element
     */
    processLootLogElement(lootElem) {
        // Skip if already processed
        if (this.processedLogs.has(lootElem)) return;

        // Mark as processed
        this.processedLogs.add(lootElem);

        // Extract divs
        const divs = lootElem.querySelectorAll('div');
        if (divs.length < 3) return;

        const secondDiv = divs[1]; // Timestamps
        const thirdDiv = divs[2]; // Duration

        // Extract log data
        const logData = this.extractLogData(lootElem, secondDiv);
        if (!logData) return;

        // Skip enhancement actions
        if (logData.actionHrid === '/actions/enhancing/enhance') return;

        // Calculate and inject total value
        this.injectTotalValue(secondDiv, logData);

        // Calculate and inject average time and daily output
        this.injectTimeAndDailyOutput(thirdDiv, logData);
    }

    /**
     * Extract log data from DOM element
     * @param {HTMLElement} lootElem - Loot log element
     * @param {HTMLElement} secondDiv - Second div containing timestamps
     * @returns {Object|null} Log data object or null if extraction fails
     */
    extractLogData(lootElem, secondDiv) {
        if (!this.currentLootLogData || !Array.isArray(this.currentLootLogData)) {
            return null;
        }

        // Extract start time from DOM
        const textContent = secondDiv.textContent;
        let utcISOString = '';

        // Try multiple date formats
        const matchCN = textContent.match(/(\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2})/);
        const matchEN = textContent.match(/(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM))/i);
        const matchDE = textContent.match(/(\d{1,2}\.\d{1,2}\.\d{4}, \d{1,2}:\d{2}:\d{2})/);

        if (matchCN) {
            const localTimeStr = matchCN[1].trim();
            const [y, m, d, h, min, s] = localTimeStr.match(/\d+/g).map(Number);
            const localDate = new Date(y, m - 1, d, h, min, s);
            utcISOString = localDate.toISOString().slice(0, 19);
        } else if (matchEN) {
            const localTimeStr = matchEN[1].trim();
            const localDate = new Date(localTimeStr);
            if (!isNaN(localDate)) {
                utcISOString = localDate.toISOString().slice(0, 19);
            } else {
                return null;
            }
        } else if (matchDE) {
            const localTimeStr = matchDE[1].trim();
            const [datePart, timePart] = localTimeStr.split(', ');
            const [day, month, year] = datePart.split('.').map(Number);
            const [hours, minutes, seconds] = timePart.split(':').map(Number);
            const localDate = new Date(year, month - 1, day, hours, minutes, seconds);
            utcISOString = localDate.toISOString().slice(0, 19);
        } else {
            return null;
        }

        // Find matching log data
        const getLogStartTimeSec = (logObj) => {
            return logObj && logObj.startTime ? logObj.startTime.slice(0, 19) : '';
        };

        let log = null;
        for (const logObj of this.currentLootLogData) {
            if (getLogStartTimeSec(logObj) === utcISOString) {
                log = logObj;
                break;
            }
        }

        return log;
    }

    /**
     * Calculate total value of drops
     * @param {Object} drops - Drops object { [itemHrid]: count, ... }
     * @returns {Object} { askTotal, bidTotal }
     */
    calculateTotalValue(drops) {
        let askTotal = 0;
        let bidTotal = 0;

        if (!drops) return { askTotal, bidTotal };

        for (const [hrid, count] of Object.entries(drops)) {
            // Strip enhancement level from HRID
            const baseHrid = hrid.replace(/::\d+$/, '');

            // Get market prices
            const prices = getItemPrices(baseHrid, 0);
            if (!prices) continue;

            const ask = prices.ask || 0;
            const bid = prices.bid || 0;

            askTotal += ask * count;
            bidTotal += bid * count;
        }

        return { askTotal, bidTotal };
    }

    /**
     * Calculate average time per action
     * @param {string} startTime - ISO start time
     * @param {string} endTime - ISO end time
     * @param {number} actionCount - Number of actions
     * @returns {number} Average time in seconds, or 0 if invalid
     */
    calculateAverageTime(startTime, endTime, actionCount) {
        if (!startTime || !endTime || !actionCount || actionCount === 0) {
            return 0;
        }

        const duration = (new Date(endTime) - new Date(startTime)) / 1000;
        if (duration <= 0) return 0;

        return duration / actionCount;
    }

    /**
     * Calculate daily output value
     * @param {number} totalValue - Total value
     * @param {number} durationSeconds - Duration in seconds
     * @returns {number} Daily output value, or 0 if invalid
     */
    calculateDailyOutput(totalValue, durationSeconds) {
        if (!totalValue || !durationSeconds || durationSeconds === 0) {
            return 0;
        }

        return (totalValue * 86400) / durationSeconds;
    }

    /**
     * Format duration for display
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration string
     */
    formatDuration(seconds) {
        if (seconds === 0 || !seconds) return '—';
        if (seconds < 60) return `${seconds.toFixed(2)}s`;

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.round(seconds % 60);

        let str = '';
        if (h > 0) str += `${h}h`;
        if (m > 0 || h > 0) str += `${m}m`;
        str += `${s}s`;

        return str;
    }

    /**
     * Inject total value into second div
     * @param {HTMLElement} secondDiv - Second div element
     * @param {Object} logData - Log data object
     */
    injectTotalValue(secondDiv, logData) {
        // Remove existing value span
        const oldValue = secondDiv.querySelector('.mwi-loot-log-value');
        if (oldValue) oldValue.remove();

        if (!logData || !logData.drops) return;

        // Calculate total value
        const { askTotal, bidTotal } = this.calculateTotalValue(logData.drops);

        // Create value span
        const valueSpan = document.createElement('span');
        valueSpan.className = 'mwi-loot-log-value';

        if (askTotal === 0 && bidTotal === 0) {
            valueSpan.textContent = 'Total Value: —';
        } else {
            valueSpan.textContent = `Total Value: ${formatKMB(askTotal)}/${formatKMB(bidTotal)}`;
        }

        valueSpan.style.float = 'right';
        valueSpan.style.color = config.COLOR_GOLD;
        valueSpan.style.fontWeight = 'bold';
        valueSpan.style.marginLeft = '8px';

        secondDiv.appendChild(valueSpan);
    }

    /**
     * Inject average time and daily output into third div
     * @param {HTMLElement} thirdDiv - Third div element
     * @param {Object} logData - Log data object
     */
    injectTimeAndDailyOutput(thirdDiv, logData) {
        // Remove existing spans
        const oldAvgTime = thirdDiv.querySelector('.mwi-loot-log-avgtime');
        if (oldAvgTime) oldAvgTime.remove();
        const oldDayValue = thirdDiv.querySelector('.mwi-loot-log-day-value');
        if (oldDayValue) oldDayValue.remove();

        if (!logData) return;

        // Calculate duration
        let duration = 0;
        if (logData.startTime && logData.endTime) {
            duration = (new Date(logData.endTime) - new Date(logData.startTime)) / 1000;
        }

        // Calculate average time
        const avgTime = this.calculateAverageTime(logData.startTime, logData.endTime, logData.actionCount);

        // Create average time span
        const avgTimeSpan = document.createElement('span');
        avgTimeSpan.className = 'mwi-loot-log-avgtime';
        avgTimeSpan.textContent = `⏱${this.formatDuration(avgTime)}`;
        avgTimeSpan.style.marginRight = '16px';
        avgTimeSpan.style.marginLeft = '2ch';
        avgTimeSpan.style.color = config.COLOR_INFO;
        avgTimeSpan.style.fontWeight = 'bold';
        thirdDiv.appendChild(avgTimeSpan);

        // Calculate total value for daily output
        const { askTotal, bidTotal } = this.calculateTotalValue(logData.drops);
        const dayValueAsk = this.calculateDailyOutput(askTotal, duration);
        const dayValueBid = this.calculateDailyOutput(bidTotal, duration);

        // Create daily output span
        const dayValueSpan = document.createElement('span');
        dayValueSpan.className = 'mwi-loot-log-day-value';

        if (dayValueAsk === 0 && dayValueBid === 0) {
            dayValueSpan.textContent = 'Daily Output: —';
        } else {
            dayValueSpan.textContent = `Daily Output: ${formatKMB(dayValueAsk)}/${formatKMB(dayValueBid)}`;
        }

        dayValueSpan.style.float = 'right';
        dayValueSpan.style.color = config.COLOR_GOLD;
        dayValueSpan.style.fontWeight = 'bold';
        dayValueSpan.style.marginLeft = '8px';
        thirdDiv.appendChild(dayValueSpan);
    }

    /**
     * Cleanup when disabling feature
     */
    cleanup() {
        // Remove all injected spans
        const valueSpans = document.querySelectorAll('.mwi-loot-log-value');
        valueSpans.forEach((span) => span.remove());

        const avgTimeSpans = document.querySelectorAll('.mwi-loot-log-avgtime');
        avgTimeSpans.forEach((span) => span.remove());

        const dayValueSpans = document.querySelectorAll('.mwi-loot-log-day-value');
        dayValueSpans.forEach((span) => span.remove());

        // Unregister all handlers
        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];

        // Clear timers
        this.timerRegistry.clearAll();

        // Reset state
        this.processedLogs = new WeakSet();
        this.currentLootLogData = null;
        this.initialized = false;
    }
}

// Export as feature module
export default {
    name: 'Loot Log Statistics',
    initialize: async () => {
        const lootLogStats = new LootLogStats();
        await lootLogStats.initialize();
        return lootLogStats;
    },
    cleanup: (instance) => {
        if (instance) {
            instance.cleanup();
        }
    },
};
