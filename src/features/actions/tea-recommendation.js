/**
 * Tea Recommendation UI
 * Adds XP and Gold buttons to skill pages that show optimal tea combinations
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import actionFilter from './action-filter.js';
import { findOptimalTeas, getTeaBuffDescription } from '../../utils/tea-optimizer.js';
import { formatKMB } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

/**
 * Get the currently selected location tab name
 * @returns {string|null} Location name or null if on "All" or can't detect
 */
function getCurrentLocationTab() {
    // Look for the tab container with location tabs
    const tabButtons = document.querySelectorAll('button[role="tab"]');

    for (const button of tabButtons) {
        // Check if this tab is selected
        if (button.getAttribute('aria-selected') === 'true') {
            const text = button.textContent?.trim();
            // Skip if it's a skill-level tab like "Foraging" or special tabs
            if (text && !['Enhance', 'Current Action', 'Decompose', 'Transmute'].includes(text)) {
                return text;
            }
        }
    }

    return null;
}

class TeaRecommendation {
    constructor() {
        this.initialized = false;
        this.unregisterHandlers = [];
        this.timerRegistry = createTimerRegistry();
        this.currentPopup = null;
        this.buttonContainer = null;
    }

    /**
     * Initialize tea recommendation feature
     */
    async initialize() {
        if (this.initialized) return;

        this.initialized = true;

        // Wait for action filter to initialize (it tracks the title element)
        await actionFilter.initialize();

        // Observe for skill panel labels (includes "Consumables" label)
        const unregisterLabelObserver = domObserver.onClass(
            'TeaRecommendation-Label',
            'GatheringProductionSkillPanel_label',
            (labelElement) => {
                this.checkAndInjectButtons(labelElement);
            }
        );

        this.unregisterHandlers.push(unregisterLabelObserver);

        // Check if consumables label already exists
        const existingLabels = document.querySelectorAll('[class*="GatheringProductionSkillPanel_label"]');
        existingLabels.forEach((label) => {
            this.checkAndInjectButtons(label);
        });
    }

    /**
     * Check if label is "Consumables" and inject buttons
     * @param {HTMLElement} labelElement - The label element
     */
    checkAndInjectButtons(labelElement) {
        // Only inject on "Consumables" label
        if (labelElement.textContent.trim() !== 'Consumables') {
            return;
        }

        // Check if buttons already exist
        if (labelElement.querySelector('.mwi-tea-recommendation-buttons')) {
            return;
        }

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'mwi-tea-recommendation-buttons';
        buttonContainer.style.cssText = `
            display: inline-flex;
            gap: 6px;
            margin-left: 12px;
            vertical-align: middle;
        `;

        // Create XP button
        const xpButton = this.createButton('XP', 'xp', config.COLOR_INFO);
        // Create Gold button
        const goldButton = this.createButton('Gold', 'gold', config.COLOR_PROFIT);

        buttonContainer.appendChild(xpButton);
        buttonContainer.appendChild(goldButton);

        // Make label a flex container and append buttons
        labelElement.style.display = 'inline-flex';
        labelElement.style.alignItems = 'center';
        labelElement.style.gap = '8px';
        labelElement.appendChild(buttonContainer);

        this.buttonContainer = buttonContainer;
    }

