/**
 * Task Icons
 * Adds visual icon overlays to task cards
 */

import { GAME } from '../../utils/selectors.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import webSocketHook from '../../core/websocket.js';
import taskIconFilters from './task-icon-filters.js';

class TaskIcons {
    constructor() {
        this.initialized = false;
        this.observers = [];
        this.characterSwitchingHandler = null;

        // SVG sprite paths (from game assets)
        this.SPRITES = {
            ITEMS: '/static/media/items_sprite.328d6606.svg',
            ACTIONS: '/static/media/actions_sprite.e6388cbc.svg',
            MONSTERS: '/static/media/combat_monsters_sprite.75d964d1.svg',
        };

        // Cache for parsed game data
        this.itemsByHrid = null;
        this.actionsByHrid = null;
        this.monstersByHrid = null;
    }

    /**
     * Initialize the task icons feature
     */
    initialize() {
        if (this.initialized) return;

        // Load game data from DataManager
        this.loadGameData();

        // Watch for task cards being added/updated
        this.watchTaskCards();

        // Store handler reference for cleanup
        this.characterSwitchingHandler = () => {
            this.cleanup();
        };

        // Listen for character switching to clean up
        dataManager.on('character_switching', this.characterSwitchingHandler);

        // Listen for filter changes to refresh icons
        this.filterChangeHandler = () => {
            this.refreshAllIcons();
        };
        document.addEventListener('mwi-task-icon-filter-changed', this.filterChangeHandler);

        this.initialized = true;
    }

    /**
     * Load game data from DataManager
     */
    loadGameData() {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return;
        }

        // Build lookup maps for quick access
        this.itemsByHrid = new Map();
        this.actionsByHrid = new Map();
        this.monstersByHrid = new Map();
        this.locationsByHrid = new Map();

        // Index items
        if (gameData.itemDetailMap) {
            Object.entries(gameData.itemDetailMap).forEach(([hrid, item]) => {
                this.itemsByHrid.set(hrid, item);
            });
        }

        // Index actions
        if (gameData.actionDetailMap) {
            Object.entries(gameData.actionDetailMap).forEach(([hrid, action]) => {
                this.actionsByHrid.set(hrid, action);
            });
        }

