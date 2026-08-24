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

const implementationMarker = 'toolasha-core-loadout-state-v1';
const allText = libraryFiles.map(({ text }) => text).join('\n');
const count = (text, pattern) => (text.match(pattern) || []).length;
const failures = [];

const markerFiles = libraryFiles.filter(({ text }) => text.includes(implementationMarker)).map(({ name }) => name);
if (markerFiles.length !== 1 || markerFiles[0] !== 'toolasha-core.js') {
    failures.push(`Core LoadoutState implementation marker must exist only in toolasha-core.js; found in: ${markerFiles.join(', ') || 'none'}`);
}

const implementationCopies = count(allText, /toolasha-core-loadout-state-v1/g);
if (implementationCopies !== 1) {
    failures.push(`Expected exactly one Core Loadout State implementation marker in production libraries; found ${implementationCopies}`);
}

if (/class\s+LoadoutSnapshot\b/.test(allText) || /new\s+LoadoutSnapshot\s*\(/.test(allText)) {
    failures.push('Legacy stateful LoadoutSnapshot implementation was bundled into production');
}

if (!core.text.includes('loadoutState')) {
    failures.push('toolasha-core.js does not expose loadoutState');
}

const coreOnlySemanticTokens = [
    'characterLoadoutMap',
    'wearableMap',
    'useExactEnhancement',
    'savedItemHash',
    'suppressValidation',
    'rawSnapshots',
    'loadouts_updated',
];

for (const { name, text } of libraryFiles) {
    if (name === 'toolasha-core.js') continue;
    if (text.includes(implementationMarker)) {
        failures.push(`${name} embeds a stateful LoadoutState copy instead of referencing Toolasha.Core.loadoutState`);
    }
    for (const token of coreOnlySemanticTokens) {
        if (text.includes(token)) {
            failures.push(`${name} embeds raw loadout semantic token "${token}"; saved-loadout interpretation must stay in toolasha-core.js`);
        }
    }
}

if (failures.length > 0) {
    for (const failure of failures) console.error(`❌ ${failure}`);
    process.exit(1);
}

console.log('✅ Loadout state integrity verified: one Core-owned state service, no legacy stateful copies.');
