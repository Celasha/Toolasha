/**
 * Task Icon Filters
 *
 * Adds clickable filter icons to the task panel header for controlling
 * which task icons are displayed. Based on MWI Task Manager implementation.
 *
 * Features:
 * - Battle icon toggle (shows/hides all combat task icons)
 * - Individual dungeon toggles (4 dungeons)
 * - Visual state indication (opacity 1.0 = active, 0.3 = inactive)
 * - Task count badges on each icon
 * - Persistent filter state across sessions
 * - Event-driven updates when filters change
 */

import { GAME } from '../../utils/selectors.js';

class TaskIconFilters {
    constructor() {
        this.filterIcons = new Map(); // Map of filter ID -> DOM element
        this.currentCounts = new Map(); // Map of filter ID -> task count
        this.taskListObserver = null;

        // Dungeon configuration matching game data
        this.dungeonConfig = {
            '/actions/combat/chimerical_den': {
                id: 'chimerical_den',
                name: 'Chimerical Den',
                spriteId: 'chimerical_den',
            },
            '/actions/combat/sinister_circus': {
                id: 'sinister_circus',
                name: 'Sinister Circus',
                spriteId: 'sinister_circus',
            },
            '/actions/combat/enchanted_fortress': {
                id: 'enchanted_fortress',
                name: 'Enchanted Fortress',
                spriteId: 'enchanted_fortress',
            },
            '/actions/combat/pirate_cove': {
                id: 'pirate_cove',
                name: 'Pirate Cove',
                spriteId: 'pirate_cove',
            },
        };
    }

    /**
     * Initialize the task icon filters feature
     */
    initialize() {
        console.log('[TaskIconFilters] Initializing task icon filters');
        // Note: Filter bar is added by task-sorter.js when task panel appears
    }

    /**
     * Cleanup when feature is disabled
     */
    cleanup() {
        console.log('[TaskIconFilters] Cleaning up task icon filters');

        // Disconnect task list observer
        if (this.taskListObserver) {
            this.taskListObserver.disconnect();
            this.taskListObserver = null;
        }

        // Remove all filter icons from DOM
        this.filterIcons.forEach((element) => {
            element.remove();
        });
        this.filterIcons.clear();
        this.currentCounts.clear();
    }

    /**
     * Add filter icon bar to task panel header
     * Called by task-sorter.js when task panel appears
     * @param {HTMLElement} headerElement - Task panel header element
     */
    addFilterBar(headerElement) {
        // Check if we already added filters to this header
        if (headerElement.querySelector('[data-mwi-task-filters]')) {
            return;
        }

        // Find the task panel container to observe task list
        // DOM structure: Grandparent > TaskBoardInfo (parent) > TaskSlotCount (header)
        //                Grandparent > TaskList (sibling to TaskBoardInfo)
        // So we need to go up two levels to find the common container
        const panel = headerElement.parentElement?.parentElement;
        if (!panel) {
            console.warn('[TaskIconFilters] Could not find task panel grandparent');
            return;
        }

        // Create container for filter icons
        const filterBar = document.createElement('div');
        filterBar.setAttribute('data-mwi-task-filters', 'true');
        filterBar.style.display = 'flex';
        filterBar.style.gap = '8px';
        filterBar.style.alignItems = 'center';
        filterBar.style.marginLeft = '8px';

        // Create battle icon
        const battleIcon = this.createFilterIcon(
            'battle',
            'Battle',
            '/static/media/misc_sprite.426c5d78.svg#combat',
            () => this.getBattleFilterEnabled()
        );
        filterBar.appendChild(battleIcon);
        this.filterIcons.set('battle', battleIcon);

        // Create dungeon icons
        Object.entries(this.dungeonConfig).forEach(([hrid, dungeon]) => {
            const dungeonIcon = this.createFilterIcon(
                dungeon.id,
                dungeon.name,
                `/static/media/actions_sprite.e6388cbc.svg#${dungeon.spriteId}`,
                () => this.getDungeonFilterEnabled(hrid)
            );
            filterBar.appendChild(dungeonIcon);
            this.filterIcons.set(dungeon.id, dungeonIcon);
        });

        // Insert filter bar after the task sort button (if it exists)
        const sortButton = headerElement.querySelector('[data-mwi-task-sort]');
        if (sortButton) {
            sortButton.parentNode.insertBefore(filterBar, sortButton.nextSibling);
        } else {
            headerElement.appendChild(filterBar);
        }

        // Initial count update
        this.updateCounts(panel);

        // Start observing task list for count updates
        this.observeTaskList(panel);
    }

