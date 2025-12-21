/**
 * MWI Tools - Main Entry Point
 * Refactored modular version
 */

import { numberFormatter, timeReadable } from './utils/formatters.js';
import storage from './core/storage.js';
import config from './core/config.js';
import webSocketHook from './core/websocket.js';

console.log('MWI Tools (Refactored) - Initializing...');

// CRITICAL: Install WebSocket hook FIRST, before game connects
webSocketHook.install();

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

// TODO: Initialize other modules here as we extract them
// const dataManager = new DataManager(storage);
// hookWebSocket(dataManager);
// ... etc

console.log('\n🎉 MWI Tools (Refactored) - Ready!');
console.log('📊 Modules loaded: Formatters, Storage, Config, WebSocket Hook');