        // Index monsters
        if (gameData.combatMonsterDetailMap) {
            Object.entries(gameData.combatMonsterDetailMap).forEach(([hrid, monster]) => {
                this.monstersByHrid.set(hrid, monster);
            });
        }
    }

    /**
     * Watch for task cards in the DOM
     */
    watchTaskCards() {
        // Process existing task cards
        this.processAllTaskCards();

        // Watch for task list appearing
        const unregisterTaskList = domObserver.onClass('TaskIcons-TaskList', 'TasksPanel_taskList', () => {
            this.processAllTaskCards();
        });
        this.observers.push(unregisterTaskList);

        // Watch for individual task cards appearing
        const unregisterTask = domObserver.onClass('TaskIcons-Task', 'RandomTask_randomTask', () => {
            this.processAllTaskCards();
        });
        this.observers.push(unregisterTask);

        // Watch for task rerolls via WebSocket
        const questsHandler = (data) => {
            if (!data.endCharacterQuests) {
                return;
            }

            // Wait for game to update DOM before updating icons
            setTimeout(() => {
                this.clearAllProcessedMarkers();
                this.processAllTaskCards();
            }, 250);
        };

        webSocketHook.on('quests_updated', questsHandler);

        // Store handler for cleanup
        this.observers.push(() => {
            webSocketHook.off('quests_updated', questsHandler);
        });
    }

    /**
     * Process all task cards in the DOM
     */
    processAllTaskCards() {
        const taskList = document.querySelector(GAME.TASK_LIST);
        if (!taskList) {
            return;
        }

        // Ensure game data is loaded
        if (!this.itemsByHrid || this.itemsByHrid.size === 0) {
            this.loadGameData();
            if (!this.itemsByHrid || this.itemsByHrid.size === 0) {
                return;
            }
        }

        const taskCards = taskList.querySelectorAll(GAME.TASK_CARD);

        taskCards.forEach((card) => {
            // Get current task name
            const nameElement = card.querySelector(GAME.TASK_NAME);
            if (!nameElement) return;

            const taskName = nameElement.textContent.trim();

            // Check if this card already has icons for this exact task
            const processedTaskName = card.getAttribute('data-mwi-task-processed');

            // Only process if:
            // 1. Card has never been processed, OR
            // 2. Task name has changed (task was rerolled)
            if (processedTaskName !== taskName) {
                // Remove old icons (if any)
                this.removeIcons(card);

                // Add new icons
                this.addIconsToTaskCard(card);

                // Mark card as processed with current task name
                card.setAttribute('data-mwi-task-processed', taskName);
            }
        });
    }

    /**
     * Clear all processed markers to force icon refresh
     */
    clearAllProcessedMarkers() {
        const taskList = document.querySelector(GAME.TASK_LIST);
        if (!taskList) {
            return;
        }

        const taskCards = taskList.querySelectorAll(GAME.TASK_CARD);
        taskCards.forEach((card) => {
            card.removeAttribute('data-mwi-task-processed');
        });
    }

    /**
     * Refresh all icons (called when filters change)
     */
    refreshAllIcons() {
        this.clearAllProcessedMarkers();
        this.processAllTaskCards();
    }

    /**
     * Add icon overlays to a task card
     */
    addIconsToTaskCard(taskCard) {
        // Parse task description to get task type and name
        const taskInfo = this.parseTaskCard(taskCard);
        if (!taskInfo) {
            return;
        }

        // Add appropriate icons based on task type
        if (taskInfo.isCombatTask) {
            this.addMonsterIcon(taskCard, taskInfo);
        } else {
            this.addActionIcon(taskCard, taskInfo);
        }
    }

    /**
     * Parse task card to extract task information
     */
    parseTaskCard(taskCard) {
        const nameElement = taskCard.querySelector(GAME.TASK_NAME);
        if (!nameElement) {
            return null;
        }

        const fullText = nameElement.textContent.trim();

        // Format is "SkillType - TaskName" or "Defeat - MonsterName"
        const match = fullText.match(/^(.+?)\s*-\s*(.+)$/);
        if (!match) {
            return null;
        }

        const [, skillType, taskName] = match;

        const taskInfo = {
            skillType: skillType.trim(),
            taskName: taskName.trim(),
            fullText,
            isCombatTask: skillType.trim() === 'Defeat',
        };

        return taskInfo;
    }

    /**
     * Find action HRID by display name
     */
    findActionHrid(actionName) {
        // Search through actions to find matching name
        for (const [hrid, action] of this.actionsByHrid) {
            if (action.name === actionName) {
                return hrid;
            }
        }
        return null;
    }

    /**
     * Find monster HRID by display name
     */
    findMonsterHrid(monsterName) {
        // Strip zone tier suffix (e.g., "Grizzly BearZ8" → "Grizzly Bear")
        // Format is: MonsterNameZ# where # is the zone index
        const cleanName = monsterName.replace(/Z\d+$/, '').trim();

        // Search through monsters to find matching name
        for (const [hrid, monster] of this.monstersByHrid) {
            if (monster.name === cleanName) {
                return hrid;
            }
        }
        return null;
    }

    /**
     * Add action icon to task card
     */
    addActionIcon(taskCard, taskInfo) {
        const actionHrid = this.findActionHrid(taskInfo.taskName);
        if (!actionHrid) {
            return;
        }

        const action = this.actionsByHrid.get(actionHrid);
        if (!action) {
            return;
        }

        // Determine sprite and icon name
        let spritePath, iconName;

        // Check if action produces a specific item (use item sprite)
        if (action.outputItems && action.outputItems.length > 0) {
            const outputItem = action.outputItems[0];
            const itemHrid = outputItem.itemHrid || outputItem.hrid;
            const item = this.itemsByHrid.get(itemHrid);
            if (item) {
                spritePath = this.SPRITES.ITEMS;
                iconName = itemHrid.split('/').pop();
            }
        }

        // If still no icon, try to find corresponding item for gathering actions
        if (!iconName) {
            // Convert action HRID to item HRID (e.g., /actions/foraging/cow → /items/cow)
            const actionName = actionHrid.split('/').pop();
            const potentialItemHrid = `/items/${actionName}`;
            const potentialItem = this.itemsByHrid.get(potentialItemHrid);

            if (potentialItem) {
                spritePath = this.SPRITES.ITEMS;
                iconName = actionName;
            } else {
                // Fall back to action sprite
                spritePath = this.SPRITES.ACTIONS;
                iconName = actionName;
            }
        }

        this.addIconOverlay(taskCard, spritePath, iconName, 'action');
    }

    /**
     * Add monster icon to task card
     */
    addMonsterIcon(taskCard, taskInfo) {
        const monsterHrid = this.findMonsterHrid(taskInfo.taskName);
        if (!monsterHrid) {
            return;
        }

        // Count dungeons if dungeon icons are enabled
        let dungeonCount = 0;
        if (config.isFeatureEnabled('taskIconsDungeons')) {
            dungeonCount = this.countDungeonsForMonster(monsterHrid);
        }

        // Calculate icon width based on total count (1 monster + N dungeons)
        const totalIcons = 1 + dungeonCount;
        let iconWidth;
        if (totalIcons <= 2) {
            iconWidth = 30;
        } else if (totalIcons <= 4) {
            iconWidth = 25;
        } else {
            iconWidth = 20;
        }

        // Position monster on the right (ends at 100%)
        const monsterPosition = 100 - iconWidth;
        const iconName = monsterHrid.split('/').pop();
        this.addIconOverlay(
            taskCard,
            this.SPRITES.MONSTERS,
            iconName,
            'monster',
            `${monsterPosition}%`,
            `${iconWidth}%`
        );

        // Add dungeon icons if enabled
        if (config.isFeatureEnabled('taskIconsDungeons') && dungeonCount > 0) {
            this.addDungeonIcons(taskCard, monsterHrid, iconWidth);
        }
    }

    /**
     * Count how many dungeons a monster appears in
     */
    countDungeonsForMonster(monsterHrid) {
        let count = 0;

        for (const [_actionHrid, action] of this.actionsByHrid) {
            if (!action.combatZoneInfo?.isDungeon) continue;

            const dungeonInfo = action.combatZoneInfo.dungeonInfo;
            if (!dungeonInfo) continue;

            let monsterFound = false;

            // Check random spawns
            if (dungeonInfo.randomSpawnInfoMap) {
                for (const waveSpawns of Object.values(dungeonInfo.randomSpawnInfoMap)) {
                    if (waveSpawns.spawns) {
                        for (const spawn of waveSpawns.spawns) {
                            if (spawn.combatMonsterHrid === monsterHrid) {
                                monsterFound = true;
                                break;
                            }
                        }
                    }
                    if (monsterFound) break;
                }
            }

            // Check fixed spawns
            if (!monsterFound && dungeonInfo.fixedSpawnsMap) {
                for (const waveSpawns of Object.values(dungeonInfo.fixedSpawnsMap)) {
                    for (const spawn of waveSpawns) {
                        if (spawn.combatMonsterHrid === monsterHrid) {
                            monsterFound = true;
                            break;
                        }
                    }
                    if (monsterFound) break;
                }
            }

            if (monsterFound) {
                count++;
            }
        }

        return count;
    }

    /**
     * Add dungeon icons for a monster
     * @param {HTMLElement} taskCard - Task card element
     * @param {string} monsterHrid - Monster HRID
     * @param {number} iconWidth - Width percentage for each icon
     */
    addDungeonIcons(taskCard, monsterHrid, iconWidth) {
        const monster = this.monstersByHrid.get(monsterHrid);
        if (!monster) return;

        // Find which dungeons this monster appears in
        const dungeonHrids = [];

        for (const [actionHrid, action] of this.actionsByHrid) {
            // Skip non-dungeon actions
            if (!action.combatZoneInfo?.isDungeon) continue;

            const dungeonInfo = action.combatZoneInfo.dungeonInfo;
            if (!dungeonInfo) continue;

            let monsterFound = false;

            // Check random spawns (regular waves)
            if (dungeonInfo.randomSpawnInfoMap) {
                for (const waveSpawns of Object.values(dungeonInfo.randomSpawnInfoMap)) {
                    if (waveSpawns.spawns) {
                        for (const spawn of waveSpawns.spawns) {
                            if (spawn.combatMonsterHrid === monsterHrid) {
                                monsterFound = true;
                                break;
                            }
                        }
                    }
                    if (monsterFound) break;
                }
            }

            // Check fixed spawns (boss waves)
            if (!monsterFound && dungeonInfo.fixedSpawnsMap) {
                for (const waveSpawns of Object.values(dungeonInfo.fixedSpawnsMap)) {
                    for (const spawn of waveSpawns) {
                        if (spawn.combatMonsterHrid === monsterHrid) {
                            monsterFound = true;
                            break;
                        }
                    }
                    if (monsterFound) break;
                }
            }

            if (monsterFound) {
                dungeonHrids.push(actionHrid);
            }
        }

        // Position dungeons right-to-left, starting from left of monster
        const monsterPosition = 100 - iconWidth;
        let position = monsterPosition - iconWidth; // Start one icon to the left of monster

        dungeonHrids.forEach((dungeonHrid) => {
            // Check if this dungeon should be shown based on filter settings
            if (!taskIconFilters.shouldShowDungeonBadge(dungeonHrid)) {
                return; // Skip this dungeon
            }

            const iconName = dungeonHrid.split('/').pop();
            this.addIconOverlay(taskCard, this.SPRITES.ACTIONS, iconName, 'dungeon', `${position}%`, `${iconWidth}%`);
            position -= iconWidth; // Move left for next dungeon
        });
    }

    /**
     * Add icon overlay to task card
     * @param {HTMLElement} taskCard - Task card element
     * @param {string} spritePath - Path to sprite SVG
     * @param {string} iconName - Icon name in sprite
     * @param {string} type - Icon type (action/monster/dungeon)
     * @param {string} leftPosition - Left position percentage
     * @param {string} widthPercent - Width percentage (default: '30%')
     */
    addIconOverlay(taskCard, spritePath, iconName, type, leftPosition = '50%', widthPercent = '30%') {
        // Create container for icon
        const iconDiv = document.createElement('div');
        iconDiv.className = `mwi-task-icon mwi-task-icon-${type}`;
        iconDiv.style.position = 'absolute';
        iconDiv.style.left = leftPosition;
        iconDiv.style.width = widthPercent;
        iconDiv.style.height = '100%';
        iconDiv.style.opacity = '0.3';
        iconDiv.style.pointerEvents = 'none';
        iconDiv.style.zIndex = '0';

        // Create SVG element
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');

        // Create use element to reference sprite
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        const spriteRef = `${spritePath}#${iconName}`;
        use.setAttribute('href', spriteRef);
        svg.appendChild(use);

        iconDiv.appendChild(svg);

        // Ensure task card is positioned relatively
        taskCard.style.position = 'relative';

        // Insert icon before content (so it appears in background)
        const taskContent = taskCard.querySelector(GAME.TASK_CONTENT);
        if (taskContent) {
            taskContent.style.zIndex = '1';
            taskContent.style.position = 'relative';
        }

        taskCard.appendChild(iconDiv);
    }

    /**
     * Remove icons from task card
     */
    removeIcons(taskCard) {
        const existingIcons = taskCard.querySelectorAll('.mwi-task-icon');
        existingIcons.forEach((icon) => icon.remove());
    }

    /**
     * Cleanup
     */
    cleanup() {
        // Unregister all observers
        this.observers.forEach((unregister) => unregister());
        this.observers = [];

        // Remove all icons and data attributes
        document.querySelectorAll('.mwi-task-icon').forEach((icon) => icon.remove());
        document.querySelectorAll('[data-mwi-task-processed]').forEach((card) => {
            card.removeAttribute('data-mwi-task-processed');
        });

        // Clear caches
        this.itemsByHrid = null;
        this.actionsByHrid = null;
        this.monstersByHrid = null;

        this.initialized = false;
    }

    /**
     * Disable and cleanup (called by feature registry during character switch)
     */
    disable() {
        // Remove event listeners
        if (this.characterSwitchingHandler) {
            dataManager.off('character_switching', this.characterSwitchingHandler);
            this.characterSwitchingHandler = null;
        }

        if (this.filterChangeHandler) {
            document.removeEventListener('mwi-task-icon-filter-changed', this.filterChangeHandler);
            this.filterChangeHandler = null;
        }

        // Run cleanup
        this.cleanup();
    }
}

// Create singleton instance
const taskIcons = new TaskIcons();

export default taskIcons;
