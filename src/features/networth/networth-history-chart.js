/**
 * Networth History Chart
 * Pop-out modal with Chart.js line chart showing networth over time.
 * Supports time range selection, gap handling, and tooltip breakdown.
 */

import networthHistory, { GAP_THRESHOLD_MS } from './networth-history.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import { networthFormatter } from '../../utils/formatters.js';

const RANGE_MS = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    all: Infinity,
};

const CATEGORIES = [
    { key: 'gold', label: 'Gold', color: '#eab308' },
    { key: 'inventory', label: 'Inventory', color: '#3b82f6' },
    { key: 'equipment', label: 'Equipment', color: '#ef4444' },
    { key: 'listings', label: 'Listings', color: '#8b5cf6' },
    { key: 'house', label: 'House', color: '#f97316' },
    { key: 'abilities', label: 'Abilities', color: '#06b6d4' },
];

class NetworthHistoryChart {
    constructor() {
        this.chartInstance = null;
        this.escHandler = null;
        this.networthFeature = null;
        this.activeRange = '7d'; // Track current active range
        this.connectGaps = false; // Toggle for connecting gaps in chart
        this.showBars = false; // Toggle for bar overlay on chart
        this.movingAvgWindow = 0; // Moving average window in data points (0 = off)
        this.categoryVisibility = {
            showTotal: true,
            gold: false,
            inventory: false,
            equipment: false,
            listings: false,
            house: false,
            abilities: false,
        };
        this.currentRange = '7d';
        this.currentCustomFrom = null;
        this.currentCustomTo = null;
        this._loadChartPrefs();
    }

    /**
     * Load persisted chart toggle preferences
     */
    async _loadChartPrefs() {
        const prefs = await storage.get('networthChartPrefs', 'networthHistory', {});
        if (prefs.connectGaps !== undefined) this.connectGaps = prefs.connectGaps;
        if (prefs.showBars !== undefined) this.showBars = prefs.showBars;
        if (prefs.movingAvgWindow !== undefined) this.movingAvgWindow = prefs.movingAvgWindow;
        if (prefs.categoryVisibility !== undefined)
            this.categoryVisibility = { ...this.categoryVisibility, ...prefs.categoryVisibility };
    }

    /**
     * Returns true if at least one line (Total or any category) is visible
     */
    _hasAnyVisible() {
        if (this.categoryVisibility.showTotal) return true;
        return CATEGORIES.some((c) => this.categoryVisibility[c.key]);
    }

    /**
     * Save chart toggle preferences
     */
    _saveChartPrefs() {
        storage.set(
            'networthChartPrefs',
            {
                connectGaps: this.connectGaps,
                showBars: this.showBars,
                movingAvgWindow: this.movingAvgWindow,
                categoryVisibility: this.categoryVisibility,
            },
            'networthHistory'
        );
    }

    /**
     * Set reference to networth feature for live data access
     * @param {Object} feature - NetworthFeature instance
     */
    setNetworthFeature(feature) {
        this.networthFeature = feature;
    }