    /**
     * Create an optimization button
     * @param {string} label - Button label
     * @param {string} goal - 'xp' or 'gold'
     * @param {string} color - Button color
     * @returns {HTMLElement} Button element
     */
    createButton(label, goal, color) {
        const button = document.createElement('button');
        button.className = `mwi-tea-recommend-${goal}`;
        button.textContent = label;
        button.style.cssText = `
            background: transparent;
            color: ${color};
            border: 1px solid ${color};
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.background = color;
            button.style.color = '#000';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = 'transparent';
            button.style.color = color;
        });

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showRecommendation(goal, button);
        });

        return button;
    }

    /**
     * Show tea recommendation popup
     * @param {string} goal - 'xp' or 'gold'
     * @param {HTMLElement} anchorButton - Button that was clicked
     */
    showRecommendation(goal, anchorButton) {
        // Close existing popup
        this.closePopup();

        // Get current skill name from action filter
        const skillName = actionFilter.getCurrentSkillName();
        if (!skillName) {
            this.showError(anchorButton, 'Could not detect current skill');
            return;
        }

        // Get current location tab (if any)
        const locationTab = getCurrentLocationTab();

        // Calculate optimal teas (pass location name to filter by category)
        const result = findOptimalTeas(skillName, goal, locationTab);

        if (result.error) {
            this.showError(anchorButton, result.error);
            return;
        }

        // Create popup
        const popup = document.createElement('div');
        popup.className = 'mwi-tea-recommendation-popup';
        popup.style.cssText = `
            position: absolute;
            z-index: 10000;
            background: #1a1a1a;
            border: 1px solid ${config.COLOR_BORDER};
            border-radius: 8px;
            padding: 16px;
            min-width: 280px;
            max-width: 350px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            cursor: default;
        `;

        // Header (draggable) - show location if filtering by tab
        const goalLabel = goal === 'xp' ? 'XP' : 'Gold';
        const header = document.createElement('div');
        header.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: #fff;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid ${config.COLOR_BORDER};
            cursor: grab;
            user-select: none;
        `;
        // Show location name if we're filtering by tab, otherwise show skill name
        const displayName = locationTab || skillName;
        // Include drink concentration in header if > 0
        const dcPercent = result.drinkConcentration ? (result.drinkConcentration * 100).toFixed(2) : 0;
        const dcSuffix = dcPercent > 0 ? ` (${dcPercent}% DC)` : '';
        header.textContent = `Optimal ${goalLabel}/hr for ${displayName}${dcSuffix}`;
        header.title = 'Drag to move';
        popup.appendChild(header);

        // Make popup draggable via header
        this.makeDraggable(popup, header);

        // Optimal teas list
        const teaList = document.createElement('div');
        teaList.style.cssText = 'margin-bottom: 12px;';

        for (const tea of result.optimal.teas) {
            const teaRow = document.createElement('div');
            teaRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 0;
            `;

            const teaName = document.createElement('span');
            teaName.style.cssText = `
                color: #fff;
                font-weight: 500;
            `;
            teaName.textContent = tea.name;

            const teaBuffs = document.createElement('span');
            teaBuffs.style.cssText = `
                color: rgba(255, 255, 255, 0.6);
                font-size: 11px;
            `;
            // Pass drink concentration to get scaled values with DC bonus shown
            const buffText = getTeaBuffDescription(tea.hrid, result.drinkConcentration || 0);
            // Style the DC bonus portion in dimmer color
            teaBuffs.innerHTML = buffText.replace(
                /\(([^)]+)\)/g,
                '<span style="color: rgba(255, 255, 255, 0.4);">($1)</span>'
            );

            teaRow.appendChild(teaName);
            teaRow.appendChild(teaBuffs);
            teaList.appendChild(teaRow);
        }
        popup.appendChild(teaList);

        // Stats
        const stats = document.createElement('div');
        stats.style.cssText = `
            font-size: 12px;
            color: rgba(255, 255, 255, 0.7);
            padding-top: 8px;
            border-top: 1px solid ${config.COLOR_BORDER};
        `;

        const avgValue = result.optimal ? formatKMB(result.optimal.avgScore) : '0';

        // For gold mode, show profitable actions count
        const profitableCount = result.profitableActionsCount || result.actionsEvaluated;
        const excludedCount = result.excludedActions?.length || 0;
        let actionsText;
        if (goal === 'gold') {
            actionsText =
                excludedCount > 0
                    ? `${profitableCount} profitable of ${result.actionsEvaluated} (+${excludedCount} excluded)`
                    : `${profitableCount} profitable of ${result.actionsEvaluated}`;
        } else {
            actionsText =
                excludedCount > 0
                    ? `${result.actionsEvaluated} actions (+${excludedCount} excluded)`
                    : `${result.actionsEvaluated} actions evaluated`;
        }

        // Create expandable actions section
        const actionsToggle = document.createElement('span');
        actionsToggle.style.cssText = `
            cursor: pointer;
            text-decoration: underline;
            color: rgba(255, 255, 255, 0.5);
        `;
        actionsToggle.textContent = actionsText;
        actionsToggle.title = 'Click to expand';

        const actionsDetail = document.createElement('div');
        actionsDetail.style.cssText = `
            display: none;
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            max-height: 150px;
            overflow-y: auto;
        `;

        // Sort actions by score descending
        const sortedActions = [...(result.optimal?.actionScores || [])].sort((a, b) => b.score - a.score);
        for (const actionData of sortedActions) {
            const actionRow = document.createElement('div');
            actionRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                padding: 2px 0;
            `;
            const actionName = document.createElement('span');
            actionName.textContent = actionData.action;
            actionName.style.color = 'rgba(255, 255, 255, 0.7)';

            const actionScore = document.createElement('span');
            actionScore.textContent = formatKMB(actionData.score);
            actionScore.style.color = actionData.score >= 0 ? config.COLOR_PROFIT : config.COLOR_LOSS;

            actionRow.appendChild(actionName);
            actionRow.appendChild(actionScore);
            actionsDetail.appendChild(actionRow);
        }

        // Add excluded actions (greyed out with strikethrough)
        const excludedActions = result.excludedActions || [];
        if (excludedActions.length > 0) {
            // Add separator if there are regular actions
            if (sortedActions.length > 0) {
                const separator = document.createElement('div');
                separator.style.cssText = `
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                    margin: 6px 0;
                    font-size: 10px;
                    color: rgba(255, 255, 255, 0.4);
                    padding-top: 4px;
                `;
                separator.textContent = `Excluded (${excludedActions.length} - level too low)`;
                actionsDetail.appendChild(separator);
            }

            for (const excluded of excludedActions) {
                const actionRow = document.createElement('div');
                actionRow.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    padding: 2px 0;
                `;
                const actionName = document.createElement('span');
                actionName.textContent = excluded.action;
                actionName.style.cssText = `
                    color: rgba(255, 255, 255, 0.35);
                    text-decoration: line-through;
                `;

                const levelReq = document.createElement('span');
                levelReq.textContent = `Lvl ${excluded.requiredLevel}`;
                levelReq.style.cssText = `
                    color: rgba(255, 255, 255, 0.35);
                    font-style: italic;
                `;

                actionRow.appendChild(actionName);
                actionRow.appendChild(levelReq);
                actionsDetail.appendChild(actionRow);
            }
        }

        actionsToggle.addEventListener('click', () => {
            const isHidden = actionsDetail.style.display === 'none';
            actionsDetail.style.display = isHidden ? 'block' : 'none';
            let expandedText;
            if (goal === 'gold') {
                expandedText =
                    excludedCount > 0
                        ? `▼ ${profitableCount} profitable (+${excludedCount})`
                        : `▼ ${profitableCount} profitable`;
            } else {
                expandedText =
                    excludedCount > 0
                        ? `▼ ${result.actionsEvaluated} (+${excludedCount})`
                        : `▼ ${result.actionsEvaluated} actions`;
            }
            actionsToggle.textContent = isHidden ? expandedText : actionsText;
        });

        stats.innerHTML = `
            <div style="margin-bottom: 4px;">
                <span style="color: ${goal === 'xp' ? config.COLOR_INFO : config.COLOR_PROFIT};">
                    Avg ${goalLabel}/hr: ${avgValue}
                </span>
            </div>
            <div style="font-size: 11px;">
                Level ${result.playerLevel} •
            </div>
        `;
        stats.querySelector('div:last-child').appendChild(actionsToggle);
        stats.appendChild(actionsDetail);
        popup.appendChild(stats);

        // Alternative combos section
        if (result.allResults && result.allResults.length > 1) {
            const altSection = document.createElement('div');
            altSection.style.cssText = `
                margin-top: 12px;
                padding-top: 8px;
                border-top: 1px solid ${config.COLOR_BORDER};
            `;

            const altHeader = document.createElement('div');
            altHeader.style.cssText = `
                font-size: 11px;
                color: rgba(255, 255, 255, 0.5);
                margin-bottom: 6px;
            `;
            altHeader.textContent = 'Alternatives:';
            altSection.appendChild(altHeader);

            // Show top 3 alternatives (skip the optimal)
            for (let i = 1; i < Math.min(4, result.allResults.length); i++) {
                const alt = result.allResults[i];
                const altRow = document.createElement('div');
                altRow.style.cssText = `
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.6);
                    padding: 2px 0;
                `;
                altRow.textContent = `${alt.teas.join(', ')} (${formatKMB(alt.avgScore)}/hr)`;
                altSection.appendChild(altRow);
            }

            popup.appendChild(altSection);
        }

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.5);
            font-size: 16px;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
        `;
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => this.closePopup());
        popup.appendChild(closeBtn);

        // Position popup relative to button
        document.body.appendChild(popup);
        const buttonRect = anchorButton.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();

        // Position below the button
        let top = buttonRect.bottom + 8;
        let left = buttonRect.left;

        // Adjust if off-screen
        if (left + popupRect.width > window.innerWidth - 16) {
            left = window.innerWidth - popupRect.width - 16;
        }
        if (top + popupRect.height > window.innerHeight - 16) {
            top = buttonRect.top - popupRect.height - 8;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        this.currentPopup = popup;

        // Close on click outside
        const closeHandler = (e) => {
            if (!popup.contains(e.target) && e.target !== anchorButton) {
                this.closePopup();
                document.removeEventListener('click', closeHandler);
            }
        };
        // Delay to prevent immediate close
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 100);
    }

