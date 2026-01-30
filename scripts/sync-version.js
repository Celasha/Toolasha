#!/usr/bin/env node

/**
 * Version Sync Script
 *
 * Syncs version from package.json to all files that need version updates:
 * - userscript-header.txt (userscript @version tag)
 * - README.md (badge and footer version)
 * - src/main.js (Toolasha.version property)
 *
 * This ensures all version references stay in sync automatically.
 *
 * Usage:
 *   node scripts/sync-version.js
 *   npm run version:sync
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function syncVersion() {
    try {
        // Read version from package.json (source of truth)
        const packageJsonPath = join(rootDir, 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        const version = packageJson.version;

        if (!version) {
            console.error('❌ Error: No version found in package.json');
            process.exit(1);
        }

        let filesUpdated = [];

        // 1. Update userscript-header.txt
        const headerPath = join(rootDir, 'userscript-header.txt');
        let headerContent = readFileSync(headerPath, 'utf8');
        const headerRegex = /^(\/\/ @version\s+)[\d.]+$/m;

        if (!headerRegex.test(headerContent)) {
            console.error('❌ Error: Could not find @version line in userscript-header.txt');
            process.exit(1);
        }

        const updatedHeader = headerContent.replace(headerRegex, `$1${version}`);
        if (updatedHeader !== headerContent) {
            writeFileSync(headerPath, updatedHeader, 'utf8');
            filesUpdated.push('userscript-header.txt');
        }

        // 2. Update README.md (badge and footer)
        const readmePath = join(rootDir, 'README.md');
        let readmeContent = readFileSync(readmePath, 'utf8');

        // Update badge: ![Version](https://img.shields.io/badge/version-X.X.X-orange?style=flat-square)
        const badgeRegex = /(!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-)[\d.]+(-.+?\))/;
        // Update footer: **Version**: X.X.X (Pre-release)
        const footerRegex = /(\*\*Version\*\*: )[\d.]+( \(Pre-release\))/;

        let updatedReadme = readmeContent;
        updatedReadme = updatedReadme.replace(badgeRegex, `$1${version}$2`);
        updatedReadme = updatedReadme.replace(footerRegex, `$1${version}$2`);

        if (updatedReadme !== readmeContent) {
            writeFileSync(readmePath, updatedReadme, 'utf8');
            filesUpdated.push('README.md');
        }

        // 3. Update src/main.js (Toolasha.version property)
        const mainJsPath = join(rootDir, 'src', 'main.js');
        let mainJsContent = readFileSync(mainJsPath, 'utf8');

        // Match: version: 'X.X.X',
        const mainJsRegex = /(version:\s+['"])[\d.]+(['"],)/;

        if (!mainJsRegex.test(mainJsContent)) {
            console.error('❌ Error: Could not find version property in src/main.js');
            process.exit(1);
        }

        const updatedMainJs = mainJsContent.replace(mainJsRegex, `$1${version}$2`);
        if (updatedMainJs !== mainJsContent) {
            writeFileSync(mainJsPath, updatedMainJs, 'utf8');
            filesUpdated.push('src/main.js');
        }

        // Report results
        if (filesUpdated.length === 0) {
            console.log(`✅ All files already at version ${version}`);
        } else {
            console.log(`✅ Version synced to ${version}`);
            console.log(`   Updated files:`);
            filesUpdated.forEach((file) => console.log(`   - ${file}`));
            console.log(`   (dist/Toolasha.user.js will be updated on next build)`);
        }
    } catch (error) {
        console.error('❌ Error syncing version:', error.message);
        process.exit(1);
    }
}

syncVersion();
