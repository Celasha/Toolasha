/**
 * Regression test (TLA): Release Please PRs must never produce a false-failure CI run.
 *
 * Release Please opens/updates its PR with a raw, unformatted commit. CI's Prettier check and
 * the version-sync/format job used to run from two independent workflow files triggered by the
 * same pull_request event, so CI could reach `Check Prettier formatting` before the sync/format
 * job pushed its fix — producing a genuine but expected failed run and a false-failure
 * notification, followed by a second run (triggered by that push) which passed.
 *
 * The fix consolidates both jobs into one workflow so lint-and-build depends on
 * format-release-notes and skips itself for the one pre-format instant, instead of failing.
 * These assertions read the raw workflow YAML text (no YAML/expression parser dependency) to
 * guard against the specific ways this race could be silently reintroduced by a future edit.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const workflowsDir = dirname(fileURLToPath(import.meta.url));
const ciYml = readFileSync(join(workflowsDir, 'ci.yml'), 'utf8');

describe('CI workflow — Release Please race fix', () => {
    test('the standalone format-release-please workflow was removed, not left as a second trigger on the same event', () => {
        expect(existsSync(join(workflowsDir, 'format-release-please.yml'))).toBe(false);
    });

    test('format-release-notes only runs for pull_request events on a release-please branch', () => {
        const job = ciYml.match(/format-release-notes:\s*\n([\s\S]*?)\n {4}lint-and-build:/);
        expect(job).not.toBeNull();
        expect(job[1]).toMatch(/if:.*github\.event_name == 'pull_request'/);
        expect(job[1]).toMatch(/startsWith\(github\.head_ref, 'release-please--'\)/);
    });

    test('format-release-notes exposes whether it pushed a fix, for lint-and-build to gate on', () => {
        const job = ciYml.match(/format-release-notes:\s*\n([\s\S]*?)\n {4}lint-and-build:/);
        expect(job[1]).toMatch(/outputs:\s*\n\s*pushed:\s*\$\{\{\s*steps\.commit\.outputs\.pushed\s*\}\}/);
        expect(job[1]).toMatch(/echo "pushed=false" >> "\$GITHUB_OUTPUT"/);
        expect(job[1]).toMatch(/echo "pushed=true" >> "\$GITHUB_OUTPUT"/);
    });

    test('lint-and-build depends on format-release-notes and skips only the expected pre-format instant', () => {
        const job = ciYml.slice(ciYml.indexOf('lint-and-build:'));
        expect(job).toMatch(/needs:\s*format-release-notes/);
        // always() is required so a *skipped* format-release-notes job (normal PRs, pushes)
        // does not skip lint-and-build too by GitHub Actions' default needs-skip propagation.
        expect(job).toMatch(/if:[\s\S]*?always\(\)/);
        // A genuine formatter/version-sync failure must still block — never silently proceed.
        expect(job).toMatch(/needs\.format-release-notes\.result != 'failure'/);
        // The one expected pre-format instant (a fix was just pushed) is skipped, not failed.
        expect(job).toMatch(/needs\.format-release-notes\.outputs\.pushed != 'true'/);
        // Normal push-to-main behavior (skip release-please's own release commit) is preserved.
        expect(job).toMatch(
            /github\.event_name == 'push' && !startsWith\(github\.event\.head_commit\.message, 'chore\(main\): release'\)/
        );
    });

    test('no sleep or timing-based delay was used to paper over the race', () => {
        expect(ciYml).not.toMatch(/\bsleep\b/);
    });

    test('lint-and-build still runs the complete required validation steps', () => {
        const job = ciYml.slice(ciYml.indexOf('lint-and-build:'));
        for (const step of [
            'Run ESLint',
            'Check Prettier formatting',
            'Run tests',
            'Build (dev standalone)',
            'Build (production libraries)',
            'Verify bundle sizes',
        ]) {
            expect(job).toContain(step);
        }
    });

    test('format-release-notes has least-privilege write permissions scoped to its own job, not the whole workflow', () => {
        const topLevelPermissions = ciYml.match(/^permissions:\s*\n\s*contents:\s*read/m);
        expect(topLevelPermissions).not.toBeNull();

        const job = ciYml.match(/format-release-notes:\s*\n([\s\S]*?)\n {4}lint-and-build:/);
        expect(job[1]).toMatch(/permissions:\s*\n\s*contents:\s*write\s*\n\s*pull-requests:\s*write/);
    });
});
