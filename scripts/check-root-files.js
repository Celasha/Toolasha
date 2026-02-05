#!/usr/bin/env node

/**
 * Pre-commit hook to prevent unauthorized .txt and .md files at project root.
 * Helps maintain clean project structure by ensuring documentation and data files
 * are organized in appropriate directories.
 */

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// Allowed files at project root
const ALLOWED_FILES = new Set([
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'LICENSE.md',
    'AGENTS.md',
    'CLAUDE.md',
    'DOCUMENTATION.md',
    'FEATURES.md',
    'MWI-TOOLS-CHANGELOG.md',
    'userscript-header.txt',
]);

// Get all staged files with their status (A=added, M=modified, D=deleted, R=renamed)
const stagedFilesOutput = execSync('git diff --cached --name-status', { encoding: 'utf-8' });
const stagedFiles = stagedFilesOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => {
        const [status, ...fileParts] = line.split('\t');
        return { status, file: fileParts[fileParts.length - 1] }; // For renames, take the destination
    });

// Check for root-level .txt and .md files being added or modified (not deleted)
const unauthorizedFiles = stagedFiles
    .filter(({ status, file }) => {
        // Ignore deletions - we only care about additions and modifications
        if (status.startsWith('D')) {
            return false;
        }

        // Only check files at root (no directory separator)
        if (file.includes('/')) {
            return false;
        }

        // Check if it's a .txt or .md file
        if (!file.endsWith('.txt') && !file.endsWith('.md')) {
            return false;
        }

        // Check if it's in the allowed list
        return !ALLOWED_FILES.has(file);
    })
    .map(({ file }) => file);

if (unauthorizedFiles.length > 0) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Error: Unauthorized files at project root detected');
    console.error('');
    console.error('The following files should not be at the project root:');
    unauthorizedFiles.forEach((file) => {
        console.error(`  - ${file}`);
    });
    console.error('');
    console.error('Please move these files to appropriate directories:');
    console.error('  • Documentation: docs/');
    console.error('  • Investigations: docs/archive/investigations/');
    console.error('  • Planning: docs/planning/');
    console.error('  • Proposals: docs/archive/proposals/');
    console.error('');
    console.error('To unstage these files:');
    unauthorizedFiles.forEach((file) => {
        console.error(`  git reset HEAD ${file}`);
    });
    process.exit(1);
}

process.exit(0);
