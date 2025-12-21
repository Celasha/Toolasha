/**
 * Tests for config.js
 */

import { Config } from '../src/core/config.js';
import { Storage } from '../src/core/storage.js';

console.log('Running Config tests...\n');

// Mock GM functions
global.GM_getValue = function(key, defaultValue) {
    const store = global.__mockStorage || {};
    return store[key] !== undefined ? store[key] : defaultValue;
};

global.GM_setValue = function(key, value) {
    if (!global.__mockStorage) global.__mockStorage = {};
    global.__mockStorage[key] = value;
};

// Helper to reset mock storage
function resetStorage() {
    global.__mockStorage = {};
}

// Test 1: Config initialization
console.log('=== Test 1: Config initialization ===');
resetStorage();
const config1 = new Config();
console.assert(config1.SCRIPT_COLOR_MAIN !== undefined, 'Should have SCRIPT_COLOR_MAIN');
console.assert(config1.MARKET_API_URL !== undefined, 'Should have MARKET_API_URL');
console.assert(config1.settingsMap !== undefined, 'Should have settingsMap');
console.log('✅ Config initializes correctly\n');

// Test 2: Constants
console.log('=== Test 2: Constants ===');
resetStorage();
const config2 = new Config();
console.assert(config2.MARKET_API_URL === 'https://www.milkywayidle.com/game_data/marketplace.json', 'Market URL should be correct');
console.assert(config2.SCRIPT_COLOR_ALERT === 'red', 'Alert color should be red');
console.assert(typeof config2.THOUSAND_SEPARATOR === 'string', 'Thousand separator should be string');
console.log('✅ Constants are correct\n');

// Test 3: Default settings
console.log('=== Test 3: Default settings ===');
resetStorage();
const config3 = new Config();
console.assert(config3.settingsMap.totalActionTime.isTrue === true, 'totalActionTime should default to true');
console.assert(config3.settingsMap.notifiEmptyAction.isTrue === false, 'notifiEmptyAction should default to false');
console.assert(config3.settingsMap.showDamage.isTrue === true, 'showDamage should default to true');
console.log('✅ Default settings are correct\n');

// Test 4: getSetting method
console.log('=== Test 4: getSetting method ===');
resetStorage();
const config4 = new Config();
console.assert(config4.getSetting('totalActionTime') === true, 'getSetting should return true for totalActionTime');
console.assert(config4.getSetting('notifiEmptyAction') === false, 'getSetting should return false for notifiEmptyAction');
console.assert(config4.getSetting('nonexistent_key') === false, 'getSetting should return false for missing key');
console.log('✅ getSetting method works\n');

// Test 5: setSetting method
console.log('=== Test 5: setSetting method ===');
resetStorage();
const config5 = new Config();
config5.setSetting('totalActionTime', false);
console.assert(config5.getSetting('totalActionTime') === false, 'setSetting should update value');
console.assert(config5.settingsMap.totalActionTime.isTrue === false, 'Setting should persist in settingsMap');
console.log('✅ setSetting method works\n');

// Test 6: toggleSetting method
console.log('=== Test 6: toggleSetting method ===');
resetStorage();
const config6 = new Config();
const originalValue = config6.getSetting('showDamage');
const newValue = config6.toggleSetting('showDamage');
console.assert(newValue === !originalValue, 'toggleSetting should flip value');
console.assert(config6.getSetting('showDamage') === newValue, 'Toggled value should persist');
console.log('✅ toggleSetting method works\n');

// Test 7: Save and load settings
console.log('=== Test 7: Save and load settings ===');
resetStorage();
const config7a = new Config();
config7a.setSetting('totalActionTime', false);
config7a.setSetting('showDamage', false);
config7a.saveSettings();

// Create new config instance (should load saved settings)
const config7b = new Config();
console.assert(config7b.getSetting('totalActionTime') === false, 'Loaded config should have saved value for totalActionTime');
console.assert(config7b.getSetting('showDamage') === false, 'Loaded config should have saved value for showDamage');
console.log('✅ Settings persist across instances\n');

// Test 8: Color settings
console.log('=== Test 8: Color settings ===');
resetStorage();
const config8 = new Config();
// Default is orange (useOrangeAsMainColor defaults to true)
console.assert(config8.SCRIPT_COLOR_MAIN === 'orange', 'Main color should be orange when setting is true');
config8.setSetting('useOrangeAsMainColor', false);
// Color won't change until applyColorSettings is called
config8.applyColorSettings();
console.assert(config8.SCRIPT_COLOR_MAIN === 'green', 'Main color should be green when setting is false');
console.log('✅ Color settings work\n');

// Test 9: getAllSettings method
console.log('=== Test 9: getAllSettings method ===');
resetStorage();
const config9 = new Config();
const allSettings = config9.getAllSettings();
console.assert(Array.isArray(allSettings), 'getAllSettings should return an array');
console.assert(allSettings.length > 20, 'Should have more than 20 settings');
console.assert(allSettings[0].hasOwnProperty('id'), 'Each setting should have id property');
console.assert(allSettings[0].hasOwnProperty('desc'), 'Each setting should have desc property');
console.assert(allSettings[0].hasOwnProperty('isTrue'), 'Each setting should have isTrue property');
console.log('✅ getAllSettings method works\n');

// Test 10: resetToDefaults method
console.log('=== Test 10: resetToDefaults method ===');
resetStorage();
const config10 = new Config();
config10.setSetting('totalActionTime', false);
config10.setSetting('showDamage', false);
config10.setSetting('notifiEmptyAction', true);
config10.resetToDefaults();
console.assert(config10.getSetting('totalActionTime') === true, 'totalActionTime should reset to true');
console.assert(config10.getSetting('showDamage') === true, 'showDamage should reset to true');
console.assert(config10.getSetting('notifiEmptyAction') === false, 'notifiEmptyAction should reset to false');
console.log('✅ resetToDefaults method works\n');

// Test 11: Setting count
console.log('=== Test 11: Setting count ===');
resetStorage();
const config11 = new Config();
const settingCount = Object.keys(config11.settingsMap).length;
console.log(`  Total settings: ${settingCount}`);
console.assert(settingCount === 29, 'Should have exactly 29 settings');
console.log('✅ Correct number of settings\n');

console.log('🎉 All Config tests passed!');
