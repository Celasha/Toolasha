/**
 * Tests for QuickInputButtons.createLevelProgressSection — reverse quantity-to-level sync.
 *
 * The Target Level Calculator only propagated target-level -> queue-quantity (one direction).
 * Typing a quantity directly into the queue input never updated the calculator's displayed
 * result. This covers the added reverse direction: quantity -> displayed level/xp result,
 * without ever writing back into the target-level input itself.
 */

/* @vitest-environment jsdom */

import { describe, test, expect, afterEach } from 'vitest';
import { QuickInputButtons, computeProgressiveQueueTime } from './quick-input-buttons.js';

const LEVEL_EXPERIENCE_TABLE = [0, 0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700];

function buildLevelContext() {
    return {
        skillHrid: '/skills/milking',
        skill: { level: 3, experience: 250 },
        currentLevel: 3,
        currentXP: 250,
        levelExperienceTable: LEVEL_EXPERIENCE_TABLE,
        xpData: { totalMultiplier: 1, totalWisdom: 0, charmExperience: 0, breakdown: {} },
        baseXP: 10,
        modifiedXP: 10,
    };
}

function buildSection(feature, numberInput) {
    const actionDetails = {
        hrid: '/actions/milking/cow',
        experienceGain: { skillHrid: '/skills/milking', value: 10 },
    };
    const section = feature.createLevelProgressSection(
        actionDetails,
        3, // actionTime
        {}, // gameData
        numberInput,
        0, // totalEfficiency
        buildLevelContext()
    );
    document.body.appendChild(section);
    return section;
}

describe('QuickInputButtons.createLevelProgressSection — reverse quantity-to-level sync', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('typing a quantity into the queue input updates the result to reflect the level it would reach', () => {
        const feature = new QuickInputButtons();
        const numberInput = document.createElement('input');
        numberInput.type = 'number';

        const section = buildSection(feature, numberInput);
        const targetLevelResult = section.querySelector('#mwi-target-level-result');

        numberInput.value = '20';
        numberInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(targetLevelResult.textContent).toContain('20 actions');
        expect(targetLevelResult.textContent).toMatch(/Level \d+/);
    });

    test('does not write back into the target-level input (one-directional per field, not a feedback loop)', () => {
        const feature = new QuickInputButtons();
        const numberInput = document.createElement('input');
        numberInput.type = 'number';

        const section = buildSection(feature, numberInput);
        const targetLevelInput = section.querySelector('#mwi-target-level-input');
        const originalTargetLevelValue = targetLevelInput.value;

        numberInput.value = '20';
        numberInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(targetLevelInput.value).toBe(originalTargetLevelValue);
    });

    test('an empty or invalid quantity leaves the existing displayed result untouched', () => {
        const feature = new QuickInputButtons();
        const numberInput = document.createElement('input');
        numberInput.type = 'number';

        const section = buildSection(feature, numberInput);
        const targetLevelResult = section.querySelector('#mwi-target-level-result');
        const before = targetLevelResult.textContent;

        numberInput.value = '';
        numberInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(targetLevelResult.textContent).toBe(before);
    });

    test('the target-level field still drives the queue input (forward direction is unchanged)', () => {
        const feature = new QuickInputButtons();
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput._valueTracker = undefined; // no React tracker attached in this fixture

        const section = buildSection(feature, numberInput);
        const targetLevelInput = section.querySelector('#mwi-target-level-input');
        const targetLevelResult = section.querySelector('#mwi-target-level-result');

        targetLevelInput.value = '6';
        targetLevelInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(targetLevelResult.textContent).toContain('actions');
        expect(numberInput.value).not.toBe('');
    });
});

describe('computeProgressiveQueueTime finite-queue cycle floor (TLA-036)', () => {
    const noNextLevel = {
        currentLevel: 200,
        currentXP: 0,
        modifiedXP: 10,
        levelExperienceTable: [],
    };

    test('one Azure Sword queue action cannot complete before its 8.42s timed cycle', () => {
        const actionTime = 16 / 1.9;
        expect(computeProgressiveQueueTime(1, noNextLevel, 65, actionTime)).toBeCloseTo(actionTime, 10);
    });

    test('zero queued actions stays zero', () => {
        expect(computeProgressiveQueueTime(0, noNextLevel, 65, 8.42)).toBe(0);
    });

    test('very high efficiency still requires one full cycle for a positive queue', () => {
        expect(computeProgressiveQueueTime(1, noNextLevel, 500, 8.42)).toBe(8.42);
    });

    test('does not change a long-horizon estimate that is already above one cycle', () => {
        const actionTime = 16 / 1.9;
        const expectedLegacy = (100 / 1.65) * actionTime;
        expect(computeProgressiveQueueTime(100, noNextLevel, 65, actionTime)).toBeCloseTo(expectedLegacy, 10);
    });

    test('does not change progressive level-crossing arithmetic above the cycle floor', () => {
        const actionTime = 16 / 1.9;
        const context = {
            currentLevel: 3,
            currentXP: 250,
            modifiedXP: 10,
            levelExperienceTable: [0, 0, 100, 250, 450, 700, 1000, 1350, 1750],
        };

        // Legacy arithmetic:
        // L3: 20 queued completions / 1.65 * actionTime
        // L4: 25 queued completions / 1.66 * actionTime
        // L5: remaining 5 queued completions / 1.67 * actionTime
        const expectedLegacy = (20 / 1.65) * actionTime + (25 / 1.66) * actionTime + (5 / 1.67) * actionTime;
        expect(computeProgressiveQueueTime(50, context, 65, actionTime)).toBeCloseTo(expectedLegacy, 10);
    });

    test('one queued action near a level boundary still requires one full timed cycle', () => {
        const actionTime = 16 / 1.9;
        const context = {
            currentLevel: 3,
            currentXP: 449,
            modifiedXP: 10,
            levelExperienceTable: [0, 0, 100, 250, 450, 700, 1000],
        };
        expect(computeProgressiveQueueTime(1, context, 65, actionTime)).toBeCloseTo(actionTime, 10);
    });
});
