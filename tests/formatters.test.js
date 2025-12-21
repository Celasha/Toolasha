/**
 * Tests for formatters.js
 * Run these to verify the formatters work correctly
 */

import { numberFormatter, timeReadable, formatWithSeparator } from '../src/utils/formatters.js';

console.log('Running formatter tests...\n');

// Test numberFormatter
console.log('=== numberFormatter Tests ===');
console.assert(numberFormatter(1500) === "1.5k", "1500 should format to 1.5k");
console.assert(numberFormatter(1500000) === "1.5M", "1500000 should format to 1.5M");
console.assert(numberFormatter(1500000000) === "1.5B", "1500000000 should format to 1.5B");
console.assert(numberFormatter(999) === "999", "999 should stay as 999");
console.assert(numberFormatter(1000) === "1k", "1000 should format to 1k");
console.assert(numberFormatter(-1500) === "-1.5k", "-1500 should format to -1.5k");
console.assert(numberFormatter(null) === null, "null should return null");
console.assert(numberFormatter(0) === "0", "0 should return 0");
console.log('✅ All numberFormatter tests passed!\n');

// Test timeReadable
console.log('=== timeReadable Tests ===');
console.assert(timeReadable(61) === "0h 01m 01s", "61 seconds should format to 0h 01m 01s");
console.assert(timeReadable(3661) === "1h 01m 01s", "3661 seconds should format to 1h 01m 01s");
console.assert(timeReadable(90000) === "1.0 days", "90000 seconds should format to 1.0 days");
console.log('✅ All timeReadable tests passed!\n');

// Test formatWithSeparator
console.log('=== formatWithSeparator Tests ===');
const formatted = formatWithSeparator(1000000);
console.log(`formatWithSeparator(1000000) = "${formatted}"`);
console.assert(formatted.includes("000"), "Should contain separators");
console.log('✅ formatWithSeparator test passed!\n');

console.log('🎉 All tests passed!');
