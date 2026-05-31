/**
 * Enhancement XPH Calculator
 * Ranks all enhanceable items by expected XP per hour at the user's current stats.
 */

import { t } from '../../core/i18n.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import marketAPI from '../../api/marketplace.js';
import { calculateEnhancement } from '../../utils/enhancement-calculator.js';
import { calculateSuccessXP, calculateFailureXP } from './enhancement-xp.js';
import { getEnhancingParams } from '../../utils/enhancement-config.js';
import { formatKMB, formatWithSeparator } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import { getCheapestProtectionPrice } from './tooltip-enhancement.js';

const PANEL_ID = 'mwi-xph-calc-panel';
const BTN_CLASS = 'mwi-xph-calc-btn';

/**
 * Calculate XPH and cost metrics for a single item.
 * @param {string} itemHrid
 * @param {Object} itemDetails
 * @param {number} maxLevel
 * @param {number} protectFrom
 * @param {Object} params - from getEnhancingParams()
 * @returns {{itemHrid, name, xph, goldPerXP, costPerHour, costPartial}|null}
 */
function calculateItemXPH(itemHrid, itemDetails, maxLevel, protectFrom, params) {
    const itemLevel = itemDetails.itemLevel || 0;

    let calc;
    try {
        calc = calculateEnhancement({
            enhancingLevel: params.enhancingLevel,
            houseLevel: params.houseLevel,
            toolBonus: params.toolBonus,
            speedBonus: params.speedBonus,
            itemLevel,
            targetLevel: maxLevel,
            startLevel: 0,
            protectFrom,
            blessedTea: params.teas.blessed,
            guzzlingBonus: params.guzzlingBonus,
        });
    } catch {
        return null;
    }

    if (!calc?.visitCounts || calc.totalTime <= 0) return null;

    let totalXP = 0;
    for (let i = 0; i < maxLevel; i++) {
        const visits = calc.visitCounts[i];
        if (!visits) continue;
        const successRate = (calc.successRates[i]?.actualRate ?? 0) / 100;
        const successXP = calculateSuccessXP(i, itemHrid);
        const failXP = calculateFailureXP(i, itemHrid);
        totalXP += visits * (successRate * successXP + (1 - successRate) * failXP);
    }

    if (totalXP <= 0) return null;

    const xph = Math.round((totalXP / calc.totalTime) * 3600);

    // Material cost calculation (coins excluded — auto-deducted by game)
    let materialCost = 0;
    let costPartial = false;
    let allMissing = true;

    if (itemDetails.enhancementCosts?.length) {
        for (const cost of itemDetails.enhancementCosts) {
            if (cost.itemHrid === '/items/coin') continue;
            const price = marketAPI.getPrice(cost.itemHrid);
            if (price?.ask > 0) {
                materialCost += cost.count * price.ask * calc.attempts;
                allMissing = false;
            } else {
                costPartial = true;
            }
        }
    }

    const hasCost = !allMissing;
    let goldPerXP = hasCost ? materialCost / totalXP : null;
    let costPerHour = hasCost ? goldPerXP * xph : null;

    // Protection cost — find cheapest option for this item
    let protectionItemName = null;
    if (protectFrom > 0 && calc.protectionCount > 0) {
        const protectionInfo = getCheapestProtectionPrice(itemHrid);
        if (protectionInfo.price > 0) {
            const protCost = protectionInfo.price * calc.protectionCount;
            const totalCost = (materialCost || 0) + protCost;
            goldPerXP = totalCost / totalXP;
            costPerHour = goldPerXP * xph;
            protectionItemName = dataManager.getInitClientData()?.itemDetailMap[protectionInfo.itemHrid]?.name || null;
        } else {
            costPartial = true;
        }
    }

    return {
        itemHrid,
        name: itemDetails.name,
        protectionItemName,
        xph,
        goldPerXP,
        costPerHour,
        costPartial: hasCost && costPartial,
    };
}

class XPHCalculator {
    constructor() {
        this.isInitialized = false;
        this.unregisterHandlers = [];
        this.timerRegistry = createTimerRegistry();
        this.panel = null;
        this.tableBody = null;
        this.sortColumn = 'xph';
        this.sortAsc = false;
        this.lastResults = [];
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
    }

    initialize() {
        if (this.isInitialized) return;
        if (!config.getSetting('enhancementXPH')) return;

        this.isInitialized = true;
        this._buildPanel();

        const unregister = domObserver.onClass('XPHCalculator', 'EnhancingPanel_enhancingPanel', (panel) =>
            this._injectButton(panel)
        );
        this.unregisterHandlers.push(unregister);

        document.querySelectorAll('[class*="EnhancingPanel_enhancingPanel"]').forEach((panel) => {
            this._injectButton(panel);
        });
    }

