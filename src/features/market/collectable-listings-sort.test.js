/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

const { default: collectableListingsSort } = await import('./collectable-listings-sort.js');
const { default: config } = await import('../../core/config.js');

function buildRow({ status, hasCollect }) {
    const row = document.createElement('tr');
    const statusCell = document.createElement('td');
    statusCell.textContent = status;
    row.appendChild(statusCell);

    if (hasCollect) {
        const collectCell = document.createElement('td');
        const btn = document.createElement('button');
        btn.textContent = 'Collect';
        collectCell.appendChild(btn);
        row.appendChild(collectCell);
    } else {
        const linkCell = document.createElement('td');
        const btn = document.createElement('button');
        btn.textContent = 'Link';
        linkCell.appendChild(btn);
        row.appendChild(linkCell);
    }

    return row;
}

function buildTable(rowSpecs) {
    const table = document.createElement('table');
    table.className = 'MarketplacePanel_myListingsTable_xyz';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th>Status</th><th>Collect</th>';
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    for (const spec of rowSpecs) {
        tbody.appendChild(buildRow(spec));
    }
    table.appendChild(thead);
    table.appendChild(tbody);
    document.body.appendChild(table);
    return table;
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    config.getSetting.mockReturnValue(true);
});

afterEach(() => {
    collectableListingsSort.cleanup();
});

describe('collectableListingsSort._reorder()', () => {
    test('moves rows with a Collect button to the top, preserving relative order otherwise', () => {
        const table = buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Active', hasCollect: false },
            { status: 'Filled', hasCollect: true },
            { status: 'Active', hasCollect: false },
            { status: 'Filled', hasCollect: true },
        ]);

        collectableListingsSort._reorder(table);

        const statuses = Array.from(table.querySelectorAll('tbody tr')).map((r) => r.children[0].textContent);
        expect(statuses).toEqual(['Filled', 'Filled', 'Active', 'Active', 'Active']);
    });

    test('does nothing when no row is collectable', () => {
        const table = buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Active', hasCollect: false },
        ]);
        const before = Array.from(table.querySelectorAll('tbody tr'));

        collectableListingsSort._reorder(table);

        const after = Array.from(table.querySelectorAll('tbody tr'));
        expect(after).toEqual(before);
    });

    test('does nothing when every row is collectable', () => {
        const table = buildTable([
            { status: 'Filled', hasCollect: true },
            { status: 'Filled', hasCollect: true },
        ]);
        const before = Array.from(table.querySelectorAll('tbody tr'));

        collectableListingsSort._reorder(table);

        const after = Array.from(table.querySelectorAll('tbody tr'));
        expect(after).toEqual(before);
    });

    test('is a no-op once already sorted (no further row movement)', () => {
        const table = buildTable([
            { status: 'Filled', hasCollect: true },
            { status: 'Active', hasCollect: false },
        ]);

        collectableListingsSort._reorder(table);
        const afterFirst = Array.from(table.querySelectorAll('tbody tr'));

        collectableListingsSort._reorder(table);
        const afterSecond = Array.from(table.querySelectorAll('tbody tr'));

        expect(afterSecond).toEqual(afterFirst);
    });

    test('yields to a manually-active column sort (▲/▼/# indicator present in the header)', () => {
        const table = buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Filled', hasCollect: true },
        ]);
        table.querySelector('thead th').textContent = 'Status ▲';
        const before = Array.from(table.querySelectorAll('tbody tr'));

        collectableListingsSort._reorder(table);

        const after = Array.from(table.querySelectorAll('tbody tr'));
        expect(after).toEqual(before);
    });

    test('resumes moving collectable rows to top once the manual sort indicator is cleared', () => {
        const table = buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Filled', hasCollect: true },
        ]);
        const statusHeader = table.querySelector('thead th');
        statusHeader.textContent = 'Status ▲';

        collectableListingsSort._reorder(table);
        expect(Array.from(table.querySelectorAll('tbody tr'))[0].children[0].textContent).toBe('Active');

        statusHeader.textContent = 'Status';
        collectableListingsSort._reorder(table);

        expect(Array.from(table.querySelectorAll('tbody tr'))[0].children[0].textContent).toBe('Filled');
    });
});

describe('collectableListingsSort.initialize()', () => {
    test('does nothing when the setting is disabled', () => {
        config.getSetting.mockReturnValue(false);
        buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Filled', hasCollect: true },
        ]);

        collectableListingsSort.initialize();

        expect(collectableListingsSort.isInitialized).toBe(false);
    });

    test('reorders an already-present table on initialize', () => {
        const table = buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Filled', hasCollect: true },
        ]);

        collectableListingsSort.initialize();

        const statuses = Array.from(table.querySelectorAll('tbody tr')).map((r) => r.children[0].textContent);
        expect(statuses).toEqual(['Filled', 'Active']);
    });

    test('reorders when a row gains a Collect button in place (React reuses the <tr>, no add/remove)', async () => {
        const table = buildTable([
            { status: 'Active', hasCollect: false },
            { status: 'Active', hasCollect: false },
        ]);

        collectableListingsSort.initialize();

        // Simulate the game flipping the second listing to Filled: React mutates the existing
        // <tr>'s cells in place rather than replacing the row, so the tbody's own childList
        // never changes — only a subtree-scoped observer sees this.
        const secondRow = table.querySelectorAll('tbody tr')[1];
        secondRow.children[0].textContent = 'Filled';
        const collectCell = document.createElement('td');
        const btn = document.createElement('button');
        btn.textContent = 'Collect';
        collectCell.appendChild(btn);
        secondRow.replaceChild(collectCell, secondRow.children[1]);

        await Promise.resolve();
        await Promise.resolve();

        const statuses = Array.from(table.querySelectorAll('tbody tr')).map((r) => r.children[0].textContent);
        expect(statuses).toEqual(['Filled', 'Active']);
    });
});