    /**
     * Create a clickable filter icon with count badge
     * @param {string} id - Unique identifier for this filter
     * @param {string} title - Tooltip text
     * @param {string} spriteHref - SVG sprite reference
     * @param {Function} getEnabled - Function to check if filter is enabled
     * @returns {HTMLElement} Filter icon container
     */
    createFilterIcon(id, title, spriteHref, getEnabled) {
        const container = document.createElement('div');
        container.setAttribute('data-filter-id', id);
        container.style.position = 'relative';
        container.style.cursor = 'pointer';
        container.style.userSelect = 'none';
        container.title = title;

        // Create SVG icon
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        svg.setAttribute('viewBox', '0 0 1024 1024');
        svg.style.display = 'block';
        svg.style.transition = 'opacity 0.2s';

        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', spriteHref);
        svg.appendChild(use);
        container.appendChild(svg);

        // Create count badge
        const countBadge = document.createElement('span');
        countBadge.setAttribute('data-count-badge', 'true');
        countBadge.style.position = 'absolute';
        countBadge.style.top = '-4px';
        countBadge.style.right = '-8px';
        countBadge.style.fontSize = '11px';
        countBadge.style.fontWeight = 'bold';
        countBadge.style.color = '#fff';
        countBadge.style.textShadow = '0 0 2px #000, 0 0 2px #000';
        countBadge.style.pointerEvents = 'none';
        countBadge.style.transition = 'opacity 0.2s';
        countBadge.textContent = '*0';
        container.appendChild(countBadge);

        // Click handler
        container.addEventListener('click', () => {
            this.handleFilterClick(id);
        });

        // Set initial state
        this.updateIconState(container, getEnabled());

        return container;
    }

    /**
     * Handle filter icon click
     * @param {string} filterId - ID of the filter that was clicked
     */
    handleFilterClick(filterId) {
        if (filterId === 'battle') {
            // Toggle battle filter
            const currentState = this.getBattleFilterEnabled();
            localStorage.setItem('mwi-taskIconsFilterBattle', (!currentState).toString());
        } else {
            // Toggle dungeon filter
            const dungeonHrid = Object.keys(this.dungeonConfig).find(
                (hrid) => this.dungeonConfig[hrid].id === filterId
            );
            if (dungeonHrid) {
                const currentState = this.getDungeonFilterEnabled(dungeonHrid);
                localStorage.setItem(`mwi-taskIconsFilter-${filterId}`, (!currentState).toString());
            }
        }

        // Update all icon states
        this.updateAllIconStates();

        // Dispatch custom event to notify other components
        document.dispatchEvent(
            new CustomEvent('mwi-task-icon-filter-changed', {
                detail: {
                    filterId,
                    battleEnabled: this.getBattleFilterEnabled(),
                },
            })
        );
    }

    /**
     * Update visual state of a filter icon
     * @param {HTMLElement} container - Filter icon container
     * @param {boolean} enabled - Whether filter is enabled
     */
    updateIconState(container, enabled) {
        const svg = container.querySelector('svg');
        const countBadge = container.querySelector('[data-count-badge]');

        if (enabled) {
            svg.style.opacity = '1.0';
            countBadge.style.display = 'inline';
        } else {
            svg.style.opacity = '0.3';
            countBadge.style.display = 'none';
        }
    }

    /**
     * Update all icon states based on current config
     */
    updateAllIconStates() {
        // Update battle icon
        const battleIcon = this.filterIcons.get('battle');
        if (battleIcon) {
            this.updateIconState(battleIcon, this.getBattleFilterEnabled());
        }

        // Update dungeon icons
        Object.entries(this.dungeonConfig).forEach(([hrid, dungeon]) => {
            const dungeonIcon = this.filterIcons.get(dungeon.id);
            if (dungeonIcon) {
                this.updateIconState(dungeonIcon, this.getDungeonFilterEnabled(hrid));
            }
        });
    }

