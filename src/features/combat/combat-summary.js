/**
 * Combat Summary Module
 * Shows detailed statistics when returning from combat
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import webSocketHook from '../../core/websocket.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * CombatSummary class manages combat completion statistics display
 */
class CombatSummary {
    constructor() {
        this.isActive = false;
        this.isInitialized = false;
        this.battleUnitFetchedHandler = null; // Store handler reference for cleanup
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize combat summary feature
     */
    initialize() {
        // Guard FIRST (before feature check)
        if (this.isInitialized) {
            return;
        }

        if (!config.getSetting('combatSummary')) {
            return;
        }

        this.isInitialized = true;

        this.battleUnitFetchedHandler = (data) => {
            this.handleBattleSummary(data);
        };

        // Listen for battle_unit_fetched WebSocket message
        webSocketHook.on('battle_unit_fetched', this.battleUnitFetchedHandler);

        this.isActive = true;
    }

    /**
     * Handle battle completion and display summary
     * @param {Object} message - WebSocket message data
     */
    async handleBattleSummary(message) {
        // Validate message structure
        if (!message || !message.unit) {
            console.warn('[Combat Summary] Invalid message structure:', message);
            return;
        }

        // Ensure market data is loaded
        if (!marketAPI.isLoaded()) {
            const marketData = await marketAPI.fetch();
            if (!marketData) {
                console.error('[Combat Summary] Market data not available');
                return;
            }
        }

        // Calculate total revenue from loot (with null check)
        let totalPriceAsk = 0;
        let totalPriceBid = 0;

        if (message.unit.totalLootMap) {
            for (const loot of Object.values(message.unit.totalLootMap)) {
                const itemCount = loot.count;

                // Coins are revenue at face value (1 coin = 1 gold)
                if (loot.itemHrid === '/items/coin') {
                    totalPriceAsk += itemCount;
                    totalPriceBid += itemCount;
                } else {
                    // Other items: get market price
                    const prices = marketAPI.getPrice(loot.itemHrid);
                    if (prices) {
                        totalPriceAsk += prices.ask * itemCount;
                        totalPriceBid += prices.bid * itemCount;
                    }
                }
            }
        } else {
            console.warn('[Combat Summary] No totalLootMap in message');
        }

        // Calculate total experience (with null check)
        let totalSkillsExp = 0;
        if (message.unit.totalSkillExperienceMap) {
            for (const exp of Object.values(message.unit.totalSkillExperienceMap)) {
                totalSkillsExp += exp;
            }
        } else {
            console.warn('[Combat Summary] No totalSkillExperienceMap in message');
        }

        // Wait for battle panel to appear and inject summary
        const tryTimes = 0;
        this.findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes);
    }

