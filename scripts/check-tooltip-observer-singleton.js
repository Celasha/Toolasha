import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const librariesDir = 'dist/libraries';
if (!existsSync(librariesDir)) {
    console.error('❌ dist/libraries is missing; run the production build first.');
    process.exit(1);
}

const libraryFiles = readdirSync(librariesDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, text: readFileSync(join(librariesDir, name), 'utf8') }));

const core = libraryFiles.find(({ name }) => name === 'toolasha-core.js');
if (!core) {
    console.error('❌ dist/libraries/toolasha-core.js is missing; run the production build first.');
    process.exit(1);
}

const implementationMarker = 'toolasha-core-tooltip-observer-v1';
const failures = [];

const markerFiles = libraryFiles.filter(({ text }) => text.includes(implementationMarker)).map(({ name }) => name);
if (markerFiles.length !== 1 || markerFiles[0] !== 'toolasha-core.js') {
    failures.push(
        `Core TooltipObserver implementation marker must exist only in toolasha-core.js; found in: ${markerFiles.join(', ') || 'none'}`
    );
}

const requiredConsumers = ['toolasha-market.js', 'toolasha-actions.js', 'toolasha-combat.js'];
for (const name of requiredConsumers) {
    const file = libraryFiles.find((entry) => entry.name === name);
    if (!file) {
        failures.push(`Expected production artifact ${name} is missing; run the production build first.`);
        continue;
    }
    if (/class\s+TooltipObserver\b/.test(file.text) || /new\s+TooltipObserver\s*\(/.test(file.text)) {
        failures.push(`${name} embeds a private TooltipObserver implementation instead of referencing Core`);
    }
    if (!file.text.includes('Toolasha.Core.tooltipObserver')) {
        failures.push(`${name} does not resolve TooltipObserver through Toolasha.Core.tooltipObserver`);
    }
}

if (!core.text.includes('tooltipObserver')) {
    failures.push('toolasha-core.js does not expose tooltipObserver');
}

if (failures.length > 0) {
    for (const failure of failures) console.error(`❌ ${failure}`);
    process.exit(1);
}

console.log('✅ TooltipObserver singleton integrity verified: one Core-owned instance, no duplicate production copies.');
