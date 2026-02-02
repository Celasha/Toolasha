/**
 * Enhancement Tracker Floating UI
 * Displays enhancement session statistics in a draggable panel
 * Based on Ultimate Enhancement Tracker v3.7.9
 */

import enhancementTracker from './enhancement-tracker.js';
import { SessionState, getSessionDuration } from './enhancement-session.js';
import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { formatPercentage } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

// UI Style Constants (matching Ultimate Enhancement Tracker)
const STYLE = {
    colors: {
        primary: '#00ffe7',
        background: 'rgba(5, 5, 15, 0.95)',
        border: 'rgba(0, 255, 234, 0.4)',
        textPrimary: '#e0f7ff',
        textSecondary: '#9b9bff',
        accent: '#ff00d4',
        danger: '#ff0055',
        success: '#00ff99',
        headerBg: 'rgba(15, 5, 35, 0.7)',
        gold: '#FFD700',
    },
    borderRadius: {
        small: '4px',
        medium: '8px',
        large: '12px',
    },
    transitions: {
        fast: 'all 0.15s ease',
        medium: 'all 0.25s ease',
    },
};

// Table styling
const compactTableStyle = `
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 0;
`;

const compactHeaderStyle = `
    padding: 4px 6px;
    background: ${STYLE.colors.headerBg};
    border: 1px solid ${STYLE.colors.border};
    color: ${STYLE.colors.textPrimary};
    font-weight: bold;
    text-align: center;
`;

const compactCellStyle = `
    padding: 3px 6px;
    border: 1px solid rgba(0, 255, 234, 0.2);
    color: ${STYLE.colors.textPrimary};
`;

/**
 * Enhancement UI Manager
 */
class EnhancementUI {
    constructor() {
        this.floatingUI = null;
        this.currentViewingIndex = 0; // Index in sessions array
        this.updateDebounce = null;
        this.isDragging = false;
        this.unregisterScreenObserver = null;
        this.pollInterval = null;
        this.isOnEnhancingScreen = false;
        this.isCollapsed = false; // Track collapsed state
        this.updateInterval = null;
        this.timerRegistry = createTimerRegistry();
        this.dragHandle = null;
        this.dragMouseDownHandler = null;
        this.dragMoveHandler = null;
        this.dragUpHandler = null;
    }

    /**
     * Initialize the UI
     */
    initialize() {
        this.createFloatingUI();
        this.updateUI();

        // Set up screen observer for visibility control
        this.setupScreenObserver();

        // Update UI every second during active sessions
        this.updateInterval = setInterval(() => {
            const session = this.getCurrentSession();
            if (session && session.state === SessionState.TRACKING) {
                this.updateUI();
            }
        }, 1000);
        this.timerRegistry.registerInterval(this.updateInterval);
    }

    /**
     * Set up screen observer to detect Enhancing screen using centralized observer
     */
    setupScreenObserver() {
        // Check if setting is enabled (default to false if undefined)
        const showOnlyOnEnhancingScreen = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

        if (showOnlyOnEnhancingScreen !== true) {
            // Setting is disabled or undefined, always show tracker
            this.isOnEnhancingScreen = true;
            this.show();
        } else {
            // Setting enabled, check current screen
            this.checkEnhancingScreen();
            this.updateVisibility();
        }

        // Register with centralized DOM observer for enhancing panel detection
        // Note: Enhancing screen uses EnhancingPanel_enhancingPanel, not SkillActionDetail_enhancingComponent
        this.unregisterScreenObserver = domObserver.onClass(
            'EnhancementUI-ScreenDetection',
            'EnhancingPanel_enhancingPanel',
            (_node) => {
                this.checkEnhancingScreen();
            },
            { debounce: false }
        );

        // Poll for both setting changes and panel removal
        this.pollInterval = setInterval(() => {
            const currentSetting = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

            if (currentSetting !== true) {
                // Setting disabled - always show
                if (!this.isOnEnhancingScreen) {
                    this.isOnEnhancingScreen = true;
                    this.updateVisibility();
                }
            } else {
                // Setting enabled - check if panel exists
                const panel = document.querySelector('[class*="EnhancingPanel_enhancingPanel"]');
                const shouldBeOnScreen = !!panel;

                if (this.isOnEnhancingScreen !== shouldBeOnScreen) {
                    this.isOnEnhancingScreen = shouldBeOnScreen;
                    this.updateVisibility();
                }
            }
        }, 500);
        this.timerRegistry.registerInterval(this.pollInterval);
    }

