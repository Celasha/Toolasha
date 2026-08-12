/**
 * Risk of Ruin Calculator UI
 *
 * Standalone floating panel (same pattern as XPHCalculator) answering "how likely am I to hit
 * 0 gold before reaching my target?" for three activities: opening dungeon chests, running
 * Transmute alchemy actions, and enhancing an item to a target level.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { formatWithSeparator, formatPercentage } from '../../utils/formatters.js';
import { parseItemCount } from '../../utils/number-parser.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import {
    lundbergBound,
    lundbergBoundVarying,
    wilsonConfidenceInterval,
    minActionsForNonZeroRisk,
    findPeakExposureStep,
} from '../../utils/risk-of-ruin-engine.js';
import { simulateRuinAsync } from '../../utils/risk-of-ruin-worker-manager.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import {
    buildDungeonChestModel,
    getChestCostBreakdown,
} from '../../utils/risk-of-ruin-adapters/dungeon-chest-adapter.js';
import { buildAlchemyTransmuteModel } from '../../utils/risk-of-ruin-adapters/alchemy-adapter.js';
import { buildEnhancementModel } from '../../utils/risk-of-ruin-adapters/enhancement-adapter.js';

const PANEL_ID = 'mwi-risk-of-ruin-panel';
const LAUNCHER_ID = 'mwi-risk-of-ruin-launcher';
const MAX_STEPS = 20000;

const CHEST_HRIDS = [
    '/items/chimerical_chest',
    '/items/chimerical_refinement_chest',
    '/items/sinister_chest',
    '/items/sinister_refinement_chest',
    '/items/enchanted_chest',
    '/items/enchanted_refinement_chest',
    '/items/pirate_chest',
    '/items/pirate_refinement_chest',
];

function getCoinBalance() {
    const coin = dataManager.getCharacterItems()?.find((item) => item.itemHrid === '/items/coin');
    return coin?.count || 0;
}

function getTrialCount() {
    return parseInt(config.getSettingValue('riskOfRuin_trials')) || 10000;
}

/**
 * Format a gold amount with thousands separators, rounded to a whole number.
 * @param {number} amount
 * @returns {string}
 */
function fmtGold(amount) {
    return formatWithSeparator(Math.round(amount));
}

class RiskOfRuinUI {
    constructor() {
        this.isInitialized = false;
        this.timerRegistry = createTimerRegistry();
        this.panel = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('riskOfRuin')) return;