    _injectButton(panel) {
        if (panel.querySelector(`.${BTN_CLASS}`)) return;

        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.textContent = t('XPH Calc');
        btn.style.cssText = `
            background: linear-gradient(180deg, rgba(0,200,150,0.2) 0%, rgba(0,200,150,0.1) 100%);
            color: #e0e0e0;
            border: 1px solid rgba(0,200,150,0.4);
            border-radius: 6px;
            padding: 5px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            margin: 4px 8px;
            display: block;
        `;
        btn.addEventListener('click', () => this._toggle());
        panel.insertBefore(btn, panel.firstChild);
    }

    _toggle() {
        if (!this.panel) return;
        const visible = this.panel.style.display !== 'none';
        this.panel.style.display = visible ? 'none' : 'flex';
        if (!visible) bringPanelToFront(this.panel);
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
            border: 2px solid rgba(0, 200, 150, 0.5);
            border-radius: 10px;
            width: 560px;
            max-height: 580px;
            display: none;
            flex-direction: column;
            font-family: 'Segoe UI', sans-serif;
            color: #e0e0e0;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            cursor: grab;
            background: rgba(0,200,150,0.12);
            border-bottom: 1px solid rgba(0,200,150,0.3);
            border-radius: 8px 8px 0 0;
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <span style="font-weight:700; font-size:14px; color:#00c896;">${t('Enhancement XPH Calculator')}</span>
            <button id="mwi-xph-close" style="
                background:none; border:none; color:#aaa; font-size:22px;
                cursor:pointer; padding:0; line-height:1;">×</button>
        `;
        this._setupDrag(header);

        // Controls row
        const controls = document.createElement('div');
        controls.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 14px;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
        `;

        const defaultMax = config.getSettingValue('enhancementXPH_maxLevel') || '6';
        const defaultProtect = config.getSettingValue('enhancementXPH_protectFrom') || '0';

        const inputStyle =
            'width:46px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center;';

        controls.innerHTML = `
            <label style="color:#888; font-size:12px;">${t('Max level')}</label>
            <input id="mwi-xph-maxlevel" type="number" min="1" max="20" value="${defaultMax}" style="${inputStyle}">
            <label style="color:#888; font-size:12px; margin-left:6px;">${t('Protect from')}</label>
            <input id="mwi-xph-protect" type="number" min="0" max="19" value="${defaultProtect}" style="${inputStyle}">
            <button id="mwi-xph-run" style="
                margin-left: auto;
                background: rgba(0,200,150,0.2);
                color: #00c896;
                border: 1px solid rgba(0,200,150,0.4);
                border-radius: 6px;
                padding: 5px 14px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;">${t('Calculate')}</button>
        `;

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = 'overflow-y: auto; flex: 1;';

        const thBase =
            'padding:6px 10px; font-weight:600; font-size:11px; cursor:pointer; white-space:nowrap; border-bottom:1px solid #222; color:#888;';
        tableContainer.innerHTML = `
            <table style="width:100%; border-collapse:collapse;">
                <thead style="position:sticky; top:0; background:#0a0a14; z-index:1;">
                    <tr>
                        <th id="mwi-xph-th-name" style="${thBase} text-align:left;">${t('# Item')}</th>
                        <th id="mwi-xph-th-xph"  style="${thBase} text-align:right;">${t('XP/hr')} ▼</th>
                        <th id="mwi-xph-th-gpx"  style="${thBase} text-align:right;">${t('Gold/XP')}</th>
                        <th id="mwi-xph-th-cphr" style="${thBase} text-align:right;">${t('Cost/hr')}</th>
                    </tr>
                </thead>
                <tbody id="mwi-xph-tbody"></tbody>
            </table>
        `;

        // Status bar
        const status = document.createElement('div');
        status.id = 'mwi-xph-status';
        status.style.cssText =
            'padding:6px 14px; color:#555; font-size:11px; border-top:1px solid #1a1a1a; flex-shrink:0; text-align:center;';
        status.textContent = t('Enter parameters and click Calculate.');

        this.panel.appendChild(header);
        this.panel.appendChild(controls);
        this.panel.appendChild(tableContainer);
        this.panel.appendChild(status);
        document.body.appendChild(this.panel);
        registerFloatingPanel(this.panel);

        this.tableBody = this.panel.querySelector('#mwi-xph-tbody');

        this.panel.querySelector('#mwi-xph-close').addEventListener('click', () => {
            this.panel.style.display = 'none';
        });
        this.panel.querySelector('#mwi-xph-run').addEventListener('click', () => this._run());
        this.panel.addEventListener('mousedown', () => bringPanelToFront(this.panel));

        ['name', 'xph', 'gpx', 'cphr'].forEach((col) => {
            this.panel.querySelector(`#mwi-xph-th-${col}`)?.addEventListener('click', () => this._sort(col));
        });
    }

