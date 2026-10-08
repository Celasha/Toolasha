/**
 * Dungeon Tracker UI Interactions
 * Handles all user interactions: dragging, toggles, button clicks
 */

import dungeonTracker from './dungeon-tracker.js';
import dungeonTrackerStorage from './dungeon-tracker-storage.js';
import dungeonTrackerChatAnnotations from './dungeon-tracker-chat-annotations.js';
import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { bringPanelToFront } from '../../utils/panel-z-index.js';

class DungeonTrackerUIInteractions {
    constructor(state, chartRef, historyRef) {
        this.state = state;
        this.chart = chartRef;
        this.history = historyRef;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isResizing = false;
        this.resizeStartX = 0;
        this.resizeStartWidth = 0;
        this.resizeWidthMultiplier = 1;
        this.timerRegistry = createTimerRegistry();
        // Store drag handlers for cleanup
        this.dragMoveHandler = null;
        this.dragUpHandler = null;
        this.resizeMoveHandler = null;
        this.resizeUpHandler = null;
        this.keyboardShortcutHandler = null;
    }

    /**
     * Setup all interactions
     * @param {HTMLElement} container - Main container element
     * @param {Object} callbacks - Callback functions {onUpdate, onUpdateChart, onUpdateHistory}
     */
    setupAll(container, callbacks) {
        this.container = container;
        this.callbacks = callbacks;

        this.setupDragging();
        this.setupResizing();
        this.setupCollapseButton();
        this.setupKeysToggle();
        this.setupRunHistoryToggle();
        this.setupGroupingControls();
        this.setupBackfillButton();
        this.setupClearAll();
        this.setupChartToggle();
        this.setupChartPopout();
        this.setupKeyboardShortcut();
    }

    /**
     * Setup dragging functionality
     */
    setupDragging() {
        const header = this.container.querySelector('#mwi-dt-header');
        if (!header) return;

        header.addEventListener('mousedown', (e) => {
            // Don't drag if clicking collapse button
            if (e.target.id === 'mwi-dt-collapse-btn') return;

            bringPanelToFront(this.container);
            this.isDragging = true;
            const rect = this.container.getBoundingClientRect();
            this.dragOffset = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
            header.style.cursor = 'grabbing';
        });

        // Remove old handlers if they exist
        if (this.dragMoveHandler) {
            document.removeEventListener('mousemove', this.dragMoveHandler);
        }
        if (this.dragUpHandler) {
            document.removeEventListener('mouseup', this.dragUpHandler);
        }

        // Create and store new handlers
        this.dragMoveHandler = (e) => {
            if (!this.isDragging) return;

            let x = e.clientX - this.dragOffset.x;
            let y = e.clientY - this.dragOffset.y;

            // Apply position boundaries to keep tracker visible
            const containerRect = this.container.getBoundingClientRect();
            const minVisiblePx = 100; // Keep at least 100px visible

            // Constrain Y: header must be visible at top
            y = Math.max(0, y);
            y = Math.min(y, window.innerHeight - minVisiblePx);

            // Constrain X: keep at least 100px visible on either edge
            x = Math.max(-containerRect.width + minVisiblePx, x);
            x = Math.min(x, window.innerWidth - minVisiblePx);

            // Save position (disables default centering)
            this.state.position = { x, y };

            // Apply position
            this.container.style.left = `${x}px`;
            this.container.style.top = `${y}px`;
            this.container.style.transform = 'none'; // Disable centering transform
        };

        this.dragUpHandler = () => {
            if (this.isDragging) {
                this.isDragging = false;
                const header = this.container.querySelector('#mwi-dt-header');
                if (header) header.style.cursor = 'move';
                this.state.save();
            }
        };

        document.addEventListener('mousemove', this.dragMoveHandler);
        document.addEventListener('mouseup', this.dragUpHandler);
    }

