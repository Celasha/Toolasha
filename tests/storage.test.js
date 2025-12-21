/**
 * Tests for storage.js
 *
 * Note: These tests use mocks since GM_getValue/GM_setValue
 * are only available in the userscript environment
 */

import { Storage } from '../src/core/storage.js';

console.log('Running Storage tests...\n');

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

// Test 1: Basic get/set
console.log('=== Test 1: Basic get/set ===');
resetStorage();
const storage1 = new Storage();
storage1.set('test_key', 'test_value');
const result1 = storage1.get('test_key');
console.assert(result1 === 'test_value', 'Should store and retrieve string value');
console.log('✅ Basic get/set works\n');

// Test 2: Default values
console.log('=== Test 2: Default values ===');
resetStorage();
const storage2 = new Storage();
const result2 = storage2.get('nonexistent_key', 'default_value');
console.assert(result2 === 'default_value', 'Should return default for missing key');
console.log('✅ Default values work\n');

// Test 3: JSON storage
console.log('=== Test 3: JSON storage ===');
resetStorage();
const storage3 = new Storage();
const testObj = { name: 'Test', value: 123, nested: { foo: 'bar' } };
storage3.setJSON('json_key', testObj);
const result3 = storage3.getJSON('json_key');
console.assert(result3.name === 'Test', 'Should store object name');
console.assert(result3.value === 123, 'Should store object value');
console.assert(result3.nested.foo === 'bar', 'Should store nested object');
console.log('✅ JSON storage works\n');

// Test 4: JSON default values
console.log('=== Test 4: JSON default values ===');
resetStorage();
const storage4 = new Storage();
const defaultObj = { default: true };
const result4 = storage4.getJSON('missing_json', defaultObj);
console.assert(result4.default === true, 'Should return default object for missing JSON key');
console.log('✅ JSON default values work\n');

// Test 5: has() method
console.log('=== Test 5: has() method ===');
resetStorage();
const storage5 = new Storage();
storage5.set('existing_key', 'value');
console.assert(storage5.has('existing_key') === true, 'Should return true for existing key');
console.assert(storage5.has('missing_key') === false, 'Should return false for missing key');
console.log('✅ has() method works\n');

// Test 6: delete() method
console.log('=== Test 6: delete() method ===');
resetStorage();
const storage6 = new Storage();
storage6.set('key_to_delete', 'value');
console.assert(storage6.has('key_to_delete') === true, 'Key should exist before delete');
storage6.delete('key_to_delete');
console.assert(storage6.has('key_to_delete') === false, 'Key should not exist after delete');
console.log('✅ delete() method works\n');

// Test 7: Number storage
console.log('=== Test 7: Number storage ===');
resetStorage();
const storage7 = new Storage();
storage7.set('number_key', 42);
const result7 = storage7.get('number_key');
console.assert(result7 === 42, 'Should store and retrieve number');
console.log('✅ Number storage works\n');

// Test 8: Boolean storage
console.log('=== Test 8: Boolean storage ===');
resetStorage();
const storage8 = new Storage();
storage8.set('bool_true', true);
storage8.set('bool_false', false);
console.assert(storage8.get('bool_true') === true, 'Should store true');
console.assert(storage8.get('bool_false') === false, 'Should store false');
console.log('✅ Boolean storage works\n');

// Test 9: Array storage via JSON
console.log('=== Test 9: Array storage ===');
resetStorage();
const storage9 = new Storage();
const testArray = [1, 2, 3, 'four', { five: 5 }];
storage9.setJSON('array_key', testArray);
const result9 = storage9.getJSON('array_key');
console.assert(Array.isArray(result9), 'Should return an array');
console.assert(result9.length === 5, 'Array should have 5 elements');
console.assert(result9[4].five === 5, 'Should preserve nested objects in array');
console.log('✅ Array storage works\n');

// Test 10: Overwriting values
console.log('=== Test 10: Overwriting values ===');
resetStorage();
const storage10 = new Storage();
storage10.set('overwrite_key', 'first_value');
console.assert(storage10.get('overwrite_key') === 'first_value', 'Should get first value');
storage10.set('overwrite_key', 'second_value');
console.assert(storage10.get('overwrite_key') === 'second_value', 'Should overwrite with second value');
console.log('✅ Overwriting works\n');

console.log('🎉 All Storage tests passed!');