        this.isInitialized = true;
        this._buildPanel();
        this._buildLauncher();
    }

    _buildLauncher() {
        const btn = document.createElement('button');
        btn.id = LAUNCHER_ID;
        btn.textContent = 'Risk of Ruin';
        btn.style.cssText = `
            position: fixed;
            bottom: 12px;
            right: 12px;
            z-index: ${config.Z_FLOATING_PANEL};
            background: linear-gradient(180deg, rgba(200,60,60,0.25) 0%, rgba(200,60,60,0.12) 100%);
            color: #e0e0e0;
            border: 1px solid rgba(200,60,60,0.5);
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        `;
        btn.addEventListener('click', () => this._toggle());
        document.body.appendChild(btn);
    }

    _toggle() {
        if (!this.panel) return;
        const visible = this.panel.style.display !== 'none';
        this.panel.style.display = visible ? 'none' : 'flex';
        if (!visible) {
            bringPanelToFront(this.panel);
            this._refillBankroll();
        }
    }

    _buildPanel() {
        this.panel = document.createElement('div');
        this.panel.id = PANEL_ID;
        this.panel.style.cssText = `
            position: fixed;
            top: 60px;
            right: 60px;
            z-index: ${config.Z_FLOATING_PANEL};
            background: rgba(10, 10, 20, 0.97);
            border: 2px solid rgba(200, 60, 60, 0.5);
            border-radius: 10px;
            width: 460px;
            max-height: 620px;
            display: none;
            flex-direction: column;
            font-family: 'Segoe UI', sans-serif;
            color: #e0e0e0;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            cursor: grab;
            background: rgba(200,60,60,0.12);
            border-bottom: 1px solid rgba(200,60,60,0.3);
            border-radius: 8px 8px 0 0;
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <span style="font-weight:700; font-size:14px; color:#e05c5c;">Risk of Ruin Calculator</span>
            <button id="mwi-ror-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">×</button>
        `;
        this._setupDrag(header);

        const body = document.createElement('div');
        body.style.cssText = 'overflow-y: auto; flex: 1; padding: 12px 14px;';
        body.innerHTML = this._bodyHTML();

        const status = document.createElement('div');
        status.id = 'mwi-ror-status';
        status.style.cssText =
            'padding:6px 14px; color:#555; font-size:11px; border-top:1px solid #1a1a1a; flex-shrink:0; text-align:center;';
        status.textContent = 'Choose a mode, set your target, and click Calculate.';

        this.panel.appendChild(header);
        this.panel.appendChild(body);
        this.panel.appendChild(status);
        document.body.appendChild(this.panel);
        registerFloatingPanel(this.panel);

        this.panel.querySelector('#mwi-ror-close').addEventListener('click', () => {
            this.panel.style.display = 'none';
        });
        this.panel.addEventListener('mousedown', () => bringPanelToFront(this.panel));

        this.panel.querySelector('#mwi-ror-mode').addEventListener('change', () => this._renderModeInputs());
        this.panel.querySelector('#mwi-ror-run').addEventListener('click', () => this._run());

        this._populateItemLists();
        this._renderModeInputs();
    }

    _bodyHTML() {
        const labelStyle = 'color:#888; font-size:12px; display:block; margin-bottom:2px;';
        const inputStyle =
            'width:100%; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:5px 8px; font-size:12px; box-sizing:border-box;';

        return `
            <label style="${labelStyle}">Mode</label>
            <select id="mwi-ror-mode" style="${inputStyle} margin-bottom:10px;">
                <option value="chest">Dungeon Chest</option>
                <option value="alchemy">Alchemy (Transmute)</option>
                <option value="enhancement">Enhancing</option>
            </select>

            <div id="mwi-ror-mode-inputs"></div>

            <label style="${labelStyle} margin-top:10px;">Starting gold</label>
            <input id="mwi-ror-bankroll" type="text" inputmode="decimal" placeholder="e.g. 5m, 1.2b" style="${inputStyle} margin-bottom:10px;">

            <button id="mwi-ror-run" style="
                width: 100%;
                background: rgba(200,60,60,0.2);
                color: #e05c5c;
                border: 1px solid rgba(200,60,60,0.4);
                border-radius: 6px;
                padding: 8px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                margin-bottom: 10px;">Calculate</button>

            <div id="mwi-ror-results" style="font-size:12px; line-height:1.6;"></div>
        `;
    }

    _renderModeInputs() {
        const mode = this.panel.querySelector('#mwi-ror-mode').value;
        const container = this.panel.querySelector('#mwi-ror-mode-inputs');
        const labelStyle = 'color:#888; font-size:12px; display:block; margin-bottom:2px;';
        const inputStyle =
            'width:100%; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:5px 8px; font-size:12px; box-sizing:border-box; margin-bottom:10px;';

        if (mode === 'chest') {
            const options = CHEST_HRIDS.map((hrid) => {
                const name = dataManager.getItemDetails(hrid)?.name || hrid;
                return `<option value="${hrid}">${name}</option>`;
            }).join('');
            container.innerHTML = `
                <label style="${labelStyle}">Chest type</label>
                <select id="mwi-ror-chest" style="${inputStyle}">${options}</select>
                <label style="${labelStyle}">Chests to open</label>
                <input id="mwi-ror-target" type="number" min="1" step="1" value="100" style="${inputStyle}">
            `;
        } else if (mode === 'alchemy') {
            container.innerHTML = `
                <label style="${labelStyle}">Item to Transmute</label>
                <input id="mwi-ror-item" list="mwi-ror-transmute-items" style="${inputStyle}" placeholder="Start typing an item name...">
                <label style="${labelStyle}">Actions to attempt</label>
                <input id="mwi-ror-target" type="number" min="1" step="1" value="100" style="${inputStyle}">
            `;
        } else {
            container.innerHTML = `
                <label style="${labelStyle}">Item to enhance</label>
                <input id="mwi-ror-item" list="mwi-ror-enhance-items" style="${inputStyle}" placeholder="Start typing an item name...">
                <label style="${labelStyle}">Target level</label>
                <input id="mwi-ror-target" type="number" min="1" max="20" step="1" value="10" style="${inputStyle}">
                <label style="${labelStyle}">Start level</label>
                <input id="mwi-ror-start-level" type="number" min="0" max="19" step="1" value="0" style="${inputStyle}">
                <label style="${labelStyle}">Protect from level (0 = never)</label>
                <input id="mwi-ror-protect-from" type="number" min="0" max="19" step="1" value="0" style="${inputStyle}">
            `;
        }
    }

    _populateItemLists() {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return;

        const transmuteList = document.createElement('datalist');
        transmuteList.id = 'mwi-ror-transmute-items';
        const enhanceList = document.createElement('datalist');
        enhanceList.id = 'mwi-ror-enhance-items';

        for (const [hrid, details] of Object.entries(gameData.itemDetailMap)) {
            if (details.alchemyDetail?.transmuteDropTable?.length) {
                const option = document.createElement('option');
                option.value = details.name;
                option.dataset.hrid = hrid;
                transmuteList.appendChild(option);
            }
            if (details.enhancementCosts?.length) {
                const option = document.createElement('option');
                option.value = details.name;
                option.dataset.hrid = hrid;
                enhanceList.appendChild(option);
            }
        }

        this.panel.appendChild(transmuteList);
        this.panel.appendChild(enhanceList);
    }

    _resolveItemHrid(name, datalistId) {
        const gameData = dataManager.getInitClientData();
        if (!gameData?.itemDetailMap) return null;
        if (gameData.itemDetailMap[name]) return name;

        const datalist = this.panel.querySelector(`#${datalistId}`);
        const option = Array.from(datalist?.options || []).find((o) => o.value === name);
        return option?.dataset.hrid || null;
    }

    _refillBankroll() {
        const bankrollInput = this.panel.querySelector('#mwi-ror-bankroll');
        if (bankrollInput && !bankrollInput.dataset.userEdited) {
            bankrollInput.value = fmtGold(getCoinBalance());
        }
        if (bankrollInput && !bankrollInput.dataset.wired) {
            bankrollInput.dataset.wired = 'true';
            bankrollInput.addEventListener('input', () => {
                bankrollInput.dataset.userEdited = 'true';
            });
            bankrollInput.addEventListener('blur', () => {
                bankrollInput.value = fmtGold(parseItemCount(bankrollInput.value, 0));
            });
        }
    }

    _setupDrag(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'mwi-ror-close') return;
            this.isDragging = true;
            header.style.cursor = 'grabbing';
            const rect = this.panel.getBoundingClientRect();
            this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            bringPanelToFront(this.panel);

            const onMove = (ev) => {
                if (!this.isDragging) return;
                this.panel.style.left = `${ev.clientX - this.dragOffset.x}px`;
                this.panel.style.top = `${ev.clientY - this.dragOffset.y}px`;
                this.panel.style.right = 'auto';
            };
            const onUp = () => {
                this.isDragging = false;
                header.style.cursor = 'grab';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    _run() {
        const status = this.panel.querySelector('#mwi-ror-status');
        const results = this.panel.querySelector('#mwi-ror-results');
        status.textContent = 'Calculating…';
        results.innerHTML = '';

        const t = setTimeout(() => {
            this._compute().catch((err) => {
                console.error('[RiskOfRuinUI] Calculation failed:', err);
                status.textContent = 'Error during calculation.';
            });
        }, 10);
        this.timerRegistry.registerTimeout(t);
    }

    async _compute() {
        const status = this.panel.querySelector('#mwi-ror-status');
        const results = this.panel.querySelector('#mwi-ror-results');
        const mode = this.panel.querySelector('#mwi-ror-mode').value;
        const startingBalance = parseItemCount(this.panel.querySelector('#mwi-ror-bankroll').value, 0);
        const trials = getTrialCount();
        const rngSeed = Math.floor(Math.random() * 2 ** 31);

        let simModel;
        let lundberg;
        let maxSinglePossibleLoss;
        let detailInfo;

        if (mode === 'chest') {
            const hrid = this.panel.querySelector('#mwi-ror-chest').value;
            const targetActionCount = parseInt(this.panel.querySelector('#mwi-ror-target').value) || 0;
            const chestModel = buildDungeonChestModel(hrid);
            maxSinglePossibleLoss = chestModel.maxSinglePossibleLoss;
            simModel = {
                type: 'fixedOutcome',
                startingBalance,
                trials,
                maxSteps: MAX_STEPS,
                rngSeed,
                outcomeDistribution: chestModel.outcomeDistribution,
                targetActionCount,
            };
            lundberg = lundbergBound({ startingBalance, outcomeDistribution: chestModel.outcomeDistribution });
            detailInfo = {
                mode: 'chest',
                costBreakdown: getChestCostBreakdown(hrid),
                dropBreakdown: expectedValueCalculator.getDropBreakdown(hrid),
            };
        } else if (mode === 'alchemy') {
            const name = this.panel.querySelector('#mwi-ror-item').value;
            const hrid = this._resolveItemHrid(name, 'mwi-ror-transmute-items');
            const targetActionCount = parseInt(this.panel.querySelector('#mwi-ror-target').value) || 0;
            const alchemyModel = hrid ? buildAlchemyTransmuteModel(hrid) : null;
            if (!alchemyModel) {
                status.textContent = 'Enter a valid transmutable item name.';
                return;
            }
            maxSinglePossibleLoss = alchemyModel.maxSinglePossibleLoss;
            simModel = {
                type: 'fixedOutcome',
                startingBalance,
                trials,
                maxSteps: MAX_STEPS,
                rngSeed,
                outcomeDistribution: alchemyModel.outcomeDistribution,
                targetActionCount,
            };
            lundberg = lundbergBound({ startingBalance, outcomeDistribution: alchemyModel.outcomeDistribution });
            detailInfo = { mode: 'alchemy', breakdown: alchemyModel.breakdown };
        } else {
            const name = this.panel.querySelector('#mwi-ror-item').value;
            const hrid = this._resolveItemHrid(name, 'mwi-ror-enhance-items');
            const targetLevel = parseInt(this.panel.querySelector('#mwi-ror-target').value) || 0;
            const startLevel = parseInt(this.panel.querySelector('#mwi-ror-start-level').value) || 0;
            const protectFrom = parseInt(this.panel.querySelector('#mwi-ror-protect-from').value) || 0;
            const itemDetails = hrid ? dataManager.getItemDetails(hrid) : null;
            if (!itemDetails) {
                status.textContent = 'Enter a valid enhanceable item name.';
                return;
            }

            const enhancingParams = getEnhancingParams();
            const enhancementModel = buildEnhancementModel(hrid, {
                enhancingLevel: enhancingParams.enhancingLevel,
                houseLevel: enhancingParams.houseLevel,
                toolBonus: enhancingParams.toolBonus,
                speedBonus: enhancingParams.speedBonus,
                itemLevel: itemDetails.itemLevel || 1,
                targetLevel,
                startLevel,
                protectFrom,
                blessedTea: enhancingParams.teas.blessed,
                guzzlingBonus: enhancingParams.guzzlingBonus,
            });
            if (!enhancementModel) {
                status.textContent = 'Could not build an enhancement model for these parameters.';
                return;
            }
            maxSinglePossibleLoss = enhancementModel.maxSinglePossibleLoss;
            simModel = {
                type: 'levelWalk',
                startingBalance,
                trials,
                maxSteps: MAX_STEPS,
                rngSeed,
                perLevelOutcomeDistributions: enhancementModel.perLevelOutcomeDistributions,
                targetLevel,
                startLevel,
            };
            lundberg = lundbergBoundVarying({
                startingBalance,
                perStepDistributions: enhancementModel.perLevelOutcomeDistributions,
            });
            detailInfo = {
                mode: 'enhancement',
                perLevelOutcomeDistributions: enhancementModel.perLevelOutcomeDistributions,
                costPerAttempt: enhancementModel.costPerAttempt,
                protectionCostOnFailure: enhancementModel.protectionCostOnFailure,
                startLevel,
                targetLevel,
            };
        }

        const simResult = await simulateRuinAsync(simModel);
        const minActions = minActionsForNonZeroRisk(startingBalance, maxSinglePossibleLoss);
        this._renderResults(results, simResult, lundberg, minActions);
        this._renderDetails(results, detailInfo, startingBalance, maxSinglePossibleLoss, minActions);
        status.textContent = `${formatWithSeparator(trials)} trials simulated.`;
    }

    _renderResults(container, simResult, lundberg, minActions) {
        const ci = wilsonConfidenceInterval(simResult.ruinCount, simResult.trials);
        const peakStep = findPeakExposureStep(simResult.ruinStepCounts);

        const lines = [];
        lines.push(
            `<strong>Ruin probability:</strong> ${formatPercentage(simResult.ruinProbability, 2)} ` +
                `(95% CI: ${formatPercentage(ci.low, 2)} – ${formatPercentage(ci.high, 2)})`
        );

        if (lundberg.meaningful) {
            lines.push(`<strong>Lundberg upper bound:</strong> ≤ ${formatPercentage(Math.min(1, lundberg.bound), 2)}`);
        } else {
            lines.push(
                `<strong>Lundberg upper bound:</strong> not meaningful — this setup does not have ` +
                    `positive expected gold gain per action, so the closed-form bound is trivial. ` +
                    `Only the Monte Carlo estimate above applies.`
            );
        }

        lines.push(
            `<strong>Risk becomes possible at action:</strong> ` +
                (Number.isFinite(minActions)
                    ? formatWithSeparator(minActions)
                    : 'never (no single action can lose money)')
        );

        lines.push(
            `<strong>Peak ruin exposure at action:</strong> ` +
                (peakStep !== null ? formatWithSeparator(peakStep) : 'no ruin occurred in the simulation')
        );

        if (simResult.meanStepsToRuin !== null) {
            lines.push(
                `<strong>Average actions before ruin (when it occurs):</strong> ${formatWithSeparator(Math.round(simResult.meanStepsToRuin * 10) / 10)}`
            );
        }

        if (simResult.undecidedCount > 0) {
            lines.push(
                `<span style="color:#c98;">${formatWithSeparator(simResult.undecidedCount)} of ${formatWithSeparator(simResult.trials)} ` +
                    `trials neither ruined nor reached the target within the simulation's step cap — ` +
                    `the result may be imprecise for this very long-horizon scenario.</span>`
            );
        }

        container.innerHTML = lines.map((line) => `<div style="margin-bottom:6px;">${line}</div>`).join('');
    }

    /**
     * Formula line spelling out exactly how "risk becomes possible at action N" was derived,
     * so the number in the summary above isn't a black box.
     */
    _riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions) {
        if (!Number.isFinite(minActions)) {
            return `<div>No single action can ever lose money here, so risk never becomes possible.</div>`;
        }
        return (
            `<div><strong>Risk becomes possible at action</strong> = ⌈starting gold ÷ max single-action loss⌉ ` +
            `= ⌈${fmtGold(startingBalance)} ÷ ${fmtGold(maxSinglePossibleLoss)}⌉ = ${formatWithSeparator(minActions)}</div>`
        );
    }

    _renderDetails(container, detailInfo, startingBalance, maxSinglePossibleLoss, minActions) {
        let html;
        if (detailInfo.mode === 'chest') {
            html = this._chestDetailsHTML(detailInfo, startingBalance, maxSinglePossibleLoss, minActions);
        } else if (detailInfo.mode === 'alchemy') {
            html = this._alchemyDetailsHTML(detailInfo, startingBalance, maxSinglePossibleLoss, minActions);
        } else {
            html = this._enhancementDetailsHTML(detailInfo, startingBalance, maxSinglePossibleLoss, minActions);
        }
        container.insertAdjacentHTML('beforeend', html);
    }

    _chestDetailsHTML({ costBreakdown, dropBreakdown }, startingBalance, maxSinglePossibleLoss, minActions) {
        const rows = [];
        if (costBreakdown.entryKey) {
            rows.push(
                `<div>Entry key (${costBreakdown.entryKey.name}): ${fmtGold(costBreakdown.entryKey.price)}</div>`
            );
        }
        if (costBreakdown.chestKey) {
            rows.push(
                `<div>Chest key (${costBreakdown.chestKey.name}): ${fmtGold(costBreakdown.chestKey.price)}</div>`
            );
        }
        rows.push(`<div><strong>Total cost per open:</strong> ${fmtGold(costBreakdown.total)}</div>`);
        rows.push(
            `<div style="margin-top:6px;"><strong>Max single-action loss:</strong> ${fmtGold(maxSinglePossibleLoss)} ` +
                `(the lowest possible payout from one open is 0, so the worst case is losing the full open cost)</div>`
        );
        rows.push(this._riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions));

        const dropRows = dropBreakdown
            .map(
                (drop) =>
                    `<tr>
                        <td style="padding:2px 6px;">${drop.itemName}</td>
                        <td style="padding:2px 6px; text-align:right;">${formatPercentage(drop.dropRate, 2)}</td>
                        <td style="padding:2px 6px; text-align:right;">${drop.avgCount}</td>
                        <td style="padding:2px 6px; text-align:right;">${drop.hasPriceData ? fmtGold(drop.priceEach) : '—'}</td>
                        <td style="padding:2px 6px; text-align:right;">${fmtGold(drop.expectedValue)}</td>
                    </tr>`
            )
            .join('');

        return this._wrapDetails(
            'Cost & risk details',
            rows.join('') +
                this._wrapDetails(
                    `Drop table (${dropBreakdown.length} items)`,
                    `<table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tr style="color:#888;"><th style="text-align:left;">Item</th><th>Drop rate</th><th>Avg count</th><th>Price</th><th>EV</th></tr>
                        ${dropRows}
                    </table>`,
                    true
                )
        );
    }

    _alchemyDetailsHTML({ breakdown }, startingBalance, maxSinglePossibleLoss, minActions) {
        const catalystName = breakdown.catalystHrid ? dataManager.getItemDetails(breakdown.catalystHrid)?.name : null;

        const rows = [
            `<div>Success rate: ${formatPercentage(breakdown.successRate, 2)}</div>`,
            `<div>Material cost (paid every attempt): ${fmtGold(breakdown.materialCost)}</div>`,
        ];
        if (breakdown.coinCost > 0) {
            rows.push(`<div>Coin cost (paid every attempt): ${fmtGold(breakdown.coinCost)}</div>`);
        }
        rows.push(
            catalystName
                ? `<div>Catalyst (${catalystName}, paid only on success): ${fmtGold(breakdown.catalystCostOnSuccess)}</div>`
                : `<div>No catalyst used.</div>`
        );
        rows.push(`<div>Output value if successful: ${fmtGold(breakdown.outputValueGivenSuccess)}</div>`);
        if (breakdown.selfReturnGivenSuccess > 0) {
            rows.push(`<div>Self-return value if successful: ${fmtGold(breakdown.selfReturnGivenSuccess)}</div>`);
        }
        rows.push(
            `<div style="margin-top:6px;"><strong>Net on success:</strong> ${fmtGold(breakdown.netOnSuccess)}</div>`
        );
        rows.push(`<div><strong>Net on failure:</strong> ${fmtGold(breakdown.netOnFail)}</div>`);
        rows.push(`<div><strong>Max single-action loss:</strong> ${fmtGold(maxSinglePossibleLoss)}</div>`);
        rows.push(this._riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions));

        const dropRows = breakdown.dropRevenues
            .map(
                (drop) =>
                    `<tr>
                        <td style="padding:2px 6px;">${dataManager.getItemDetails(drop.itemHrid)?.name || drop.itemHrid}${drop.isSelfReturn ? ' (self-return)' : ''}</td>
                        <td style="padding:2px 6px; text-align:right;">${formatPercentage(drop.dropRate, 2)}</td>
                        <td style="padding:2px 6px; text-align:right;">${fmtGold(drop.price)}</td>
                        <td style="padding:2px 6px; text-align:right;">${fmtGold(drop.revenuePerAttempt)}</td>
                    </tr>`
            )
            .join('');

        return this._wrapDetails(
            'Cost & risk details',
            rows.join('') +
                this._wrapDetails(
                    `Output drops (${breakdown.dropRevenues.length} items)`,
                    `<table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tr style="color:#888;"><th style="text-align:left;">Item</th><th>Drop rate</th><th>Price</th><th>Revenue given success</th></tr>
                        ${dropRows}
                    </table>`,
                    true
                )
        );
    }

    _enhancementDetailsHTML(
        { perLevelOutcomeDistributions, costPerAttempt, protectionCostOnFailure, startLevel, targetLevel },
        startingBalance,
        maxSinglePossibleLoss,
        minActions
    ) {
        const rows = perLevelOutcomeDistributions
            .map((outcomes, level) => {
                const [failure] = outcomes;
                const successRate = 1 - failure.prob;
                const isProtected = failure.net !== -costPerAttempt;
                return `<tr>
                    <td style="padding:2px 6px;">+${level} → +${level + 1}</td>
                    <td style="padding:2px 6px; text-align:right;">${formatPercentage(successRate, 2)}</td>
                    <td style="padding:2px 6px; text-align:right;">${fmtGold(costPerAttempt)}</td>
                    <td style="padding:2px 6px; text-align:right;">+${failure.nextLevel}</td>
                    <td style="padding:2px 6px; text-align:right;">${isProtected ? fmtGold(protectionCostOnFailure) : '—'}</td>
                </tr>`;
            })
            .join('');

        const rows2 = [
            `<div><strong>Cost per attempt (materials, every attempt):</strong> ${fmtGold(costPerAttempt)}</div>`,
        ];
        if (protectionCostOnFailure > 0) {
            rows2.push(
                `<div><strong>Protection cost (charged only on a protected failure):</strong> ${fmtGold(protectionCostOnFailure)}</div>`
            );
        }
        rows2.push(
            `<div style="margin-top:6px;"><strong>Max single-action loss:</strong> ${fmtGold(maxSinglePossibleLoss)} ` +
                `(worst case: an attempt fails at a protected level)</div>`
        );
        rows2.push(this._riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions));

        return this._wrapDetails(
            `Cost & risk details (levels +${startLevel} to +${targetLevel})`,
            rows2.join('') +
                this._wrapDetails(
                    `Per-level success rates & costs (${perLevelOutcomeDistributions.length} levels)`,
                    `<table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tr style="color:#888;"><th style="text-align:left;">Attempt</th><th>Success</th><th>Cost</th><th>Fail →</th><th>Protection cost</th></tr>
                        ${rows}
                    </table>`,
                    true
                )
        );
    }

    _wrapDetails(summary, innerHTML, nested = false) {
        const margin = nested ? 'margin-top:6px;' : 'margin-top:10px; border-top:1px solid #333; padding-top:8px;';
        const summaryColor = nested ? '#aaa' : '#e05c5c';
        return `<details style="${margin}">
            <summary style="cursor:pointer; color:${summaryColor}; font-weight:600; font-size:${nested ? '11px' : '12px'};">${summary}</summary>
            <div style="margin-top:8px; padding-left:4px;">${innerHTML}</div>
        </details>`;
    }

    disable() {
        this.timerRegistry.clearAll();
        if (this.panel) {
            unregisterFloatingPanel(this.panel);
            this.panel.remove();
            this.panel = null;
        }
        document.getElementById(LAUNCHER_ID)?.remove();
        this.isInitialized = false;
    }
}

const riskOfRuinUI = new RiskOfRuinUI();
export default riskOfRuinUI;
