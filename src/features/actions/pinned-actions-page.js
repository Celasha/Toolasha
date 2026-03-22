/**
 * Pinned Actions Page
 * Adds a "Pinned" button to the left nav bar that shows all pinned actions
 * in a consolidated list with skill, level, profit/hr, and XP/hr.
 * Columns are sortable (click header) and skill is filterable (⋮ button).
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import actionPanelSort from './action-panel-sort.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { calculateProductionProfit } from './production-profit.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';
import { numberFormatter } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

const COLUMNS = [
    { key: 'name', label: 'Action', align: 'left', filterable: false },
    { key: 'skill', label: 'Skill', align: 'left', filterable: true },
    { key: 'level', label: 'Lv', align: 'left', filterable: false },
    { key: 'profitPerHour', label: 'Profit/hr', align: 'right', filterable: false },
    { key: 'expPerHour', label: 'XP/hr', align: 'right', filterable: false },
];

const GRID_COLUMNS = '1fr 120px 50px 90px 90px';

/**
 * Get game object via React fiber tree traversal
 * @returns {Object|null} Game component instance
 */
function getGameObject() {
    const rootEl = document.getElementById('root');
    const rootFiber = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
    if (!rootFiber) return null;

    function find(fiber) {
        if (!fiber) return null;
        if (fiber.stateNode?.handleGoToAction) return fiber.stateNode;
        return find(fiber.child) || find(fiber.sibling);
    }

    return find(rootFiber);
}

/**
 * Format skill name from action type HRID
 * @param {string} typeHrid - e.g. "/action_types/milking"
 * @returns {string} Display name, e.g. "Milking"
 */
