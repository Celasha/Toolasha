/**
 * Guild Activity Display
 * Renders the guild activity calculator panel in the Toolasha settings section.
 * Shows live session stats, budget tracking, tier comparisons, and guild progress.
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { guildActivityTracker } from './guild-activity-tracker.js';
import { formatWithSeparator } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const CSS_PREFIX = 'mwi-guild-activity';
const ACTIVITY_NAMES = {
    '/guild_skilling/milking': 'Milking',
    '/guild_skilling/foraging': 'Foraging',
    '/guild_skilling/woodcutting': 'Woodcutting',
    '/guild_skilling/cheesesmithing': 'Cheesesmithing',
    '/guild_skilling/crafting': 'Crafting',
    '/guild_skilling/tailoring': 'Tailoring',
    '/guild_skilling/cooking': 'Cooking',
    '/guild_skilling/brewing': 'Brewing',
    '/guild_skilling/alchemy': 'Alchemy',
    '/guild_skilling/enhancing': 'Enhancing',
    '/guild_combat/vanguard': 'Trial Vanguard',
    '/guild_combat/deadeye': 'Trial Deadeye',
    '/guild_combat/magus': 'Trial Magus',
    '/guild_combat/warden': 'Trial Warden',
    '/guild_combat/swarm': 'Trial Swarm',
};

class GuildActivityDisplay {
    constructor() {
        this.timerRegistry = createTimerRegistry();
        this.unregisterObservers = [];
        this._unsubTracker = null;
        this._panelEl = null;
        this._activeTab = null; // 'calculator' | 'simulator'
        this._simActivity = null;
        this._initialized = false;
    }

    initialize() {
        if (!config.getSetting('guildActivityCalculator')) return;
        if (this._initialized) return;
        this._initialized = true;

        const unregPanel = domObserver.onClass('GuildActivityDisplay-Inject', 'GuildPanel_guildPanel', (el) =>
            this._injectTab(el)
        );
        this.unregisterObservers.push(unregPanel);

        this._unsubTracker = guildActivityTracker.onUpdate(() => this._refresh());

        const intervalId = setInterval(() => this._refreshTimer(), 1000);
        this.timerRegistry.registerInterval(intervalId);

        const existingPanel = document.querySelector('[class*="GuildPanel_guildPanel"]');
        if (existingPanel) {
            this._injectTab(existingPanel);
        }
    }

    disable() {
        for (const unreg of this.unregisterObservers) {
            unreg();
        }
        this.unregisterObservers = [];
        this.timerRegistry.clearAll();
        if (this._unsubTracker) {
            this._unsubTracker();
            this._unsubTracker = null;
        }
        document.querySelectorAll(`.${CSS_PREFIX}`).forEach((el) => el.remove());
        this._panelEl = null;
        this._initialized = false;
    }

    _injectTab(guildPanelEl) {
        if (guildPanelEl.querySelector(`.${CSS_PREFIX}`)) return;

        const tabRow =
            guildPanelEl.querySelector('[role="tablist"]') ||
            guildPanelEl.querySelector('.MuiTabs-flexContainer') ||
            guildPanelEl.querySelector('[class*="TabsComponent_tabsContainer"]');
        if (!tabRow) return;

        const calcTab = this._createTab('Calculator');
        calcTab.addEventListener('click', () => this._showPanel(guildPanelEl, 'calculator'));
        tabRow.appendChild(calcTab);

        const simTab = this._createTab('Simulator');
        simTab.classList.add(`${CSS_PREFIX}__tab--sim`);
        simTab.addEventListener('click', () => this._showPanel(guildPanelEl, 'simulator'));
        tabRow.appendChild(simTab);

        const otherTabs = tabRow.querySelectorAll('[role="tab"]:not(.' + CSS_PREFIX + '__tab)');
        for (const otherTab of otherTabs) {
            otherTab.addEventListener('click', () => this._dismissPanel(guildPanelEl));
        }
    }

    _createTab(label) {
        const tab = document.createElement('button');
        tab.className = `${CSS_PREFIX} ${CSS_PREFIX}__tab MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
        tab.style.minWidth = '90px';
        const span = document.createElement('span');
        span.className = 'MuiTab-wrapper';
        span.textContent = label;
        tab.appendChild(span);
        return tab;
    }

    _getContentSiblings(guildPanelEl) {
        const tabRow =
            guildPanelEl.querySelector('[role="tablist"]') || guildPanelEl.querySelector('.MuiTabs-flexContainer');
        if (!tabRow) return [];

        const tabContainer = tabRow.closest('[class*="Tabs"]') || tabRow.parentElement;
        const siblings = [];
        let el = tabContainer.nextElementSibling;
        while (el) {
            if (!el.classList.contains(`${CSS_PREFIX}__panel`)) {
                siblings.push(el);
            }
            el = el.nextElementSibling;
        }
        return siblings;
    }

    _dismissPanel(guildPanelEl) {
        const panel = guildPanelEl.querySelector(`.${CSS_PREFIX}__panel`);
        if (!panel) return;
        panel.remove();
        this._panelEl = null;
        this._activeTab = null;

        for (const el of this._getContentSiblings(guildPanelEl)) {
            el.style.display = '';
        }

        for (const tab of guildPanelEl.querySelectorAll(`.${CSS_PREFIX}__tab`)) {
            tab.classList.remove('Mui-selected');
            tab.setAttribute('aria-selected', 'false');
        }
    }

    _showPanel(guildPanelEl, mode) {
        const existingPanel = guildPanelEl.querySelector(`.${CSS_PREFIX}__panel`);
        if (existingPanel && this._activeTab === mode) {
            this._dismissPanel(guildPanelEl);
            return;
        }
        if (existingPanel) {
            existingPanel.remove();
            this._panelEl = null;
        }

        for (const el of this._getContentSiblings(guildPanelEl)) {
            el.style.display = 'none';
        }

        for (const tab of guildPanelEl.querySelectorAll(`.${CSS_PREFIX}__tab`)) {
            const isSim = tab.classList.contains(`${CSS_PREFIX}__tab--sim`);
            const isActive = (mode === 'simulator' && isSim) || (mode === 'calculator' && !isSim);
            tab.classList.toggle('Mui-selected', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }

        const panel = document.createElement('div');
        panel.className = `${CSS_PREFIX}__panel`;
        panel.style.cssText = `
            padding: 12px;
            color: ${config.COLOR_TEXT_PRIMARY};
            font-size: 13px;
        `;

        const tabRow =
            guildPanelEl.querySelector('[role="tablist"]') || guildPanelEl.querySelector('.MuiTabs-flexContainer');
        const tabContainer = tabRow?.closest('[class*="Tabs"]') || tabRow?.parentElement;
        if (tabContainer) {
            tabContainer.parentElement.appendChild(panel);
        } else {
            guildPanelEl.appendChild(panel);
        }

        this._panelEl = panel;
        this._activeTab = mode;

        if (mode === 'calculator') {
            this._renderPanel();
        } else {
            this._renderSimulator();
        }
    }

    _refresh() {
        if (!this._panelEl) return;
        if (this._activeTab === 'simulator') {
            this._renderSimulator();
        } else {
            this._renderPanel();
        }
    }

    _refreshTimer() {
        const timerEl = this._panelEl?.querySelector(`.${CSS_PREFIX}__timer`);
        if (timerEl) {
            const session = guildActivityTracker.getCurrentSession();
            if (!session?.timeoutAt) {
                timerEl.textContent = '--:--';
            } else {
                const remaining = new Date(session.timeoutAt).getTime() - Date.now();
                if (remaining <= 0) {
                    timerEl.textContent = '0:00';
                } else {
                    const min = Math.floor(remaining / 60000);
                    const sec = Math.floor((remaining % 60000) / 1000);
                    timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
                }
            }
        }

        const guildPanelEl = document.querySelector('[class*="GuildPanel_guildPanel"]');
        if (guildPanelEl && !guildPanelEl.querySelector(`.${CSS_PREFIX}`)) {
            this._injectTab(guildPanelEl);
        }
    }

    _renderPanel() {
        if (!this._panelEl) return;

        const session = guildActivityTracker.getCurrentSession();
        const budget = guildActivityTracker.getBudget();
        const guildStars = guildActivityTracker.getGuildStars();
        const memberProgress = guildActivityTracker.getMemberProgress();
        const activitySet = guildActivityTracker.getWeeklyActivitySet();

        let html = `<style>
            .${CSS_PREFIX}__section { margin-bottom: 16px; }
            .${CSS_PREFIX}__section-title { font-weight: bold; margin-bottom: 6px; font-size: 13px; }
            .${CSS_PREFIX}__stat-row { display: flex; justify-content: space-between; padding: 2px 0; }
        </style>`;

        // ─── Budget Section ──────────────────────────────────────────
        html += this._renderBudget(budget);

        // ─── Live Session Section ────────────────────────────────────
        html += this._renderSession(session);

        // ─── Weekly Progress ─────────────────────────────────────────
        html += this._renderWeeklyProgress(guildStars, memberProgress, activitySet);

        // ─── Tier Comparison ─────────────────────────────────────────
        if (session) {
            html += this._renderTierComparison(session);
        }

        this._panelEl.innerHTML = html;
    }

    _renderBudget(budget) {
        if (!budget) {
            return `<div class="${CSS_PREFIX}__section">
                <div class="${CSS_PREFIX}__section-title">Weekly Budget</div>
                <div style="color: ${config.COLOR_TEXT_SECONDARY};">No budget data yet — start a guild activity</div>
            </div>`;
        }

        const used = budget.secondsCap - budget.secondsRemaining;
        const pct = Math.min(100, (used / budget.secondsCap) * 100);
        const usedMin = Math.floor(used / 60);
        const capMin = Math.floor(budget.secondsCap / 60);
        const remainMin = Math.floor(budget.secondsRemaining / 60);

        return `<div class="${CSS_PREFIX}__section">
            <div class="${CSS_PREFIX}__section-title">Weekly Budget</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <div style="flex: 1; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: ${pct >= 90 ? config.COLOR_LOSS : config.COLOR_ACCENT}; border-radius: 4px;"></div>
                </div>
                <span style="white-space: nowrap;">${usedMin}m / ${capMin}m</span>
            </div>
            <div style="color: ${config.COLOR_TEXT_SECONDARY};">${remainMin}m remaining</div>
        </div>`;
    }

    _renderSession(session) {
        if (!session) {
            return `<div class="${CSS_PREFIX}__section">
                <div class="${CSS_PREFIX}__section-title">Current Session</div>
                <div style="color: ${config.COLOR_TEXT_SECONDARY};">No active guild activity</div>
            </div>`;
        }

        const name = ACTIVITY_NAMES[session.activityHrid] || session.activityHrid;
        const isEnhancing = session.targetLevel != null;
        const starsPerSession = isEnhancing
            ? guildActivityTracker.calculateEnhancingStarsPerSession(session)
            : guildActivityTracker.calculateStarsPerSession(session);
        const starsPerHour = starsPerSession * 6;
        const tokenReward = session.activityHrid.includes('combat') ? 200 : 100;
        const tokensPerHour = starsPerHour * tokenReward;

        let statsHTML = '';
        if (isEnhancing) {
            statsHTML = `
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Target Level</span><span>${session.targetLevel}</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Current Level</span><span>${session.currentEnhLevel}</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Success Rate</span><span>${(session.successRate * 100).toFixed(1)}%</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Action Time</span><span>${(session.actionTimeMs / 1000).toFixed(2)}s</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Attempts</span><span>${session.actionCounter}</span>
                </div>`;
        } else {
            const progressPct =
                session.targetWorkValue > 0
                    ? ((session.currentWorkValue / session.targetWorkValue) * 100).toFixed(1)
                    : '0';
            statsHTML = `
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Work Power</span><span>${session.progressPerAction.toFixed(2)}</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Success Rate</span><span>${(session.successRate * 100).toFixed(1)}%</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Double Progress</span><span>${(session.doubleProgressChance * 100).toFixed(2)}%</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Action Time</span><span>${(session.actionTimeMs / 1000).toFixed(2)}s</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span>Progress</span><span>${formatWithSeparator(Math.floor(session.currentWorkValue))} / ${formatWithSeparator(session.targetWorkValue)} (${progressPct}%)</span>
                </div>`;
        }

        return `<div class="${CSS_PREFIX}__section">
            <div class="${CSS_PREFIX}__section-title" style="display: flex; justify-content: space-between; align-items: center;">
                <span>${name} — Tier ${session.tier} (Lv.${100 + session.tier * 10})</span>
                <span class="${CSS_PREFIX}__timer" style="font-family: monospace; color: ${config.COLOR_ACCENT};">--:--</span>
            </div>
            ${statsHTML}
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div class="${CSS_PREFIX}__stat-row">
                    <span style="color: ${config.COLOR_ACCENT};">Stars/session</span>
                    <span style="color: ${config.COLOR_ACCENT};">${starsPerSession.toFixed(2)}</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span style="color: ${config.COLOR_ACCENT};">Stars/hr</span>
                    <span style="color: ${config.COLOR_ACCENT};">${starsPerHour.toFixed(1)}</span>
                </div>
                <div class="${CSS_PREFIX}__stat-row">
                    <span style="color: ${config.COLOR_ACCENT};">Tokens/hr</span>
                    <span style="color: ${config.COLOR_ACCENT};">${formatWithSeparator(Math.round(tokensPerHour))}</span>
                </div>
            </div>
        </div>`;
    }

    _renderWeeklyProgress(guildStars, memberProgress, activitySet) {
        if (!activitySet) return '';

        const allActivities = [...(activitySet.skillHrids || []), ...(activitySet.combatHrids || [])];

        if (allActivities.length === 0) return '';

        let rows = '';
        for (const hrid of allActivities) {
            const name = ACTIVITY_NAMES[hrid] || hrid.split('/').pop();
            const guildCount = guildStars[hrid] || 0;
            const myCount = memberProgress[hrid] || 0;
            rows += `<tr>
                <td style="padding: 3px 8px;">${name}</td>
                <td style="padding: 3px 8px; text-align: right;">${myCount}</td>
                <td style="padding: 3px 8px; text-align: right;">${guildCount}</td>
            </tr>`;
        }

        return `<div class="${CSS_PREFIX}__section">
            <div class="${CSS_PREFIX}__section-title">This Week's Activities</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="color: ${config.COLOR_TEXT_SECONDARY}; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <th style="padding: 3px 8px; text-align: left;">Activity</th>
                        <th style="padding: 3px 8px; text-align: right;">My Stars</th>
                        <th style="padding: 3px 8px; text-align: right;">Guild Stars</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    _renderTierComparison(session) {
        const comparison = guildActivityTracker.getTierComparison(session.activityHrid);
        if (comparison.length === 0) return '';

        const isEnhancing = session.targetLevel != null;
        let rows = '';
        for (const tier of comparison) {
            const isCurrentTier = tier.tier === session.tier;
            const rowStyle = isCurrentTier ? `background: rgba(34, 197, 94, 0.1); font-weight: bold;` : '';
            const goalCell = isEnhancing
                ? ''
                : `<td style="padding: 3px 6px; text-align: right;">${formatWithSeparator(tier.targetWorkValue)}</td>`;
            rows += `<tr style="${rowStyle}">
                <td style="padding: 3px 6px;">${tier.difficultyLevel}</td>
                <td style="padding: 3px 6px; text-align: right;">${Math.min(100, tier.successRate * 100).toFixed(0)}%</td>
                <td style="padding: 3px 6px; text-align: right;">${(tier.completionChance * 100).toFixed(0)}%</td>
                ${goalCell}
                <td style="padding: 3px 6px; text-align: right;">${tier.starsPerSession.toFixed(2)}</td>
                <td style="padding: 3px 6px; text-align: right;">${tier.starsPerHour.toFixed(1)}</td>
                <td style="padding: 3px 6px; text-align: right;">${formatWithSeparator(Math.round(tier.tokensPerHour))}</td>
            </tr>`;
        }

        const name = ACTIVITY_NAMES[session.activityHrid] || session.activityHrid.split('/').pop();
        const goalHeader = isEnhancing ? '' : '<th style="padding: 3px 6px; text-align: right;">Goal</th>';

        return `<div class="${CSS_PREFIX}__section">
            <div class="${CSS_PREFIX}__section-title">Difficulty Comparison — ${name}</div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="color: ${config.COLOR_TEXT_SECONDARY}; border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="padding: 3px 6px; text-align: left;">Lv.</th>
                            <th style="padding: 3px 6px; text-align: right;">Hit %</th>
                            <th style="padding: 3px 6px; text-align: right;">Session %</th>
                            ${goalHeader}
                            <th style="padding: 3px 6px; text-align: right;">★/sess</th>
                            <th style="padding: 3px 6px; text-align: right;">★/hr</th>
                            <th style="padding: 3px 6px; text-align: right;">Tok/hr</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
    }

    _renderSimulator() {
        if (!this._panelEl) return;

        const allActivities = Object.keys(ACTIVITY_NAMES);
        const selected = this._simActivity || allActivities[0];

        const comparison = guildActivityTracker.getTierComparison(selected);
        const name = ACTIVITY_NAMES[selected] || selected;
        const isEnhancing = selected.includes('enhancing');

        let optionsHTML = '';
        for (const hrid of allActivities) {
            const label = ACTIVITY_NAMES[hrid];
            const sel = hrid === selected ? ' selected' : '';
            optionsHTML += `<option value="${hrid}"${sel}>${label}</option>`;
        }

        let html = `<style>
            .${CSS_PREFIX}__section { margin-bottom: 16px; }
            .${CSS_PREFIX}__section-title { font-weight: bold; margin-bottom: 6px; font-size: 13px; }
        </style>`;

        html += `<div class="${CSS_PREFIX}__section">
            <div class="${CSS_PREFIX}__section-title">Simulator</div>
            <div style="margin-bottom: 12px;">
                <select class="${CSS_PREFIX}__sim-select" style="
                    background: rgba(255,255,255,0.1);
                    color: ${config.COLOR_TEXT_PRIMARY};
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px;
                    padding: 6px 8px;
                    font-size: 13px;
                    width: 100%;
                ">${optionsHTML}</select>
            </div>
        </div>`;

        if (comparison.length === 0) {
            html += `<div style="color: ${config.COLOR_TEXT_SECONDARY};">
                Unable to compute projections for ${name}. Skill level data not available.
            </div>`;
        } else {
            let rows = '';
            const goalHeader = isEnhancing ? '' : '<th style="padding: 3px 6px; text-align: right;">Goal</th>';

            for (const tier of comparison) {
                const goalCell = isEnhancing
                    ? ''
                    : `<td style="padding: 3px 6px; text-align: right;">${formatWithSeparator(tier.targetWorkValue)}</td>`;
                rows += `<tr>
                    <td style="padding: 3px 6px;">${tier.difficultyLevel}</td>
                    <td style="padding: 3px 6px; text-align: right;">${Math.min(100, tier.successRate * 100).toFixed(0)}%</td>
                    <td style="padding: 3px 6px; text-align: right;">${(tier.completionChance * 100).toFixed(0)}%</td>
                    ${goalCell}
                    <td style="padding: 3px 6px; text-align: right;">${tier.starsPerSession.toFixed(2)}</td>
                    <td style="padding: 3px 6px; text-align: right;">${tier.starsPerHour.toFixed(1)}</td>
                    <td style="padding: 3px 6px; text-align: right;">${formatWithSeparator(Math.round(tier.tokensPerHour))}</td>
                </tr>`;
            }

            html += `<div class="${CSS_PREFIX}__section">
                <div class="${CSS_PREFIX}__section-title">Tier Projection — ${name}</div>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <thead>
                            <tr style="color: ${config.COLOR_TEXT_SECONDARY}; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <th style="padding: 3px 6px; text-align: left;">Lv.</th>
                                <th style="padding: 3px 6px; text-align: right;">Hit %</th>
                                <th style="padding: 3px 6px; text-align: right;">Session %</th>
                                ${goalHeader}
                                <th style="padding: 3px 6px; text-align: right;">★/sess</th>
                                <th style="padding: 3px 6px; text-align: right;">★/hr</th>
                                <th style="padding: 3px 6px; text-align: right;">Tok/hr</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
        }

        this._panelEl.innerHTML = html;

        const select = this._panelEl.querySelector(`.${CSS_PREFIX}__sim-select`);
        if (select) {
            select.addEventListener('change', (e) => {
                this._simActivity = e.target.value;
                this._renderSimulator();
            });
        }
    }
}

const guildActivityDisplay = new GuildActivityDisplay();

export default {
    name: 'Guild Activity Display',
    initialize: () => guildActivityDisplay.initialize(),
    cleanup: () => guildActivityDisplay.disable(),
};
