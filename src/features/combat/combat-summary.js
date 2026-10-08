/**
 * Combat Summary Module
 * Adds rate stats (encounters/hour, revenue, experience) to the Battle Info panel
 */

import config from '../../core/config.js';
import marketAPI from '../../api/marketplace.js';
import webSocketHook from '../../core/websocket.js';
import { t } from '../../core/i18n.js';
import { formatLargeNumber } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { getItemPrices } from '../../utils/market-data.js';
import { buildOutlierPriceWarningIcon } from '../../utils/warning-icon.js';
import { translateGameName } from '../../utils/game-i18n.js';

/**
 * Parse the BattlePanel_combatInfo text into duration/battles/deaths.
 *
 * The game localizes the labels ("Combat Duration", "Battles", "Deaths") via
 * its i18next `battlePanel` namespace. We try translated labels first, then
 * fall back to a structure-only regex that matches by colon separators and the
 * duration's d/h/m/s time-unit pattern, so non-English clients still parse
 * even if the suspected i18n keys are wrong.
 *
 * @param {string} text - The combat info panel text.
 * @returns {{days:number, hours:number, minutes:number, seconds:number, battles:number, deaths:number}|null}
 */
export function parseCombatInfo(text) {
    if (!text) return null;
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const durationLabels = [
        ...new Set(['Combat Duration', translateGameName('battlePanel', 'combatDuration', 'Combat Duration')]),
    ];
    const battlesLabels = [...new Set(['Battles', translateGameName('battlePanel', 'battles', 'Battles')])];
    const deathsLabels = [...new Set(['Deaths', translateGameName('battlePanel', 'deaths', 'Deaths')])];
    const labelRegexes = [];
    for (const d of durationLabels) {
        for (const b of battlesLabels) {
            for (const dd of deathsLabels) {
                labelRegexes.push(
                    new RegExp(
                        `${escape(d)}: (?:(\\d+)d\\s*)?(?:(\\d+)h\\s*)?(?:(\\d+)m\\s*)?(?:(\\d+)s).*?${escape(b)}: (\\d+).*?${escape(dd)}: (\\d+)`
                    )
                );
            }
        }
    }
    // Fallback: structure-only regex — matches three "label: value" segments by
    // colon separators, where the first value contains d/h/m/s time units. This
    // works regardless of label text or locale.
    labelRegexes.push(
        /^[^:]+:\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)\b[^.]*\.\s*[^:]+:\s*(\d+)\b[^.]*\.\s*[^:]+:\s*(\d+)/
    );
    for (const re of labelRegexes) {
        const m = text.match(re);
        if (m) {
            return {
                days: parseInt(m[1], 10) || 0,
                hours: parseInt(m[2], 10) || 0,
                minutes: parseInt(m[3], 10) || 0,
                seconds: parseInt(m[4], 10) || 0,
                battles: parseInt(m[5], 10),
                deaths: parseInt(m[6], 10),
            };
        }
    }
    return null;
}

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
        let hasOutlierPrices = false;

        if (message.unit.totalLootMap) {
            for (const loot of Object.values(message.unit.totalLootMap)) {
                const itemCount = loot.count;

                // Coins are revenue at face value (1 coin = 1 gold)
                if (loot.itemHrid === '/items/coin') {
                    totalPriceAsk += itemCount;
                    totalPriceBid += itemCount;
                } else {
                    // Other items: get market price
                    const prices = getItemPrices(loot.itemHrid);
                    if (prices) {
                        totalPriceAsk += prices.ask * itemCount;
                        totalPriceBid += prices.bid * itemCount;
                        if (prices.askOutlier || prices.bidOutlier) hasOutlierPrices = true;
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
        this.findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes, hasOutlierPrices);
    }

    /**
     * Find battle panel and inject summary stats
     * @param {Object} message - WebSocket message data
     * @param {number} totalPriceAsk - Total loot value at ask price
     * @param {number} totalPriceBid - Total loot value at bid price
     * @param {number} totalSkillsExp - Total experience gained
     * @param {number} tryTimes - Retry counter
     * @param {boolean} hasOutlierPrices - Whether any priced loot item was substituted by the outlier guard
     */
    findAndInjectSummary(message, totalPriceAsk, totalPriceBid, totalSkillsExp, tryTimes, hasOutlierPrices) {
        tryTimes++;

        // Find the experience section parent
        const elem = document.querySelector('[class*="BattlePanel_gainedExp"]')?.parentElement;

        if (elem) {
            // Check if we've already injected stats (check for any of our divs, not just the first one)
            const alreadyInjected =
                elem.querySelector('#mwi-combat-encounters') ||
                elem.querySelector('#mwi-combat-revenue') ||
                elem.querySelector('#mwi-combat-total-exp');

            if (alreadyInjected) {
                return; // Already injected, skip
            }

            // Get primary text color from settings
            const textColor = config.getSetting('color_text_primary') || config.COLOR_TEXT_PRIMARY;

            // Parse combat duration and battle count
            let battleDurationSec = null;
            const combatInfoElement = document.querySelector('[class*="BattlePanel_combatInfo"]');

            if (combatInfoElement) {
                const parsed = parseCombatInfo(combatInfoElement.textContent);

                if (parsed) {
                    const days = parsed.days;
                    const hours = parsed.hours;
                    const minutes = parsed.minutes;
                    const seconds = parsed.seconds;
                    const battles = parsed.battles - 1; // Exclude current battle

                    battleDurationSec = days * 86400 + hours * 3600 + minutes * 60 + seconds;

                    // Calculate encounters per hour
                    const encountersPerHour = ((battles / battleDurationSec) * 3600).toFixed(1);

                    elem.insertAdjacentHTML(
                        'beforeend',
                        `<div id="mwi-combat-encounters" style="color: ${textColor};">${t('combatSummary.encountersPerHour', { value: encountersPerHour })}</div>`
                    );
                }
            }

            // Total revenue
            document
                .querySelector('div#mwi-combat-encounters')
                ?.insertAdjacentHTML(
                    'afterend',
                    `<div id="mwi-combat-revenue" style="color: ${textColor};">${t('combatSummary.totalRevenue', { ask: formatLargeNumber(Math.round(totalPriceAsk)), bid: formatLargeNumber(Math.round(totalPriceBid)) })}${buildOutlierPriceWarningIcon(hasOutlierPrices)}</div>`
                );

            // Per-hour revenue
            if (battleDurationSec) {
                const revenuePerHourAsk = totalPriceAsk / (battleDurationSec / 3600);
                const revenuePerHourBid = totalPriceBid / (battleDurationSec / 3600);

                document
                    .querySelector('div#mwi-combat-revenue')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-revenue-hour" style="color: ${textColor};">${t('combatSummary.revenuePerHour', { ask: formatLargeNumber(Math.round(revenuePerHourAsk)), bid: formatLargeNumber(Math.round(revenuePerHourBid)) })}${buildOutlierPriceWarningIcon(hasOutlierPrices)}</div>`
                    );

                // Per-day revenue
                document
                    .querySelector('div#mwi-combat-revenue-hour')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-revenue-day" style="color: ${textColor};">${t('combatSummary.revenuePerDay', { ask: formatLargeNumber(Math.round(revenuePerHourAsk * 24)), bid: formatLargeNumber(Math.round(revenuePerHourBid * 24)) })}${buildOutlierPriceWarningIcon(hasOutlierPrices)}</div>`
                    );
            }

            // Total experience
            document
                .querySelector('div#mwi-combat-revenue-day')
                ?.insertAdjacentHTML(
                    'afterend',
                    `<div id="mwi-combat-total-exp" style="color: ${textColor};">${t('combatSummary.totalExp', { value: formatLargeNumber(Math.round(totalSkillsExp)) })}</div>`
                );

            // Per-hour experience breakdowns
            if (battleDurationSec) {
                const totalExpPerHour = totalSkillsExp / (battleDurationSec / 3600);

                // Insert total exp/hour first
                document
                    .querySelector('div#mwi-combat-total-exp')
                    ?.insertAdjacentHTML(
                        'afterend',
                        `<div id="mwi-combat-total-exp-hour" style="color: ${textColor};">${t('combatSummary.totalExpPerHour', { value: formatLargeNumber(Math.round(totalExpPerHour)) })}</div>`
                    );

                // Individual skill exp/hour
                const skills = [
                    { skillHrid: '/skills/attack', name: t('simEditor.skillAttack') },
                    { skillHrid: '/skills/magic', name: t('simEditor.skillMagic') },
                    { skillHrid: '/skills/ranged', name: t('simEditor.skillRanged') },
                    { skillHrid: '/skills/defense', name: t('simEditor.skillDefense') },
                    { skillHrid: '/skills/melee', name: t('simEditor.skillMelee') },
                    { skillHrid: '/skills/intelligence', name: t('simEditor.skillIntelligence') },
                    { skillHrid: '/skills/stamina', name: t('simEditor.skillStamina') },
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
                                `<div style="color: ${textColor};">${t('combatSummary.skillExpPerHour', { skillName: skill.name, value: formatLargeNumber(Math.round(expPerHour)) })}</div>`
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
                this.findAndInjectSummary(
                    message,
                    totalPriceAsk,
                    totalPriceBid,
                    totalSkillsExp,
                    tryTimes,
                    hasOutlierPrices
                );
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
