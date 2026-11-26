/**
 * Dungeon Tracker UI Chart Integration
 * Handles Chart.js rendering for dungeon run statistics
 */

import { t } from '../../core/i18n.js';
import dungeonTrackerStorage from './dungeon-tracker-storage.js';

const LARGE_CHART_THRESHOLD = 200;
const MAX_X_TICKS = 12;

class DungeonTrackerUIChart {
    constructor(state) {
        this.state = state;
        this.chartInstance = null;
        this.modalChartInstance = null;
        this.closeModal = null;
    }

    /**
     * Render chart with filtered run data
     * @param {HTMLElement} container - Main container element
     * @param {Function} canRender - Whether this render is still current and visible after the read
     */
    async render(container, canRender = () => true) {
        const canvas = container.querySelector('#mwi-dt-chart-canvas');
        if (!canvas) return;

        const allRuns = await dungeonTrackerStorage.getAllRuns();
        if (!canRender()) return;

        this.chartInstance?.destroy();
        this.chartInstance = null;
        this.chartInstance = this.createChart(canvas, allRuns);
    }

    /**
     * Build the chart used by both the panel and the pop-out.
     * @param {HTMLCanvasElement} canvas
     * @param {Array} allRuns
     * @param {boolean} [isModal=false]
     * @returns {Chart|null}
     */
    createChart(canvas, allRuns, isModal = false) {
        const { filterDungeon, filterTeam } = this.state;
        const runs = [];
        for (const run of allRuns) {
            if (filterDungeon !== 'all' && run.dungeonName !== filterDungeon) continue;
            if (filterTeam !== 'all' && run.teamKey !== filterTeam) continue;
            // Failed attempts and unvalidated durations inflated by sleep would skew the trend.
            if (run.result && run.result !== 'success') continue;
            if (run.hibernationDetected && !run.validated) continue;

            runs.push({
                timestamp: typeof run.timestamp === 'number' ? run.timestamp : Date.parse(run.timestamp),
                minutes: (run.duration || run.totalTime || 0) / 60000,
            });
        }

        const count = runs.length;
        if (count === 0) return null;

        runs.sort((a, b) => a.timestamp - b.timestamp);
        const largeChart = count > LARGE_CHART_THRESHOLD;
        const placeholder = '{runNumber}';
        const [prefix, suffix = ''] = t('dungeonTrackerUi.chartRunLabel', { number: placeholder }).split(placeholder);
        const labels = new Array(count);
        const durations = new Array(count);
        let total = 0;
        let fastest = Infinity;
        let slowest = -Infinity;
        for (let i = 0; i < count; i++) {
            // In the pop-out, Run 1 is the most recent run, as in the history list.
            labels[i] = `${prefix}${isModal ? count - i : i + 1}${suffix}`;
            const duration = runs[i].minutes;
            durations[i] = duration;
            total += duration;
            fastest = Math.min(fastest, duration);
            slowest = Math.max(slowest, duration);
        }

        // Chart.js 3.7 index tooltips look up the same array index in each visible dataset.
        // Keep the reference lines as plain numbers so every run's tooltip includes them.
        const referenceLine = (label, value, borderColor) => ({
            label,
            data: new Array(count).fill(value),
            borderColor,
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            tension: 0,
            fill: false,
        });
        const datasets = [
            {
                label: t('dungeonTrackerUi.chartRunTimesLabel'),
                data: durations,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderWidth: 2,
                pointRadius: largeChart ? 0 : 3,
                pointHoverRadius: 5,
                tension: largeChart ? 0 : 0.1,
                fill: false,
            },
            referenceLine(t('dungeonTrackerUi.chartAverageLabel'), total / count, 'rgb(255, 159, 64)'),
            referenceLine(t('dungeonTrackerUi.chartFastestLabel'), fastest, 'rgb(75, 192, 75)'),
            referenceLine(t('dungeonTrackerUi.chartSlowestLabel'), slowest, 'rgb(255, 99, 132)'),
        ];

        const modalFont = isModal ? { font: { size: 14 } } : {};
        return new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#ccc',
                            usePointStyle: true,
                            padding: 15,
                            ...modalFont,
                        },
                    },
                    title: {
                        display: false,
                    },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                const minutes = Math.floor(value);
                                const seconds = Math.floor((value - minutes) * 60);
                                return `${label}: ${minutes}m ${seconds}s`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: t('dungeonTrackerUi.chartRunNumberAxisLabel'),
                            color: '#ccc',
                            ...modalFont,
                        },
                        ticks: {
                            color: '#999',
                            ...(largeChart && { autoSkip: true, maxTicksLimit: MAX_X_TICKS, sampleSize: MAX_X_TICKS }),
                        },
                        grid: {
                            color: '#333',
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: t('dungeonTrackerUi.chartDurationAxisLabel'),
                            color: '#ccc',
                            ...modalFont,
                        },
                        ticks: {
                            color: '#999',
                        },
                        grid: {
                            color: '#333',
                        },
                        beginAtZero: false,
                    },
                },
            },
        });
    }

    /**
     * Create pop-out modal with larger chart
     */
    createPopoutModal() {
        this.closeModal?.();

        // Create modal container
        const modal = document.createElement('div');
        modal.id = 'mwi-dt-chart-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 1200px;
            height: 80%;
            max-height: 700px;
            background: #1a1a1a;
            border: 2px solid #555;
            border-radius: 8px;
            padding: 20px;
            z-index: 100000;
            display: flex;
            flex-direction: column;
        `;

        // Create header with close button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        `;

        const title = document.createElement('h3');
        title.textContent = t('dungeonTrackerUi.chartTitle');
        title.style.cssText = 'color: #ccc; margin: 0; font-size: 18px;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
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

        header.appendChild(title);
        header.appendChild(closeBtn);

        const canvasContainer = document.createElement('div');
        canvasContainer.style.cssText = `
            flex: 1;
            position: relative;
            min-height: 0;
        `;

        const canvas = document.createElement('canvas');
        canvas.id = 'mwi-dt-chart-modal-canvas';
        canvasContainer.appendChild(canvas);

        modal.appendChild(header);
        modal.appendChild(canvasContainer);
        document.body.appendChild(modal);

        const escHandler = (e) => {
            if (e.key === 'Escape') this.closeModal?.();
        };
        this.closeModal = () => {
            this.modalChartInstance?.destroy();
            this.modalChartInstance = null;
            this.closeModal = null;
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        };
        closeBtn.addEventListener('click', this.closeModal);
        document.addEventListener('keydown', escHandler);

        this.renderModalChart(canvas);
    }

    /**
     * Render chart in pop-out modal
     * @param {HTMLCanvasElement} canvas - Canvas element
     */
    async renderModalChart(canvas) {
        try {
            const allRuns = await dungeonTrackerStorage.getAllRuns();
            if (canvas.isConnected) {
                this.modalChartInstance = this.createChart(canvas, allRuns, true);
            }
        } catch (error) {
            console.error('[Dungeon Tracker UI Chart] Pop-out render failed:', error);
        }
    }

    /**
     * Destroy charts and close the pop-out when the tracker is torn down.
     */
    cleanup() {
        this.chartInstance?.destroy();
        this.chartInstance = null;
        this.closeModal?.();
    }
}

export default DungeonTrackerUIChart;
