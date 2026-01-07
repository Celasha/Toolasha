/**
 * Task Icons
 * Adds visual icon overlays to task cards
 */

import { GAME } from '../../utils/selectors.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';

class TaskIcons {
    constructor() {
        this.initialized = false;
        this.observers = [];

        // SVG sprite paths (from game assets)
        this.SPRITES = {
            ITEMS: '/static/media/items_sprite.328d6606.svg',
            ACTIONS: '/static/media/actions_sprite.e6388cbc.svg',
            MONSTERS: '/static/media/combat_monsters_sprite.75d964d1.svg'
        };

        // Cache for parsed game data
        this.itemsByHrid = null;
        this.actionsByHrid = null;
        this.monstersByHrid = null;
        this.locationsByHrid = null;
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

        // Index locations (for dungeon info)
        if (gameData.locationDetailMap) {
            Object.entries(gameData.locationDetailMap).forEach(([hrid, location]) => {
                this.locationsByHrid.set(hrid, location);
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
        const unregisterTaskList = domObserver.onClass(
            'TaskIcons-TaskList',
            'TasksPanel_taskList',
            () => {
                this.processAllTaskCards();
            }
        );
        this.observers.push(unregisterTaskList);

        // Watch for individual task cards appearing
        const unregisterTask = domObserver.onClass(
            'TaskIcons-Task',
            'RandomTask_randomTask',
            () => {
                this.processAllTaskCards();
            }
        );
        this.observers.push(unregisterTask);
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
            // Remove existing icons first
            const hasIcons = card.querySelector('.mwi-task-icon');
            if (hasIcons) {
                this.removeIcons(card);
            }

            this.addIconsToTaskCard(card);
        });
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
            isCombatTask: skillType.trim() === 'Defeat'
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
        // Search through monsters to find matching name
        for (const [hrid, monster] of this.monstersByHrid) {
            if (monster.name === monsterName) {
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

        const iconName = monsterHrid.split('/').pop();
        this.addIconOverlay(taskCard, this.SPRITES.MONSTERS, iconName, 'monster', '50%');

        // Also add dungeon icons if enabled and monster appears in dungeons
        if (config.isFeatureEnabled('taskIconsDungeons')) {
            this.addDungeonIcons(taskCard, monsterHrid);
        }
    }

    /**
     * Add dungeon icons for a monster
     */
    addDungeonIcons(taskCard, monsterHrid) {
        const monster = this.monstersByHrid.get(monsterHrid);
        if (!monster || !monster.combatDropTable) return;

        // Find which dungeon zones this monster appears in
        const dungeonHrids = [];

        for (const [locationHrid, location] of this.locationsByHrid) {
            // Skip non-dungeon locations
            if (!location.isDungeon) continue;

            // Check if this location's monster drop table includes our monster
            if (location.combatEncounterTable) {
                for (const encounter of location.combatEncounterTable) {
                    if (encounter.monsterHrid === monsterHrid) {
                        dungeonHrids.push(locationHrid);
                        break;
                    }
                }
            }
        }

        // Add icon for each dungeon
        let offset = 35; // Start after monster icon (which is at 5%)
        dungeonHrids.forEach(dungeonHrid => {
            const iconName = dungeonHrid.split('/').pop();
            this.addIconOverlay(taskCard, this.SPRITES.ACTIONS, iconName, 'dungeon', `${offset}%`);
            offset += 30; // Each dungeon icon takes 30% width
        });
    }

    /**
     * Add icon overlay to task card
     */
    addIconOverlay(taskCard, spritePath, iconName, type, leftPosition = '50%') {
        // Create container for icon
        const iconDiv = document.createElement('div');
        iconDiv.className = `mwi-task-icon mwi-task-icon-${type}`;
        iconDiv.style.position = 'absolute';
        iconDiv.style.left = leftPosition;
        iconDiv.style.width = '30%';
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
        existingIcons.forEach(icon => icon.remove());
    }

    /**
     * Cleanup
     */
    cleanup() {
        // Unregister all observers
        this.observers.forEach(unregister => unregister());
        this.observers = [];

        // Remove all icons
        document.querySelectorAll('.mwi-task-icon').forEach(icon => icon.remove());

        this.initialized = false;
    }
}

// Create singleton instance
const taskIcons = new TaskIcons();

export default taskIcons;
