import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    initialize: vi.fn(),
    instances: [],
}));

vi.mock('../../../utils/worker-pool.js', () => ({
    default: class MockWorkerPool {
        constructor(blob) {
            this.blob = blob;
            mocks.instances.push(this);
        }
        initialize() {
            return mocks.initialize();
        }
        execute(taskData) {
            return mocks.execute(taskData);
        }
        terminate() {}
    },
}));

import {
    getScoreEnhancementExpectationTable,
    buildExpectationCacheKey,
    terminateScoreEnhancementWorkerPool,
} from './score-enhancement-worker.js';

const PARAMS = { enhancingLevel: 140, toolBonus: 8, itemLevel: 100, blessedTea: true, guzzlingBonus: 1.2 };
const FAKE_TABLE = { targets: [] };

beforeEach(() => {
    terminateScoreEnhancementWorkerPool();
    mocks.execute.mockReset();
    mocks.initialize.mockReset();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.instances = [];
});

describe('buildExpectationCacheKey', () => {
    test('is built only from probability-affecting parameters', () => {
        const key = buildExpectationCacheKey(PARAMS);
        expect(key).toBe('140|8|100|true|1.2');
    });

    test('ignores speedBonus/other fields entirely (they do not fragment the cache)', () => {
        const withExtra = { ...PARAMS, speedBonus: 999, itemHrid: '/items/whatever' };
        expect(buildExpectationCacheKey(withExtra)).toBe(buildExpectationCacheKey(PARAMS));
    });

    test('defaults toolBonus/blessedTea/guzzlingBonus like the kernel does', () => {
        const key = buildExpectationCacheKey({ enhancingLevel: 100, itemLevel: 50 });
        expect(key).toBe('100|0|50|false|1');
    });
});

describe('getScoreEnhancementExpectationTable - PSP-06 coalescing / PSP-07 cache miss', () => {
    test('two concurrent calls with the same params share one worker round trip', async () => {
        let resolveExecute;
        mocks.execute.mockImplementation(() => new Promise((resolve) => (resolveExecute = resolve)));

        const first = getScoreEnhancementExpectationTable(PARAMS);
        const second = getScoreEnhancementExpectationTable(PARAMS);

        await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
        resolveExecute(FAKE_TABLE);

        expect(await first).toBe(FAKE_TABLE);
        expect(await second).toBe(FAKE_TABLE);
    });

    test('a later call after the first settles reuses the cached table without a new worker call', async () => {
        mocks.execute.mockResolvedValue(FAKE_TABLE);

        await getScoreEnhancementExpectationTable(PARAMS);
        await getScoreEnhancementExpectationTable(PARAMS);

        expect(mocks.execute).toHaveBeenCalledTimes(1);
    });

    test('a changed probability-affecting parameter is a cache miss', async () => {
        mocks.execute.mockResolvedValue(FAKE_TABLE);

        await getScoreEnhancementExpectationTable(PARAMS);
        await getScoreEnhancementExpectationTable({ ...PARAMS, itemLevel: 101 });

        expect(mocks.execute).toHaveBeenCalledTimes(2);
    });

    test('changing only speedBonus (not probability-affecting) still reuses the cached table', async () => {
        mocks.execute.mockResolvedValue(FAKE_TABLE);

        await getScoreEnhancementExpectationTable(PARAMS);
        await getScoreEnhancementExpectationTable({ ...PARAMS, speedBonus: 42 });

        expect(mocks.execute).toHaveBeenCalledTimes(1);
    });

    test('the worker pool is created once and reused across distinct requests', async () => {
        mocks.execute.mockResolvedValue(FAKE_TABLE);

        await getScoreEnhancementExpectationTable(PARAMS);
        await getScoreEnhancementExpectationTable({ ...PARAMS, itemLevel: 101 });

        expect(mocks.instances).toHaveLength(1);
    });
});

describe('getScoreEnhancementExpectationTable - PSP-15 worker failure fails closed, never falls back', () => {
    test('a rejected request propagates the rejection to the caller', async () => {
        mocks.execute.mockRejectedValue(new Error('worker exploded'));

        await expect(getScoreEnhancementExpectationTable(PARAMS)).rejects.toThrow('worker exploded');
    });

    test('a rejected request clears its cache entry so a later call retries instead of caching the failure', async () => {
        mocks.execute.mockRejectedValueOnce(new Error('worker exploded'));
        mocks.execute.mockResolvedValueOnce(FAKE_TABLE);

        await expect(getScoreEnhancementExpectationTable(PARAMS)).rejects.toThrow('worker exploded');
        await expect(getScoreEnhancementExpectationTable(PARAMS)).resolves.toBe(FAKE_TABLE);

        expect(mocks.execute).toHaveBeenCalledTimes(2);
    });
});