    /**
     * Show error message
     * @param {HTMLElement} anchorButton - Button that was clicked
     * @param {string} message - Error message
     */
    showError(anchorButton, message) {
        this.closePopup();

        const popup = document.createElement('div');
        popup.className = 'mwi-tea-recommendation-popup';
        popup.style.cssText = `
            position: absolute;
            z-index: 10000;
            background: #1a1a1a;
            border: 1px solid ${config.COLOR_WARNING};
            border-radius: 8px;
            padding: 12px 16px;
            max-width: 280px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            color: ${config.COLOR_WARNING};
            font-size: 13px;
        `;
        popup.textContent = message;

        document.body.appendChild(popup);
        const buttonRect = anchorButton.getBoundingClientRect();
        popup.style.top = `${buttonRect.bottom + 8}px`;
        popup.style.left = `${buttonRect.left}px`;

        this.currentPopup = popup;

        // Auto-close after 3 seconds
        const timeout = setTimeout(() => this.closePopup(), 3000);
        this.timerRegistry.registerTimeout(timeout);
    }

    /**
     * Close the current popup
     */
    closePopup() {
        if (this.currentPopup) {
            this.currentPopup.remove();
            this.currentPopup = null;
        }
    }

    /**
     * Make an element draggable via a handle
     * @param {HTMLElement} element - Element to make draggable
     * @param {HTMLElement} handle - Handle element for dragging
     */
    makeDraggable(element, handle) {
        let isDragging = false;
        let startX, startY, initialX, initialY;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = element.offsetLeft;
            initialY = element.offsetTop;
            handle.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            element.style.left = `${initialX + dx}px`;
            element.style.top = `${initialY + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
            }
        });
    }

    /**
     * Disable the feature
     */
    disable() {
        this.closePopup();
        this.timerRegistry.clearAll();

        this.unregisterHandlers.forEach((unregister) => unregister());
        this.unregisterHandlers = [];

        // Remove injected elements
        document.querySelectorAll('.mwi-tea-recommendation-buttons').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-tea-recommendation-popup').forEach((el) => el.remove());

        this.buttonContainer = null;
        this.initialized = false;
    }
}

const teaRecommendation = new TeaRecommendation();

export default teaRecommendation;