    /**
     * Setup resize handle (width-only, bottom-right corner grip)
     */
    setupResizing() {
        const handle = this.container.querySelector('#mwi-dt-resize-handle');
        if (!handle) return;

        const MIN_WIDTH = 200;

        handle.addEventListener('mouseenter', () => {
            handle.style.background = 'rgba(74, 158, 255, 0.4)';
        });
        handle.addEventListener('mouseleave', () => {
            if (!this.isResizing) handle.style.background = 'transparent';
        });

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Don't let this bubble into the header's drag handler

            bringPanelToFront(this.container);
            this.isResizing = true;
            this.resizeStartX = e.clientX;
            this.resizeStartWidth = this.container.getBoundingClientRect().width;
            // Centered (no custom position) panels grow from their midpoint, so the right edge
            // only moves half as far as the cursor — double the delta to keep edge-tracking 1:1.
            this.resizeWidthMultiplier = this.state.position ? 1 : 2;
        });

        // Remove old handlers if they exist
        if (this.resizeMoveHandler) {
            document.removeEventListener('mousemove', this.resizeMoveHandler);
        }
        if (this.resizeUpHandler) {
            document.removeEventListener('mouseup', this.resizeUpHandler);
        }

        this.resizeMoveHandler = (e) => {
            if (!this.isResizing) return;

            const delta = (e.clientX - this.resizeStartX) * this.resizeWidthMultiplier;
            let newWidth = this.resizeStartWidth + delta;
            newWidth = Math.max(MIN_WIDTH, newWidth);
            newWidth = Math.min(newWidth, window.innerWidth - 20);

            this.container.style.width = `${newWidth}px`;
        };

        this.resizeUpHandler = () => {
            if (this.isResizing) {
                this.isResizing = false;
                handle.style.background = 'transparent';
                this.state.width = Math.round(this.container.getBoundingClientRect().width);
                this.state.save();
            }
        };

        document.addEventListener('mousemove', this.resizeMoveHandler);
        document.addEventListener('mouseup', this.resizeUpHandler);
    }

    /**
     * Setup collapse button
     */
    setupCollapseButton() {
        const collapseBtn = this.container.querySelector('#mwi-dt-collapse-btn');
        if (!collapseBtn) return;

        collapseBtn.addEventListener('click', () => {
            this.toggleCollapse();
        });
    }

    /**
     * Setup keys toggle
     */
    setupKeysToggle() {
        const keysHeader = this.container.querySelector('#mwi-dt-keys-header');
        if (!keysHeader) return;

        keysHeader.addEventListener('click', () => {
            this.toggleKeys();
        });
    }

    /**
     * Setup run history toggle
     */
    setupRunHistoryToggle() {
        const runHistoryHeader = this.container.querySelector('#mwi-dt-run-history-header');
        if (!runHistoryHeader) return;

        runHistoryHeader.addEventListener('click', (e) => {
            // Don't toggle if clicking the clear or backfill buttons
            if (e.target.id === 'mwi-dt-clear-all' || e.target.closest('#mwi-dt-clear-all')) return;
            if (e.target.id === 'mwi-dt-backfill-btn' || e.target.closest('#mwi-dt-backfill-btn')) return;
            this.toggleRunHistory();
        });
    }

    /**
     * Setup grouping and filtering controls
     */
    setupGroupingControls() {
        // Group by dropdown
        const groupBySelect = this.container.querySelector('#mwi-dt-group-by');
        if (groupBySelect) {
            groupBySelect.value = this.state.groupBy;
            groupBySelect.addEventListener('change', (e) => {
                this.state.groupBy = e.target.value;
                this.state.save();
                // Clear expanded groups when grouping changes (different group labels)
                this.state.expandedGroups.clear();
                if (this.callbacks.onUpdateHistory) this.callbacks.onUpdateHistory();
                if (this.callbacks.onUpdateChart) this.callbacks.onUpdateChart();
            });
        }

        // Filter dungeon dropdown
        const filterDungeonSelect = this.container.querySelector('#mwi-dt-filter-dungeon');
        if (filterDungeonSelect) {
            filterDungeonSelect.addEventListener('change', (e) => {
                this.state.filterDungeon = e.target.value;
                this.state.save();
                if (this.callbacks.onUpdateHistory) this.callbacks.onUpdateHistory();
                if (this.callbacks.onUpdateChart) this.callbacks.onUpdateChart();
            });
        }

        // Filter team dropdown
        const filterTeamSelect = this.container.querySelector('#mwi-dt-filter-team');
        if (filterTeamSelect) {
            filterTeamSelect.addEventListener('change', (e) => {
                this.state.filterTeam = e.target.value;
                this.state.save();
                if (this.callbacks.onUpdateHistory) this.callbacks.onUpdateHistory();
                if (this.callbacks.onUpdateChart) this.callbacks.onUpdateChart();
            });
        }
    }

    /**
     * Setup clear all button
     */
    setupClearAll() {
        const clearBtn = this.container.querySelector('#mwi-dt-clear-all');
        if (!clearBtn) return;

        clearBtn.addEventListener('click', async () => {
            if (confirm(t('dungeonTrackerUi.clearAllRunsConfirm'))) {
                try {
                    // Clear unified storage completely
                    await dungeonTrackerStorage.clearAllRuns();
                    alert(t('dungeonTrackerUi.clearAllRunsSuccessAlert'));

                    // Refresh both history and chart display
                    if (this.callbacks.onUpdateHistory) await this.callbacks.onUpdateHistory();
                    if (this.callbacks.onUpdateChart) await this.callbacks.onUpdateChart();

                    // Reset chat annotations so run numbers restart from #1
                    await dungeonTrackerChatAnnotations.refreshRunCounts();
                } catch (error) {
                    console.error('[Dungeon Tracker UI Interactions] Clear all history error:', error);
                    alert(t('dungeonTrackerUi.clearAllRunsFailedAlert'));
                }
            }
        });
    }

    /**
     * Setup chart toggle
     */
    setupChartToggle() {
        const chartHeader = this.container.querySelector('#mwi-dt-chart-header');
        if (!chartHeader) return;

        chartHeader.addEventListener('click', (e) => {
            // Don't toggle if clicking the pop-out button
            if (e.target.closest('#mwi-dt-chart-popout-btn')) return;

            this.toggleChart();
        });
    }

    /**
     * Setup chart pop-out button
     */
    setupChartPopout() {
        const popoutBtn = this.container.querySelector('#mwi-dt-chart-popout-btn');
        if (!popoutBtn) return;

        popoutBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent toggle
            this.chart.createPopoutModal();
        });
    }

    /**
     * Setup backfill button
     */
    setupBackfillButton() {
        const backfillBtn = this.container.querySelector('#mwi-dt-backfill-btn');
        if (!backfillBtn) return;

        backfillBtn.addEventListener('click', async () => {
            // Change button text to show loading
            backfillBtn.textContent = t('dungeonTrackerUi.backfillProcessingLabel');
            backfillBtn.disabled = true;

            try {
                // Run backfill
                const result = await dungeonTracker.backfillFromChatHistory();

                // Show result message
                if (result.runsAdded > 0) {
                    alert(
                        t('dungeonTrackerUi.backfillCompleteAlert', {
                            runsAdded: result.runsAdded,
                            teamsCount: result.teams.length,
                        })
                    );
                } else {
                    alert(t('dungeonTrackerUi.backfillNoRunsAlert'));
                }

                // Refresh both history and chart display
                if (this.callbacks.onUpdateHistory) await this.callbacks.onUpdateHistory();
                if (this.callbacks.onUpdateChart) await this.callbacks.onUpdateChart();

                // Sync chat annotations with newly stored run data
                await dungeonTrackerChatAnnotations.refreshRunCounts();
            } catch (error) {
                console.error('[Dungeon Tracker UI Interactions] Backfill error:', error);
                alert(t('dungeonTrackerUi.backfillFailedAlert'));
            } finally {
                // Reset button
                backfillBtn.textContent = t('dungeonTrackerUi.backfillButtonLabel');
                backfillBtn.disabled = false;
            }
        });
    }

    /**
     * Toggle collapse state
     */
    toggleCollapse() {
        this.state.isCollapsed = !this.state.isCollapsed;

        if (this.state.isCollapsed) {
            this.applyCollapsedState();
        } else {
            this.applyExpandedState();
        }

        // Recompute width/position for the new state — handles both default-centered and
        // custom-dragged positions, and collapsed always uses the fixed compact width
        // regardless of any custom resize width saved while expanded.
        this.state.updatePosition(this.container);

        this.state.save();
    }

    /**
     * Apply collapsed state appearance
     */
    applyCollapsedState() {
        const content = this.container.querySelector('#mwi-dt-content');
        const collapseBtn = this.container.querySelector('#mwi-dt-collapse-btn');

        if (content) content.style.display = 'none';
        if (collapseBtn) collapseBtn.textContent = '▲';
    }

    /**
     * Apply expanded state appearance
     */
    applyExpandedState() {
        const content = this.container.querySelector('#mwi-dt-content');
        const collapseBtn = this.container.querySelector('#mwi-dt-collapse-btn');

        if (content) content.style.display = 'flex';
        if (collapseBtn) collapseBtn.textContent = '▼';
    }

    /**
     * Toggle keys expanded state
     */
    toggleKeys() {
        this.state.isKeysExpanded = !this.state.isKeysExpanded;

        if (this.state.isKeysExpanded) {
            this.applyKeysExpandedState();
        } else {
            this.applyKeysCollapsedState();
        }

        this.state.save();
    }

    /**
     * Apply keys expanded state
     */
    applyKeysExpandedState() {
        const keysList = this.container.querySelector('#mwi-dt-keys-list');
        const keysToggle = this.container.querySelector('#mwi-dt-keys-toggle');

        if (keysList) keysList.style.display = 'block';
        if (keysToggle) keysToggle.textContent = '▲';
    }

    /**
     * Apply keys collapsed state
     */
    applyKeysCollapsedState() {
        const keysList = this.container.querySelector('#mwi-dt-keys-list');
        const keysToggle = this.container.querySelector('#mwi-dt-keys-toggle');

        if (keysList) keysList.style.display = 'none';
        if (keysToggle) keysToggle.textContent = '▼';
    }

    /**
     * Toggle run history expanded state
     */
    toggleRunHistory() {
        this.state.isRunHistoryExpanded = !this.state.isRunHistoryExpanded;

        if (this.state.isRunHistoryExpanded) {
            this.applyRunHistoryExpandedState();
        } else {
            this.applyRunHistoryCollapsedState();
        }

        this.state.save();
    }

    /**
     * Apply run history expanded state
     */
    applyRunHistoryExpandedState() {
        const runList = this.container.querySelector('#mwi-dt-run-list');
        const runHistoryToggle = this.container.querySelector('#mwi-dt-run-history-toggle');
        const controls = this.container.querySelector('#mwi-dt-controls');

        if (runList) runList.style.display = 'block';
        if (runHistoryToggle) runHistoryToggle.textContent = '▲';
        if (controls) controls.style.display = 'block';
    }

    /**
     * Apply run history collapsed state
     */
    applyRunHistoryCollapsedState() {
        const runList = this.container.querySelector('#mwi-dt-run-list');
        const runHistoryToggle = this.container.querySelector('#mwi-dt-run-history-toggle');
        const controls = this.container.querySelector('#mwi-dt-controls');

        if (runList) runList.style.display = 'none';
        if (runHistoryToggle) runHistoryToggle.textContent = '▼';
        if (controls) controls.style.display = 'none';
    }

    /**
     * Toggle chart expanded/collapsed
     */
    toggleChart() {
        this.state.isChartExpanded = !this.state.isChartExpanded;

        if (this.state.isChartExpanded) {
            this.applyChartExpandedState();
        } else {
            this.applyChartCollapsedState();
        }

        this.state.save();
    }

    /**
     * Apply chart expanded state
     */
    applyChartExpandedState() {
        const chartContainer = this.container.querySelector('#mwi-dt-chart-container');
        const toggle = this.container.querySelector('#mwi-dt-chart-toggle');

        if (chartContainer) {
            chartContainer.style.display = 'block';
            // Render chart after becoming visible (longer delay for initial page load)
            if (this.callbacks.onUpdateChart) {
                const chartTimeout = setTimeout(() => this.callbacks.onUpdateChart(), 300);
                this.timerRegistry.registerTimeout(chartTimeout);
            }
        }
        if (toggle) toggle.textContent = '▼';
    }

    /**
     * Apply chart collapsed state
     */
    applyChartCollapsedState() {
        const chartContainer = this.container.querySelector('#mwi-dt-chart-container');
        const toggle = this.container.querySelector('#mwi-dt-chart-toggle');

        if (chartContainer) chartContainer.style.display = 'none';
        if (toggle) toggle.textContent = '▶';
    }

    /**
     * Apply initial states
     */
    applyInitialStates() {
        // Apply initial collapsed state
        if (this.state.isCollapsed) {
            this.applyCollapsedState();
        }

        // Apply initial keys expanded state
        if (this.state.isKeysExpanded) {
            this.applyKeysExpandedState();
        }

        // Apply initial run history expanded state
        if (this.state.isRunHistoryExpanded) {
            this.applyRunHistoryExpandedState();
        }

        // Apply initial chart expanded state
        if (this.state.isChartExpanded) {
            this.applyChartExpandedState();
        }
    }

    /**
     * Setup keyboard shortcut for resetting position and size
     * Ctrl+Shift+D to reset dungeon tracker to default position and size
     */
    setupKeyboardShortcut() {
        if (this.keyboardShortcutHandler) {
            document.removeEventListener('keydown', this.keyboardShortcutHandler);
        }

        this.keyboardShortcutHandler = (e) => {
            // Ctrl+Shift+D - Reset dungeon tracker position and size
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                this.resetPosition();
            }
        };
        document.addEventListener('keydown', this.keyboardShortcutHandler);
    }

    /**
     * Reset dungeon tracker position and size to default (centered, default width)
     */
    resetPosition() {
        // Clear saved position and custom width (re-enables default centering/sizing)
        this.state.position = null;
        this.state.width = null;

        // Re-apply position styling
        this.state.updatePosition(this.container);

        // Save updated state
        this.state.save();

        // Show brief notification
        this.showNotification(t('dungeonTrackerUi.positionResetNotification'));
    }

    /**
     * Show temporary notification message
     * @param {string} message - Notification text
     */
    showNotification(message) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(74, 158, 255, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            font-family: 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: ${config.Z_NOTIFICATION};
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            pointer-events: none;
        `;

        document.body.appendChild(notification);

        // Fade out and remove after 2 seconds
        const removeTimeout = setTimeout(() => {
            notification.style.transition = 'opacity 0.3s ease';
            notification.style.opacity = '0';
            const cleanupTimeout = setTimeout(() => notification.remove(), 300);
            this.timerRegistry.registerTimeout(cleanupTimeout);
        }, 2000);
        this.timerRegistry.registerTimeout(removeTimeout);
    }

    cleanup() {
        // Remove document-level drag listeners
        if (this.dragMoveHandler) {
            document.removeEventListener('mousemove', this.dragMoveHandler);
            this.dragMoveHandler = null;
        }
        if (this.dragUpHandler) {
            document.removeEventListener('mouseup', this.dragUpHandler);
            this.dragUpHandler = null;
        }
        if (this.keyboardShortcutHandler) {
            document.removeEventListener('keydown', this.keyboardShortcutHandler);
            this.keyboardShortcutHandler = null;
        }

        this.timerRegistry.clearAll();
    }
}

export default DungeonTrackerUIInteractions;
