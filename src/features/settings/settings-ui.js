/**
 * Settings UI Module
 * Injects Toolasha settings tab into the game's settings panel
 * Based on MWITools Extended approach
 */

import config from '../../core/config.js';
import { settingsGroups } from './settings-config.js';
import settingsStorage from './settings-storage.js';
import settingsCSS from './settings-styles.css?raw';

class SettingsUI {
    constructor() {
        this.config = config;
        this.settingsPanel = null;
        this.settingsObserver = null;
        this.currentSettings = {};
    }

    /**
     * Initialize the settings UI
     */
    async initialize() {
        // Inject CSS styles
        this.injectStyles();

        // Load current settings
        this.currentSettings = await settingsStorage.loadSettings();

        // Wait for game's settings panel to load
        this.observeSettingsPanel();
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
     */
    observeSettingsPanel() {
        this.settingsObserver = new MutationObserver(() => {
            // Look for settings panel container
            const settingsContainer = document.querySelector('[class*="SettingsPanel_container"]');

            if (settingsContainer && !this.settingsPanel) {
                // Found the settings panel - inject our tab
                this.injectSettingsTab();
                // Stop observing once injected
                this.settingsObserver.disconnect();
            }
        });

        this.settingsObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Inject Toolasha settings tab into game's settings panel
     */
    injectSettingsTab() {
        // Find tab containers
        const tabsContainer = document.querySelector('[class*="TabPanel_tabs"]');
        const tabPanelsContainer = document.querySelector('[class*="TabPanel_tabPanels"]');

        if (!tabsContainer || !tabPanelsContainer) {
            console.warn('[Toolasha Settings] Could not find tab containers');
            return;
        }

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

        console.log('✅ Toolasha settings tab injected');
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
            // Add section header
            const header = document.createElement('h3');
            header.innerHTML = `<span class="icon">${group.icon}</span> ${group.title}`;
            container.appendChild(header);

            // Add settings in this group
            for (const [settingId, settingDef] of Object.entries(group.settings)) {
                const settingEl = this.createSettingElement(settingId, settingDef);
                container.appendChild(settingEl);
            }
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

        // Add dependency class
        if (settingDef.dependencies && settingDef.dependencies.length > 0) {
            div.classList.add('has-dependency');
            div.dataset.dependencies = settingDef.dependencies.join(',');
        }

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

        // Create input
        const inputHTML = this.generateSettingInput(settingId, settingDef);
        const inputContainer = document.createElement('div');
        inputContainer.className = 'toolasha-setting-input';
        inputContainer.innerHTML = inputHTML;

        div.appendChild(label);
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
        } else if (type === 'number') {
            value = parseFloat(input.value) || 0;
        } else {
            value = input.value;
        }

        // Save to storage
        await settingsStorage.setSetting(settingId, value);

        // Update config module (for backward compatibility)
        if (type === 'checkbox') {
            this.config.setSetting(settingId, value);
        } else {
            this.config.setSettingValue(settingId, value);
        }

        // Update dependencies
        this.updateDependencies();

        console.log(`[Toolasha Settings] Updated ${settingId} = ${value}`);
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

        console.log('[Toolasha Settings] Settings exported');
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
}

// Create and export singleton instance
const settingsUI = new SettingsUI();

export default settingsUI;
