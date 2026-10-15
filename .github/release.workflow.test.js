/**
 * Regression test: the release workflow's Discord topic step runs after the step that leaves the
 * workspace on the `releases` branch (built files only), so it must not run repo scripts from the
 * working tree. It reads the script from the triggering commit instead.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const workflow = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'workflows', 'release.yml'), 'utf8');
const topicStep = workflow.slice(workflow.indexOf('Update the Discord general channel topic'));

describe('release workflow Discord topic step', () => {
    test('is a real step after the branch switch and publish steps', () => {
        expect(workflow.indexOf('Commit built files to releases branch')).toBeGreaterThan(-1);
        expect(workflow.indexOf('Upload userscripts and publish release')).toBeGreaterThan(-1);
        expect(workflow.indexOf('Update the Discord general channel topic')).toBeGreaterThan(
            workflow.indexOf('Upload userscripts and publish release')
        );
    });

    test('reads the script from the triggering commit, not the working tree', () => {
        expect(topicStep).toContain('git show "$GITHUB_SHA:scripts/update-discord-topic.js"');
        expect(topicStep).not.toMatch(/node scripts\//);
    });

    test('surfaces a failure as a warning annotation without failing the release', () => {
        expect(topicStep).toContain('::warning::');
        expect(topicStep).toContain('continue-on-error: true');
    });

    test('has no "#" in the step name, which YAML would treat as a comment', () => {
        const nameLine = topicStep.split('\n')[0];
        expect(nameLine).not.toContain('#');
    });
});
