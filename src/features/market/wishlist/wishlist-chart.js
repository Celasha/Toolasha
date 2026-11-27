/**
 * Wishlist Price Chart
 * Pop-out modal with a Chart.js line chart of a wishlist item's price since it was added.
 * Prices are only recorded while the game is open, so long stretches without data are shown as
 * breaks in the line (or joined, with the "Connect gaps" toggle).
 */

import { t } from '../../../core/i18n.js';
import { formatWithSeparator, networthFormatter, formatDateTime } from '../../../utils/formatters.js';

/** Gap that breaks the line (the recorder samples hourly) */
export const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export const RANGE_MS = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    all: Infinity,
};

const MODAL_ID = 'mwi-wishlist-chart-modal';
const LIVE_COLOR = '#4ade80';
const ESTIMATED_COLOR = '#f59e0b';

/**
 * Turn a recorded series into chart points for a time range.
 * @param {Array<Array<number>>} series - [t, price, estimated] points, oldest first
 * @param {Object} options
 * @param {number} [options.rangeMs=Infinity] - Only points newer than now - rangeMs
 * @param {number} [options.now=Date.now()]
 * @param {boolean} [options.connectGaps=false] - Join across gaps instead of breaking the line
 * @returns {Array<{x: number, y: number, estimated?: boolean}>} y is NaN for a break
 */
export function buildChartPoints(series, { rangeMs = Infinity, now = Date.now(), connectGaps = false } = {}) {
    const cutoff = rangeMs === Infinity ? 0 : now - rangeMs;
    const kept = series.filter((point) => point[0] >= cutoff);

    const points = [];
    kept.forEach((point, i) => {
        if (!connectGaps && i > 0 && point[0] - kept[i - 1][0] > GAP_THRESHOLD_MS) {
            points.push({ x: kept[i - 1][0] + 1, y: NaN });
        }
        points.push({ x: point[0], y: point[1], estimated: point[2] === 1 });
    });
    return points;
}

/**
 * Summary numbers for a recorded series.
 * @param {Array<Array<number>>} series - [t, price, estimated] points
 * @returns {{first: number, last: number, lowest: number, highest: number, change: number, changePercent: number}|null}
 */
export function summarizeSeries(series) {
    if (series.length === 0) return null;
    const prices = series.map((point) => point[1]);
    const first = prices[0];
    const last = prices[prices.length - 1];
    return {
        first,
        last,
        lowest: Math.min(...prices),
        highest: Math.max(...prices),
        change: last - first,
        changePercent: first > 0 ? ((last - first) / first) * 100 : 0,
    };
}

class WishlistChart {
    constructor() {
        this.chartInstance = null;
        this.modal = null;
        this.escHandler = null;
        this.outsideClickHandler = null;
        this.outsideClickTimer = null;
        this.item = null;
        this.series = [];
        this.range = 'all';
        this.connectGaps = false;
    }