    _setupDrag(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'mwi-xph-close') return;
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
        const maxLevel = Math.min(20, Math.max(1, parseInt(this.panel.querySelector('#mwi-xph-maxlevel').value) || 6));
        const protectFrom = Math.min(
            maxLevel - 1,
            Math.max(0, parseInt(this.panel.querySelector('#mwi-xph-protect').value) || 0)
        );

        const status = this.panel.querySelector('#mwi-xph-status');
        status.textContent = t('Calculating…');
        this.tableBody.innerHTML = '';

        const t = setTimeout(() => {
            try {
                this._compute(maxLevel, protectFrom);
            } catch (err) {
                console.error('[XPHCalculator] Error:', err);
                status.textContent = t('Error during calculation.');
            }
        }, 10);
        this.timerRegistry.registerTimeout(t);
    }

    _compute(maxLevel, protectFrom) {
        const gameData = dataManager.getInitClientData();
        const status = this.panel.querySelector('#mwi-xph-status');
        if (!gameData) {
            status.textContent = t('No game data available.');
            return;
        }

        const params = getEnhancingParams();
        const results = [];

        for (const [itemHrid, itemDetails] of Object.entries(gameData.itemDetailMap || {})) {
            if (!itemDetails.enhancementCosts?.length) continue;
            const result = calculateItemXPH(itemHrid, itemDetails, maxLevel, protectFrom, params);
            if (result) results.push(result);
        }

        this.lastResults = results;
        this.sortColumn = 'xph';
        this.sortAsc = false;
        this._render();
        this._updateSortIndicators();

        const withCost = results.filter((r) => r.costPerHour !== null).length;
        const partialNote = results.some((r) => r.costPartial) ? ` ${t('* = partial price data.')}` : '';
        status.textContent =
            t('{count} items · {withCost} with cost data', { count: results.length, withCost }) + partialNote;
    }

    _sort(col) {
        const colMap = { name: 'name', xph: 'xph', gpx: 'goldPerXP', cphr: 'costPerHour' };
        const key = colMap[col];
        if (this.sortColumn === key) {
            this.sortAsc = !this.sortAsc;
        } else {
            this.sortColumn = key;
            this.sortAsc = col === 'name';
        }
        this._render();
        this._updateSortIndicators();
    }

    _updateSortIndicators() {
        const colMap = { name: 'name', xph: 'xph', goldPerXP: 'gpx', costPerHour: 'cphr' };
        const activeId = colMap[this.sortColumn];
        ['name', 'xph', 'gpx', 'cphr'].forEach((col) => {
            const th = this.panel.querySelector(`#mwi-xph-th-${col}`);
            if (!th) return;
            const base = th.textContent.replace(/\s*[▲▼]$/, '').trimEnd();
            th.textContent = col === activeId ? `${base} ${this.sortAsc ? '▲' : '▼'}` : base;
        });
    }

    _render() {
        const sorted = [...this.lastResults].sort((a, b) => {
            const key = this.sortColumn;
            const av = a[key];
            const bv = b[key];
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            if (typeof av === 'string') return this.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return this.sortAsc ? av - bv : bv - av;
        });

        const tdR = 'padding:5px 10px; text-align:right; border-bottom:1px solid #141414;';
        const tdL = `padding:5px 10px; text-align:left; border-bottom:1px solid #141414;
            max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;

        this.tableBody.innerHTML = sorted
            .map(
                (r, i) => `
            <tr style="${i % 2 ? 'background:rgba(255,255,255,0.02)' : ''}">
                <td style="${tdL}" title="${r.name}${r.protectionItemName ? ` (${r.protectionItemName})` : ''}">${i + 1}. ${r.name}${r.protectionItemName ? ` <span style="color:#888; font-size:11px;">(${r.protectionItemName})</span>` : ''}</td>
                <td style="${tdR} color:#00c896;">${formatWithSeparator(r.xph)}</td>
                <td style="${tdR}${r.goldPerXP === null ? ' color:#444;' : ''}">
                    ${r.goldPerXP !== null ? `${r.goldPerXP.toFixed(3)}${r.costPartial ? '*' : ''}` : '—'}
                </td>
                <td style="${tdR}${r.costPerHour === null ? ' color:#444;' : ''}">
                    ${r.costPerHour !== null ? `${formatKMB(Math.round(r.costPerHour))}${r.costPartial ? '*' : ''}` : '—'}
                </td>
            </tr>`
            )
            .join('');
    }

    disable() {
        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];
        this.timerRegistry.clearAll();
        if (this.panel) {
            unregisterFloatingPanel(this.panel);
            this.panel.remove();
            this.panel = null;
        }
        document.querySelectorAll(`.${BTN_CLASS}`).forEach((el) => el.remove());
        this.isInitialized = false;
    }
}

const xphCalculator = new XPHCalculator();
export default xphCalculator;
