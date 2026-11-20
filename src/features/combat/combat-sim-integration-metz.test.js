/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({ default: { COLOR_ACCENT: '#22c55e' } }));
vi.mock('../../core/i18n.js', () => ({ t: vi.fn((key) => key) }));
vi.mock('./combat-sim-export-metz.js', () => ({ constructMetzTeamExport: vi.fn() }));
vi.mock('./combat-shared-loadout-metz.js', () => ({ clearSharedLoadouts: vi.fn(), describeMetzImport: vi.fn() }));
vi.mock('../../utils/formatters.js', () => ({ formatRelativeTime: vi.fn(() => '1m') }));

const { initialize, disable } = await import('./combat-sim-integration-metz.js');

const flush = () => vi.advanceTimersByTimeAsync(600);

describe('Metz import buttons', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="field"><textarea id="zone-export-paste"></textarea></div>';
    });

    afterEach(() => {
        disable();
        vi.useRealTimers();
    });

    test('are added right after the paste box', async () => {
        initialize();
        await flush();

        const container = document.getElementById('toolasha-metz-import-container');
        expect(container.previousElementSibling.id).toBe('zone-export-paste');
    });

    test('stay where they are when another script puts its own element between them and the paste box', async () => {
        initialize();
        await flush();
        const container = document.getElementById('toolasha-metz-import-container');
        const helper = document.createElement('div');
        helper.id = 'mwi-party-export-import';
        document.getElementById('zone-export-paste').insertAdjacentElement('afterend', helper);

        // Any change in the page makes the observer look again
        document.body.appendChild(document.createElement('span'));
        await flush();

        const field = document.getElementById('field');
        expect([...field.children].map((child) => child.id)).toEqual([
            'zone-export-paste',
            'mwi-party-export-import',
            'toolasha-metz-import-container',
        ]);
        expect(document.getElementById('toolasha-metz-import-container')).toBe(container);
    });

    test('come back when the page drops them', async () => {
        initialize();
        await flush();
        document.getElementById('toolasha-metz-import-container').remove();

        document.body.appendChild(document.createElement('span'));
        await flush();

        expect(document.getElementById('toolasha-metz-import-container').previousElementSibling.id).toBe(
            'zone-export-paste'
        );
    });
});
