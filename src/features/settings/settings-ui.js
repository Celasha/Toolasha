/**
 * Settings UI Module
 * Injects Toolasha settings tab into the game's settings panel
 * Based on MWITools Extended approach
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import { settingsGroups } from './settings-config.js';
import settingsStorage from './settings-storage.js';
import storage from '../../core/storage.js';
import settingsCSS from './settings-styles.css?raw';
import marketAPI from '../../api/marketplace.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

class SettingsUI {
    constructor() {
        this.config = config;
        this.settingsPanel = null;
        this.settingsObserver = null;
        this.settingsObserverCleanup = null;
        this.currentSettings = {};
        this.isInjecting = false; // Guard against concurrent injection
        this.characterSwitchHandler = null; // Store listener reference to prevent duplicates
        this.settingsPanelCallbacks = []; // Callbacks to run when settings panel appears
        this.timerRegistry = createTimerRegistry();
    }

    /**
     * Initialize the settings UI
     */
    async initialize() {
        // Inject CSS styles (check if already injected)
        if (!document.getElementById('toolasha-settings-styles')) {
            this.injectStyles();
        }

        // Load current settings
        this.currentSettings = await settingsStorage.loadSettings();

        // Set up handler for character switching (ONLY if not already registered)
        if (!this.characterSwitchHandler) {
            this.characterSwitchHandler = () => {
                this.handleCharacterSwitch();
            };
            dataManager.on('character_initialized', this.characterSwitchHandler);
        }

        // Wait for game's settings panel to load
        this.observeSettingsPanel();
    }

    /**
     * Register a callback to be called when settings panel appears
     * @param {Function} callback - Function to call when settings panel is detected
     */
    onSettingsPanelAppear(callback) {
        if (typeof callback === 'function') {
            this.settingsPanelCallbacks.push(callback);
        }
    }

    /**
     * Handle character switch
     * Clean up old observers and re-initialize for new character's settings panel
     */
    handleCharacterSwitch() {
        // Clean up old DOM references and observers (but keep listener registered)
        this.cleanupDOM();

        // Wait for settings panel to stabilize before re-observing
        const reobserveTimeout = setTimeout(() => {
            this.observeSettingsPanel();
        }, 500);
        this.timerRegistry.registerTimeout(reobserveTimeout);
    }

    /**
     * Cleanup DOM elements and observers only (internal cleanup during character switch)
     */
    cleanupDOM() {
        this.timerRegistry.clearAll();

        // Stop observer
        if (this.settingsObserver) {
            this.settingsObserver.disconnect();
            this.settingsObserver = null;
        }

        if (this.settingsObserverCleanup) {
            this.settingsObserverCleanup();
            this.settingsObserverCleanup = null;
        }

        // Remove settings tab
        const tab = document.querySelector('#toolasha-settings-tab');
        if (tab) {
            tab.remove();
        }

        // Remove settings panel
        const panel = document.querySelector('#toolasha-settings');
        if (panel) {
            panel.remove();
        }

        // Clear state
        this.settingsPanel = null;
        this.currentSettings = {};
        this.isInjecting = false;

        // Clear config cache
        this.config.clearSettingsCache();
    }

    /**
     * Inject CSS styles into page
     */
    injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.id = 'toolasha-settings-styles';
        styleEl.textContent = settingsCSS;
        document.head.appendChild(styleEl);
    }

    /**
     * Observe for game's settings panel
     * Uses MutationObserver to detect when settings panel appears
     */
    observeSettingsPanel() {
        // Wait for DOM to be ready before observing
        const startObserver = () => {
            if (!document.body) {
                const observerDelay = setTimeout(startObserver, 10);
                this.timerRegistry.registerTimeout(observerDelay);
                return;
            }

            const onMutation = (_mutations) => {
                // Look for the settings tabs container
                const tabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

                if (tabsContainer) {
                    // Check if our tab already exists before injecting
                    if (!tabsContainer.querySelector('#toolasha-settings-tab')) {
                        this.injectSettingsTab();
                    }

                    // Call registered callbacks for other features
                    this.settingsPanelCallbacks.forEach((callback) => {
                        try {
                            callback();
                        } catch (error) {
                            console.error('[Toolasha Settings] Callback error:', error);
                        }
                    });

                    // Keep observer running - panel might be removed/re-added if user navigates away and back
                }
            };

            // Observe the main game panel for changes
            const gamePanel = document.querySelector('div[class*="GamePage_gamePanel"]');
            if (gamePanel) {
                this.settingsObserverCleanup = createMutationWatcher(gamePanel, onMutation, {
                    childList: true,
                    subtree: true,
                });
            } else {
                // Fallback: observe entire body if game panel not found (Firefox timing issue)
                console.warn('[Toolasha Settings] Could not find game panel, observing body instead');
                this.settingsObserverCleanup = createMutationWatcher(document.body, onMutation, {
                    childList: true,
                    subtree: true,
                });
            }

            // Store observer reference (for compatibility with existing cleanup path)
            this.settingsObserver = null;

            // Also check immediately in case settings is already open
            const existingTabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');
            if (existingTabsContainer && !existingTabsContainer.querySelector('#toolasha-settings-tab')) {
                this.injectSettingsTab();

                // Call registered callbacks for other features
                this.settingsPanelCallbacks.forEach((callback) => {
                    try {
                        callback();
                    } catch (error) {
                        console.error('[Toolasha Settings] Callback error:', error);
                    }
                });
            }
        };

        startObserver();
    }

    /**
     * Inject Toolasha settings tab into game's settings panel
     */
    async injectSettingsTab() {
        // Guard against concurrent injection
        if (this.isInjecting) {
            return;
        }
        this.isInjecting = true;

        try {
            // Find tabs container (MWIt-E approach)
            const tabsComponentContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

            if (!tabsComponentContainer) {
                console.warn('[Toolasha Settings] Could not find tabsComponentContainer');
                return;
            }

            // Find the MUI tabs flexContainer
            const tabsContainer = tabsComponentContainer.querySelector('[class*="MuiTabs-flexContainer"]');
            const tabPanelsContainer = tabsComponentContainer.querySelector(
                '[class*="TabsComponent_tabPanelsContainer"]'
            );

            if (!tabsContainer || !tabPanelsContainer) {
                console.warn('[Toolasha Settings] Could not find tabs or panels container');
                return;
            }

            // Check if already injected
            if (tabsContainer.querySelector('#toolasha-settings-tab')) {
                return;
            }

            // Reload current settings from storage to ensure latest values
            this.currentSettings = await settingsStorage.loadSettings();

            // Get existing tabs for reference
            const existingTabs = Array.from(tabsContainer.querySelectorAll('button[role="tab"]'));

            // Create new tab button
            const tabButton = this.createTabButton();

            // Create tab panel
            const tabPanel = this.createTabPanel();

            // Setup tab switching
            this.setupTabSwitching(tabButton, tabPanel, existingTabs, tabPanelsContainer);

            // Append to DOM
            tabsContainer.appendChild(tabButton);
            tabPanelsContainer.appendChild(tabPanel);

            // Store reference
            this.settingsPanel = tabPanel;
        } catch (error) {
            console.error('[Toolasha Settings] Error during tab injection:', error);
        } finally {
            // Always reset the guard flag
            this.isInjecting = false;
        }
    }

    /**
     * Create tab button
     * @returns {HTMLElement} Tab button element
     */
    createTabButton() {
        const button = document.createElement('button');
        button.id = 'toolasha-settings-tab';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', 'false');
        button.setAttribute('tabindex', '-1');
        button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';
        button.style.minWidth = '90px';

        const span = document.createElement('span');
        span.className = 'MuiTab-wrapper';
        span.textContent = 'Toolasha';

        button.appendChild(span);

        return button;
    }

    /**
     * Create tab panel with all settings
     * @returns {HTMLElement} Tab panel element
     */
    createTabPanel() {
        const panel = document.createElement('div');
        panel.id = 'toolasha-settings';
        panel.className = 'TabPanel_tabPanel__tXMJF TabPanel_hidden__26UM3';
        panel.setAttribute('role', 'tabpanel');
        panel.style.display = 'none';

        // Create settings card
        const card = document.createElement('div');
        card.className = 'toolasha-settings-card';
        card.id = 'toolasha-settings-content';

        // Add search box at the top
        this.addSearchBox(card);

        // Generate settings from config
        this.generateSettings(card);

        // Add utility buttons
        this.addUtilityButtons(card);

        // Add refresh notice
        this.addRefreshNotice(card);

        panel.appendChild(card);

        // Add change listener
        card.addEventListener('change', (e) => this.handleSettingChange(e));

        // Add click listener for template edit buttons
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('toolasha-template-edit-btn')) {
                const settingId = e.target.dataset.settingId;
                this.openTemplateEditor(settingId);
            }
        });

        return panel;
    }

    /**
     * Generate all settings UI from config
     * @param {HTMLElement} container - Container element
     */
    generateSettings(container) {
        for (const [groupKey, group] of Object.entries(settingsGroups)) {
            // Create collapsible group container
            const groupContainer = document.createElement('div');
            groupContainer.className = 'toolasha-settings-group';
            groupContainer.dataset.group = groupKey;

            // Add section header with collapse toggle
            const header = document.createElement('h3');
            header.className = 'toolasha-settings-group-header';
            header.innerHTML = `
                <span class="collapse-icon">▼</span>
                <span class="icon">${group.icon}</span>
                ${group.title}
            `;
            // Bind toggleGroup method to this instance
            header.addEventListener('click', this.toggleGroup.bind(this, groupContainer));

            // Create content container for this group
            const content = document.createElement('div');
            content.className = 'toolasha-settings-group-content';

            // Add settings in this group
            for (const [settingId, settingDef] of Object.entries(group.settings)) {
                const settingEl = this.createSettingElement(settingId, settingDef);
                content.appendChild(settingEl);
            }

            groupContainer.appendChild(header);
            groupContainer.appendChild(content);
            container.appendChild(groupContainer);
        }

        // After all settings are created, set up collapse functionality for parent settings
        this.setupParentCollapseIcons(container);

        // Restore collapse states from IndexedDB storage
        this.restoreCollapseStates(container);
    }

    /**
     * Setup collapse icons for parent settings (settings that have dependents)
     * @param {HTMLElement} container - Settings container
     */
    setupParentCollapseIcons(container) {
        const allSettings = container.querySelectorAll('.toolasha-setting');

        allSettings.forEach((setting) => {
            const settingId = setting.dataset.settingId;

            // Find all dependents of this setting
            const dependents = Array.from(allSettings).filter(
                (s) => s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
            );

            if (dependents.length > 0) {
                // This setting has dependents - show collapse icon
                const collapseIcon = setting.querySelector('.setting-collapse-icon');
                if (collapseIcon) {
                    collapseIcon.style.display = 'inline-block';

                    // Add click handler to toggle dependents - bind to preserve this context
                    const labelContainer = setting.querySelector('.toolasha-setting-label-container');
                    labelContainer.style.cursor = 'pointer';
                    labelContainer.addEventListener('click', (e) => {
                        // Don't toggle if clicking the input itself
                        if (e.target.closest('.toolasha-setting-input')) return;

                        this.toggleDependents(setting, dependents);
                    });
                }
            }
        });
    }

    /**
     * Toggle group collapse/expand
     * @param {HTMLElement} groupContainer - Group container element
     */
    toggleGroup(groupContainer) {
        groupContainer.classList.toggle('collapsed');

        // Save collapse state to IndexedDB storage
        const groupKey = groupContainer.dataset.group;
        const isCollapsed = groupContainer.classList.contains('collapsed');
        this.saveCollapseState('group', groupKey, isCollapsed);
    }

    /**
     * Toggle dependent settings visibility
     * @param {HTMLElement} parentSetting - Parent setting element
     * @param {HTMLElement[]} dependents - Array of dependent setting elements
     */
    toggleDependents(parentSetting, dependents) {
        const collapseIcon = parentSetting.querySelector('.setting-collapse-icon');
        const isCollapsed = parentSetting.classList.contains('dependents-collapsed');

        if (isCollapsed) {
            // Expand
            parentSetting.classList.remove('dependents-collapsed');
            collapseIcon.style.transform = 'rotate(0deg)';
            dependents.forEach((dep) => (dep.style.display = 'flex'));
        } else {
            // Collapse
            parentSetting.classList.add('dependents-collapsed');
            collapseIcon.style.transform = 'rotate(-90deg)';
            dependents.forEach((dep) => (dep.style.display = 'none'));
        }

        // Save collapse state to IndexedDB storage
        const settingId = parentSetting.dataset.settingId;
        const newState = !isCollapsed; // Inverted because we just toggled
        this.saveCollapseState('setting', settingId, newState);
    }

    /**
     * Save collapse state to IndexedDB
     * @param {string} type - 'group' or 'setting'
     * @param {string} key - Group key or setting ID
     * @param {boolean} isCollapsed - Whether collapsed
     */
    async saveCollapseState(type, key, isCollapsed) {
        try {
            const states = await storage.getJSON('collapse-states', 'settings', {});

            if (!states[type]) {
                states[type] = {};
            }
            states[type][key] = isCollapsed;

            await storage.setJSON('collapse-states', states, 'settings');
        } catch (e) {
            console.warn('[Toolasha Settings] Failed to save collapse states:', e);
        }
    }

    /**
     * Load collapse state from IndexedDB
     * @param {string} type - 'group' or 'setting'
     * @param {string} key - Group key or setting ID
     * @returns {Promise<boolean|null>} Collapse state or null if not found
     */
    async loadCollapseState(type, key) {
        try {
            const states = await storage.getJSON('collapse-states', 'settings', {});
            return states[type]?.[key] ?? null;
        } catch (e) {
            console.warn('[Toolasha Settings] Failed to load collapse states:', e);
            return null;
        }
    }

    /**
     * Restore collapse states from IndexedDB
     * @param {HTMLElement} container - Settings container
     */
    async restoreCollapseStates(container) {
        try {
            // Restore group collapse states
            const groups = container.querySelectorAll('.toolasha-settings-group');
            for (const group of groups) {
                const groupKey = group.dataset.group;
                const isCollapsed = await this.loadCollapseState('group', groupKey);
                if (isCollapsed === true) {
                    group.classList.add('collapsed');
                }
            }

            // Restore setting collapse states
            const settings = container.querySelectorAll('.toolasha-setting');
            for (const setting of settings) {
                const settingId = setting.dataset.settingId;
                const isCollapsed = await this.loadCollapseState('setting', settingId);

                if (isCollapsed === true) {
                    setting.classList.add('dependents-collapsed');

                    // Update collapse icon rotation
                    const collapseIcon = setting.querySelector('.setting-collapse-icon');
                    if (collapseIcon) {
                        collapseIcon.style.transform = 'rotate(-90deg)';
                    }

                    // Hide dependents
                    const allSettings = container.querySelectorAll('.toolasha-setting');
                    const dependents = Array.from(allSettings).filter(
                        (s) => s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
                    );
                    dependents.forEach((dep) => (dep.style.display = 'none'));
                }
            }
        } catch (e) {
            console.warn('[Toolasha Settings] Failed to restore collapse states:', e);
        }
    }

    /**
     * Create a single setting UI element
     * @param {string} settingId - Setting ID
     * @param {Object} settingDef - Setting definition
     * @returns {HTMLElement} Setting element
     */
    createSettingElement(settingId, settingDef) {
        const div = document.createElement('div');
        div.className = 'toolasha-setting';
        div.dataset.settingId = settingId;
        div.dataset.type = settingDef.type || 'checkbox';

        // Add dependency class and store dependency info
        if (settingDef.dependencies) {
            div.classList.add('has-dependency');

            // Handle both array format (legacy, AND logic) and object format (supports OR logic)
            if (Array.isArray(settingDef.dependencies)) {
                // Legacy format: ['dep1', 'dep2'] means AND logic
                div.dataset.dependencies = settingDef.dependencies.join(',');
                div.dataset.dependencyMode = 'all'; // AND logic
            } else if (typeof settingDef.dependencies === 'object') {
                // New format: {mode: 'any', settings: ['dep1', 'dep2']}
                div.dataset.dependencies = settingDef.dependencies.settings.join(',');
                div.dataset.dependencyMode = settingDef.dependencies.mode || 'all'; // 'any' = OR, 'all' = AND
            }
        }

        // Add not-implemented class for red text
        if (settingDef.notImplemented) {
            div.classList.add('not-implemented');
        }

        // Create label container (clickable for collapse if has dependents)
        const labelContainer = document.createElement('div');
        labelContainer.className = 'toolasha-setting-label-container';
        labelContainer.style.display = 'flex';
        labelContainer.style.alignItems = 'center';
        labelContainer.style.flex = '1';
        labelContainer.style.gap = '6px';

        // Add collapse icon if this setting has dependents (will be populated by checkDependents)
        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'setting-collapse-icon';
        collapseIcon.textContent = '▼';
        collapseIcon.style.display = 'none'; // Hidden by default, shown if dependents exist
        collapseIcon.style.cursor = 'pointer';
        collapseIcon.style.fontSize = '10px';
        collapseIcon.style.transition = 'transform 0.2s ease';

        // Create label
        const label = document.createElement('span');
        label.className = 'toolasha-setting-label';
        label.textContent = settingDef.label;

        // Add help text if present
        if (settingDef.help) {
            const help = document.createElement('span');
            help.className = 'toolasha-setting-help';
            help.textContent = settingDef.help;
            label.appendChild(help);
        }

        labelContainer.appendChild(collapseIcon);
        labelContainer.appendChild(label);

        // Create input
        const inputHTML = this.generateSettingInput(settingId, settingDef);
        const inputContainer = document.createElement('div');
        inputContainer.className = 'toolasha-setting-input';
        inputContainer.innerHTML = inputHTML;

        div.appendChild(labelContainer);
        div.appendChild(inputContainer);

        return div;
    }

    /**
     * Generate input HTML for a setting
     * @param {string} settingId - Setting ID
     * @param {Object} settingDef - Setting definition
     * @returns {string} Input HTML
     */
    generateSettingInput(settingId, settingDef) {
        const currentSetting = this.currentSettings[settingId];
        const type = settingDef.type || 'checkbox';

        switch (type) {
            case 'checkbox': {
                const checked = currentSetting?.isTrue ?? settingDef.default ?? false;
                return `
                    <label class="toolasha-switch">
                        <input type="checkbox" id="${settingId}" ${checked ? 'checked' : ''}>
                        <span class="toolasha-slider"></span>
                    </label>
                `;
            }

            case 'text': {
                const value = currentSetting?.value ?? settingDef.default ?? '';
                return `
                    <input type="text"
                        id="${settingId}"
                        class="toolasha-text-input"
                        value="${value}"
                        placeholder="${settingDef.placeholder || ''}">
                `;
            }

            case 'template': {
                const value = currentSetting?.value ?? settingDef.default ?? [];
                // Store as JSON string
                const jsonValue = JSON.stringify(value);
                const escapedValue = jsonValue.replace(/"/g, '&quot;');

                return `
                    <input type="hidden"
                        id="${settingId}"
                        value="${escapedValue}">
                    <button type="button"
                        class="toolasha-template-edit-btn"
                        data-setting-id="${settingId}"
                        style="
                            background: #4a7c59;
                            border: 1px solid #5a8c69;
                            border-radius: 4px;
                            padding: 6px 12px;
                            color: #e0e0e0;
                            cursor: pointer;
                            font-size: 13px;
                            white-space: nowrap;
                            transition: all 0.2s;
                        ">
                        Edit Template
                    </button>
                `;
            }

            case 'number': {
                const value = currentSetting?.value ?? settingDef.default ?? 0;
                return `
                    <input type="number"
                        id="${settingId}"
                        class="toolasha-number-input"
                        value="${value}"
                        min="${settingDef.min ?? ''}"
                        max="${settingDef.max ?? ''}"
                        step="${settingDef.step ?? '1'}">
                `;
            }

            case 'select': {
                const value = currentSetting?.value ?? settingDef.default ?? '';
                const options = settingDef.options || [];
                const optionsHTML = options
                    .map((option) => {
                        const optValue = typeof option === 'object' ? option.value : option;
                        const optLabel = typeof option === 'object' ? option.label : option;
                        const selected = optValue === value ? 'selected' : '';
                        return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
                    })
                    .join('');

                return `
                    <select id="${settingId}" class="toolasha-select-input">
                        ${optionsHTML}
                    </select>
                `;
            }

            case 'color': {
                const value = currentSetting?.value ?? settingDef.value ?? settingDef.default ?? '#000000';
                return `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color"
                            id="${settingId}"
                            class="toolasha-color-input"
                            value="${value}">
                        <input type="text"
                            id="${settingId}_text"
                            class="toolasha-color-text-input"
                            value="${value}"
                            style="width: 80px; padding: 4px; background: #2a2a2a; color: white; border: 1px solid #555; border-radius: 3px;"
                            readonly>
                    </div>
                `;
            }

            case 'slider': {
                const value = currentSetting?.value ?? settingDef.default ?? 0;
                return `
                    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                        <input type="range"
                            id="${settingId}"
                            class="toolasha-slider-input"
                            value="${value}"
                            min="${settingDef.min ?? 0}"
                            max="${settingDef.max ?? 1}"
                            step="${settingDef.step ?? 0.01}"
                            style="flex: 1;">
                        <span id="${settingId}_value" class="toolasha-slider-value" style="min-width: 50px; color: #aaa; font-size: 0.9em;">${value}</span>
                    </div>
                `;
            }

            default:
                return `<span style="color: red;">Unknown type: ${type}</span>`;
        }
    }

    /**
     * Add search box to filter settings
     * @param {HTMLElement} container - Container element
     */
    addSearchBox(container) {
        const searchContainer = document.createElement('div');
        searchContainer.className = 'toolasha-search-container';
        searchContainer.style.cssText = `
            margin-bottom: 20px;
            display: flex;
            gap: 8px;
            align-items: center;
        `;

        // Search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'toolasha-search-input';
        searchInput.placeholder = 'Search settings...';
        searchInput.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            background: #2a2a2a;
            color: white;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 14px;
        `;

        // Clear button
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear';
        clearButton.className = 'toolasha-search-clear';
        clearButton.style.cssText = `
            padding: 8px 16px;
            background: #444;
            color: white;
            border: 1px solid #555;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        `;
        clearButton.style.display = 'none'; // Hidden by default

        // Filter function
        const filterSettings = (query) => {
            const lowerQuery = query.toLowerCase().trim();

            // If query is empty, show everything
            if (!lowerQuery) {
                // Show all settings
                document.querySelectorAll('.toolasha-setting').forEach((setting) => {
                    setting.style.display = 'flex';
                });
                // Show all groups
                document.querySelectorAll('.toolasha-settings-group').forEach((group) => {
                    group.style.display = 'block';
                });
                clearButton.style.display = 'none';
                return;
            }

            clearButton.style.display = 'block';

            // Filter settings
            document.querySelectorAll('.toolasha-settings-group').forEach((group) => {
                let visibleCount = 0;

                group.querySelectorAll('.toolasha-setting').forEach((setting) => {
                    const label = setting.querySelector('.toolasha-setting-label')?.textContent || '';
                    const help = setting.querySelector('.toolasha-setting-help')?.textContent || '';
                    const searchText = (label + ' ' + help).toLowerCase();

                    if (searchText.includes(lowerQuery)) {
                        setting.style.display = 'flex';
                        visibleCount++;
                    } else {
                        setting.style.display = 'none';
                    }
                });

                // Hide group if no visible settings
                if (visibleCount === 0) {
                    group.style.display = 'none';
                } else {
                    group.style.display = 'block';
                }
            });
        };

        // Input event listener
        searchInput.addEventListener('input', (e) => {
            filterSettings(e.target.value);
        });

        // Clear button event listener
        clearButton.addEventListener('click', () => {
            searchInput.value = '';
            filterSettings('');
            searchInput.focus();
        });

        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(clearButton);
        container.appendChild(searchContainer);
    }

    /**
     * Add utility buttons (Reset, Export, Import, Fetch Prices)
     * @param {HTMLElement} container - Container element
     */
    addUtilityButtons(container) {
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'toolasha-utility-buttons';

        // Sync button (at top - most important)
        const syncBtn = document.createElement('button');
        syncBtn.textContent = 'Copy Settings to All Characters';
        syncBtn.className = 'toolasha-utility-button toolasha-sync-button';
        syncBtn.addEventListener('click', () => this.handleSync());

        // Fetch Latest Prices button
        const fetchPricesBtn = document.createElement('button');
        fetchPricesBtn.textContent = '🔄 Fetch Latest Prices';
        fetchPricesBtn.className = 'toolasha-utility-button toolasha-fetch-prices-button';
        fetchPricesBtn.addEventListener('click', () => this.handleFetchPrices(fetchPricesBtn));

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset to Defaults';
        resetBtn.className = 'toolasha-utility-button';
        resetBtn.addEventListener('click', () => this.handleReset());

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export Settings';
        exportBtn.className = 'toolasha-utility-button';
        exportBtn.addEventListener('click', () => this.handleExport());

        // Import button
        const importBtn = document.createElement('button');
        importBtn.textContent = 'Import Settings';
        importBtn.className = 'toolasha-utility-button';
        importBtn.addEventListener('click', () => this.handleImport());

        buttonsDiv.appendChild(syncBtn);
        buttonsDiv.appendChild(fetchPricesBtn);
        buttonsDiv.appendChild(resetBtn);
        buttonsDiv.appendChild(exportBtn);
        buttonsDiv.appendChild(importBtn);

        container.appendChild(buttonsDiv);
    }

    /**
     * Add refresh notice
     * @param {HTMLElement} container - Container element
     */
    addRefreshNotice(container) {
        const notice = document.createElement('div');
        notice.className = 'toolasha-refresh-notice';
        notice.textContent = 'Some settings require a page refresh to take effect';
        container.appendChild(notice);
    }

    /**
     * Setup tab switching functionality
     * @param {HTMLElement} tabButton - Toolasha tab button
     * @param {HTMLElement} tabPanel - Toolasha tab panel
     * @param {HTMLElement[]} existingTabs - Existing tab buttons
     * @param {HTMLElement} tabPanelsContainer - Tab panels container
     */
    setupTabSwitching(tabButton, tabPanel, existingTabs, tabPanelsContainer) {
        const switchToTab = (targetButton, targetPanel) => {
            // Hide all panels
            const allPanels = tabPanelsContainer.querySelectorAll('[class*="TabPanel_tabPanel"]');
            allPanels.forEach((panel) => {
                panel.style.display = 'none';
                panel.classList.add('TabPanel_hidden__26UM3');
            });

            // Deactivate all buttons
            const allButtons = document.querySelectorAll('button[role="tab"]');
            allButtons.forEach((btn) => {
                btn.setAttribute('aria-selected', 'false');
                btn.setAttribute('tabindex', '-1');
                btn.classList.remove('Mui-selected');
            });

            // Activate target
            targetButton.setAttribute('aria-selected', 'true');
            targetButton.setAttribute('tabindex', '0');
            targetButton.classList.add('Mui-selected');
            targetPanel.style.display = 'block';
            targetPanel.classList.remove('TabPanel_hidden__26UM3');

            // Update title
            const titleEl = document.querySelector('[class*="SettingsPanel_title"]');
            if (titleEl) {
                if (targetButton.id === 'toolasha-settings-tab') {
                    titleEl.textContent = '⚙️ Toolasha Settings (refresh to apply)';
                } else {
                    titleEl.textContent = 'Settings';
                }
            }
        };

        // Click handler for Toolasha tab
        tabButton.addEventListener('click', () => {
            switchToTab(tabButton, tabPanel);
        });

        // Click handlers for existing tabs
        existingTabs.forEach((existingTab, index) => {
            existingTab.addEventListener('click', () => {
                const correspondingPanel = tabPanelsContainer.children[index];
                if (correspondingPanel) {
                    switchToTab(existingTab, correspondingPanel);
                }
            });
        });
    }

    /**
     * Handle setting change
     * @param {Event} event - Change event
     */
    async handleSettingChange(event) {
        const input = event.target;
        if (!input.id) return;

        const settingId = input.id;
        const type = input.closest('.toolasha-setting')?.dataset.type || 'checkbox';

        let value;

        // Get value based on type
        if (type === 'checkbox') {
            value = input.checked;
        } else if (type === 'number' || type === 'slider') {
            value = parseFloat(input.value) || 0;
            // Update the slider value display if it's a slider
            if (type === 'slider') {
                const valueDisplay = document.getElementById(`${settingId}_value`);
                if (valueDisplay) {
                    valueDisplay.textContent = value;
                }
            }
        } else if (type === 'color') {
            value = input.value;
            // Update the text display
            const textInput = document.getElementById(`${settingId}_text`);
            if (textInput) {
                textInput.value = value;
            }
        } else {
            value = input.value;
        }

        // Save to storage
        await settingsStorage.setSetting(settingId, value);

        // Update local cache immediately
        if (!this.currentSettings[settingId]) {
            this.currentSettings[settingId] = {};
        }
        if (type === 'checkbox') {
            this.currentSettings[settingId].isTrue = value;
        } else {
            this.currentSettings[settingId].value = value;
        }

        // Update config module (for backward compatibility)
        if (type === 'checkbox') {
            this.config.setSetting(settingId, value);
        } else {
            this.config.setSettingValue(settingId, value);
        }

        // Apply color settings immediately if this is a color setting
        if (type === 'color') {
            this.config.applyColorSettings();
        }

        // Update dependencies
        this.updateDependencies();
    }

    /**
     * Update dependency states (enable/disable dependent settings)
     */
    updateDependencies() {
        const settings = document.querySelectorAll('.toolasha-setting[data-dependencies]');

        settings.forEach((settingEl) => {
            const dependencies = settingEl.dataset.dependencies.split(',');
            const mode = settingEl.dataset.dependencyMode || 'all'; // 'all' = AND, 'any' = OR
            let enabled = false;

            if (mode === 'any') {
                // OR logic: at least one dependency must be met
                for (const depId of dependencies) {
                    const depInput = document.getElementById(depId);
                    if (depInput && depInput.type === 'checkbox' && depInput.checked) {
                        enabled = true;
                        break; // Found at least one enabled, that's enough
                    }
                }
            } else {
                // AND logic (default): all dependencies must be met
                enabled = true; // Assume enabled, then check all
                for (const depId of dependencies) {
                    const depInput = document.getElementById(depId);
                    if (depInput && depInput.type === 'checkbox' && !depInput.checked) {
                        enabled = false;
                        break; // Found one disabled, no need to check rest
                    }
                }
            }

            // Enable or disable
            if (enabled) {
                settingEl.classList.remove('disabled');
            } else {
                settingEl.classList.add('disabled');
            }
        });
    }

    /**
     * Handle sync settings to all characters
     */
    async handleSync() {
        // Get character count to show in confirmation
        const characterCount = await this.config.getKnownCharacterCount();

        // If only 1 character (current), no need to sync
        if (characterCount <= 1) {
            alert('You only have one character. Settings are already saved for this character.');
            return;
        }

        // Confirm action
        const otherCharacters = characterCount - 1;
        const message = `This will copy your current settings to ${otherCharacters} other character${otherCharacters > 1 ? 's' : ''}. Their existing settings will be overwritten.\n\nContinue?`;

        if (!confirm(message)) {
            return;
        }

        // Perform sync
        const result = await this.config.syncSettingsToAllCharacters();

        // Show result
        if (result.success) {
            alert(`Settings successfully copied to ${result.count} character${result.count > 1 ? 's' : ''}!`);
        } else {
            alert(`Failed to sync settings: ${result.error || 'Unknown error'}`);
        }
    }

    /**
     * Handle fetch latest prices
     * @param {HTMLElement} button - Button element for state updates
     */
    async handleFetchPrices(button) {
        // Disable button and show loading state
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '⏳ Fetching...';

        try {
            // Clear cache and fetch fresh data
            const result = await marketAPI.clearCacheAndRefetch();

            if (result) {
                // Success - clear listing price display cache to force re-render
                document.querySelectorAll('.mwi-listing-prices-set').forEach((table) => {
                    table.classList.remove('mwi-listing-prices-set');
                });

                // Show success state
                button.textContent = '✅ Updated!';
                button.style.backgroundColor = '#00ff00';
                button.style.color = '#000';

                // Reset button after 2 seconds
                const resetSuccessTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.backgroundColor = '';
                    button.style.color = '';
                    button.disabled = false;
                }, 2000);
                this.timerRegistry.registerTimeout(resetSuccessTimeout);
            } else {
                // Failed - show error state
                button.textContent = '❌ Failed';
                button.style.backgroundColor = '#ff0000';

                // Reset button after 3 seconds
                const resetFailureTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.backgroundColor = '';
                    button.disabled = false;
                }, 3000);
                this.timerRegistry.registerTimeout(resetFailureTimeout);
            }
        } catch (error) {
            console.error('[SettingsUI] Fetch prices failed:', error);

            // Show error state
            button.textContent = '❌ Error';
            button.style.backgroundColor = '#ff0000';

            // Reset button after 3 seconds
            const resetErrorTimeout = setTimeout(() => {
                button.textContent = originalText;
                button.style.backgroundColor = '';
                button.disabled = false;
            }, 3000);
            this.timerRegistry.registerTimeout(resetErrorTimeout);
        }
    }

    /**
     * Handle reset to defaults
     */
    async handleReset() {
        if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
            return;
        }

        await settingsStorage.resetToDefaults();
        await this.config.resetToDefaults();

        alert('Settings reset to defaults. Please refresh the page.');
        window.location.reload();
    }

    /**
     * Handle export settings
     */
    async handleExport() {
        const json = await settingsStorage.exportSettings();

        // Create download
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `toolasha-settings-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Handle import settings
     */
    async handleImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const success = await settingsStorage.importSettings(text);

                if (success) {
                    alert('Settings imported successfully. Please refresh the page.');
                    window.location.reload();
                } else {
                    alert('Failed to import settings. Please check the file format.');
                }
            } catch (error) {
                console.error('[Toolasha Settings] Import error:', error);
                alert('Failed to import settings.');
            }
        });

        input.click();
    }

    /**
     * Open template editor modal
     * @param {string} settingId - Setting ID
     */
    openTemplateEditor(settingId) {
        const setting = this.findSettingDef(settingId);
        if (!setting || !setting.templateVariables) {
            return;
        }

        const input = document.getElementById(settingId);
        let currentValue = setting.default;

        // Try to parse stored value
        if (input && input.value) {
            try {
                const parsed = JSON.parse(input.value);
                if (Array.isArray(parsed)) {
                    currentValue = parsed;
                }
            } catch (e) {
                console.error('[Settings] Failed to parse template value:', e);
            }
        }

        // Ensure currentValue is an array
        if (!Array.isArray(currentValue)) {
            currentValue = setting.default || [];
        }

        // Deep clone to avoid mutating original
        const templateItems = JSON.parse(JSON.stringify(currentValue));

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'toolasha-template-editor-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'toolasha-template-editor-modal';
        modal.style.cssText = `
            background: #1a1a1a;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            padding: 20px;
            max-width: 700px;
            width: 90%;
            max-height: 90%;
            overflow-y: auto;
            color: #e0e0e0;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #3a3a3a;
            padding-bottom: 10px;
        `;
        header.innerHTML = `
            <h3 style="margin: 0; color: #e0e0e0;">Edit Template</h3>
            <button class="toolasha-template-close-btn" style="
                background: none;
                border: none;
                color: #e0e0e0;
                font-size: 32px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            ">×</button>
        `;

        // Template list section
        const listSection = document.createElement('div');
        listSection.style.cssText = 'margin-bottom: 20px;';
        listSection.innerHTML =
            '<h4 style="margin: 0 0 10px 0; color: #e0e0e0;">Template Items (drag to reorder):</h4>';

        const listContainer = document.createElement('div');
        listContainer.className = 'toolasha-template-list';
        listContainer.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 10px;
            min-height: 200px;
            max-height: 300px;
            overflow-y: auto;
        `;

        const renderList = () => {
            listContainer.innerHTML = '';
            templateItems.forEach((item, index) => {
                const itemEl = this.createTemplateListItem(item, index, templateItems, renderList);
                listContainer.appendChild(itemEl);
            });
        };

        renderList();
        listSection.appendChild(listContainer);

        // Available variables section
        const variablesSection = document.createElement('div');
        variablesSection.style.cssText = 'margin-bottom: 20px;';
        variablesSection.innerHTML = '<h4 style="margin: 0 0 10px 0; color: #e0e0e0;">Add Variable:</h4>';

        const variablesContainer = document.createElement('div');
        variablesContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        `;

        for (const variable of setting.templateVariables) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = '+  ' + variable.label;
            chip.title = variable.description;
            chip.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #4a4a4a;
                border-radius: 4px;
                padding: 6px 12px;
                color: #e0e0e0;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
            `;
            chip.onmouseover = () => {
                chip.style.background = '#3a3a3a';
                chip.style.borderColor = '#5a5a5a';
            };
            chip.onmouseout = () => {
                chip.style.background = '#2a2a2a';
                chip.style.borderColor = '#4a4a4a';
            };
            chip.onclick = () => {
                templateItems.push({
                    type: 'variable',
                    key: variable.key,
                    label: variable.label,
                });
                renderList();
            };
            variablesContainer.appendChild(chip);
        }

        // Add text button
        const addTextBtn = document.createElement('button');
        addTextBtn.type = 'button';
        addTextBtn.textContent = '+ Add Text';
        addTextBtn.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 6px 12px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
        `;
        addTextBtn.onmouseover = () => {
            addTextBtn.style.background = '#3a3a3a';
            addTextBtn.style.borderColor = '#5a5a5a';
        };
        addTextBtn.onmouseout = () => {
            addTextBtn.style.background = '#2a2a2a';
            addTextBtn.style.borderColor = '#4a4a4a';
        };
        addTextBtn.onclick = () => {
            const text = prompt('Enter text:');
            if (text !== null && text !== '') {
                templateItems.push({
                    type: 'text',
                    value: text,
                });
                renderList();
            }
        };

        variablesContainer.appendChild(addTextBtn);
        variablesSection.appendChild(variablesContainer);

        // Buttons
        const buttonsSection = document.createElement('div');
        buttonsSection.style.cssText = `
            display: flex;
            gap: 10px;
            justify-content: space-between;
            margin-top: 20px;
        `;

        // Restore to Default button (left side)
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.textContent = 'Restore to Default';
        restoreBtn.style.cssText = `
            background: #6b5b3a;
            border: 1px solid #8b7b5a;
            border-radius: 4px;
            padding: 8px 16px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
        `;
        restoreBtn.onclick = () => {
            if (confirm('Reset template to default? This will discard your current template.')) {
                // Reset to default
                templateItems.length = 0;
                const defaultTemplate = setting.default || [];
                templateItems.push(...JSON.parse(JSON.stringify(defaultTemplate)));
                renderList();
            }
        };

        // Right side buttons container
        const rightButtons = document.createElement('div');
        rightButtons.style.cssText = 'display: flex; gap: 10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 8px 16px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
        `;
        cancelBtn.onclick = () => overlay.remove();

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = `
            background: #4a7c59;
            border: 1px solid #5a8c69;
            border-radius: 4px;
            padding: 8px 16px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
        `;
        saveBtn.onclick = () => {
            const input = document.getElementById(settingId);
            if (input) {
                input.value = JSON.stringify(templateItems);
                // Trigger change event
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            overlay.remove();
        };

        rightButtons.appendChild(cancelBtn);
        rightButtons.appendChild(saveBtn);

        buttonsSection.appendChild(restoreBtn);
        buttonsSection.appendChild(rightButtons);

        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(listSection);
        modal.appendChild(variablesSection);
        modal.appendChild(buttonsSection);
        overlay.appendChild(modal);

        // Close button handler
        header.querySelector('.toolasha-template-close-btn').onclick = () => overlay.remove();

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        };

        // Add to page
        document.body.appendChild(overlay);
    }

    /**
     * Create a draggable template list item
     * @param {Object} item - Template item
     * @param {number} index - Item index
     * @param {Array} items - All items
     * @param {Function} renderList - Callback to re-render list
     * @returns {HTMLElement} List item element
     */
    createTemplateListItem(item, index, items, renderList) {
        const itemEl = document.createElement('div');
        itemEl.draggable = true;
        itemEl.dataset.index = index;
        itemEl.style.cssText = `
            background: #1a1a1a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: move;
            transition: all 0.2s;
        `;

        // Drag handle
        const dragHandle = document.createElement('span');
        dragHandle.textContent = '⋮⋮';
        dragHandle.style.cssText = `
            color: #666;
            font-size: 16px;
            cursor: move;
        `;

        // Content
        const content = document.createElement('div');
        content.style.cssText = 'flex: 1; color: #e0e0e0; font-size: 13px;';

        if (item.type === 'variable') {
            content.innerHTML = `<strong style="color: #4a9eff;">${item.label}</strong> <span style="color: #666; font-family: monospace;">${item.key}</span>`;
        } else {
            // Editable text
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.value = item.value;
            textInput.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #4a4a4a;
                border-radius: 3px;
                padding: 4px 8px;
                color: #e0e0e0;
                font-size: 13px;
                width: 100%;
            `;
            textInput.onchange = () => {
                items[index].value = textInput.value;
            };
            content.appendChild(textInput);
        }

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Remove';
        deleteBtn.style.cssText = `
            background: #8b0000;
            border: 1px solid #a00000;
            border-radius: 3px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            padding: 4px 8px;
            transition: all 0.2s;
        `;
        deleteBtn.onmouseover = () => {
            deleteBtn.style.background = '#a00000';
        };
        deleteBtn.onmouseout = () => {
            deleteBtn.style.background = '#8b0000';
        };
        deleteBtn.onclick = () => {
            items.splice(index, 1);
            renderList();
        };

        // Drag events
        itemEl.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
            itemEl.style.opacity = '0.5';
        };

        itemEl.ondragend = () => {
            itemEl.style.opacity = '1';
        };

        itemEl.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            itemEl.style.borderColor = '#4a9eff';
        };

        itemEl.ondragleave = () => {
            itemEl.style.borderColor = '#4a4a4a';
        };

        itemEl.ondrop = (e) => {
            e.preventDefault();
            itemEl.style.borderColor = '#4a4a4a';

            const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const dropIndex = index;

            if (dragIndex !== dropIndex) {
                // Remove from old position
                const [movedItem] = items.splice(dragIndex, 1);
                // Insert at new position
                items.splice(dropIndex, 0, movedItem);
                renderList();
            }
        };

        itemEl.appendChild(dragHandle);
        itemEl.appendChild(content);
        itemEl.appendChild(deleteBtn);

        return itemEl;
    }

    /**
     * Find setting definition by ID
     * @param {string} settingId - Setting ID
     * @returns {Object|null} Setting definition
     */
    findSettingDef(settingId) {
        for (const group of Object.values(settingsGroups)) {
            if (group.settings[settingId]) {
                return group.settings[settingId];
            }
        }
        return null;
    }

    /**
     * Cleanup for full shutdown (not character switching)
     * Unregisters event listeners and removes all DOM elements
     */
    cleanup() {
        // Clean up DOM elements first
        this.cleanupDOM();

        if (this.characterSwitchHandler) {
            dataManager.off('character_initialized', this.characterSwitchHandler);
            this.characterSwitchHandler = null;
        }

        this.timerRegistry.clearAll();
    }
}

const settingsUI = new SettingsUI();

export default settingsUI;
