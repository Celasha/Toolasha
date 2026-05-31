/**
 * Foundation Core Library
 * Core infrastructure and API clients only (no utilities)
 *
 * Exports to: window.Toolasha.Core
 */

// Core modules
import storage from '../core/storage.js';
import config from '../core/config.js';
import webSocketHook from '../core/websocket.js';
import domObserver from '../core/dom-observer.js';
import dataManager from '../core/data-manager.js';
import featureRegistry from '../core/feature-registry.js';
import settingsStorage from '../core/settings-storage.js';
import { settingsGroups } from '../core/settings-schema.js';
import { setCurrentProfile, getCurrentProfile, clearCurrentProfile } from '../core/profile-manager.js';
import tooltipObserver from '../core/tooltip-observer.js';
import performanceMonitor from '../utils/performance-monitor.js';

// API modules
import marketAPI from '../api/marketplace.js';

// i18n - register Chinese translations
import '../core/i18n-zh-CN.js';

// Export to global namespace
const toolashaRoot = window.Toolasha || {};
window.Toolasha = toolashaRoot;

if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.Toolasha = toolashaRoot;
}

toolashaRoot.Core = {
    storage,
    config,
    webSocketHook,
    domObserver,
    dataManager,
    featureRegistry,
    settingsStorage,
    settingsGroups,
    tooltipObserver,
    profileManager: {
        setCurrentProfile,
        getCurrentProfile,
        clearCurrentProfile,
    },
    marketAPI,
    performanceMonitor,
};

console.log('[Toolasha] Core library loaded');