    /**
     * Check if currently on Enhancing screen
     */
    checkEnhancingScreen() {
        const enhancingPanel = document.querySelector('[class*="EnhancingPanel_enhancingPanel"]');
        const wasOnEnhancingScreen = this.isOnEnhancingScreen;
        this.isOnEnhancingScreen = !!enhancingPanel;

        if (wasOnEnhancingScreen !== this.isOnEnhancingScreen) {
            this.updateVisibility();
        }
    }

    /**
     * Update visibility based on screen state and settings
     */
    updateVisibility() {
        const showOnlyOnEnhancingScreen = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

        if (showOnlyOnEnhancingScreen !== true) {
            this.show();
        } else if (this.isOnEnhancingScreen) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Get currently viewed session
     */
    getCurrentSession() {
        const sessions = Object.values(enhancementTracker.getAllSessions());
        if (sessions.length === 0) return null;

        // Ensure index is valid
        if (this.currentViewingIndex >= sessions.length) {
            this.currentViewingIndex = sessions.length - 1;
        }
        if (this.currentViewingIndex < 0) {
            this.currentViewingIndex = 0;
        }

        return sessions[this.currentViewingIndex];
    }

    /**
     * Switch viewing to a specific session by ID
     * @param {string} sessionId - Session ID to view
     */
    switchToSession(sessionId) {
        const sessions = Object.values(enhancementTracker.getAllSessions());
        const index = sessions.findIndex((session) => session.id === sessionId);

        if (index !== -1) {
            this.currentViewingIndex = index;
        }
    }

    /**
     * Create the floating UI panel
     */
    createFloatingUI() {
        if (this.floatingUI && document.body.contains(this.floatingUI)) {
            return this.floatingUI;
        }

        // Main container
        this.floatingUI = document.createElement('div');
        this.floatingUI.id = 'enhancementFloatingUI';
        Object.assign(this.floatingUI.style, {
            position: 'fixed',
            top: '50px',
            right: '50px',
            zIndex: '9998',
            fontSize: '14px',
            padding: '0',
            borderRadius: STYLE.borderRadius.medium,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            overflow: 'hidden',
            width: '350px',
            minHeight: 'auto',
            background: 'rgba(25, 0, 35, 0.92)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${STYLE.colors.primary}`,
            color: STYLE.colors.textPrimary,
            display: 'flex',
            flexDirection: 'column',
            transition: 'width 0.2s ease',
        });

        // Create header
        const header = this.createHeader();
        this.floatingUI.appendChild(header);

        // Create content area
        const content = document.createElement('div');
        content.id = 'enhancementPanelContent';
        content.style.padding = '15px';
        content.style.flexGrow = '1';
        content.style.overflow = 'auto';
        content.style.transition = 'max-height 0.2s ease, opacity 0.2s ease';
        content.style.maxHeight = '600px';
        content.style.opacity = '1';
        this.floatingUI.appendChild(content);

        // Make draggable
        this.makeDraggable(header);

        // Add to page
        document.body.appendChild(this.floatingUI);

        return this.floatingUI;
    }

    /**
     * Create header with title and navigation
     */
    createHeader() {
        const header = document.createElement('div');
        header.id = 'enhancementPanelHeader';
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move',
            padding: '10px 15px',
            background: STYLE.colors.headerBg,
            borderBottom: `1px solid ${STYLE.colors.border}`,
            userSelect: 'none',
            flexShrink: '0',
        });

        // Title with session counter
        const titleContainer = document.createElement('div');
        titleContainer.style.display = 'flex';
        titleContainer.style.alignItems = 'center';
        titleContainer.style.gap = '10px';

        const title = document.createElement('span');
        title.textContent = 'Enhancement Tracker';
        title.style.fontWeight = 'bold';

        const sessionCounter = document.createElement('span');
        sessionCounter.id = 'enhancementSessionCounter';
        sessionCounter.style.fontSize = '12px';
        sessionCounter.style.opacity = '0.7';
        sessionCounter.style.marginLeft = '5px';