function formatSkillName(typeHrid) {
    if (!typeHrid) return 'Unknown';
    const slug = typeHrid.split('/').pop();
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Format profit/xp number compactly
 * @param {number|null} value - Value to format
 * @returns {string} Formatted string or '-'
 */
function formatCompact(value) {
    if (value === null || value === undefined) return '-';
    const abs = Math.abs(value);
    let formatted;
    if (abs >= 1e9) {
        formatted = (value / 1e9).toFixed(1) + 'B';
    } else if (abs >= 1e6) {
        formatted = (value / 1e6).toFixed(1) + 'M';
    } else if (abs >= 1e3) {
        formatted = (value / 1e3).toFixed(1) + 'K';
    } else {
        formatted = numberFormatter(value);
    }
    return formatted;
}

class PinnedActionsPage {
    constructor() {
        this.navButton = null;
        this.pageContainer = null;
        this.isActive = false;
        this.navigationObserver = null;
        this.unregisterObserver = null;
        this.timerRegistry = createTimerRegistry();
        this.navInjected = false;
        this.hiddenElements = [];

        // Sort state
        this.sortColumn = 'skill';
        this.sortDirection = 'asc';

        // Filter state
        this.selectedSkills = []; // empty = show all

        // Filter popup state
        this.activeFilterPopup = null;
        this.activeFilterButton = null;
        this.popupCloseHandler = null;

        // Cached action data (computed once per showPage, re-sorted/filtered in place)
        this.allActions = [];

        // Game nav deactivation (so clicking the previously-active skill re-triggers navigation)
        this.deactivatedNavItem = null;

        // Nav click interceptor (hides pinned page when user clicks a game nav item)
        this.navClickInterceptor = null;
    }

    /**
     * Initialize the pinned actions page feature
     */
    initialize() {
        if (!config.getSetting('actions_pinnedPage')) return;

        this.unregisterObserver = domObserver.onClass('PinnedActionsPage', 'NavigationBar_nav', () => {
            if (!this.navInjected) {
                this.injectNavButton();
            }
        });

        const existingNav = document.querySelector('[class*="NavigationBar_nav"]');
        if (existingNav && !this.navInjected) {
            this.injectNavButton();
        }
    }

    /**
     * Inject the "Pinned" nav button above the first skill in the nav bar
     */
    injectNavButton() {
        const navLinks = document.querySelector('[class*="NavigationBar_navigationLinks"]');
        if (!navLinks) return;

        this.navInjected = true;

        const btn = document.createElement('div');
        btn.className = 'mwi-pinned-nav';
        btn.style.cssText = `
            padding: 4px 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85em;
            color: ${config.COLOR_ACCENT};
            border-left: 3px solid transparent;
            transition: background 0.15s, border-color 0.15s;
            user-select: none;
            margin-bottom: 2px;
        `;

        btn.innerHTML = `<span style="font-size: 1.1em;">📌</span><span>Pinned</span>`;

        btn.addEventListener('mouseenter', () => {
            if (!this.isActive) {
                btn.style.background = 'rgba(255, 255, 255, 0.05)';
            }
        });

        btn.addEventListener('mouseleave', () => {
            if (!this.isActive) {
                btn.style.background = '';
            }
        });

        btn.addEventListener('click', () => {
            if (this.isActive) {
                this.hidePage();
            } else {
                this.showPage();
            }
        });

        navLinks.insertBefore(btn, navLinks.firstChild);
        this.navButton = btn;
    }

    /**
     * Show the pinned actions page, replacing the main content
     */
    showPage() {
        if (this.isActive) return;

        const mainPanel = document.querySelector('[class*="MainPanel_mainPanel"]');
        if (!mainPanel) return;

        this.isActive = true;
        this.updateNavButtonState(true);
        this.deactivateGameNav();
        this.startNavClickInterceptor();

        this.hiddenElements = [];
        for (const child of mainPanel.children) {
            if (child !== this.pageContainer) {
                this.hiddenElements.push({ el: child, prevDisplay: child.style.display });
                child.style.display = 'none';
            }
        }

        this.pageContainer = document.createElement('div');
        this.pageContainer.className = 'mwi-pinned-page';
        this.pageContainer.style.cssText = `
            width: 100%;
            height: 100%;
            overflow-y: auto;
            padding: 16px;
            box-sizing: border-box;
        `;
        mainPanel.appendChild(this.pageContainer);

        this.loadActions();
        this.setupNavigationObserver(mainPanel);
    }

    /**
     * Load action data (async), then render
     */
    async loadActions() {
        const pinnedActions = actionPanelSort.getPinnedActions();
        this.allActions = [];

        for (const actionHrid of pinnedActions) {
            const details = dataManager.getActionDetails(actionHrid);
            if (!details) continue;

            let stats = actionPanelSort.getCachedStats(actionHrid);
            if (!stats || stats.profitPerHour === undefined) {
                stats = await this.computeStats(actionHrid, details);
            }

            this.allActions.push({
                actionHrid,
                name: details.name,
                skill: formatSkillName(details.type),
                level: details.levelRequirement?.level ?? 0,
                profitPerHour: stats?.profitPerHour ?? null,
                expPerHour: stats?.expPerHour ?? null,
            });
        }

        this.renderTable();
    }

    /**
     * Get filtered and sorted actions based on current state
     * @returns {Array} Filtered and sorted action array
     */
    getFilteredSorted() {
        let actions = [...this.allActions];

        // Apply skill filter
        if (this.selectedSkills.length > 0) {
            const skillSet = new Set(this.selectedSkills);
            actions = actions.filter((a) => skillSet.has(a.skill));
        }

        // Apply sort
        const col = this.sortColumn;
        const dir = this.sortDirection === 'asc' ? 1 : -1;

        actions.sort((a, b) => {
            const aVal = a[col];
            const bVal = b[col];

            // Nulls sort last regardless of direction
            if (aVal === null && bVal === null) return 0;
            if (aVal === null) return 1;
            if (bVal === null) return -1;

            if (typeof aVal === 'string') {
                return dir * aVal.localeCompare(bVal);
            }
            return dir * (aVal - bVal);
        });

        return actions;
    }

    /**
     * Render the full table (header + rows) from current state
     */
    renderTable() {
        if (!this.pageContainer) return;
        this.closeFilterPopup();

        const actions = this.getFilteredSorted();

        // Clear container
        while (this.pageContainer.firstChild) {
            this.pageContainer.removeChild(this.pageContainer.firstChild);
        }

        // Title
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #444;
        `;
        header.innerHTML = `
            <span style="font-size: 1.3em;">📌</span>
            <span style="font-size: 1.1em; font-weight: bold;">Pinned Actions</span>
            <span style="color: #888; font-size: 0.85em;">(${actions.length})</span>
        `;
        this.pageContainer.appendChild(header);

        if (this.allActions.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align: center; padding: 40px 20px; color: #999;';
            empty.innerHTML = `
                <div style="font-size: 2em; margin-bottom: 12px;">📌</div>
                <div style="font-size: 1.1em; margin-bottom: 8px;">No pinned actions</div>
                <div style="font-size: 0.85em; color: #666;">
                    Pin actions using the 📌 icon on action tiles to see them here.
                </div>
            `;
            this.pageContainer.appendChild(empty);
            return;
        }

        // Column headers
        const headerRow = document.createElement('div');
        headerRow.style.cssText = `
            display: grid;
            grid-template-columns: ${GRID_COLUMNS};
            gap: 8px;
            padding: 4px 8px;
            font-size: 0.75em;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #555;
            user-select: none;
        `;

        for (const col of COLUMNS) {
            const th = document.createElement('div');
            th.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                ${col.align === 'right' ? 'justify-content: flex-end;' : ''}
            `;

            // Sort label
            const label = document.createElement('span');
            label.style.cursor = 'pointer';
            let labelText = col.label;
            if (this.sortColumn === col.key) {
                labelText += this.sortDirection === 'asc' ? ' \u25B2' : ' \u25BC';
            }
            label.textContent = labelText;

            label.addEventListener('click', () => {
                if (this.sortColumn === col.key) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = col.key;
                    this.sortDirection = col.key === 'name' || col.key === 'skill' ? 'asc' : 'desc';
                }
                this.renderTable();
            });

            th.appendChild(label);

            // Filter button for filterable columns
            if (col.filterable) {
                const filterBtn = document.createElement('button');
                filterBtn.textContent = '\u22EE';
                const hasActive = this.selectedSkills.length > 0;
                filterBtn.style.cssText = `
                    background: none;
                    border: none;
                    color: ${hasActive ? '#4a90e2' : '#aaa'};
                    cursor: pointer;
                    font-size: 14px;
                    padding: 2px 4px;
                    font-weight: bold;
                `;

                filterBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showSkillFilterPopup(filterBtn);
                });

                th.appendChild(filterBtn);
            }

            headerRow.appendChild(th);
        }

        this.pageContainer.appendChild(headerRow);

        // Data rows
        for (let ri = 0; ri < actions.length; ri++) {
            const action = actions[ri];
            const profitColor =
                action.profitPerHour === null
                    ? '#888'
                    : action.profitPerHour >= 0
                      ? config.COLOR_PROFIT || '#5fda5f'
                      : config.COLOR_LOSS || '#ff6b6b';
            const profitPrefix = action.profitPerHour !== null && action.profitPerHour > 0 ? '+' : '';
            const rowBg = ri % 2 === 1 ? 'rgba(255, 255, 255, 0.03)' : 'transparent';

            const row = document.createElement('div');
            row.className = 'mwi-pinned-row';
            row.dataset.actionHrid = action.actionHrid;
            row.dataset.rowBg = rowBg;
            row.style.cssText = `
                display: grid;
                grid-template-columns: ${GRID_COLUMNS};
                gap: 8px;
                padding: 8px;
                cursor: pointer;
                border-radius: 4px;
                transition: background 0.15s;
                align-items: center;
                background: ${rowBg};
            `;

            row.innerHTML = `
                <span style="font-weight: 500; text-align: left;">${action.name}</span>
                <span style="color: #aaa; font-size: 0.9em; text-align: left;">${action.skill}</span>
                <span style="color: #aaa; text-align: left;">${action.level}</span>
                <span style="text-align: right; color: ${profitColor};">
                    ${profitPrefix}${formatCompact(action.profitPerHour)}
                </span>
                <span style="text-align: right; color: #7ec8e3;">
                    ${formatCompact(action.expPerHour)}
                </span>
            `;

            row.addEventListener('mouseenter', () => {
                row.style.background = 'rgba(255, 255, 255, 0.08)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = row.dataset.rowBg || 'transparent';
            });
            row.addEventListener('click', () => {
                const game = getGameObject();
                if (game?.handleGoToAction) {
                    this.hidePage(true);
                    game.handleGoToAction(action.actionHrid);
                }
            });

            this.pageContainer.appendChild(row);
        }

        // No results after filtering
        if (actions.length === 0 && this.allActions.length > 0) {
            const noResults = document.createElement('div');
            noResults.style.cssText = 'text-align: center; padding: 20px; color: #888;';
            noResults.textContent = 'No actions match the current filter.';
            this.pageContainer.appendChild(noResults);
        }
    }

    /**
     * Show skill filter popup below the filter button
     * @param {HTMLElement} buttonElement - The filter button
     */
    showSkillFilterPopup(buttonElement) {
        // Toggle close if same button
        if (this.activeFilterPopup && this.activeFilterButton === buttonElement) {
            this.closeFilterPopup();
            return;
        }

        this.closeFilterPopup();

        // Get unique skills from all actions
        const skills = [...new Set(this.allActions.map((a) => a.skill))].sort();

        const popup = document.createElement('div');
        popup.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            min-width: 180px;
            max-height: 300px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        `;

        // Title
        const title = document.createElement('div');
        title.textContent = 'Filter by Skill';
        title.style.cssText = 'color: #fff; font-weight: bold; margin-bottom: 10px; font-size: 0.85em;';
        popup.appendChild(title);

        // Checkbox container
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = 'flex: 1; overflow-y: auto; margin-bottom: 10px;';

        for (const skill of skills) {
            const label = document.createElement('label');
            label.style.cssText = `
                display: block;
                color: #fff;
                padding: 4px 0;
                cursor: pointer;
                font-size: 0.85em;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.selectedSkills.length === 0 || this.selectedSkills.includes(skill);
            checkbox.style.marginRight = '6px';

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(skill));
            checkboxContainer.appendChild(label);
        }

        popup.appendChild(checkboxContainer);

        // Buttons row
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 8px;';

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8em;
        `;

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #666;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8em;
        `;

        applyBtn.addEventListener('click', () => {
            const checked = [];
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
                if (cb.checked) checked.push(skills[i]);
            });
            // If all are checked, treat as no filter
            this.selectedSkills = checked.length === skills.length ? [] : checked;
            this.closeFilterPopup();
            this.renderTable();
        });

        clearBtn.addEventListener('click', () => {
            this.selectedSkills = [];
            this.closeFilterPopup();
            this.renderTable();
        });

        btnRow.appendChild(applyBtn);
        btnRow.appendChild(clearBtn);
        popup.appendChild(btnRow);

        // Position below button
        const rect = buttonElement.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.top = `${rect.bottom + 5}px`;
        popup.style.left = `${rect.left}px`;
        popup.style.zIndex = '10002';

        document.body.appendChild(popup);
        this.activeFilterPopup = popup;
        this.activeFilterButton = buttonElement;

        // Close on outside click (delayed to avoid immediate close)
        const closeTimeout = setTimeout(() => {
            this.popupCloseHandler = (e) => {
                if (!popup.contains(e.target) && e.target !== buttonElement) {
                    this.closeFilterPopup();
                }
            };
            document.addEventListener('click', this.popupCloseHandler);
        }, 10);
        this.timerRegistry.registerTimeout(closeTimeout);
    }

    /**
     * Close any open filter popup
     */
    closeFilterPopup() {
        if (this.activeFilterPopup) {
            this.activeFilterPopup.remove();
            this.activeFilterPopup = null;
            this.activeFilterButton = null;
        }
        if (this.popupCloseHandler) {
            document.removeEventListener('click', this.popupCloseHandler);
            this.popupCloseHandler = null;
        }
    }

    /**
     * Compute profit/hr and XP/hr for an action on demand
     * @param {string} actionHrid - Action HRID
     * @param {Object} details - Action details from dataManager
     * @returns {Object|null} { profitPerHour, expPerHour }
     */
    async computeStats(actionHrid, details) {
        try {
            let profitPerHour = null;
            let expPerHour = null;

            const isGathering = GATHERING_TYPES.includes(details.type);
            if (isGathering) {
                const profitData = await calculateGatheringProfit(actionHrid);
                profitPerHour = profitData?.profitPerHour ?? null;
            } else {
                const profitData = await calculateProductionProfit(actionHrid);
                profitPerHour = profitData?.profitPerHour ?? null;
            }

            const expData = calculateExpPerHour(actionHrid);
            expPerHour = expData?.expPerHour ?? null;

            const stats = { profitPerHour, expPerHour };
            if (!actionPanelSort.cachedStats) actionPanelSort.cachedStats = {};
            actionPanelSort.cachedStats[actionHrid] = stats;

            return stats;
        } catch (error) {
            console.error('[PinnedActionsPage] Failed to compute stats for', actionHrid, error);
            return null;
        }
    }

    /**
     * Hide the pinned page and restore original content
     * @param {boolean} [navigatedAway=false] - True if hiding because user navigated to a skill
     */
    hidePage(navigatedAway = false) {
        if (!this.isActive) return;

        this.closeFilterPopup();

        for (const { el, prevDisplay } of this.hiddenElements) {
            el.style.display = prevDisplay;
        }
        this.hiddenElements = [];

        if (this.pageContainer) {
            this.pageContainer.remove();
            this.pageContainer = null;
        }

        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
            this.navigationObserver = null;
        }

        this.isActive = false;
        this.updateNavButtonState(false);
        this.stopNavClickInterceptor();

        // Only restore the old nav highlight if user toggled Pinned off (not when navigating away,
        // since the game already activated the new skill's nav item)
        if (!navigatedAway) {
            this.restoreGameNav();
        } else {
            this.deactivatedNavItem = null;
        }
    }

    /**
     * Update nav button visual state
     * @param {boolean} active - Whether the pinned page is active
     */
    updateNavButtonState(active) {
        if (!this.navButton) return;
        if (active) {
            this.navButton.style.borderLeftColor = config.COLOR_ACCENT;
            this.navButton.style.background = 'rgba(255, 255, 255, 0.08)';
        } else {
            this.navButton.style.borderLeftColor = 'transparent';
            this.navButton.style.background = '';
        }
    }

    /**
     * Remove the active class from the game's currently-selected nav item
     * so that clicking it again triggers a real navigation event.
     */
    deactivateGameNav() {
        const activeNav = document.querySelector('.NavigationBar_active__2Oj_e');
        if (activeNav) {
            this.deactivatedNavItem = activeNav;
            activeNav.classList.remove('NavigationBar_active__2Oj_e');
        }
    }

    /**
     * Restore the active class to the nav item we deactivated
     */
    restoreGameNav() {
        if (this.deactivatedNavItem) {
            this.deactivatedNavItem.classList.add('NavigationBar_active__2Oj_e');
            this.deactivatedNavItem = null;
        }
    }

    /**
     * Start listening for clicks on game nav items while pinned page is active.
     * When a game nav item is clicked, hide the pinned page and let the game navigate.
     */
    startNavClickInterceptor() {
        this.stopNavClickInterceptor();

        const navParent = this.navButton?.parentElement;
        if (!navParent) return;

        this.navClickInterceptor = (e) => {
            if (!this.isActive) return;

            // Ignore clicks on the Pinned button itself (its handler manages show/hide)
            if (this.navButton && this.navButton.contains(e.target)) return;

            const clickedNav = e.target.closest('[class*="NavigationBar_nav"]');
            if (!clickedNav) return;

            // Unhide the game content first so React can render into it
            for (const { el, prevDisplay } of this.hiddenElements) {
                el.style.display = prevDisplay;
            }
            this.hiddenElements = [];

            // Remove our page container
            if (this.pageContainer) {
                this.pageContainer.remove();
                this.pageContainer = null;
            }

            // Disconnect the mutation observer
            if (this.navigationObserver) {
                this.navigationObserver.disconnect();
                this.navigationObserver = null;
            }

            this.isActive = false;
            this.updateNavButtonState(false);
            this.deactivatedNavItem = null;
            this.stopNavClickInterceptor();
        };

        navParent.addEventListener('click', this.navClickInterceptor);
    }

    /**
     * Stop the nav click interceptor
     */
    stopNavClickInterceptor() {
        if (this.navClickInterceptor) {
            const navParent = this.navButton?.parentElement;
            if (navParent) {
                navParent.removeEventListener('click', this.navClickInterceptor);
            }
            this.navClickInterceptor = null;
        }
    }

    /**
     * Watch for React replacing the main panel content (user navigated to a skill)
     * @param {HTMLElement} mainPanel - The MainPanel_mainPanel element
     */
    setupNavigationObserver(mainPanel) {
        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
        }

        this.navigationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (
                        node.nodeType === Node.ELEMENT_NODE &&
                        node !== this.pageContainer &&
                        node.className?.includes?.('MainPanel_subPanelContainer')
                    ) {
                        this.hidePage(true);
                        return;
                    }
                }
            }
        });

        this.navigationObserver.observe(mainPanel, { childList: true });
    }

    /**
     * Disable the feature and clean up
     */
    disable() {
        if (this.isActive) {
            this.hidePage();
        }

        if (this.navButton) {
            this.navButton.remove();
            this.navButton = null;
        }

        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }

        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
            this.navigationObserver = null;
        }

        this.closeFilterPopup();
        this.stopNavClickInterceptor();
        this.timerRegistry.clearAll();
        this.navInjected = false;
    }
}

const pinnedActionsPage = new PinnedActionsPage();

export default pinnedActionsPage;
