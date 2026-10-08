/**
 * Dungeon Tracker UI State Management
 * Handles loading, saving, and managing UI state
 */

import storage from '../../core/storage.js';
import config from '../../core/config.js';

class DungeonTrackerUIState {
    constructor() {
        // Collapse/expand states
        this.isCollapsed = false;
        this.isKeysExpanded = false;
        this.isRunHistoryExpanded = false;
        this.isChartExpanded = true; // Default: expanded

        // Position state
        this.position = null; // { x, y } or null for default

        // Size state (custom width in px, only honored while expanded; null = default)
        this.width = null;

        // Grouping and filtering state
        this.groupBy = 'team'; // 'team' or 'dungeon'
        this.filterDungeon = 'all'; // 'all' or specific dungeon name
        this.filterTeam = 'all'; // 'all' or specific team key

        // Track expanded groups to preserve state across refreshes
        this.expandedGroups = new Set();
    }

    /**
     * Load saved state from storage
     */
    async load() {
        const savedState = await storage.getJSON('dungeonTracker_uiState', 'settings', null);
        if (savedState) {
            this.isCollapsed = savedState.isCollapsed || false;
            this.isKeysExpanded = savedState.isKeysExpanded || false;
            this.isRunHistoryExpanded = savedState.isRunHistoryExpanded || false;
            this.position = savedState.position || null;
            this.width = savedState.width || null;

            // Load grouping/filtering state
            this.groupBy = savedState.groupBy || 'team';
            this.filterDungeon = savedState.filterDungeon || 'all';
            this.filterTeam = savedState.filterTeam || 'all';
        }
    }

    /**
     * Save current state to storage
     */
    async save() {
        await storage.setJSON(
            'dungeonTracker_uiState',
            {
                isCollapsed: this.isCollapsed,
                isKeysExpanded: this.isKeysExpanded,
                isRunHistoryExpanded: this.isRunHistoryExpanded,
                position: this.position,
                width: this.width,
                groupBy: this.groupBy,
                filterDungeon: this.filterDungeon,
                filterTeam: this.filterTeam,
            },
            'settings',
            true
        );
    }

    /**
     * Update container position and styling
     * @param {HTMLElement} container - Container element
     */
    updatePosition(container) {
        const zIndex = this.isCollapsed ? config.Z_HUD : config.Z_FLOATING_PANEL;
        const baseStyle = `
            position: fixed;
            z-index: ${zIndex};
            box-sizing: border-box;
            background: rgba(0, 0, 0, 0.85);
            border: 2px solid #4a9eff;
            border-radius: 8px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Custom width applies in both collapsed and expanded modes (shared with position,
        // which is likewise unified across modes rather than tracked separately per mode).
        const defaultWidth = this.isCollapsed ? 250 : 480;
        const targetWidth = this.width || defaultWidth;
        const widthStyle = `width: min(${targetWidth}px, calc(100vw - 20px));`;

        if (this.position) {
            // Custom position (user dragged it)
            container.style.cssText = `
                ${baseStyle}
                top: ${this.position.y}px;
                left: ${this.position.x}px;
                ${widthStyle}
            `;
        } else if (this.isCollapsed) {
            // Collapsed: top-left (near action time display)
            container.style.cssText = `
                ${baseStyle}
                top: 10px;
                left: 10px;
                ${widthStyle}
            `;
        } else {
            // Expanded: top-center
            container.style.cssText = `
                ${baseStyle}
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                ${widthStyle}
            `;
        }
    }
}

const dungeonTrackerUIState = new DungeonTrackerUIState();

export default dungeonTrackerUIState;
