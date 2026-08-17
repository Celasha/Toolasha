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
    wilsonConfidenceInterval,
    minActionsForNonZeroRisk,
    findPeakExposureStep,
} from '../../utils/risk-of-ruin-engine.js';
import { simulateRuinAsync } from '../../utils/risk-of-ruin-worker-manager.js';
import { calculateOptimalCommit } from '../../utils/optimal-bankroll-share.js';
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
    const coin = dataManager.getInventory()?.find((item) => item.itemHrid === '/items/coin');
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
        // Last computed cost-per-action + per-item output quantities, for market-depth-cap.js's
        // live order-book widget to read — null whenever the last run had no revenue distribution
        // to key off (enhancement mode, or no successful run yet).
        this.lastDepthCapContext = null;
    }

    /**
     * Setup setting change listener (always active, even when feature is disabled) so toggling
     * "Enable Risk of Ruin calculator" in Settings takes effect immediately, with no refresh.
     */
    setupSettingListener() {
        config.onSettingChange('riskOfRuin', (enabled) => {
            if (enabled) {
                this.initialize();
            } else {
                this.disable();
            }
        });
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
                <label style="${labelStyle}">Catalyst</label>
                <select id="mwi-ror-catalyst" style="${inputStyle}">
                    <option value="best">Best available (auto)</option>
                    <option value="none">None</option>
                    <option value="typeSpecific">Type-specific catalyst</option>
                    <option value="prime">Prime catalyst</option>
                </select>
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

    /**
     * The last computed cost-per-action + per-item output quantities, for market-depth-cap.js to
     * check the currently-viewed marketplace item against. Null when the last run was enhancement
     * mode (no revenue distribution to key off) or nothing has been calculated yet.
     * @returns {{costPerAction: number, items: Array<{itemHrid: string, quantityPerAction: number}>}|null}
     */
    getDepthCapContext() {
        return this.lastDepthCapContext;
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
        let maxSinglePossibleLoss;
        let detailInfo;
        let optimalCommit = null;
        this.lastDepthCapContext = null;

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
            const dropBreakdown = expectedValueCalculator.getDropBreakdown(hrid);
            detailInfo = {
                mode: 'chest',
                costBreakdown: getChestCostBreakdown(hrid),
                dropBreakdown,
                minimumGuaranteedPayout: chestModel.minimumGuaranteedPayout,
            };
            this.lastDepthCapContext = {
                costPerAction: chestModel.cost,
                items: dropBreakdown
                    .filter((d) => d.dropRate > 0 && d.avgCount > 0)
                    .map((d) => ({ itemHrid: d.itemHrid, quantityPerAction: d.avgCount * d.dropRate })),
            };
            optimalCommit = calculateOptimalCommit({
                outcomeDistribution: chestModel.outcomeDistribution,
                costPerAction: chestModel.cost,
                actionCount: targetActionCount,
                bankroll: startingBalance,
            });
        } else if (mode === 'alchemy') {
            const name = this.panel.querySelector('#mwi-ror-item').value;
            const hrid = this._resolveItemHrid(name, 'mwi-ror-transmute-items');
            const targetActionCount = parseInt(this.panel.querySelector('#mwi-ror-target').value) || 0;
            const catalystSelection = this.panel.querySelector('#mwi-ror-catalyst').value;
            const catalystChoice = catalystSelection === 'best' ? null : catalystSelection;
            const alchemyModel = hrid ? buildAlchemyTransmuteModel(hrid, { catalystChoice }) : null;
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
            detailInfo = { mode: 'alchemy', breakdown: alchemyModel.breakdown };
            this.lastDepthCapContext = {
                costPerAction: alchemyModel.cost,
                items: this._alchemyDepthCapItems(alchemyModel.breakdown),
            };
            optimalCommit = calculateOptimalCommit({
                outcomeDistribution: alchemyModel.outcomeDistribution,
                costPerAction: alchemyModel.cost,
                actionCount: targetActionCount,
                bankroll: startingBalance,
            });
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
        this._renderResults(results, simResult, minActions);
        if (optimalCommit) {
            this._renderOptimalCommit(results, optimalCommit);
        } else {
            results.insertAdjacentHTML(
                'beforeend',
                `<div style="margin-top:10px; margin-bottom:6px; color:#888; font-size:11px;">
                    Optimal share of cash to commit: not applicable — enhancing has no revenue
                    distribution to size a bet against, only a fixed cost toward the target level.
                    Use the ruin probability above instead.
                </div>`
            );
        }
        this._renderDetails(results, detailInfo, startingBalance, maxSinglePossibleLoss, minActions);
        status.textContent = `${formatWithSeparator(trials)} trials simulated.`;
    }

    /**
     * Recover the raw per-attempt output quantity for each item a Transmute attempt can produce,
     * for market-depth-cap.js — main branches are conditional on success (successRate * dropRate),
     * bonus drops (essence/rare) are independent per-attempt Bernoulli events already unconditional.
     * @param {Object} breakdown - alchemyModel.breakdown from buildAlchemyTransmuteModel().
     * @returns {Array<{itemHrid: string, quantityPerAction: number}>}
     */
    _alchemyDepthCapItems(breakdown) {
        const items = [];
        for (const branch of breakdown.mainBranches) {
            if (branch.isSelfReturn || !(branch.count > 0)) continue;
            items.push({
                itemHrid: branch.itemHrid,
                quantityPerAction: breakdown.successRate * branch.dropRate * branch.count,
            });
        }
        for (const bonus of breakdown.bonusDrops) {
            if (!(bonus.count > 0)) continue;
            items.push({ itemHrid: bonus.itemHrid, quantityPerAction: bonus.dropRate * bonus.count });
        }
        return items;
    }

    /**
     * Renders the closed-form "optimal share of cash to commit" figures (see
     * utils/optimal-bankroll-share.js) — a quick variance-based cap, separate from and shown
     * alongside the Monte Carlo ruin probability above.
     */
    _renderOptimalCommit(container, optimalCommit) {
        if (!optimalCommit.hasEdge) {
            container.insertAdjacentHTML(
                'beforeend',
                `<div style="margin-top:10px; margin-bottom:6px; color:#c98;">
                    <strong>Optimal share of cash to commit:</strong> 0% — this setup has no positive
                    expected edge (E[R] ≤ 1), so sizing a bet against its variance isn't meaningful here.
                </div>`
            );
            return;
        }

        container.insertAdjacentHTML(
            'beforeend',
            `<div style="margin-top:10px;">
                <strong>Optimal share of cash to commit:</strong> ${formatPercentage(optimalCommit.fstar, 1)} of bankroll
                (${fmtGold(optimalCommit.recommendedCommit)} ≈ ${formatWithSeparator(optimalCommit.recommendedActionCount)} actions)
            </div>
            <div style="color:#888; font-size:11px; margin-bottom:6px;">
                Variance-based cap only — ignores the downward price pressure from selling your own output.
                Toolasha shows an automatic "Sell depth" estimate on the item's order book screen when it
                applies (Chest/Transmute modes only, after running a calculation) — eyeball the book yourself
                for Enhancement or if no estimate appears.
            </div>`
        );
    }

    _renderResults(container, simResult, minActions) {
        const ci = wilsonConfidenceInterval(simResult.ruinCount, simResult.trials);
        const peakStep = findPeakExposureStep(simResult.ruinStepCounts);

        const lines = [];
        lines.push(
            `<strong>Ruin probability:</strong> ${formatPercentage(simResult.ruinProbability, 2)} ` +
                `(95% CI: ${formatPercentage(ci.low, 2)} – ${formatPercentage(ci.high, 2)})`
        );

        lines.push(
            `<strong>Ruin becomes possible at action:</strong> ` +
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
     * Formula line spelling out exactly how "ruin becomes possible at action N" was derived,
     * so the number in the summary above isn't a black box.
     */
    _riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions) {
        if (!Number.isFinite(minActions)) {
            return `<div>No single action can ever lose money here, so ruin never becomes possible.</div>`;
        }
        return (
            `<div><strong>Ruin becomes possible at action</strong> = ⌈starting gold ÷ max single-action loss⌉ ` +
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

    _chestDetailsHTML(
        { costBreakdown, dropBreakdown, minimumGuaranteedPayout },
        startingBalance,
        maxSinglePossibleLoss,
        minActions
    ) {
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
            `<div style="margin-top:6px;">Guaranteed minimum payout per open: ${fmtGold(minimumGuaranteedPayout)} ` +
                `(the sum of every drop table entry with a 100% drop rate, at its minimum count — a real chest ` +
                `always drops at least this much, it is never actually 0)</div>`
        );
        rows.push(
            `<div><strong>Max single-action loss:</strong> ${fmtGold(maxSinglePossibleLoss)} ` +
                `= cost − guaranteed minimum payout = ${fmtGold(costBreakdown.total)} − ${fmtGold(minimumGuaranteedPayout)}</div>`
        );
        rows.push(this._riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions));

        const totalEV = dropBreakdown.reduce((sum, drop) => sum + drop.expectedValue, 0);
        const dropRows = dropBreakdown
            .map(
                (drop) =>
                    `<tr>
                        <td style="padding:2px 6px;">${drop.itemName}${drop.dropRate === 1 ? ' (guaranteed)' : ''}</td>
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
                        <tr style="border-top:1px solid #444; font-weight:600;">
                            <td style="padding:2px 6px;" colspan="4">Total EV per open</td>
                            <td style="padding:2px 6px; text-align:right;">${fmtGold(totalEV)}</td>
                        </tr>
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
        rows.push(
            `<div style="margin-top:6px;">The output drop table (below) is a single mutually-exclusive roll ` +
                `<em>given success</em> — each branch is its own separate outcome, not averaged together, so a ` +
                `rare high-value branch's real tail risk shows up in the simulation instead of being smoothed away.</div>`
        );
        rows.push(`<div><strong>Net on failure:</strong> ${fmtGold(breakdown.netOnFail)}</div>`);
        rows.push(`<div><strong>Max single-action loss:</strong> ${fmtGold(maxSinglePossibleLoss)}</div>`);
        rows.push(this._riskFormulaLine(startingBalance, maxSinglePossibleLoss, minActions));

        const mainRows = breakdown.mainBranches
            .map(
                (branch) =>
                    `<tr>
                        <td style="padding:2px 6px;">${dataManager.getItemDetails(branch.itemHrid)?.name || branch.itemHrid}${branch.isSelfReturn ? ' (self-return)' : ''}</td>
                        <td style="padding:2px 6px; text-align:right;">${formatPercentage(breakdown.successRate * branch.dropRate, 2)}</td>
                        <td style="padding:2px 6px; text-align:right;">${fmtGold(branch.payout)}</td>
                    </tr>`
            )
            .join('');
        const mainCoverage = breakdown.mainBranches.reduce((sum, b) => sum + b.dropRate, 0);
        const failRow = `<tr>
                        <td style="padding:2px 6px;">(failure)</td>
                        <td style="padding:2px 6px; text-align:right;">${formatPercentage(1 - breakdown.successRate, 2)}</td>
                        <td style="padding:2px 6px; text-align:right;">${fmtGold(0)}</td>
                    </tr>`;
        const gapNote =
            mainCoverage < 0.999
                ? `<div style="color:#c98; margin-top:4px; font-size:11px;">${formatPercentage(1 - mainCoverage, 1)} of the success-branch probability has no market price data and is treated as a 0-payout outcome (never inflated with a guess).</div>`
                : '';

        const bonusRows = breakdown.bonusDrops
            .map(
                (bonus) =>
                    `<tr>
                        <td style="padding:2px 6px;">${dataManager.getItemDetails(bonus.itemHrid)?.name || bonus.itemHrid}</td>
                        <td style="padding:2px 6px; text-align:right;">${formatPercentage(bonus.dropRate, 2)}</td>
                        <td style="padding:2px 6px; text-align:right;">${fmtGold(bonus.payout)}</td>
                    </tr>`
            )
            .join('');
        const bonusSection = breakdown.bonusDrops.length
            ? this._wrapDetails(
                  `Bonus drops (${breakdown.bonusDrops.length}, independent of success/fail)`,
                  `<table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tr style="color:#888;"><th style="text-align:left;">Item</th><th>Chance per attempt</th><th>Payout if hit</th></tr>
                        ${bonusRows}
                    </table>`,
                  true
              )
            : '';

        return this._wrapDetails(
            'Cost & risk details',
            rows.join('') +
                this._wrapDetails(
                    `Output drop table (${breakdown.mainBranches.length} branches, one roll given success)`,
                    `<table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tr style="color:#888;"><th style="text-align:left;">Outcome</th><th>Chance per attempt</th><th>Payout if hit</th></tr>
                        ${failRow}
                        ${mainRows}
                    </table>
                    ${gapNote}`,
                    true
                ) +
                bonusSection
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
riskOfRuinUI.setupSettingListener();
export default riskOfRuinUI;
