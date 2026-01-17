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

class SettingsUI {
    constructor() {
        this.config = config;
        this.settingsPanel = null;
        this.settingsObserver = null;
        this.currentSettings = {};
        this.isInjecting = false; // Guard against concurrent injection
        this.characterSwitchHandler = null; // Store listener reference to prevent duplicates
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
     * Handle character switch
     * Clean up old observers and re-initialize for new character's settings panel
     */
    handleCharacterSwitch() {
        // Clean up old DOM references and observers (but keep listener registered)
        this.cleanupDOM();

        // Wait for settings panel to stabilize before re-observing
        setTimeout(() => {
            this.observeSettingsPanel();
        }, 500);
    }

    /**
     * Cleanup DOM elements and observers only (internal cleanup during character switch)
     */
    cleanupDOM() {
        // Stop observer
        if (this.settingsObserver) {
            this.settingsObserver.disconnect();
            this.settingsObserver = null;
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
                setTimeout(startObserver, 10);
                return;
            }

            const observer = new MutationObserver((mutations) => {
                // Look for the settings tabs container
                const tabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

                if (tabsContainer) {
                    // Check if our tab already exists before injecting
                    if (!tabsContainer.querySelector('#toolasha-settings-tab')) {
                        this.injectSettingsTab();
                    }
                    // Keep observer running - panel might be removed/re-added if user navigates away and back
                }
            });

            // Observe the main game panel for changes
            const gamePanel = document.querySelector('div[class*="GamePage_gamePanel"]');
            if (gamePanel) {
                observer.observe(gamePanel, {
                    childList: true,
                    subtree: true
                });
            } else {
                // Fallback: observe entire body if game panel not found (Firefox timing issue)
                console.warn('[Toolasha Settings] Could not find game panel, observing body instead');
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }

            // Store observer reference
            this.settingsObserver = observer;

            // Also check immediately in case settings is already open
            const existingTabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');
            if (existingTabsContainer && !existingTabsContainer.querySelector('#toolasha-settings-tab')) {
                this.injectSettingsTab();
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
            const tabPanelsContainer = tabsComponentContainer.querySelector('[class*="TabsComponent_tabPanelsContainer"]');

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

        // Generate settings from config
        this.generateSettings(card);

        // Add utility buttons
        this.addUtilityButtons(card);

        // Add refresh notice
        this.addRefreshNotice(card);

        panel.appendChild(card);

        // Add change listener
        card.addEventListener('change', (e) => this.handleSettingChange(e));

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

        // Restore collapse states from localStorage
        this.restoreCollapseStates(container);
    }

    /**
     * Setup collapse icons for parent settings (settings that have dependents)
     * @param {HTMLElement} container - Settings container
     */
    setupParentCollapseIcons(container) {
        const allSettings = container.querySelectorAll('.toolasha-setting');

        allSettings.forEach(setting => {
            const settingId = setting.dataset.settingId;

            // Find all dependents of this setting
            const dependents = Array.from(allSettings).filter(s =>
                s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
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

        // Save collapse state to localStorage
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
            dependents.forEach(dep => dep.style.display = 'flex');
        } else {
            // Collapse
            parentSetting.classList.add('dependents-collapsed');
            collapseIcon.style.transform = 'rotate(-90deg)';
            dependents.forEach(dep => dep.style.display = 'none');
        }

        // Save collapse state to localStorage
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
                    const dependents = Array.from(allSettings).filter(s =>
                        s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
                    );
                    dependents.forEach(dep => dep.style.display = 'none');
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

        // Add dependency class and make parent settings collapsible
        if (settingDef.dependencies && settingDef.dependencies.length > 0) {
            div.classList.add('has-dependency');
            div.dataset.dependencies = settingDef.dependencies.join(',');
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
                const optionsHTML = options.map(option => {
                    const optValue = typeof option === 'object' ? option.value : option;
                    const optLabel = typeof option === 'object' ? option.label : option;
                    const selected = optValue === value ? 'selected' : '';
                    return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
                }).join('');

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
     * Add utility buttons (Reset, Export, Import)
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
            allPanels.forEach(panel => {
                panel.style.display = 'none';
                panel.classList.add('TabPanel_hidden__26UM3');
            });

            // Deactivate all buttons
            const allButtons = document.querySelectorAll('button[role="tab"]');
            allButtons.forEach(btn => {
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

        settings.forEach(settingEl => {
            const dependencies = settingEl.dataset.dependencies.split(',');
            let enabled = true;

            // Check if all dependencies are met
            for (const depId of dependencies) {
                const depInput = document.getElementById(depId);
                if (depInput && depInput.type === 'checkbox' && !depInput.checked) {
                    enabled = false;
                    break;
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
     * Cleanup for full shutdown (not character switching)
     * Unregisters event listeners and removes all DOM elements
     */
    cleanup() {
        // Clean up DOM elements first
        this.cleanupDOM();

        // Unregister character switch listener
        if (this.characterSwitchHandler) {
            dataManager.off('character_initialized', this.characterSwitchHandler);
            this.characterSwitchHandler = null;
        }
    }
}

// Create and export singleton instance
const settingsUI = new SettingsUI();

export default settingsUI;
