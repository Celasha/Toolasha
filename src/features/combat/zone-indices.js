/**
 * Combat Zone Indices
 * Shows index numbers on combat zone buttons and task cards
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';

/**
 * ZoneIndices class manages zone index display on maps and tasks
 */
class ZoneIndices {
    constructor() {
        this.observer = null;
        this.isActive = false;
        this.debounceTimer = null;
        this.DEBOUNCE_MS = 100; // Wait 100ms after last mutation before processing
        this.monsterZoneCache = null; // Cache monster name -> zone index mapping
    }

    /**
     * Initialize zone indices feature
     */
    initialize() {
        // Check if either feature is enabled
        const taskMapIndexEnabled = config.getSetting('taskMapIndex');
        const mapIndexEnabled = config.getSetting('mapIndex');

        if (!taskMapIndexEnabled && !mapIndexEnabled) {
            return;
        }

        // Build monster->zone cache once on initialization
        if (taskMapIndexEnabled) {
            this.buildMonsterZoneCache();
        }

        // Set up MutationObserver to watch for task cards and map buttons
        this.observer = new MutationObserver((mutations) => {
            // Debounce to prevent excessive re-runs
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        if (taskMapIndexEnabled) {
                            this.addTaskIndices();
                        }
                        if (mapIndexEnabled) {
                            this.addMapIndices();
                        }
                        break;
                    }
                }
            }, this.DEBOUNCE_MS);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Process existing elements
        if (taskMapIndexEnabled) {
            this.addTaskIndices();
        }
        if (mapIndexEnabled) {
            this.addMapIndices();
        }

        this.isActive = true;
    }

    /**
     * Build a cache of monster names to zone indices
     * Run once on initialization to avoid repeated traversals
     */
    buildMonsterZoneCache() {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return;
        }

        this.monsterZoneCache = new Map();

        for (const action of Object.values(gameData.actionDetailMap)) {
            // Only check combat actions
            if (!action.hrid?.includes('/combat/')) {
                continue;
            }

            const categoryHrid = action.category;
            if (!categoryHrid) {
                continue;
            }

            const category = gameData.actionCategoryDetailMap[categoryHrid];
            const zoneIndex = category?.sortIndex;
            if (!zoneIndex) {
                continue;
            }

            // Cache action name -> zone index
            if (action.name) {
                this.monsterZoneCache.set(action.name.toLowerCase(), zoneIndex);
            }

            // Cache boss names -> zone index
            if (action.combatZoneInfo?.fightInfo?.bossSpawns) {
                for (const boss of action.combatZoneInfo.fightInfo.bossSpawns) {
                    const bossHrid = boss.combatMonsterHrid;
                    if (bossHrid) {
                        const bossName = bossHrid.replace('/monsters/', '').replace(/_/g, ' ');
                        this.monsterZoneCache.set(bossName.toLowerCase(), zoneIndex);
                    }
                }
            }
        }
    }

    /**
     * Add zone indices to task cards
     * Shows "Z5" next to monster kill tasks
     */
    addTaskIndices() {
        // Find all task name elements
        const taskNameElements = document.querySelectorAll('div[class*="RandomTask_name"]');

        for (const nameElement of taskNameElements) {
            // Always remove any existing index first (in case task was rerolled)
            const existingIndex = nameElement.querySelector('span.script_taskMapIndex');
            if (existingIndex) {
                existingIndex.remove();
            }

            const taskText = nameElement.textContent;

            // Check if this is a combat task (contains "Kill" or "Defeat")
            if (!taskText.includes('Kill') && !taskText.includes('Defeat')) {
                continue; // Not a combat task, skip
            }

            // Extract monster name from task text
            // Format: "Defeat - Jerry" or "Kill - Monster Name"
            const match = taskText.match(/(?:Kill|Defeat)\s*-\s*(.+)$/);
            if (!match) {
                continue; // Couldn't parse monster name
            }

            const monsterName = match[1].trim();

            // Find the combat action for this monster
            const zoneIndex = this.getZoneIndexForMonster(monsterName);

            if (zoneIndex) {
                // Add index to the name element
                nameElement.insertAdjacentHTML(
                    'beforeend',
                    `<span class="script_taskMapIndex" style="margin-left: 4px; color: ${config.SCRIPT_COLOR_MAIN};">Z${zoneIndex}</span>`
                );
            }
        }
    }

    /**
     * Add sequential indices to combat zone buttons on maps page
     * Shows "1. Zone Name", "2. Zone Name", etc.
     */
    addMapIndices() {
        // Find all combat zone tab buttons
        // Target the vertical tabs in the combat panel
        const buttons = document.querySelectorAll(
            'div.MainPanel_subPanelContainer__1i-H9 div.CombatPanel_tabsComponentContainer__GsQlg div.MuiTabs-root.MuiTabs-vertical button.MuiButtonBase-root.MuiTab-root span.MuiBadge-root'
        );

        if (buttons.length === 0) {
            return;
        }

        let index = 1;
        for (const button of buttons) {
            // Skip if already has index
            if (button.querySelector('span.script_mapIndex')) {
                continue;
            }

            // Add index at the beginning
            button.insertAdjacentHTML(
                'afterbegin',
                `<span class="script_mapIndex" style="color: ${config.SCRIPT_COLOR_MAIN};">${index}. </span>`
            );

            index++;
        }
    }

    /**
     * Get zone index for a monster name
     * @param {string} monsterName - Monster display name
     * @returns {number|null} Zone index or null if not found
     */
    getZoneIndexForMonster(monsterName) {
        // Use cache if available
        if (this.monsterZoneCache) {
            return this.monsterZoneCache.get(monsterName.toLowerCase()) || null;
        }

        // Fallback to direct lookup if cache not built (shouldn't happen)
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return null;
        }

        const normalizedName = monsterName.toLowerCase();

        for (const action of Object.values(gameData.actionDetailMap)) {
            if (!action.hrid?.includes('/combat/')) {
                continue;
            }

            if (action.name?.toLowerCase() === normalizedName) {
                const categoryHrid = action.category;
                if (categoryHrid) {
                    const category = gameData.actionCategoryDetailMap[categoryHrid];
                    if (category?.sortIndex) {
                        return category.sortIndex;
                    }
                }
            }

            if (action.combatZoneInfo?.fightInfo?.bossSpawns) {
                for (const boss of action.combatZoneInfo.fightInfo.bossSpawns) {
                    const bossHrid = boss.combatMonsterHrid;
                    if (bossHrid) {
                        const bossName = bossHrid.replace('/monsters/', '').replace(/_/g, ' ');
                        if (bossName === normalizedName) {
                            const categoryHrid = action.category;
                            if (categoryHrid) {
                                const category = gameData.actionCategoryDetailMap[categoryHrid];
                                if (category?.sortIndex) {
                                    return category.sortIndex;
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Disable the feature
     */
    disable() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Clear debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        // Remove all added indices
        const taskIndices = document.querySelectorAll('span.script_taskMapIndex');
        for (const span of taskIndices) {
            span.remove();
        }

        const mapIndices = document.querySelectorAll('span.script_mapIndex');
        for (const span of mapIndices) {
            span.remove();
        }

        // Clear cache
        this.monsterZoneCache = null;
        this.isActive = false;
    }
}

// Create and export singleton instance
const zoneIndices = new ZoneIndices();

export default zoneIndices;
