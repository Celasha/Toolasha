/**
 * MWI Tools - Main Entry Point
 * Refactored modular version
 */

import { numberFormatter, timeReadable } from './utils/formatters.js';
import storage from './core/storage.js';
import config from './core/config.js';
import webSocketHook from './core/websocket.js';
import DataManager from './core/data-manager.js';

console.log('MWI Tools (Refactored) - Initializing...');

// CRITICAL: Install WebSocket hook FIRST, before game connects
webSocketHook.install();

// Create Data Manager (connects to WebSocket hook)
const dataManager = new DataManager(webSocketHook);

// Initialize Data Manager after a delay (let game load localStorageUtil)
setTimeout(() => {
    dataManager.initialize();

    // Check static data after initialization
    setTimeout(() => {
        const initData = dataManager.getInitClientData();
        if (initData) {
            const itemCount = Object.keys(initData.itemDetailMap || {}).length;
            const actionCount = Object.keys(initData.actionDetailMap || {}).length;
            console.log(`[Data Manager] Static data loaded: ${itemCount} items, ${actionCount} actions`);
        }
    }, 500);
}, 1000);

// Test the formatters
console.log('\n=== Testing Formatters ===');
console.log('  1,500 =>', numberFormatter(1500));
console.log('  1,500,000 =>', numberFormatter(1500000));
console.log('  3,661 seconds =>', timeReadable(3661));
console.log('  90,000 seconds =>', timeReadable(90000));
console.log('✅ Formatters working correctly!');

// Test the storage module
console.log('\n=== Testing Storage ===');
storage.set('test_key', 'test_value');
console.log('  Stored "test_value" with key "test_key"');
const retrieved = storage.get('test_key');
console.log('  Retrieved:', retrieved);

storage.setJSON('test_json', { name: 'MWI Tools', version: '25.1' });
console.log('  Stored JSON object');
const retrievedJSON = storage.getJSON('test_json');
console.log('  Retrieved JSON:', retrievedJSON);
console.log('✅ Storage working correctly!');

// Test the config module
console.log('\n=== Testing Config ===');
console.log('  Main color:', config.SCRIPT_COLOR_MAIN);
console.log('  Tooltip color:', config.SCRIPT_COLOR_TOOLTIP);
console.log('  Alert color:', config.SCRIPT_COLOR_ALERT);
console.log('  Market API URL:', config.MARKET_API_URL);

console.log('\n  Sample settings:');
console.log('    totalActionTime:', config.getSetting('totalActionTime'));
console.log('    showDamage:', config.getSetting('showDamage'));
console.log('    notifiEmptyAction:', config.getSetting('notifiEmptyAction'));

const allSettings = config.getAllSettings();
console.log(`\n  Total settings loaded: ${allSettings.length}`);

console.log('✅ Config working correctly!');

// Test the WebSocket hook
console.log('\n=== Testing WebSocket Hook ===');
let messageCount = 0;
webSocketHook.on('*', (data) => {
    messageCount++;
    if (messageCount <= 5) {
        console.log(`  [${messageCount}] Message type:`, data.type);
    }
    if (messageCount === 6) {
        console.log('  ... (suppressing further messages)');
    }
});
console.log('  Hook installed, waiting for game messages...');
console.log('  (Will log first 5 message types)');

// Test the Data Manager
console.log('\n=== Testing Data Manager ===');
console.log('  Data Manager created, waiting for game data...');

dataManager.on('character_initialized', (data) => {
    console.log('  ✅ Character data loaded!');
    console.log('  Skills loaded:', dataManager.getSkills()?.length || 0);
    console.log('  Inventory items:', dataManager.getInventory()?.length || 0);
    console.log('  Equipment slots:', dataManager.getEquipment().size);
});

dataManager.on('actions_updated', () => {
    const actions = dataManager.getCurrentActions();
    console.log(`  ⚡ Actions updated: ${actions.length} in queue`);
});

// TODO: Initialize other modules here as we extract them
// ... etc

console.log('\n🎉 MWI Tools (Refactored) - Ready!');
console.log('📊 Modules loaded: Formatters, Storage, Config, WebSocket Hook, Data Manager');