    /**
     * Update task counts on all filter icons
     * @param {HTMLElement} panel - Task panel container
     */
    updateCounts(panel) {
        // Find all task items in the panel
        const taskItems = panel.querySelectorAll(GAME.TASK_CARD);

        // Count tasks for each filter
        const counts = {
            battle: 0,
            chimerical_den: 0,
            sinister_circus: 0,
            enchanted_fortress: 0,
            pirate_cove: 0,
        };

        taskItems.forEach((taskItem) => {
            // Check if this is a combat task
            const isCombatTask = this.isTaskCombat(taskItem);

            if (isCombatTask) {
                counts.battle++;

                // Check which dungeon this task is for
                const dungeonType = this.getTaskDungeonType(taskItem);
                if (dungeonType && counts.hasOwnProperty(dungeonType)) {
                    counts[dungeonType]++;
                }
            }
        });

        // Update count badges
        this.filterIcons.forEach((icon, filterId) => {
            const count = counts[filterId] || 0;
            const countBadge = icon.querySelector('[data-count-badge]');
            if (countBadge) {
                countBadge.textContent = `*${count}`;
            }
            this.currentCounts.set(filterId, count);
        });
    }

    /**
     * Check if a task item is a combat task
     * @param {HTMLElement} taskItem - Task item element
     * @returns {boolean} True if this is a combat task
     */
    isTaskCombat(taskItem) {
        // Check for monster icon class added by task-icons.js to all combat tasks
        const monsterIcon = taskItem.querySelector('.mwi-task-icon-monster');
        return monsterIcon !== null;
    }

    /**
     * Get the dungeon type for a combat task
     * @param {HTMLElement} taskItem - Task item element
     * @returns {string|null} Dungeon ID or null if not a dungeon task
     */
    getTaskDungeonType(taskItem) {
        // Look for dungeon badge icons (using class, not ID)
        const badges = taskItem.querySelectorAll('.mwi-task-icon-dungeon svg use');

        if (!badges || badges.length === 0) {
            return null;
        }

        // Check each badge to identify the dungeon
        for (const badge of badges) {
            const href = badge.getAttribute('href') || badge.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

            if (!href) continue;

            // Match href to dungeon config
            for (const [_hrid, dungeon] of Object.entries(this.dungeonConfig)) {
                if (href.includes(dungeon.spriteId)) {
                    return dungeon.id;
                }
            }
        }

        return null;
    }

    /**
     * Set up observer to watch for task list changes
     * @param {HTMLElement} panel - Task panel container
     */
    observeTaskList(panel) {
        // Find the task list container
        const taskList = panel.querySelector(GAME.TASK_LIST);
        if (!taskList) {
            console.warn('[TaskIconFilters] Could not find task list');
            return;
        }

        // Disconnect existing observer if any
        if (this.taskListObserver) {
            this.taskListObserver.disconnect();
        }

        // Create new observer
        this.taskListObserver = new MutationObserver(() => {
            this.updateCounts(panel);
        });

        // Start observing
        this.taskListObserver.observe(taskList, {
            childList: true,
            subtree: true,
        });
    }

    /**
     * Check if battle filter is enabled
     * @returns {boolean} True if battle icons should be shown
     */
    getBattleFilterEnabled() {
        // Default to true if not set
        const stored = localStorage.getItem('mwi-taskIconsFilterBattle');
        return stored === null || stored === 'true';
    }

    /**
     * Check if a specific dungeon filter is enabled
     * @param {string} dungeonHrid - Dungeon action HRID
     * @returns {boolean} True if this dungeon's badges should be shown
     */
    getDungeonFilterEnabled(dungeonHrid) {
        const dungeon = this.dungeonConfig[dungeonHrid];
        if (!dungeon) return false;

        // Default to false if not set (dungeons start disabled)
        const stored = localStorage.getItem(`mwi-taskIconsFilter-${dungeon.id}`);
        return stored === 'true';
    }

    /**
     * Check if a specific dungeon badge should be shown
     * @param {string} dungeonHrid - Dungeon action HRID
     * @returns {boolean} True if badge should be shown
     */
    shouldShowDungeonBadge(dungeonHrid) {
        // Must have both battle toggle enabled AND specific dungeon toggle enabled
        return this.getBattleFilterEnabled() && this.getDungeonFilterEnabled(dungeonHrid);
    }
}

// Export singleton instance
const taskIconFilters = new TaskIconFilters();
export default taskIconFilters;