        titleContainer.appendChild(title);
        titleContainer.appendChild(sessionCounter);

        // Navigation container
        const navContainer = document.createElement('div');
        Object.assign(navContainer.style, {
            display: 'flex',
            gap: '5px',
            alignItems: 'center',
            marginLeft: 'auto',
        });

        // Previous session button
        const prevButton = this.createNavButton('◀', () => this.navigateSession(-1));

        // Next session button
        const nextButton = this.createNavButton('▶', () => this.navigateSession(1));

        // Collapse button
        const collapseButton = this.createCollapseButton();

        // Clear sessions button
        const clearButton = this.createClearButton();

        navContainer.appendChild(prevButton);
        navContainer.appendChild(nextButton);
        navContainer.appendChild(collapseButton);
        navContainer.appendChild(clearButton);

        header.appendChild(titleContainer);
        header.appendChild(navContainer);

        return header;
    }

    /**
     * Create navigation button
     */
    createNavButton(text, onClick) {
        const button = document.createElement('button');
        button.textContent = text;
        Object.assign(button.style, {
            background: 'none',
            border: 'none',
            color: STYLE.colors.textPrimary,
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 8px',
            borderRadius: '3px',
            transition: STYLE.transitions.fast,
        });

        button.addEventListener('mouseover', () => {
            button.style.color = STYLE.colors.accent;
            button.style.background = 'rgba(255, 0, 212, 0.1)';
        });
        button.addEventListener('mouseout', () => {
            button.style.color = STYLE.colors.textPrimary;
            button.style.background = 'none';
        });
        button.addEventListener('click', onClick);

        return button;
    }

    /**
     * Create clear sessions button
     */
    createClearButton() {
        const button = document.createElement('button');
        button.innerHTML = '🗑️';
        button.title = 'Clear all sessions';
        Object.assign(button.style, {
            background: 'none',
            border: 'none',
            color: STYLE.colors.textPrimary,
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 8px',
            borderRadius: '3px',
            transition: STYLE.transitions.fast,
            marginLeft: '5px',
        });

        button.addEventListener('mouseover', () => {
            button.style.color = STYLE.colors.danger;
            button.style.background = 'rgba(255, 0, 0, 0.1)';
        });
        button.addEventListener('mouseout', () => {
            button.style.color = STYLE.colors.textPrimary;
            button.style.background = 'none';
        });
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Clear all enhancement sessions?')) {
                this.clearAllSessions();
            }
        });

        return button;
    }

    /**
     * Create collapse button
     */
    createCollapseButton() {
        const button = document.createElement('button');
        button.id = 'enhancementCollapseButton';
        button.innerHTML = '▼';
        button.title = 'Collapse panel';
        Object.assign(button.style, {
            background: 'none',
            border: 'none',
            color: STYLE.colors.textPrimary,
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 8px',
            borderRadius: '3px',
            transition: STYLE.transitions.fast,
        });

        button.addEventListener('mouseover', () => {
            button.style.color = STYLE.colors.accent;
            button.style.background = 'rgba(255, 0, 212, 0.1)';
        });
        button.addEventListener('mouseout', () => {
            button.style.color = STYLE.colors.textPrimary;
            button.style.background = 'none';
        });
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse();
        });

        return button;
    }

    /**
     * Make element draggable
     */
    makeDraggable(header) {
        let offsetX = 0;
        let offsetY = 0;

        const onMouseMove = (event) => {
            if (this.isDragging) {
                const newLeft = event.clientX - offsetX;
                const newTop = event.clientY - offsetY;

                // Use absolute positioning during drag
                this.floatingUI.style.left = `${newLeft}px`;
                this.floatingUI.style.right = 'auto';
                this.floatingUI.style.top = `${newTop}px`;
            }
        };

        const onMouseUp = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this.dragMoveHandler = null;
            this.dragUpHandler = null;
        };

        const onMouseDown = (event) => {
            this.isDragging = true;

            // Calculate offset from panel's current screen position
            const rect = this.floatingUI.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            this.dragMoveHandler = onMouseMove;
            this.dragUpHandler = onMouseUp;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        if (this.dragHandle && this.dragMouseDownHandler) {
            this.dragHandle.removeEventListener('mousedown', this.dragMouseDownHandler);
        }

        this.dragHandle = header;
        this.dragMouseDownHandler = onMouseDown;

        header.addEventListener('mousedown', onMouseDown);
    }

    /**
     * Toggle panel collapse state
     */
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        const content = document.getElementById('enhancementPanelContent');
        const button = document.getElementById('enhancementCollapseButton');

        if (this.isCollapsed) {
            // Collapsed state
            content.style.maxHeight = '0px';
            content.style.opacity = '0';
            content.style.padding = '0 15px';
            button.innerHTML = '▶';
            button.title = 'Expand panel';
            this.floatingUI.style.width = '250px';

            // Show compact summary after content fades
            const summaryTimeout = setTimeout(() => {
                this.showCollapsedSummary();
            }, 200);
            this.timerRegistry.registerTimeout(summaryTimeout);
        } else {
            // Expanded state
            this.hideCollapsedSummary();
            content.style.maxHeight = '600px';
            content.style.opacity = '1';
            content.style.padding = '15px';
            button.innerHTML = '▼';
            button.title = 'Collapse panel';
            this.floatingUI.style.width = '350px';
        }
    }

    /**
     * Show compact summary in collapsed state
     */
    showCollapsedSummary() {
        if (!this.isCollapsed) return;

        const session = this.getCurrentSession();
        const sessions = Object.values(enhancementTracker.getAllSessions());

        // Remove any existing summary
        this.hideCollapsedSummary();

        if (sessions.length === 0 || !session) return;

        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData?.itemDetailMap?.[session.itemHrid];
        const itemName = itemDetails?.name || 'Unknown Item';

        const totalAttempts = session.totalAttempts;
        const totalSuccess = session.totalSuccesses;
        const successRate = totalAttempts > 0 ? Math.floor((totalSuccess / totalAttempts) * 100) : 0;
        const statusIcon = session.state === SessionState.COMPLETED ? '✅' : '🟢';

        const summary = document.createElement('div');
        summary.id = 'enhancementCollapsedSummary';
        Object.assign(summary.style, {
            padding: '10px 15px',
            fontSize: '12px',
            borderTop: `1px solid ${STYLE.colors.border}`,
            color: STYLE.colors.textPrimary,
        });

        summary.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">${itemName} → +${session.targetLevel}</div>
            <div style="opacity: 0.8;">${statusIcon} ${totalAttempts} attempts | ${successRate}% rate</div>
        `;

        this.floatingUI.appendChild(summary);
    }

    /**
     * Hide collapsed summary
     */
    hideCollapsedSummary() {
        const summary = document.getElementById('enhancementCollapsedSummary');
        if (summary) {
            summary.remove();
        }
    }

    /**
     * Navigate between sessions
     */
    navigateSession(direction) {
        const sessions = Object.values(enhancementTracker.getAllSessions());
        if (sessions.length === 0) return;

        this.currentViewingIndex += direction;

        // Wrap around
        if (this.currentViewingIndex < 0) {
            this.currentViewingIndex = sessions.length - 1;
        } else if (this.currentViewingIndex >= sessions.length) {
            this.currentViewingIndex = 0;
        }

        this.updateUI();

        // Update collapsed summary if in collapsed state
        if (this.isCollapsed) {
            this.showCollapsedSummary();
        }
    }

    /**
     * Clear all sessions
     */
    async clearAllSessions() {
        // Clear from tracker
        const sessions = enhancementTracker.getAllSessions();
        for (const sessionId of Object.keys(sessions)) {
            delete sessions[sessionId];
        }

        await enhancementTracker.saveSessions();

        this.currentViewingIndex = 0;
        this.updateUI();

        // Hide collapsed summary if shown
        if (this.isCollapsed) {
            this.hideCollapsedSummary();
        }
    }

    /**
     * Update UI content (debounced)
     */
    scheduleUpdate() {
        if (this.updateDebounce) {
            clearTimeout(this.updateDebounce);
        }
        this.updateDebounce = setTimeout(() => this.updateUI(), 100);
        this.timerRegistry.registerTimeout(this.updateDebounce);
    }

    /**
     * Update UI content (immediate)
     */
    updateUI() {
        if (!this.floatingUI || !document.body.contains(this.floatingUI)) {
            return;
        }

        const content = document.getElementById('enhancementPanelContent');
        if (!content) return;

        // Update session counter
        this.updateSessionCounter();

        const sessions = Object.values(enhancementTracker.getAllSessions());

        // No sessions
        if (sessions.length === 0) {
            content.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: ${STYLE.colors.textSecondary};">
                    <div style="font-size: 32px; margin-bottom: 10px;">✧</div>
                    <div style="font-size: 14px;">Begin enhancing to populate data</div>
                </div>
            `;
            return;
        }

        const session = this.getCurrentSession();
        if (!session) {
            content.innerHTML = '<div style="text-align: center; color: ${STYLE.colors.danger};">Invalid session</div>';
            return;
        }

        // Remember expanded state before updating
        const detailsId = `cost-details-${session.id}`;
        const detailsElement = document.getElementById(detailsId);
        const wasExpanded = detailsElement && detailsElement.style.display !== 'none';

        // Build UI content
        content.innerHTML = this.generateSessionHTML(session);

        // Restore expanded state after updating
        if (wasExpanded) {
            const newDetailsElement = document.getElementById(detailsId);
            if (newDetailsElement) {
                newDetailsElement.style.display = 'block';
            }
        }

        // Update collapsed summary if in collapsed state
        if (this.isCollapsed) {
            this.showCollapsedSummary();
        }
    }

    /**
     * Update session counter in header
     */
    updateSessionCounter() {
        const counter = document.getElementById('enhancementSessionCounter');
        if (!counter) return;

        const sessions = Object.values(enhancementTracker.getAllSessions());
        if (sessions.length === 0) {
            counter.textContent = '';
        } else {
            counter.textContent = `(${this.currentViewingIndex + 1}/${sessions.length})`;
        }
    }

    /**
     * Generate HTML for session display
     */
    generateSessionHTML(session) {
        const gameData = dataManager.getInitClientData();
        const itemDetails = gameData?.itemDetailMap?.[session.itemHrid];
        const itemName = itemDetails?.name || 'Unknown Item';

        // Calculate stats
        const totalAttempts = session.totalAttempts;
        const totalSuccess = session.totalSuccesses;
        const _totalFailure = session.totalFailures;
        const _successRate = totalAttempts > 0 ? formatPercentage(totalSuccess / totalAttempts, 1) : '0.0%';

        const duration = getSessionDuration(session);
        const durationText = this.formatDuration(duration);

        // Calculate XP/hour if we have enough data (at least 5 seconds + some XP)
        const xpPerHour = duration >= 5 && session.totalXP > 0 ? Math.floor((session.totalXP / duration) * 3600) : 0;

        // Status display
        const statusColor = session.state === SessionState.COMPLETED ? STYLE.colors.success : STYLE.colors.accent;
        const statusText = session.state === SessionState.COMPLETED ? 'Completed' : 'In Progress';

        // Build HTML
        let html = `
            <div style="margin-bottom: 10px; font-size: 13px;">
                <div style="display: flex; justify-content: space-between;">
                    <span>Item:</span>
                    <strong>${itemName}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Target:</span>
                    <span>+${session.targetLevel}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Prot:</span>
                    <span>+${session.protectFrom}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 5px; color: ${statusColor};">
                    <span>Status:</span>
                    <strong>${statusText}</strong>
                </div>
            </div>
        `;

        // Per-level table
        html += this.generateLevelTable(session);

        // Summary stats
        html += `
            <div style="margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <div>
                        <span>Total Attempts:</span>
                        <strong> ${totalAttempts}</strong>
                    </div>
                    <div>
                        <span>Prots Used:</span>
                        <strong> ${session.protectionCount || 0}</strong>
                    </div>
                </div>
            </div>`;

        // Predictions (if available)
        if (session.predictions) {
            const predictions = session.predictions;
            const expAtt = predictions.expectedAttempts || 0;
            const expProt = predictions.expectedProtections || 0;
            const actualProt = session.protectionCount || 0;

            // Calculate factors (like Ultimate Tracker)
            const attFactor = expAtt > 0 ? (totalAttempts / expAtt).toFixed(2) : null;
            const protFactor = expProt > 0 ? (actualProt / expProt).toFixed(2) : null;

            html += `
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px;">
                <div style="color: ${STYLE.colors.textSecondary};">
                    <span>Expected Attempts:</span>
                    <span> ${expAtt}</span>
                </div>
                <div style="color: ${STYLE.colors.textSecondary};">
                    <span>Expected Prots:</span>
                    <span> ${expProt}</span>
                </div>
            </div>`;

            if (attFactor || protFactor) {
                html += `
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 2px; color: ${STYLE.colors.textSecondary};">
                <div>
                    <span>Attempt Factor:</span>
                    <strong> ${attFactor ? attFactor + 'x' : '—'}</strong>
                </div>
                <div>
                    <span>Prot Factor:</span>
                    <strong> ${protFactor ? protFactor + 'x' : '—'}</strong>
                </div>
            </div>`;
            }
        }

        html += `
            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>Total XP Gained:</span>
                <strong>${this.formatNumber(session.totalXP)}</strong>
            </div>

            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>Session Duration:</span>
                <strong>${durationText}</strong>
            </div>

            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>XP/Hour:</span>
                <strong>${xpPerHour > 0 ? this.formatNumber(xpPerHour) : 'Calculating...'}</strong>
            </div>
        `;

        // Material costs
        html += this.generateMaterialCostsHTML(session);

        return html;
    }

    /**
     * Generate per-level breakdown table
     */
    generateLevelTable(session) {
        const levels = Object.keys(session.attemptsPerLevel).sort((a, b) => b - a);

        if (levels.length === 0) {
            return '<div style="text-align: center; padding: 20px; color: ${STYLE.colors.textSecondary};">No attempts recorded yet</div>';
        }

        let rows = '';
        for (const level of levels) {
            const levelData = session.attemptsPerLevel[level];
            const rate = formatPercentage(levelData.successRate, 1);
            const isCurrent = parseInt(level) === session.currentLevel;

            const rowStyle = isCurrent
                ? `
                background: linear-gradient(90deg, rgba(126, 87, 194, 0.25), rgba(0, 242, 255, 0.1));
                box-shadow: 0 0 12px rgba(126, 87, 194, 0.5), inset 0 0 6px rgba(0, 242, 255, 0.3);
                border-left: 3px solid ${STYLE.colors.accent};
                font-weight: bold;
            `
                : '';

            rows += `
                <tr style="${rowStyle}">
                    <td style="${compactCellStyle} text-align: center;">${level}</td>
                    <td style="${compactCellStyle} text-align: right;">${levelData.success}</td>
                    <td style="${compactCellStyle} text-align: right;">${levelData.fail}</td>
                    <td style="${compactCellStyle} text-align: right;">${rate}</td>
                </tr>
            `;
        }

        return `
            <table style="${compactTableStyle}">
                <thead>
                    <tr>
                        <th style="${compactHeaderStyle}">Lvl</th>
                        <th style="${compactHeaderStyle}">Success</th>
                        <th style="${compactHeaderStyle}">Fail</th>
                        <th style="${compactHeaderStyle}">%</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    /**
     * Generate material costs HTML (expandable)
     */
    generateMaterialCostsHTML(session) {
        // Check if there are any costs to display
        const hasMaterials = session.materialCosts && Object.keys(session.materialCosts).length > 0;
        const hasCoins = session.coinCost > 0;
        const hasProtection = session.protectionCost > 0;

        if (!hasMaterials && !hasCoins && !hasProtection) {
            return '';
        }

        const gameData = dataManager.getInitClientData();
        const detailsId = `cost-details-${session.id}`;

        let html = '<div style="margin-top: 12px; font-size: 13px;">';

        // Collapsible header
        html += `
            <div style="display: flex; justify-content: space-between; cursor: pointer; font-weight: bold; padding: 5px 0;"
                 onclick="document.getElementById('${detailsId}').style.display = document.getElementById('${detailsId}').style.display === 'none' ? 'block' : 'none'">
                <span>💰 Total Cost (click for details)</span>
                <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.totalCost)}</span>
            </div>
        `;

        // Expandable details section (hidden by default)
        html += `<div id="${detailsId}" style="display: none; margin-left: 10px; margin-top: 5px;">`;

        // Material costs
        if (hasMaterials) {
            html +=
                '<div style="margin-bottom: 8px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">';
            html +=
                '<div style="font-weight: bold; margin-bottom: 3px; color: ${STYLE.colors.textSecondary};">Materials:</div>';

            for (const [itemHrid, data] of Object.entries(session.materialCosts)) {
                const itemDetails = gameData?.itemDetailMap?.[itemHrid];
                const itemName = itemDetails?.name || itemHrid;
                const unitCost = Math.floor(data.totalCost / data.count);

                html += `
                    <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 12px;">
                        <span>${itemName}</span>
                        <span>${data.count} × ${this.formatNumber(unitCost)} = <span style="color: ${STYLE.colors.gold};">${this.formatNumber(data.totalCost)}</span></span>
                    </div>
                `;
            }
            html += '</div>';
        }

        // Coin costs
        if (hasCoins) {
            html += `
                <div style="display: flex; justify-content: space-between; margin-top: 2px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">
                    <span style="font-weight: bold; color: ${STYLE.colors.textSecondary};">Coins (${session.coinCount || 0}×):</span>
                    <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.coinCost)}</span>
                </div>
            `;
        }

        // Protection costs
        if (hasProtection) {
            const protectionItemName = session.protectionItemHrid
                ? gameData?.itemDetailMap?.[session.protectionItemHrid]?.name || 'Protection'
                : 'Protection';

            html += `
                <div style="display: flex; justify-content: space-between; margin-top: 2px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">
                    <span style="font-weight: bold; color: ${STYLE.colors.textSecondary};">${protectionItemName} (${session.protectionCount || 0}×):</span>
                    <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.protectionCost)}</span>
                </div>
            `;
        }

        html += '</div>'; // Close details
        html += '</div>'; // Close container

        return html;
    }

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return Math.floor(num).toLocaleString();
    }

    /**
     * Format duration (seconds to h:m:s)
     */
    formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        if (h > 0) {
            return `${h}h ${m}m ${s}s`;
        } else if (m > 0) {
            return `${m}m ${s}s`;
        } else {
            return `${s}s`;
        }
    }

    /**
     * Show the UI
     */
    show() {
        if (this.floatingUI) {
            this.floatingUI.style.display = 'flex';
        }
    }

    /**
     * Hide the UI
     */
    hide() {
        if (this.floatingUI) {
            this.floatingUI.style.display = 'none';
        }
    }

    /**
     * Toggle UI visibility
     */
    toggle() {
        if (this.floatingUI) {
            const isVisible = this.floatingUI.style.display !== 'none';
            if (isVisible) {
                this.hide();
            } else {
                this.show();
            }
        }
    }

    /**
     * Cleanup all UI resources
     */
    cleanup() {
        // Clear any pending update debounces
        if (this.updateDebounce) {
            clearTimeout(this.updateDebounce);
            this.updateDebounce = null;
        }

        // Clear poll interval
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Unregister DOM observer
        if (this.unregisterScreenObserver) {
            this.unregisterScreenObserver();
            this.unregisterScreenObserver = null;
        }

        if (this.dragMoveHandler) {
            document.removeEventListener('mousemove', this.dragMoveHandler);
            this.dragMoveHandler = null;
        }

        if (this.dragUpHandler) {
            document.removeEventListener('mouseup', this.dragUpHandler);
            this.dragUpHandler = null;
        }

        if (this.dragHandle && this.dragMouseDownHandler) {
            this.dragHandle.removeEventListener('mousedown', this.dragMouseDownHandler);
        }

        this.dragHandle = null;
        this.dragMouseDownHandler = null;

        this.timerRegistry.clearAll();

        // Remove floating UI from DOM
        if (this.floatingUI && this.floatingUI.parentNode) {
            this.floatingUI.parentNode.removeChild(this.floatingUI);
            this.floatingUI = null;
        }

        // Reset state
        this.isOnEnhancingScreen = false;
        this.isCollapsed = false;
        this.currentViewingIndex = 0;
        this.isDragging = false;
    }
}

const enhancementUI = new EnhancementUI();

export default enhancementUI;