    /**
     * Open the chart modal
     */
    async openModal() {
        // Ensure preferences are loaded before building UI
        await this._loadChartPrefs();

        // Remove existing modal if any
        const existing = document.getElementById('mwi-nw-chart-modal');
        if (existing) {
            existing.remove();
        }

        // Create modal container
        const modal = document.createElement('div');
        modal.id = 'mwi-nw-chart-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 1200px;
            height: 80%;
            max-height: 750px;
            background: #1a1a1a;
            border: 2px solid #555;
            border-radius: 8px;
            padding: 20px;
            z-index: 100000;
            display: flex;
            flex-direction: column;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Networth History';
        title.style.cssText = 'color: #ccc; margin: 0; font-size: 18px;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText = `
            background: #a33;
            color: #fff;
            border: none;
            cursor: pointer;
            font-size: 20px;
            padding: 4px 12px;
            border-radius: 4px;
            font-weight: bold;
        `;
        closeBtn.addEventListener('click', () => this.closeModal());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Time range row (buttons + date inputs)
        const rangeRow = document.createElement('div');
        rangeRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        `;

        const ranges = ['24h', '7d', '30d', 'all'];
        for (const range of ranges) {
            const btn = document.createElement('button');
            btn.textContent = range === 'all' ? 'All' : range.toUpperCase();
            btn.dataset.range = range;
            btn.className = 'mwi-nw-range-btn';
            btn.style.cssText = `
                background: ${range === '7d' ? '#444' : '#2a2a2a'};
                color: ${range === '7d' ? '#fff' : '#999'};
                border: 1px solid #555;
                cursor: pointer;
                padding: 4px 14px;
                border-radius: 4px;
                font-size: 13px;
            `;
            btn.addEventListener('click', () => {
                this._selectPresetRange(btn, rangeRow, range);
            });
            rangeRow.appendChild(btn);
        }

        // Connect Gaps toggle
        const gapToggle = document.createElement('button');
        gapToggle.textContent = 'Connect Gaps';
        gapToggle.className = 'mwi-nw-gap-toggle';
        const updateGapToggleStyle = () => {
            gapToggle.style.cssText = `
                background: ${this.connectGaps ? '#444' : '#2a2a2a'};
                color: ${this.connectGaps ? '#fff' : '#999'};
                border: 1px solid #555;
                cursor: pointer;
                padding: 4px 14px;
                border-radius: 4px;
                font-size: 13px;
                margin-left: 4px;
            `;
        };
        updateGapToggleStyle();
        gapToggle.addEventListener('click', () => {
            this.connectGaps = !this.connectGaps;
            updateGapToggleStyle();
            this._saveChartPrefs();
            this.renderChart(this.currentRange, this.currentCustomFrom, this.currentCustomTo);
        });
        rangeRow.appendChild(gapToggle);

        // Show Bars toggle
        const barToggle = document.createElement('button');
        barToggle.textContent = 'Show Bars';
        barToggle.className = 'mwi-nw-bar-toggle';
        const updateBarToggleStyle = () => {
            barToggle.style.cssText = `
                background: ${this.showBars ? '#444' : '#2a2a2a'};
                color: ${this.showBars ? '#fff' : '#999'};
                border: 1px solid #555;
                cursor: pointer;
                padding: 4px 14px;
                border-radius: 4px;
                font-size: 13px;
                margin-left: 4px;
            `;
        };
        updateBarToggleStyle();
        barToggle.addEventListener('click', () => {
            this.showBars = !this.showBars;
            updateBarToggleStyle();
            this._saveChartPrefs();
            this.renderChart(this.currentRange, this.currentCustomFrom, this.currentCustomTo);
        });
        rangeRow.appendChild(barToggle);

        // Moving Average dropdown
        const maLabel = document.createElement('span');
        maLabel.textContent = 'Avg:';
        maLabel.style.cssText = 'color: #999; font-size: 12px; margin-left: 8px;';
        rangeRow.appendChild(maLabel);

        const maSelect = document.createElement('select');
        maSelect.className = 'mwi-nw-ma-select';
        maSelect.style.cssText = `
            background: #2a2a2a;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 3px 6px;
            font-size: 13px;
            cursor: pointer;
            color-scheme: dark;
        `;
        const maOptions = [
            { value: 0, label: 'Off' },
            { value: 3, label: '3h' },
            { value: 6, label: '6h' },
            { value: 12, label: '12h' },
            { value: 24, label: '24h' },
        ];
        for (const opt of maOptions) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === this.movingAvgWindow) option.selected = true;
            maSelect.appendChild(option);
        }
        maSelect.addEventListener('change', () => {
            this.movingAvgWindow = parseInt(maSelect.value, 10);
            this._saveChartPrefs();
            this.renderChart(this.currentRange, this.currentCustomFrom, this.currentCustomTo);
        });
        rangeRow.appendChild(maSelect);

        // Spacer
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        rangeRow.appendChild(spacer);

        // Date input styles (shared)
        const dateInputStyle = `
            background: #2a2a2a;
            color: #ccc;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 3px 8px;
            font-size: 12px;
            color-scheme: dark;
            cursor: pointer;
        `;

        // From label + input
        const fromLabel = document.createElement('span');
        fromLabel.textContent = 'From:';
        fromLabel.style.cssText = 'color: #999; font-size: 12px;';
        rangeRow.appendChild(fromLabel);

        const fromInput = document.createElement('input');
        fromInput.type = 'date';
        fromInput.id = 'mwi-nw-date-from';
        fromInput.style.cssText = dateInputStyle;
        fromInput.addEventListener('change', () => {
            this._onDateInputChange(rangeRow);
        });
        rangeRow.appendChild(fromInput);

        // To label + input
        const toLabel = document.createElement('span');
        toLabel.textContent = 'To:';
        toLabel.style.cssText = 'color: #999; font-size: 12px;';
        rangeRow.appendChild(toLabel);

        const toInput = document.createElement('input');
        toInput.type = 'date';
        toInput.id = 'mwi-nw-date-to';
        toInput.style.cssText = dateInputStyle;
        toInput.addEventListener('change', () => {
            this._onDateInputChange(rangeRow);
        });
        rangeRow.appendChild(toInput);

        // Category toggle row
        const categoryRow = document.createElement('div');
        categoryRow.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 10px;
        `;

        const categoryButtons = {};

        // Total toggle chip (controls the main networth line)
        const totalColor = config.COLOR_ACCENT || '#22c55e';
        const totalBtn = document.createElement('button');
        const updateTotalBtnStyle = () => {
            const active = this.categoryVisibility.showTotal;
            totalBtn.style.cssText = `
                background: ${active ? totalColor + '33' : '#2a2a2a'};
                color: ${active ? '#fff' : '#999'};
                border: 1px solid ${active ? totalColor : '#555'};
                cursor: pointer;
                padding: 3px 8px;
                border-radius: 4px;
                font-size: 0.8em;
                display: flex;
                align-items: center;
                gap: 5px;
            `;
        };
        const totalDot = document.createElement('span');
        totalDot.style.cssText = `
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 2px;
            background: ${totalColor};
            flex-shrink: 0;
        `;
        totalBtn.appendChild(totalDot);
        totalBtn.appendChild(document.createTextNode('Total'));
        updateTotalBtnStyle();
        totalBtn.addEventListener('click', () => {
            this.categoryVisibility.showTotal = !this.categoryVisibility.showTotal;
            if (!this._hasAnyVisible()) {
                this.categoryVisibility.showTotal = true;
            }
            updateTotalBtnStyle();
            this._saveChartPrefs();
            this.renderChart(this.currentRange, this.currentCustomFrom, this.currentCustomTo);
        });
        categoryRow.appendChild(totalBtn);

        for (const cat of CATEGORIES) {
            const btn = document.createElement('button');
            categoryButtons[cat.key] = btn;
            const updateCatBtnStyle = () => {
                const active = this.categoryVisibility[cat.key];
                btn.style.cssText = `
                    background: ${active ? cat.color + '33' : '#2a2a2a'};
                    color: ${active ? '#fff' : '#999'};
                    border: 1px solid ${active ? cat.color : '#555'};
                    cursor: pointer;
                    padding: 3px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                `;
            };
            const dot = document.createElement('span');
            dot.style.cssText = `
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 2px;
                background: ${cat.color};
                flex-shrink: 0;
            `;
            btn.appendChild(dot);
            btn.appendChild(document.createTextNode(cat.label));
            updateCatBtnStyle();
            btn.addEventListener('click', () => {
                this.categoryVisibility[cat.key] = !this.categoryVisibility[cat.key];
                if (!this._hasAnyVisible()) {
                    this.categoryVisibility.showTotal = true;
                    updateTotalBtnStyle();
                }
                updateCatBtnStyle();
                this._saveChartPrefs();
                this.renderChart(this.currentRange, this.currentCustomFrom, this.currentCustomTo);
            });
            categoryRow.appendChild(btn);
        }

        // Summary stats row
        const statsRow = document.createElement('div');
        statsRow.id = 'mwi-nw-chart-stats';
        statsRow.style.cssText = `
            display: flex;
            gap: 24px;
            margin-bottom: 12px;
            font-size: 13px;
            color: #ccc;
        `;

        // Canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.style.cssText = `
            flex: 1;
            position: relative;
            min-height: 0;
        `;

        const canvas = document.createElement('canvas');
        canvas.id = 'mwi-nw-chart-canvas';
        canvasContainer.appendChild(canvas);

        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(rangeRow);
        modal.appendChild(categoryRow);
        modal.appendChild(statsRow);
        modal.appendChild(canvasContainer);
        document.body.appendChild(modal);

        // ESC to close
        this.escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        };
        document.addEventListener('keydown', this.escHandler);

        // Render default view
        this.renderChart('7d');
    }

    /**
     * Select a preset range button, clear date inputs, and render
     * @param {HTMLElement} btn - Clicked button
     * @param {HTMLElement} rangeRow - Row container for deselecting siblings
     * @param {string} range - '24h', '7d', '30d', or 'all'
     */
    _selectPresetRange(btn, rangeRow, range) {
        // Highlight selected button, deselect others
        for (const sibling of rangeRow.querySelectorAll('.mwi-nw-range-btn')) {
            sibling.style.background = '#2a2a2a';
            sibling.style.color = '#999';
        }
        btn.style.background = '#444';
        btn.style.color = '#fff';

        // Clear date inputs
        const fromInput = document.getElementById('mwi-nw-date-from');
        const toInput = document.getElementById('mwi-nw-date-to');
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';

        this.activeRange = range;
        this.renderChart(range);
    }

    /**
     * Handle date input change — deselect preset buttons and render custom range
     * @param {HTMLElement} rangeRow - Row container
     */
    _onDateInputChange(rangeRow) {
        const fromInput = document.getElementById('mwi-nw-date-from');
        const toInput = document.getElementById('mwi-nw-date-to');
        if (!fromInput || !toInput) return;

        // Only render if at least one date is set
        if (!fromInput.value && !toInput.value) return;

        // Deselect all preset buttons
        for (const btn of rangeRow.querySelectorAll('.mwi-nw-range-btn')) {
            btn.style.background = '#2a2a2a';
            btn.style.color = '#999';
        }

        // Parse dates (from = start of day, to = end of day)
        const fromMs = fromInput.value ? new Date(fromInput.value + 'T00:00:00').getTime() : 0;
        const toMs = toInput.value ? new Date(toInput.value + 'T23:59:59').getTime() : Date.now();

        this.activeRange = 'custom';
        this.renderChart('custom', fromMs, toMs);
    }

    /**
     * Render the chart for a given time range
     * @param {string} range - '24h', '7d', '30d', 'all', or 'custom'
     * @param {number} [customFrom] - Custom start timestamp (for 'custom' range)
     * @param {number} [customTo] - Custom end timestamp (for 'custom' range)
     */
    renderChart(range, customFrom, customTo) {
        // Store params for re-render on toggle
        this.currentRange = range;
        this.currentCustomFrom = customFrom;
        this.currentCustomTo = customTo;

        const canvas = document.getElementById('mwi-nw-chart-canvas');
        if (!canvas) return;

        // Destroy existing chart
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }

        const history = networthHistory.getHistory();
        if (history.length === 0) {
            this.updateSummaryStats([]);
            return;
        }

        // Filter by time range
        const now = Date.now();
        let filtered;
        if (range === 'custom') {
            const from = customFrom || 0;
            const to = customTo || now;
            filtered = history.filter((p) => p.t >= from && p.t <= to);
        } else {
            const cutoff = range === 'all' ? 0 : now - RANGE_MS[range];
            filtered = history.filter((p) => p.t >= cutoff);
        }

        if (filtered.length === 0) {
            this.updateSummaryStats([]);
            return;
        }

        // Update summary stats
        this.updateSummaryStats(filtered);

        // Build chart data — connect gaps or split into segments
        let chartData;
        if (this.connectGaps) {
            chartData = filtered.map((p) => ({ x: p.t, y: p.total, _raw: p }));
        } else {
            // Split into gap-separated segments
            const segments = [];
            let currentSegment = [filtered[0]];

            for (let i = 1; i < filtered.length; i++) {
                if (filtered[i].t - filtered[i - 1].t > GAP_THRESHOLD_MS) {
                    segments.push(currentSegment);
                    currentSegment = [filtered[i]];
                } else {
                    currentSegment.push(filtered[i]);
                }
            }
            segments.push(currentSegment);

            // Build chart data with NaN gaps between segments
            chartData = [];
            for (let i = 0; i < segments.length; i++) {
                for (const point of segments[i]) {
                    chartData.push({ x: point.t, y: point.total, _raw: point });
                }
                // Insert NaN gap between segments (not after last)
                if (i < segments.length - 1) {
                    const gapTime = segments[i][segments[i].length - 1].t + 1;
                    chartData.push({ x: gapTime, y: NaN });
                }
            }
        }

        // Determine if short range (use time-only x-axis labels)
        const rangeSpanMs = filtered[filtered.length - 1].t - filtered[0].t;
        const isShortRange = range === '24h' || (range === 'custom' && rangeSpanMs <= 48 * 60 * 60 * 1000);

        // Create chart
        const ctx = canvas.getContext('2d');

        // Build datasets array
        const datasets = [];

        // Bar overlay dataset (rendered first = behind line)
        if (this.showBars) {
            const barData = chartData.filter((p) => !isNaN(p.y));
            datasets.push({
                type: 'bar',
                label: 'Networth (bars)',
                data: barData,
                backgroundColor: 'rgba(34, 197, 94, 0.3)',
                borderColor: 'transparent',
                borderWidth: 0,
                barThickness: 6,
                minBarLength: 2,
                order: 2,
            });
        }

        // Line dataset (rendered on top)
        if (this.categoryVisibility.showTotal) {
            datasets.push({
                type: 'line',
                label: 'Total Networth',
                data: chartData,
                borderColor: config.COLOR_ACCENT || '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderWidth: 2,
                pointRadius: filtered.length > 200 ? 0 : 2,
                pointHoverRadius: 5,
                tension: 0.1,
                fill: true,
                spanGaps: this.connectGaps,
                order: 1,
            });
        }

        // Category line datasets (one per visible category)
        for (const cat of CATEGORIES) {
            if (!this.categoryVisibility[cat.key]) continue;

            const catData = chartData.map((p) => ({ x: p.x, y: p._raw ? p._raw[cat.key] : NaN }));
            datasets.push({
                type: 'line',
                label: cat.label,
                data: catData,
                borderColor: cat.color,
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0.1,
                fill: false,
                spanGaps: this.connectGaps,
                parsing: false,
            });
        }

        // Moving average line dataset
        if (this.movingAvgWindow > 0) {
            const realPoints = chartData.filter((p) => !isNaN(p.y));
            const maData = [];
            for (let i = 0; i < realPoints.length; i++) {
                const windowStart = Math.max(0, i - this.movingAvgWindow + 1);
                let sum = 0;
                let count = 0;
                for (let j = windowStart; j <= i; j++) {
                    sum += realPoints[j].y;
                    count++;
                }
                maData.push({ x: realPoints[i].x, y: sum / count });
            }
            datasets.push({
                type: 'line',
                label: `${this.movingAvgWindow}h Moving Avg`,
                data: maData,
                borderColor: '#f59e0b',
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [6, 3],
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.2,
                fill: false,
                spanGaps: true,
                order: 0,
            });
        }

        const visibleCategories = CATEGORIES.filter((c) => this.categoryVisibility[c.key]);
        const yAxisTitle =
            !this.categoryVisibility.showTotal && visibleCategories.length > 0 ? 'Category Value' : 'Networth';

        this.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                interaction: {
                    mode: 'nearest',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                        filter: (tooltipItem) => {
                            if (tooltipItem.dataset.type === 'bar') return false;
                            if (isNaN(tooltipItem.raw?.y)) return false;
                            if (tooltipItem.dataset.label === 'Total Networth') return true;
                            const cat = CATEGORIES.find((c) => c.label === tooltipItem.dataset.label);
                            return cat ? this.categoryVisibility[cat.key] : false;
                        },
                        callbacks: {
                            title: (tooltipItems) => {
                                if (!tooltipItems.length) return '';
                                const ts = tooltipItems[0].raw.x;
                                return new Date(ts).toLocaleString([], {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                });
                            },
                            label: (context) => {
                                if (context.dataset.label === 'Total Networth') {
                                    const raw = context.raw._raw;
                                    return raw ? `Total: ${networthFormatter(raw.total)}` : '';
                                }
                                return `${context.dataset.label}: ${networthFormatter(Math.round(context.raw.y))}`;
                            },
                            afterLabel: (context) => {
                                if (context.dataset.label !== 'Total Networth') return [];
                                const raw = context.raw._raw;
                                if (!raw) return [];
                                const lines = [];
                                if (raw.gold) lines.push(`Gold: ${networthFormatter(raw.gold)}`);
                                if (raw.inventory) lines.push(`Inventory: ${networthFormatter(raw.inventory)}`);
                                if (raw.equipment) lines.push(`Equipment: ${networthFormatter(raw.equipment)}`);
                                if (raw.listings) lines.push(`Listings: ${networthFormatter(raw.listings)}`);
                                if (raw.house) lines.push(`House: ${networthFormatter(raw.house)}`);
                                if (raw.abilities) lines.push(`Abilities: ${networthFormatter(raw.abilities)}`);
                                return lines;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        ticks: {
                            color: '#999',
                            maxTicksLimit: 10,
                            callback: (value) => {
                                const d = new Date(value);
                                if (isShortRange) {
                                    return d.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    });
                                }
                                return d.toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                });
                            },
                        },
                        grid: { color: '#333' },
                    },
                    y: {
                        title: {
                            display: true,
                            text: yAxisTitle,
                            color: '#ccc',
                        },
                        ticks: {
                            color: '#999',
                            callback: (value) => networthFormatter(value),
                        },
                        grid: { color: '#333' },
                    },
                },
            },
        });
    }

    /**
     * Update the summary stats row
     * @param {Array} filtered - Filtered history data for the current range
     */
    updateSummaryStats(filtered) {
        const statsRow = document.getElementById('mwi-nw-chart-stats');
        if (!statsRow) return;

        if (filtered.length === 0) {
            statsRow.innerHTML = '<span style="color: #666;">No data available for this range</span>';
            return;
        }

        const parts = [];
        const first = filtered[0];
        const last = filtered[filtered.length - 1];
        const hoursElapsed = (last.t - first.t) / 3_600_000;

        // Hoist 24h baseline (used by both Total and category stats)
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const fullHistory = networthHistory.getHistory();
        const oldestIn24h = fullHistory.find((p) => p.t >= oneDayAgo);

        // Total stats — Current, 24h change, Rate
        if (this.categoryVisibility.showTotal) {
            const currentTotal = this.networthFeature?.currentData?.totalNetworth ?? last.total;

            let change24h = null;
            let changePercent = null;
            if (oldestIn24h) {
                change24h = currentTotal - oldestIn24h.total;
                changePercent = oldestIn24h.total > 0 ? (change24h / oldestIn24h.total) * 100 : 0;
            }

            const ratePerHour = hoursElapsed > 0 ? (last.total - first.total) / hoursElapsed : 0;

            parts.push(
                `<span>Current: <strong style="color: ${config.COLOR_ACCENT};">${networthFormatter(Math.round(currentTotal))}</strong></span>`
            );

            if (change24h !== null) {
                const color = change24h >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const sign = change24h >= 0 ? '+' : '';
                parts.push(
                    `<span id="mwi-nw-24h-toggle" style="cursor: pointer;" title="Click for item breakdown">24h: <strong style="color: ${color};">${sign}${networthFormatter(Math.round(change24h))} (${sign}${changePercent.toFixed(1)}%)</strong> <span style="font-size: 10px; color: #666;">▼</span></span>`
                );
            }

            if (hoursElapsed >= 1) {
                const color = ratePerHour >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const sign = ratePerHour >= 0 ? '+' : '';
                parts.push(
                    `<span>Rate: <strong style="color: ${color};">${sign}${networthFormatter(Math.round(ratePerHour))}/hr</strong></span>`
                );
            }
        }

        // Per-category rate stats for each visible category line
        for (const cat of CATEGORIES) {
            if (!this.categoryVisibility[cat.key]) continue;
            const firstVal = first[cat.key] ?? 0;
            const lastVal = last[cat.key] ?? 0;
            const rate = hoursElapsed > 0 ? (lastVal - firstVal) / hoursElapsed : 0;
            const rateColor = rate >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
            const rateSign = rate >= 0 ? '+' : '';

            let statHtml = `${cat.label}: <strong style="color: ${rateColor};">${rateSign}${networthFormatter(Math.round(rate))}/hr</strong>`;

            if (oldestIn24h?.[cat.key] != null) {
                const change24h = lastVal - (oldestIn24h[cat.key] ?? 0);
                const c24Sign = change24h >= 0 ? '+' : '';
                statHtml += ` <span style="font-size: 11px; color: #aaa;">(${c24Sign}${networthFormatter(Math.round(change24h))} 24h)</span>`;
            }

            parts.push(`<span>${statHtml}</span>`);
        }

        if (parts.length === 0) {
            statsRow.innerHTML = '<span style="color: #666;">No data available for this range</span>';
            return;
        }

        statsRow.innerHTML = parts.join('<span style="color: #555; margin: 0 2px;">·</span>');

        // Wire up 24h click handler for item breakdown toggle
        const toggle24h = document.getElementById('mwi-nw-24h-toggle');
        if (toggle24h) {
            toggle24h.addEventListener('click', () => this.toggle24hBreakdown());
        }
    }

    /**
     * Toggle the 24h item-level breakdown popout
     */
    toggle24hBreakdown() {
        // Close if already open
        const existing = document.getElementById('mwi-nw-24h-breakdown');
        if (existing) {
            existing.remove();
            return;
        }

        const toggle = document.getElementById('mwi-nw-24h-toggle');
        if (!toggle) return;

        // Create popout positioned below the 24h stat
        const container = document.createElement('div');
        container.id = 'mwi-nw-24h-breakdown';
        container.style.cssText = `
            position: absolute;
            background: #222;
            border: 1px solid #444;
            border-radius: 6px;
            padding: 10px 14px;
            max-height: 300px;
            width: 360px;
            overflow-y: auto;
            font-size: 12px;
            color: #ccc;
            z-index: 100001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Position below the toggle element
        const rect = toggle.getBoundingClientRect();
        container.style.top = `${rect.bottom + 4}px`;
        container.style.left = `${rect.left}px`;

        this.render24hBreakdown(container);
        document.body.appendChild(container);

        // Close popout when clicking outside
        const closeHandler = (e) => {
            if (!container.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
                container.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        // Delay so the current click doesn't immediately close it
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
    }

    /**
     * Render the 24h item-level breakdown into the given container.
     * Decomposes each item's change into activity impact (quantity changes)
     * and market movement (price changes on existing holdings).
     * @param {HTMLElement} container - Breakdown container element
     */
    render24hBreakdown(container) {
        const currentData = this.networthFeature?.currentData;
        if (!currentData) {
            container.innerHTML = '<span style="color: #666;">No live data available</span>';
            return;
        }

        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const oldSnapshot = networthHistory.getDetailSnapshot(oneDayAgo);
        if (!oldSnapshot) {
            container.innerHTML =
                '<span style="color: #666;">No detail snapshot available yet (data collected hourly)</span>';
            return;
        }

        // Build current items map from live data
        const currentItems = {};
        const gameData = dataManager.getInitClientData();

        // Gold
        currentItems['/items/coin:0'] = {
            count: Math.round(currentData.coins),
            value: Math.round(currentData.coins),
            name: 'Gold',
        };

        // Inventory items
        for (const item of currentData.currentAssets.inventory.breakdown) {
            if (!item.itemHrid) continue;
            const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
            currentItems[key] = {
                count: item.count || 0,
                value: Math.round(item.value || 0),
                name: item.name,
            };
        }

        // Equipped items
        for (const item of currentData.currentAssets.equipped.breakdown) {
            if (!item.itemHrid) continue;
            const key = `${item.itemHrid}:${item.enhancementLevel || 0}`;
            currentItems[key] = {
                count: 1,
                value: Math.round(item.value || 0),
                name: item.name,
            };
        }

        // Decompose each item into activity vs market impact
        const activityItems = [];
        const marketItems = [];
        let activityTotal = 0;
        let marketTotal = 0;

        const allKeys = new Set([...Object.keys(currentItems), ...Object.keys(oldSnapshot.items)]);

        for (const key of allKeys) {
            const curr = currentItems[key] || { count: 0, value: 0 };
            const old = oldSnapshot.items[key] || { count: 0, value: 0 };

            const countDiff = curr.count - old.count;
            const totalDiff = curr.value - old.value;

            if (totalDiff === 0 && countDiff === 0) continue;

            // Resolve display name
            let name = curr.name;
            if (!name) {
                const [itemHrid, enhLevel] = key.split(':');
                const details = gameData?.itemDetailMap?.[itemHrid];
                const baseName = details?.name || itemHrid.replace('/items/', '');
                name = Number(enhLevel) > 0 ? `${baseName} +${enhLevel}` : baseName;
            }

            // Per-unit prices
            const oldPrice = old.count > 0 ? old.value / old.count : 0;
            const currPrice = curr.count > 0 ? curr.value / curr.count : 0;

            // Activity = countDiff × oldPrice (new/removed items use current price)
            // Market = oldCount × (currPrice - oldPrice)
            let activity = 0;
            let market = 0;

            if (old.count === 0) {
                // Entirely new item — pure activity
                activity = curr.value;
            } else if (curr.count === 0) {
                // Entirely removed item — pure activity (negative)
                activity = -old.value;
            } else {
                activity = countDiff * oldPrice;
                market = old.count * (currPrice - oldPrice);
            }

            activity = Math.round(activity);
            market = Math.round(market);

            if (activity !== 0) {
                activityTotal += activity;
                activityItems.push({ name, key, countDiff, value: activity });
            }
            if (market !== 0) {
                marketTotal += market;
                marketItems.push({ name, key, count: old.count, value: market });
            }
        }

        if (activityItems.length === 0 && marketItems.length === 0) {
            container.innerHTML = '<span style="color: #666;">No item-level changes in the last 24h</span>';
            return;
        }

        // Sort both lists by absolute value descending
        activityItems.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        marketItems.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

        let html = '';

        // Activity section
        if (activityItems.length > 0) {
            const actColor = activityTotal >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
            const actSign = activityTotal >= 0 ? '+' : '';
            html += `<div style="font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between;">`;
            html += `<span>Activity</span>`;
            html += `<span style="color: ${actColor};">${actSign}${networthFormatter(activityTotal)}</span>`;
            html += `</div>`;

            for (const item of activityItems) {
                const isPos = item.value >= 0;
                const color = isPos ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const sign = isPos ? '+' : '';

                let countText = '';
                if (item.countDiff !== 0 && item.key !== '/items/coin:0') {
                    const countSign = item.countDiff > 0 ? '+' : '';
                    countText = ` <span style="color: #888; font-size: 11px;">${countSign}${item.countDiff}</span>`;
                }

                html += `<div style="display: flex; justify-content: space-between; padding: 1px 0 1px 12px;">`;
                html += `<span>${item.name}${countText}</span>`;
                html += `<span style="color: ${color}; white-space: nowrap; margin-left: 12px;">${sign}${networthFormatter(item.value)}</span>`;
                html += `</div>`;
            }
        }

        // Market movement section
        if (marketItems.length > 0) {
            const mktColor = marketTotal >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;
            const mktSign = marketTotal >= 0 ? '+' : '';
            html += `<div style="font-weight: bold; margin-top: 8px; margin-bottom: 4px; display: flex; justify-content: space-between;${activityItems.length > 0 ? ' padding-top: 6px; border-top: 1px solid #333;' : ''}">`;
            html += `<span>Market Movement</span>`;
            html += `<span style="color: ${mktColor};">${mktSign}${networthFormatter(marketTotal)}</span>`;
            html += `</div>`;

            for (const item of marketItems) {
                const isPos = item.value >= 0;
                const color = isPos ? config.COLOR_PROFIT : config.COLOR_LOSS;
                const sign = isPos ? '+' : '';

                html += `<div style="display: flex; justify-content: space-between; padding: 1px 0 1px 12px;">`;
                html += `<span>${item.name} <span style="color: #888; font-size: 11px;">\u00d7${item.count}</span></span>`;
                html += `<span style="color: ${color}; white-space: nowrap; margin-left: 12px;">${sign}${networthFormatter(item.value)}</span>`;
                html += `</div>`;
            }
        }

        // Snapshot age note
        const ageHours = Math.round((Date.now() - oldSnapshot.t) / 3_600_000);
        html += `<div style="color: #555; font-size: 10px; margin-top: 6px; text-align: right;">Compared to snapshot from ${ageHours}h ago</div>`;

        container.innerHTML = html;
    }

    /**
     * Close the modal and clean up
     */
    closeModal() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }

        // Remove 24h breakdown popout if open
        const breakdown = document.getElementById('mwi-nw-24h-breakdown');
        if (breakdown) {
            breakdown.remove();
        }

        const modal = document.getElementById('mwi-nw-chart-modal');
        if (modal) {
            modal.remove();
        }

        if (this.escHandler) {
            document.removeEventListener('keydown', this.escHandler);
            this.escHandler = null;
        }
    }
}

const networthHistoryChart = new NetworthHistoryChart();

export default networthHistoryChart;
