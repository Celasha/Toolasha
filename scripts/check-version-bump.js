#!/usr/bin/env node

/**
 * Pre-commit hook to prevent manual version bumps in package.json.
 * Version bumps should only happen via release-please.
 */

import { execSync } from 'child_process';

// Skip check on release-please branches
const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
if (branch.startsWith('release-please--')) {
    process.exit(0);
}

// Check if package.json is staged
const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf-8' });
if (!stagedFiles.includes('package.json')) {
    process.exit(0);
}

// Get the committed version (HEAD)
let committedVersion;
try {
    const committedPackageJson = execSync('git show HEAD:package.json', { encoding: 'utf-8' });
    committedVersion = JSON.parse(committedPackageJson).version;
} catch {
    // No previous commit or package.json doesn't exist yet
    process.exit(0);
}

// Get the staged version
const stagedPackageJson = execSync('git show :package.json', { encoding: 'utf-8' });
const stagedVersion = JSON.parse(stagedPackageJson).version;

if (committedVersion !== stagedVersion) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: Manual version bump detected in package.json');
    console.error(`  Committed version: ${committedVersion}`);
    console.error(`  Staged version: ${stagedVersion}`);
    console.error('');
    console.error('Version bumps should only happen via release-please.');
    console.error('Please revert the version change:');
    console.error(`  git checkout HEAD -- package.json`);
    process.exit(1);
}

process.exit(0);