    /**
     * Find battle panel and inject summary stats
     * @param {Object} message - WebSocket message data
     * @param {number} totalPriceAsk - Total loot value at ask price
     * @param {number} totalPriceBid - Total loot value at bid price
     * @param {number} totalSkillsExp - Total experience gained
     * @param {number} tryTimes - Retry counter
     */
    findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes) {
        tryTimes++;

        // Find the experience section parent
        const elem = document.querySelector('[class*="BattlePanel_gainedExp"]')?.parentElement;

        if (elem) {
            // Get primary text color from settings
            const textColor = config.getSetting('color_text_primary') || config.COLOR_TEXT_PRIMARY;

            // Parse combat duration and battle count
            let battleDurationSec = null;
            const combatInfoElement = document.querySelector('[class*="BattlePanel_combatInfo"]');

            if (combatInfoElement) {
                const matches = combatInfoElement.innerHTML.match(
                    /Combat Duration: (?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s).*?Battles: (\d+).*?Deaths: (\d+)/
                );

                if (matches) {
                    const days = parseInt(matches[1], 10) || 0;
                    const hours = parseInt(matches[2], 10) || 0;
                    const minutes = parseInt(matches[3], 10) || 0;
                    const seconds = parseInt(matches[4], 10) || 0;
                    const battles = parseInt(matches[5], 10) - 1; // Exclude current battle

                    battleDurationSec = days * 86400 + hours * 3600 + minutes * 60 + seconds;

                    // Calculate encounters per hour
                    const encountersPerHour = ((battles / battleDurationSec) * 3600).toFixed(1);

                    elem.insertAdjacentHTML(
                        'beforeend',
                        `<div id="mwi-combat-encounters" style="color: ${textColor};">Encounters/hour: ${encountersPerHour}</div>`
                    );
                }
            }

            // Total revenue
            document
                .querySelector('div#mwi-combat-encounters')
                ?.insertAdjacentHTML(
                    'afterend',
                    `<div id="mwi-combat-revenue" style="color: ${textColor};">Total revenue: ${formatWithSeparator(Math.round(totalPriceAsk))} / ${formatWithSeparator(Math.round(totalPriceBid))}</div>`
                );

            // Per-hour revenue
            if (battleDurationSec) {
                const revenuePerHourAsk = totalPriceAsk / (battleDurationSec / 3600);
                const revenuePerHourBid = totalPriceBid / (battleDurationSec / 3600);

                document
                    .querySelector('div#mwi-combat-revenue')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-revenue-hour" style="color: ${textColor};">Revenue/hour: ${formatWithSeparator(Math.round(revenuePerHourAsk))} / ${formatWithSeparator(Math.round(revenuePerHourBid))}</div>`
                    );

                // Per-day revenue
                document
                    .querySelector('div#mwi-combat-revenue-hour')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-revenue-day" style="color: ${textColor};">Revenue/day: ${formatWithSeparator(Math.round(revenuePerHourAsk * 24))} / ${formatWithSeparator(Math.round(revenuePerHourBid * 24))}</div>`
                    );
            }

            // Total experience
            document
                .querySelector('div#mwi-combat-revenue-day')
                ?.insertAdjacentHTML(
                    'afterend',
                    `<div id="mwi-combat-total-exp" style="color: ${textColor};">Total exp: ${formatWithSeparator(Math.round(totalSkillsExp))}</div>`
                );

            // Per-hour experience breakdowns
            if (battleDurationSec) {
                const totalExpPerHour = totalSkillsExp / (battleDurationSec / 3600);

                // Insert total exp/hour first
                document
                    .querySelector('div#mwi-combat-total-exp')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-total-exp-hour" style="color: ${textColor};">Total exp/hour: ${formatWithSeparator(Math.round(totalExpPerHour))}</div>`
                    );

                // Individual skill exp/hour
                const skills = [
                    { skillHrid: '/skills/attack', name: 'Attack' },
                    { skillHrid: '/skills/magic', name: 'Magic' },
                    { skillHrid: '/skills/ranged', name: 'Ranged' },
                    { skillHrid: '/skills/defense', name: 'Defense' },
                    { skillHrid: '/skills/melee', name: 'Melee' },
                    { skillHrid: '/skills/intelligence', name: 'Intelligence' },
                    { skillHrid: '/skills/stamina', name: 'Stamina' },
                ];

                let lastElement = document.querySelector('div#mwi-combat-total-exp-hour');

                // Only show individual skill exp if we have the data
                if (message.unit.totalSkillExperienceMap) {
                    for (const skill of skills) {
                        const expGained = message.unit.totalSkillExperienceMap[skill.skillHrid];
                        if (expGained && lastElement) {
                            const expPerHour = expGained / (battleDurationSec / 3600);
                            lastElement.insertAdjacentHTML(
                                'afterend',
                                `<div style="color: ${textColor};">${skill.name} exp/hour: ${formatWithSeparator(Math.round(expPerHour))}</div>`
                            );
                            // Update lastElement to the newly inserted div
                            lastElement = lastElement.nextElementSibling;
                        }
                    }
                }
            } else {
                console.warn('[Combat Summary] Unable to display hourly stats due to null battleDurationSec');
            }
        } else if (tryTimes <= 10) {
            // Retry if element not found
            const retryTimeout = setTimeout(() => {
                this.findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes);
            }, 200);
            this.timerRegistry.registerTimeout(retryTimeout);
        } else {
            console.error('[Combat Summary] Battle panel not found after 10 tries');
        }
    }

    /**
     * Disable the combat summary feature
     */
    disable() {
        if (this.battleUnitFetchedHandler) {
            webSocketHook.off('battle_unit_fetched', this.battleUnitFetchedHandler);
            this.battleUnitFetchedHandler = null;
        }

        this.timerRegistry.clearAll();
        this.isActive = false;
        this.isInitialized = false;
    }
}

const combatSummary = new CombatSummary();

export default combatSummary;
