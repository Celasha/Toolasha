/**
 * Skill Calculator UI
 * UI generation and management for combat sim skill calculator
 */

import { calculateTimeToLevel, calculateLevelsAfterDays, getLevelFromExp } from './skill-calculator-logic.js';

/**
 * Create the skill calculator UI
 * @param {HTMLElement} container - Container element to append to
 * @param {Array} characterSkills - Character skills from dataManager
 * @param {Object} expRates - Exp/hour rates for each skill
 * @param {Object} levelExpTable - Level experience table
 * @returns {Object} UI elements for later updates
 */
export function createCalculatorUI(container, characterSkills, expRates, levelExpTable) {
    const wrapper = document.createElement('div');
    wrapper.id = 'mwi-skill-calculator';
    wrapper.style.cssText = `
        background-color: #FFFFE0;
        color: black;
        padding: 12px;
        border-radius: 4px;
        margin-top: 10px;
        font-family: inherit;
    `;

    const skillOrder = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];
    const skillData = {};

    // Build skill data map
    for (const skillName of skillOrder) {
        const skill = characterSkills.find((s) => s.skillHrid.includes(skillName));
        if (skill) {
            const currentLevel = getLevelFromExp(skill.experience, levelExpTable);
            skillData[skillName] = {
                displayName: capitalize(skillName),
                currentLevel,
                currentExp: skill.experience,
            };
        }
    }

    // Create skill input rows
    const skillInputs = {};
    for (const skillName of skillOrder) {
        if (!skillData[skillName]) continue;

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 4px; align-items: center;';

        const label = document.createElement('span');
        label.textContent = `${skillData[skillName].displayName} to level `;
        label.style.marginRight = '6px';

        const input = document.createElement('input');
        input.type = 'number';
        input.value = skillData[skillName].currentLevel + 1;
        input.min = skillData[skillName].currentLevel + 1;
        input.max = 200;
        input.style.cssText = 'width: 60px; padding: 2px 4px;';
        input.dataset.skill = skillName;

        skillInputs[skillName] = input;

        row.appendChild(label);
        row.appendChild(input);
        wrapper.appendChild(row);
    }

    // Create days input row
    const daysRow = document.createElement('div');
    daysRow.style.cssText =
        'display: flex; justify-content: flex-end; margin-bottom: 8px; margin-top: 8px; align-items: center;';

    const daysInput = document.createElement('input');
    daysInput.type = 'number';
    daysInput.id = 'mwi-days-input';
    daysInput.value = 1;
    daysInput.min = 0;
    daysInput.max = 200;
    daysInput.style.cssText = 'width: 60px; padding: 2px 4px; margin-right: 6px;';

    const daysLabel = document.createElement('span');
    daysLabel.textContent = 'days after';

    daysRow.appendChild(daysInput);
    daysRow.appendChild(daysLabel);
    wrapper.appendChild(daysRow);

    // Create results display divs
    const resultsHeader = document.createElement('div');
    resultsHeader.id = 'mwi-calc-results-header';
    resultsHeader.style.cssText = 'margin-top: 8px; font-weight: bold; border-top: 1px solid #ccc; padding-top: 8px;';
    wrapper.appendChild(resultsHeader);

    const resultsContent = document.createElement('div');
    resultsContent.id = 'mwi-calc-results-content';
    resultsContent.style.cssText = 'margin-top: 4px;';
    wrapper.appendChild(resultsContent);

    container.appendChild(wrapper);

    // Attach event handlers
    const updateHandler = () => {
        updateCalculatorResults(
            skillInputs,
            daysInput,
            skillData,
            expRates,
            levelExpTable,
            resultsHeader,
            resultsContent,
            characterSkills
        );
    };

    for (const input of Object.values(skillInputs)) {
        input.addEventListener('change', updateHandler);
        input.addEventListener('keyup', updateHandler);
        input.addEventListener('click', updateHandler);
    }

    daysInput.addEventListener('change', updateHandler);
    daysInput.addEventListener('keyup', updateHandler);
    daysInput.addEventListener('click', updateHandler);

    // Initial calculation for "After 1 days"
    updateCalculatorResults(
        skillInputs,
        daysInput,
        skillData,
        expRates,
        levelExpTable,
        resultsHeader,
        resultsContent,
        characterSkills
    );

    return {
        wrapper,
        skillInputs,
        daysInput,
        resultsHeader,
        resultsContent,
    };
}

