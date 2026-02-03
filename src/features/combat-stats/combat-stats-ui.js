/**
 * Combat Statistics UI
 * Injects button and displays statistics popup
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import combatStatsDataCollector from './combat-stats-data-collector.js';
import { calculateAllPlayerStats } from './combat-stats-calculator.js';
import { formatWithSeparator, coinFormatter } from '../../utils/formatters.js';

class CombatStatsUI {
    constructor() {
        this.isInitialized = false;
        this.observer = null;
        this.popup = null;
    }

    /**
     * Initialize the UI
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        // Start observing for Combat panel
        this.startObserver();
    }

    /**
     * Start MutationObserver to watch for Combat panel
     */
    startObserver() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const addedNode of mutation.addedNodes) {
                    if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

                    // Check for Combat Panel appearing
                    if (addedNode.classList?.contains('MainPanel_subPanelContainer__1i-H9')) {
                        const combatPanel = addedNode.querySelector('[class*="CombatPanel_combatPanel"]');
                        if (combatPanel) {
                            this.injectButton();
                        }
                    }

                    // Check for initial page load
                    if (addedNode.classList?.contains('GamePage_contentPanel__Zx4FH')) {
                        const combatPanel = addedNode.querySelector('[class*="CombatPanel_combatPanel"]');
                        if (combatPanel) {
                            this.injectButton();
                        }
                    }
                }
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });

        // Try to inject button immediately if Combat panel is already visible
        setTimeout(() => this.injectButton(), 1000);
    }

    /**
     * Inject Statistics button into Combat panel tabs
     */
    injectButton() {
        // Find the tabs container
        const tabsContainer = document.querySelector(
            'div.GamePage_mainPanel__2njyb > div > div:nth-child(1) > div > div > div > div[class*="TabsComponent_tabsContainer"] > div > div > div'
        );

        if (!tabsContainer) {
            return;
        }

        // Check if button already exists
        if (tabsContainer.querySelector('.toolasha-combat-stats-btn')) {
            return;
        }

        // Create button
        const button = document.createElement('div');
        button.className =
            'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary css-1q2h7u5 toolasha-combat-stats-btn';
        button.textContent = 'Statistics';
        button.style.cursor = 'pointer';

        button.onclick = () => this.showPopup();

        // Insert button at the end
        const lastTab = tabsContainer.children[tabsContainer.children.length - 1];
        tabsContainer.insertBefore(button, lastTab.nextSibling);
    }

    /**
     * Share statistics to chat (triggered by Ctrl+Click on player card)
     * @param {Object} stats - Player statistics
     */
    shareStatsToChat(stats) {
        // Get chat message format from config (use getSettingValue for template type)
        const messageTemplate = config.getSettingValue('combatStatsChatMessage');

        // Convert array format to string if needed
        let message = '';
        if (Array.isArray(messageTemplate)) {
            // Format numbers
            const useKMB = config.getSetting('formatting_useKMBFormat');
            const formatNum = (num) => (useKMB ? coinFormatter(Math.round(num)) : formatWithSeparator(Math.round(num)));

            // Build message from array
            message = messageTemplate
                .map((item) => {
                    if (item.type === 'variable') {
                        // Replace variable with actual value
                        switch (item.key) {
                            case '{income}':
                                return formatNum(stats.income.bid);
                            case '{dailyIncome}':
                                return formatNum(stats.dailyIncome.bid);
                            case '{dailyConsumableCosts}':
                                return formatNum(stats.dailyConsumableCosts);
                            case '{dailyProfit}':
                                return formatNum(stats.dailyProfit.bid);
                            case '{exp}':
                                return formatNum(stats.expPerHour);
                            case '{deathCount}':
                                return stats.deathCount.toString();
                            case '{encountersPerHour}':
                                return formatNum(stats.encountersPerHour);
                            case '{duration}':
                                return stats.durationFormatted || '0s';
                            default:
                                return item.key;
                        }
                    } else {
                        // Plain text
                        return item.value;
                    }
                })
                .join('');
        } else {
            // Legacy string format (shouldn't happen, but handle it)
            const useKMB = config.getSetting('formatting_useKMBFormat');
            const formatNum = (num) => (useKMB ? coinFormatter(Math.round(num)) : formatWithSeparator(Math.round(num)));

            message = (messageTemplate || 'Combat Stats: {income} income | {dailyProfit} profit/d | {exp} exp/h')
                .replace('{income}', formatNum(stats.income.bid))
                .replace('{dailyIncome}', formatNum(stats.dailyIncome.bid))
                .replace('{dailyProfit}', formatNum(stats.dailyProfit.bid))
                .replace('{dailyConsumableCosts}', formatNum(stats.dailyConsumableCosts))
                .replace('{exp}', formatNum(stats.expPerHour))
                .replace('{deathCount}', stats.deathCount.toString());
        }

        // Insert into chat
        this.insertToChat(message);
    }

    /**
     * Insert text into chat input
     * @param {string} text - Text to insert
     */
    insertToChat(text) {
        const chatSelector =
            '#root > div > div > div.GamePage_gamePanel__3uNKN > div.GamePage_contentPanel__Zx4FH > div.GamePage_middlePanel__uDts7 > div.GamePage_chatPanel__mVaVt > div > div.Chat_chatInputContainer__2euR8 > form > input';
        const chatInput = document.querySelector(chatSelector);

        if (!chatInput) {
            console.error('[Combat Stats] Chat input not found');
            return;
        }

        // Use native value setter for React compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const start = chatInput.selectionStart || 0;
        const end = chatInput.selectionEnd || 0;

        // Insert text at cursor position
        const newValue = chatInput.value.substring(0, start) + text + chatInput.value.substring(end);
        nativeInputValueSetter.call(chatInput, newValue);

        // Dispatch input event for React
        const event = new Event('input', {
            bubbles: true,
            cancelable: true,
        });
        chatInput.dispatchEvent(event);

        // Set cursor position after inserted text
        chatInput.selectionStart = chatInput.selectionEnd = start + text.length;
        chatInput.focus();
    }

    /**
     * Show statistics popup
     */
    async showPopup() {
        // Ensure market data is loaded
        if (!marketAPI.isLoaded()) {
            const marketData = await marketAPI.fetch();
            if (!marketData) {
                console.error('[Combat Stats] Market data not available');
                alert('Market data not available. Please try again.');
                return;
            }
        }

        // Get latest combat data
        let combatData = combatStatsDataCollector.getLatestData();

        if (!combatData) {
            // Try to load from storage
            combatData = await combatStatsDataCollector.loadLatestData();
        }

        if (!combatData || !combatData.players || combatData.players.length === 0) {
            alert('No combat data available. Start a combat run first.');
            return;
        }

        // Recalculate duration from combat start time (updates in real-time during combat)
        let durationSeconds = null;
        if (combatData.combatStartTime) {
            const combatStartTime = new Date(combatData.combatStartTime).getTime() / 1000;
            const currentTime = Date.now() / 1000;
            durationSeconds = currentTime - combatStartTime;
        } else if (combatData.durationSeconds) {
            // Fallback to stored duration if no start time
            durationSeconds = combatData.durationSeconds;
        }

        if (!durationSeconds) {
            console.warn('[Combat Stats] No duration data available');
        }

        // Calculate statistics
        const playerStats = calculateAllPlayerStats(combatData, durationSeconds);

        // Create and show popup
        this.createPopup(playerStats);
    }

    /**
     * Create and display the statistics popup
     * @param {Array} playerStats - Array of player statistics
     */
    createPopup(playerStats) {
        // Remove existing popup if any
        if (this.popup) {
            this.closePopup();
        }

        // Get text color from config
        const textColor = config.getSetting('color_text_primary') || config.COLOR_TEXT_PRIMARY;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'toolasha-combat-stats-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Create popup container
        const popup = document.createElement('div');
        popup.className = 'toolasha-combat-stats-popup';
        popup.style.cssText = `
            background: #1a1a1a;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            padding: 20px;
            max-width: 90%;
            max-height: 90%;
            overflow-y: auto;
            color: ${textColor};
        `;

        // Create header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #3a3a3a;
            padding-bottom: 10px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'Combat Statistics';
        title.style.cssText = `
            margin: 0;
            color: ${textColor};
            font-size: 24px;
        `;

        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.cssText = `
            background: none;
            border: none;
            color: ${textColor};
            font-size: 32px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        `;
        closeButton.onclick = () => this.closePopup();

        header.appendChild(title);
        header.appendChild(closeButton);

        // Create player cards container
        const cardsContainer = document.createElement('div');
        cardsContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            justify-content: center;
        `;

        // Create a card for each player
        for (const stats of playerStats) {
            const card = this.createPlayerCard(stats, textColor);
            cardsContainer.appendChild(card);
        }

        // Assemble popup
        popup.appendChild(header);
        popup.appendChild(cardsContainer);
        overlay.appendChild(popup);

        // Add to page
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.closePopup();
            }
        };

        this.popup = overlay;
    }

    /**
     * Create a player statistics card
     * @param {Object} stats - Player statistics
     * @param {string} textColor - Text color
     * @returns {HTMLElement} Card element
     */
    createPlayerCard(stats, textColor) {
        const card = document.createElement('div');
        card.style.cssText = `
            background: #2a2a2a;
            border: 2px solid #4a4a4a;
            border-radius: 8px;
            padding: 15px;
            min-width: 300px;
            max-width: 400px;
            cursor: pointer;
        `;

        // Add Ctrl+Click handler to share to chat
        card.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                this.shareStatsToChat(stats);
                e.stopPropagation();
            }
        };

        // Player name
        const nameHeader = document.createElement('div');
        nameHeader.textContent = stats.name;
        nameHeader.style.cssText = `
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 15px;
            text-align: center;
            color: ${textColor};
            border-bottom: 1px solid #4a4a4a;
            padding-bottom: 8px;
        `;

        // Statistics rows
        // Use K/M/B formatting if enabled, otherwise use separators
        const useKMB = config.getSetting('formatting_useKMBFormat');
        const formatNum = (num) => (useKMB ? coinFormatter(Math.round(num)) : formatWithSeparator(Math.round(num)));

        const statsRows = [
            { label: 'Duration', value: stats.durationFormatted || '0s' },
            { label: 'Encounters/Hour', value: formatNum(stats.encountersPerHour) },
            { label: 'Income', value: formatNum(stats.income.bid) },
            { label: 'Daily Income', value: `${formatNum(stats.dailyIncome.bid)}/d` },
            {
                label: 'Consumable Costs',
                value: formatNum(stats.consumableCosts),
                color: '#ff6b6b',
                expandable: true,
                breakdown: stats.consumableBreakdown,
            },
            {
                label: 'Daily Consumable Costs',
                value: `${formatNum(stats.dailyConsumableCosts)}/d`,
                color: '#ff6b6b',
                expandable: true,
                breakdown: stats.consumableBreakdown,
                isDaily: true,
            },
            {
                label: 'Daily Profit',
                value: `${formatNum(stats.dailyProfit.bid)}/d`,
                color: stats.dailyProfit.bid >= 0 ? '#51cf66' : '#ff6b6b',
            },
            { label: 'Total EXP', value: formatNum(stats.totalExp) },
            { label: 'EXP/hour', value: `${formatNum(stats.expPerHour)}/h` },
            { label: 'Death Count', value: `${stats.deathCount}` },
        ];

        const statsContainer = document.createElement('div');
        statsContainer.style.cssText = 'margin-bottom: 15px;';

        for (const row of statsRows) {
            const rowDiv = document.createElement('div');
            rowDiv.style.cssText = `
                display: flex;
                justify-content: space-between;
                margin-bottom: 5px;
                font-size: 14px;
            `;

            const label = document.createElement('span');
            label.textContent = row.label + ':';
            label.style.color = textColor;

            const value = document.createElement('span');
            value.textContent = row.value;
            value.style.color = row.color || textColor;

            // Add expandable indicator if applicable
            if (row.expandable) {
                rowDiv.style.cursor = 'pointer';
                rowDiv.style.userSelect = 'none';
                label.textContent = '▶ ' + row.label + ':';

                let isExpanded = false;
                let breakdownDiv = null;

                rowDiv.onclick = () => {
                    isExpanded = !isExpanded;
                    label.textContent = (isExpanded ? '▼ ' : '▶ ') + row.label + ':';

                    if (isExpanded) {
                        // Create breakdown
                        breakdownDiv = document.createElement('div');
                        breakdownDiv.style.cssText = `
                            margin-left: 20px;
                            margin-top: 5px;
                            margin-bottom: 10px;
                            padding: 10px;
                            background: #1a1a1a;
                            border-left: 2px solid #4a4a4a;
                            font-size: 13px;
                        `;

                        if (row.breakdown && row.breakdown.length > 0) {
                            // Add header
                            const header = document.createElement('div');
                            header.style.cssText = `
                                display: grid;
                                grid-template-columns: 2fr 1fr 1fr 1fr;
                                gap: 10px;
                                font-weight: bold;
                                margin-bottom: 5px;
                                padding-bottom: 5px;
                                border-bottom: 1px solid #4a4a4a;
                                color: ${textColor};
                            `;
                            header.innerHTML = `
                                <span>Item</span>
                                <span style="text-align: right;">Consumed</span>
                                <span style="text-align: right;">Price</span>
                                <span style="text-align: right;">Cost</span>
                            `;
                            breakdownDiv.appendChild(header);

                            // Add each item
                            for (const item of row.breakdown) {
                                const itemRow = document.createElement('div');
                                itemRow.style.cssText = `
                                    display: grid;
                                    grid-template-columns: 2fr 1fr 1fr 1fr;
                                    gap: 10px;
                                    margin-bottom: 3px;
                                    color: ${textColor};
                                `;

                                // For daily: show per-day quantities at same price
                                // For total: show actual quantities and costs
                                const displayQty = row.isDaily ? (item.count / stats.duration) * 86400 : item.count;

                                const displayPrice = item.pricePerItem; // Price stays the same

                                const displayCost = row.isDaily
                                    ? (item.totalCost / stats.duration) * 86400
                                    : item.totalCost;

                                itemRow.innerHTML = `
                                    <span>${item.itemName}</span>
                                    <span style="text-align: right;">${formatNum(displayQty)}</span>
                                    <span style="text-align: right;">${formatNum(displayPrice)}</span>
                                    <span style="text-align: right; color: #ff6b6b;">${formatNum(displayCost)}</span>
                                `;
                                breakdownDiv.appendChild(itemRow);
                            }

                            // Add total row
                            const totalRow = document.createElement('div');
                            totalRow.style.cssText = `
                                display: grid;
                                grid-template-columns: 2fr 1fr 1fr 1fr;
                                gap: 10px;
                                margin-top: 5px;
                                padding-top: 5px;
                                border-top: 1px solid #4a4a4a;
                                font-weight: bold;
                                color: ${textColor};
                            `;
                            totalRow.innerHTML = `
                                <span>Total</span>
                                <span></span>
                                <span></span>
                                <span style="text-align: right; color: #ff6b6b;">${row.value}</span>
                            `;
                            breakdownDiv.appendChild(totalRow);

                            // Add tracking info note
                            if (row.breakdown.length > 0) {
                                const trackingNote = document.createElement('div');
                                trackingNote.style.cssText = `
                                    margin-top: 8px;
                                    padding-top: 8px;
                                    border-top: 1px solid #3a3a3a;
                                    font-size: 11px;
                                    color: #888;
                                    font-style: italic;
                                `;

                                // Format tracking duration
                                const formatTrackingDuration = (seconds) => {
                                    if (seconds < 60) return `${seconds}s`;
                                    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
                                    if (seconds < 86400) {
                                        const h = Math.floor(seconds / 3600);
                                        const m = Math.floor((seconds % 3600) / 60);
                                        return m > 0 ? `${h}h ${m}m` : `${h}h`;
                                    }
                                    // Days
                                    const d = Math.floor(seconds / 86400);
                                    const h = Math.floor((seconds % 86400) / 3600);
                                    if (d >= 30) {
                                        const months = Math.floor(d / 30);
                                        const days = d % 30;
                                        return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
                                    }
                                    return h > 0 ? `${d}d ${h}h` : `${d}d`;
                                };

                                // Display tracking info with MCS-style calculation note
                                const firstItem = row.breakdown[0];
                                const trackingDuration = Math.floor(firstItem.elapsedSeconds || 0);
                                const hasActualData = firstItem.actualConsumed > 0;

                                if (!hasActualData) {
                                    trackingNote.textContent = `📊 Tracked ${formatTrackingDuration(trackingDuration)} - Using baseline rates (no consumption detected yet)`;
                                } else {
                                    trackingNote.textContent = `📊 Tracked ${formatTrackingDuration(trackingDuration)} - Using 90% actual + 10% combined (baseline+actual)`;
                                }

                                breakdownDiv.appendChild(trackingNote);
                            }
                        } else if (breakdownDiv) {
                            breakdownDiv.textContent = 'No consumables used';
                            breakdownDiv.style.color = '#888';
                        }

                        rowDiv.after(breakdownDiv);
                    } else if (breakdownDiv) {
                        // Collapse - remove breakdown
                        breakdownDiv.remove();
                        breakdownDiv = null;
                    }
                };
            }

            rowDiv.appendChild(label);
            rowDiv.appendChild(value);
            statsContainer.appendChild(rowDiv);
        }

        // Drop list
        if (stats.lootList && stats.lootList.length > 0) {
            const dropHeader = document.createElement('div');
            dropHeader.textContent = 'Drops';
            dropHeader.style.cssText = `
                font-weight: bold;
                margin-top: 10px;
                margin-bottom: 5px;
                color: ${textColor};
                border-top: 1px solid #4a4a4a;
                padding-top: 8px;
            `;

            const dropList = document.createElement('div');
            dropList.style.cssText = 'font-size: 13px;';

            // Show top 10 items
            const topItems = stats.lootList.slice(0, 10);
            for (const item of topItems) {
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = 'margin-bottom: 3px;';

                const rarityColor = this.getRarityColor(item.rarity);
                itemDiv.innerHTML = `<span style="color: ${textColor};">${item.count}</span> <span style="color: ${rarityColor};">× ${item.itemName}</span>`;

                dropList.appendChild(itemDiv);
            }

            if (stats.lootList.length > 10) {
                const moreDiv = document.createElement('div');
                moreDiv.textContent = `... and ${stats.lootList.length - 10} more`;
                moreDiv.style.cssText = `
                    font-style: italic;
                    color: #888;
                    margin-top: 5px;
                `;
                dropList.appendChild(moreDiv);
            }

            statsContainer.appendChild(dropHeader);
            statsContainer.appendChild(dropList);
        }

        // Assemble card
        card.appendChild(nameHeader);
        card.appendChild(statsContainer);

        return card;
    }

    /**
     * Get color for item rarity
     * @param {number} rarity - Item rarity
     * @returns {string} Color hex code
     */
    getRarityColor(rarity) {
        switch (rarity) {
            case 6:
                return '#64dbff'; // Mythic
            case 5:
                return '#ff8888'; // Legendary
            case 4:
                return '#ffa844'; // Epic
            case 3:
                return '#e586ff'; // Rare
            case 2:
                return '#a9d5ff'; // Uncommon
            case 1:
                return '#b9f1be'; // Common
            default:
                return '#b4b4b4'; // Normal
        }
    }

    /**
     * Close the popup
     */
    closePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    /**
     * Cleanup
     */
    cleanup() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.closePopup();

        // Remove injected buttons
        const buttons = document.querySelectorAll('.toolasha-combat-stats-btn');
        for (const button of buttons) {
            button.remove();
        }

        this.isInitialized = false;
    }
}

const combatStatsUI = new CombatStatsUI();

export default combatStatsUI;