    /**
     * Open the chart for one item.
     * @param {Object} params
     * @param {string} params.title - Display name (with +N for enhanced items)
     * @param {Array<Array<number>>} params.series - Recorded [t, price, estimated] points
     * @param {number|null} [params.currentPrice] - Live price, shown as "Current" when available
     */
    open({ title, series, currentPrice = null }) {
        this.close();
        this.series = series;
        this.currentPrice = currentPrice;
        this.range = 'all';
        this.connectGaps = false;

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 900px;
            height: 70%;
            max-height: 560px;
            background: #1a1a1a;
            border: 2px solid #555;
            border-radius: 8px;
            padding: 20px;
            z-index: 100000;
            display: flex;
            flex-direction: column;
            color: #ccc;
        `;

        const header = document.createElement('div');
        header.style.cssText =
            'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
        const heading = document.createElement('h3');
        heading.textContent = t('marketWishlist.chartTitle', { name: title });
        heading.style.cssText = 'margin: 0; font-size: 18px;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText =
            'background: #a33; color: #fff; border: none; cursor: pointer; font-size: 20px; padding: 4px 12px; border-radius: 4px; font-weight: bold;';
        closeBtn.addEventListener('click', () => this.close());
        header.append(heading, closeBtn);

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;';
        const rangeLabels = {
            '24h': t('marketWishlist.range24h'),
            '7d': t('marketWishlist.range7d'),
            '30d': t('marketWishlist.range30d'),
            all: t('marketWishlist.rangeAll'),
        };
        for (const range of Object.keys(RANGE_MS)) {
            const btn = document.createElement('button');
            btn.textContent = rangeLabels[range];
            btn.dataset.range = range;
            btn.className = 'mwi-wishlist-range-btn';
            btn.addEventListener('click', () => {
                this.range = range;
                this.styleRangeButtons();
                this.renderChart();
            });
            controls.appendChild(btn);
        }
        const gapLabel = document.createElement('label');
        gapLabel.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: 6px; cursor: pointer;';
        const gapToggle = document.createElement('input');
        gapToggle.type = 'checkbox';
        gapToggle.className = 'mwi-wishlist-connect-gaps';
        gapToggle.addEventListener('change', () => {
            this.connectGaps = gapToggle.checked;
            this.renderChart();
        });
        gapLabel.append(gapToggle, document.createTextNode(t('marketWishlist.connectGaps')));
        controls.appendChild(gapLabel);

        const stats = document.createElement('div');
        stats.className = 'mwi-wishlist-chart-stats';
        stats.style.cssText = 'display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px;';

        const canvasContainer = document.createElement('div');
        canvasContainer.style.cssText = 'position: relative; flex: 1; min-height: 0;';
        const canvas = document.createElement('canvas');
        canvas.className = 'mwi-wishlist-chart-canvas';
        canvasContainer.appendChild(canvas);

        modal.append(header, controls, stats, canvasContainer);
        document.body.appendChild(modal);
        this.modal = modal;
        this.styleRangeButtons();

        this.escHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('keydown', this.escHandler);

        // Registered on the next tick so the click that opened the modal does not close it
        this.outsideClickHandler = (e) => {
            if (!modal.contains(e.target)) this.close();
        };
        const queued = this.outsideClickHandler;
        this.outsideClickTimer = setTimeout(() => {
            this.outsideClickTimer = null;
            if (this.outsideClickHandler === queued) document.addEventListener('mousedown', queued);
        }, 0);

        this.renderChart();
    }

    styleRangeButtons() {
        this.modal?.querySelectorAll('.mwi-wishlist-range-btn').forEach((btn) => {
            const active = btn.dataset.range === this.range;
            btn.style.cssText = `
                background: ${active ? '#444' : '#2a2a2a'};
                color: ${active ? '#fff' : '#999'};
                border: 1px solid #555;
                cursor: pointer;
                padding: 4px 14px;
                border-radius: 4px;
                font-size: 13px;
            `;
        });
    }

    /**
     * (Re)draw the stats row and the chart for the current range
     */
    renderChart() {
        if (!this.modal) return;
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }

        const now = Date.now();
        const rangeMs = RANGE_MS[this.range];
        const inRange = this.series.filter((point) => rangeMs === Infinity || point[0] >= now - rangeMs);
        this.renderStats(inRange);

        const canvasContainer = this.modal.querySelector('.mwi-wishlist-chart-canvas').parentElement;
        canvasContainer.querySelector('.mwi-wishlist-chart-message')?.remove();
        const canvas = canvasContainer.querySelector('canvas');

        const message = (key) => {
            canvas.style.display = 'none';
            const el = document.createElement('div');
            el.className = 'mwi-wishlist-chart-message';
            el.style.cssText = 'padding: 40px 0; text-align: center; opacity: 0.75;';
            el.textContent = t(key);
            canvasContainer.appendChild(el);
        };

        if (typeof Chart === 'undefined') {
            message('marketWishlist.chartUnavailable');
            return;
        }
        if (inRange.length < 2) {
            message(this.series.length === 0 ? 'marketWishlist.noHistoryYet' : 'marketWishlist.notEnoughHistory');
            return;
        }
        canvas.style.display = '';

        const points = buildChartPoints(this.series, { rangeMs, now, connectGaps: this.connectGaps });
        const shortRange = inRange[inRange.length - 1][0] - inRange[0][0] <= 48 * 60 * 60 * 1000;
        const estimatedLabel = t('marketWishlist.estimatedPoint');

        this.chartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: t('marketWishlist.priceAxisTitle'),
                        data: points,
                        borderColor: LIVE_COLOR,
                        borderWidth: 2,
                        pointRadius: points.length > 120 ? 0 : 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: (ctx) => (ctx.raw?.estimated ? ESTIMATED_COLOR : LIVE_COLOR),
                        pointBorderColor: (ctx) => (ctx.raw?.estimated ? ESTIMATED_COLOR : LIVE_COLOR),
                        spanGaps: false,
                        tension: 0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                interaction: { mode: 'nearest', intersect: false },
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                        filter: (item) => !Number.isNaN(item.raw?.y),
                        callbacks: {
                            title: (items) => formatDateTime(new Date(items[0].raw.x), { includeSeconds: false }),
                            label: (item) =>
                                `${formatWithSeparator(item.raw.y)}${item.raw.estimated ? ` ${estimatedLabel}` : ''}`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        offset: false,
                        min: points[0].x,
                        max: points[points.length - 1].x,
                        ticks: {
                            color: '#999',
                            maxTicksLimit: 10,
                            callback: (value) =>
                                shortRange
                                    ? formatDateTime(new Date(value), { includeDate: false, includeSeconds: false })
                                    : formatDateTime(new Date(value), { includeTime: false }),
                        },
                        grid: { color: '#333' },
                    },
                    y: {
                        beginAtZero: false,
                        title: { display: true, text: t('marketWishlist.priceAxisTitle'), color: '#ccc' },
                        ticks: { color: '#999', callback: (value) => networthFormatter(value) },
                        grid: { color: '#333' },
                    },
                },
            },
        });
    }

    renderStats(inRange) {
        const stats = this.modal.querySelector('.mwi-wishlist-chart-stats');
        const summary = summarizeSeries(inRange);
        const parts = [];

        if (this.series.length > 0) {
            parts.push(
                t('marketWishlist.trackingSince', {
                    date: formatDateTime(new Date(this.series[0][0]), { includeSeconds: false }),
                })
            );
        }
        if (this.currentPrice > 0) {
            parts.push(t('marketWishlist.statCurrent', { value: formatWithSeparator(Math.round(this.currentPrice)) }));
        }
        if (summary) {
            parts.push(
                t('marketWishlist.statLowest', { value: formatWithSeparator(summary.lowest) }),
                t('marketWishlist.statHighest', { value: formatWithSeparator(summary.highest) })
            );
            const sign = summary.change > 0 ? '+' : '';
            parts.push(
                t('marketWishlist.statChange', {
                    value: `${sign}${formatWithSeparator(summary.change)} (${sign}${summary.changePercent.toFixed(1)}%)`,
                })
            );
        }
        stats.replaceChildren(
            ...parts.map((text) => {
                const span = document.createElement('span');
                span.textContent = text;
                return span;
            })
        );
    }

    close() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
        if (this.escHandler) {
            document.removeEventListener('keydown', this.escHandler);
            this.escHandler = null;
        }
        if (this.outsideClickTimer) {
            clearTimeout(this.outsideClickTimer);
            this.outsideClickTimer = null;
        }
        if (this.outsideClickHandler) {
            document.removeEventListener('mousedown', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        this.modal?.remove();
        this.modal = null;
    }
}

const wishlistChart = new WishlistChart();

export default wishlistChart;
export { WishlistChart };