/**
 * Update calculator results based on current inputs
 * @param {Object} skillInputs - Skill input elements
 * @param {HTMLElement} daysInput - Days input element
 * @param {Object} skillData - Skill data (levels, exp)
 * @param {Object} expRates - Exp/hour rates
 * @param {Object} levelExpTable - Level experience table
 * @param {HTMLElement} resultsHeader - Results header element
 * @param {HTMLElement} resultsContent - Results content element
 * @param {Array} characterSkills - Character skills array
 */
function updateCalculatorResults(
    skillInputs,
    daysInput,
    skillData,
    expRates,
    levelExpTable,
    resultsHeader,
    resultsContent,
    characterSkills
) {
    // Check which mode: individual skill or days projection
    let hasIndividualTarget = false;
    let activeSkill = null;
    let activeInput = null;

    for (const [skillName, input] of Object.entries(skillInputs)) {
        if (document.activeElement === input) {
            hasIndividualTarget = true;
            activeSkill = skillName;
            activeInput = input;
            break;
        }
    }

    if (hasIndividualTarget && activeSkill && activeInput) {
        // Calculate time to reach specific level
        const targetLevel = Number(activeInput.value);
        const currentExp = skillData[activeSkill].currentExp;
        const expRate = expRates[activeSkill] || 0;

        resultsHeader.textContent = `${skillData[activeSkill].displayName} to level ${targetLevel} takes:`;

        if (expRate === 0) {
            resultsContent.innerHTML = '<div>No experience gain (not trained in simulation)</div>';
        } else {
            const timeResult = calculateTimeToLevel(currentExp, targetLevel, expRate, levelExpTable);
            if (timeResult) {
                resultsContent.innerHTML = `<div>[${timeResult.readable}]</div>`;
            } else {
                resultsContent.innerHTML = '<div>Invalid target level</div>';
            }
        }
    } else {
        // Calculate levels after X days
        const days = Number(daysInput.value);
        resultsHeader.textContent = `After ${days} days:`;

        const projected = calculateLevelsAfterDays(characterSkills, expRates, days, levelExpTable);
        if (projected) {
            let html = '';
            const skillOrder = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];

            for (const skillName of skillOrder) {
                if (projected[skillName]) {
                    html += `<div>${capitalize(skillName)} level ${projected[skillName].level} ${projected[skillName].percentage}%</div>`;
                }
            }

            html += `<div style="margin-top: 4px; font-weight: bold;">Combat level: ${projected.combatLevel.toFixed(1)}</div>`;
            resultsContent.innerHTML = html;
        } else {
            resultsContent.innerHTML = '<div>Unable to calculate projection</div>';
        }
    }
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Extract exp/hour rates from combat sim DOM
 * @returns {Object|null} Exp rates object or null if not found
 */
export function extractExpRates() {
    const expDiv = document.querySelector('#simulationResultExperienceGain');
    if (!expDiv) {
        return null;
    }

    const rates = {};
    const rows = expDiv.querySelectorAll('.row');

    for (const row of rows) {
        if (row.children.length >= 2) {
            const skillText = row.children[0]?.textContent?.toLowerCase() || '';
            const expText = row.children[1]?.textContent || '';
            const expValue = Number(expText);

            // Match skill names
            if (skillText.includes('stamina')) {
                rates.stamina = expValue;
            } else if (skillText.includes('intelligence')) {
                rates.intelligence = expValue;
            } else if (skillText.includes('attack')) {
                rates.attack = expValue;
            } else if (skillText.includes('melee')) {
                rates.melee = expValue;
            } else if (skillText.includes('defense')) {
                rates.defense = expValue;
            } else if (skillText.includes('ranged')) {
                rates.ranged = expValue;
            } else if (skillText.includes('magic')) {
                rates.magic = expValue;
            }
        }
    }

    return rates;
}
