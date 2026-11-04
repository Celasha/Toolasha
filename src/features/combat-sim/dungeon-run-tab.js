/**
 * Dungeon tab of the Combat Sim: a what-if for dungeon runs (see dungeon-run-planner.js). The tab is
 * built once and refilled when it is opened or an input changes.
 */

import { t } from '../../core/i18n.js';
import { formatKMB, formatWithSeparator } from '../../utils/formatters.js';
import { getActionName, getItemName } from '../../utils/game-i18n.js';
import { planDungeonRuns } from './dungeon-run-planner.js';

const LABEL = 'color:#888; font-size:12px;';
const INPUT =
    'width:70px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center;';
const SELECT =
    'background:#1a1a2e; color:#e0e0e0; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px;';
const GOOD = '#4ade80';
const BAD = '#ff6b6b';

/**
 * @param {Object} deps
 * @param {function(): Array<{hrid: string, name: string, isDungeon: boolean}>} deps.getZones
 * @param {function(): Object} deps.getGameData - buildGameDataPayload
 * @param {function(): number} deps.getDefaultDropQuantity - Community buff bonus to start from
 * @param {function(): ?number} deps.getDefaultMinutes - Average clear time from the last dungeon sim, if any
 * @returns {{element: HTMLElement, refresh: function(): void}}
 */
export function createDungeonTab({ getZones, getGameData, getDefaultDropQuantity, getDefaultMinutes }) {
    const element = document.createElement('div');
    element.id = 'mwi-csim-dungeon-content';
    element.style.cssText = 'display:none; flex-direction:column; flex:1; overflow:hidden;';

    const controls = document.createElement('div');
    controls.style.cssText =
        'display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid #222; flex-shrink:0;';
    const results = document.createElement('div');
    results.style.cssText = 'flex:1; overflow-y:auto; padding:10px 14px;';
    element.append(controls, results);

    const state = { dungeon: null, tier: 0, players: 1, minutes: null, dropQuantity: null, consumables: 0 };

    const field = (label, control) => {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex; align-items:center; gap:4px;';
        const text = document.createElement('span');
        text.style.cssText = LABEL;
        text.textContent = label;
        wrap.append(text, control);
        return wrap;
    };
    const numberInput = (key, { min = 0, step = 'any' } = {}) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.step = String(step);
        input.style.cssText = INPUT;
        input.addEventListener('change', () => {
            state[key] = Number(input.value);
            render();
        });
        return input;
    };

    const dungeonSelect = document.createElement('select');
    dungeonSelect.style.cssText = `${SELECT} flex:1; min-width:0;`;
    dungeonSelect.addEventListener('change', () => {
        state.dungeon = dungeonSelect.value;
        render();
    });
    const tierSelect = document.createElement('select');
    tierSelect.style.cssText = SELECT;
    for (let tier = 0; tier <= 2; tier++) tierSelect.append(new Option(`T${tier}`, String(tier)));
    tierSelect.addEventListener('change', () => {
        state.tier = Number(tierSelect.value);
        render();
    });
    const players = numberInput('players', { min: 1, step: 1 });
    const minutes = numberInput('minutes', { min: 1, step: 0.1 });
    // Shown in percent, kept as a fraction
    const dropQuantity = document.createElement('input');
    dropQuantity.type = 'number';
    dropQuantity.min = '0';
    dropQuantity.step = '0.1';
    dropQuantity.style.cssText = INPUT;
    dropQuantity.addEventListener('change', () => {
        state.dropQuantity = Math.max(0, Number(dropQuantity.value)) / 100;
        render();
    });
    const consumables = numberInput('consumables', { min: 0, step: 1000 });
    controls.append(
        field(t('combatSimUi.dungeonLabel'), dungeonSelect),
        field(t('combatSimUi.tierLabel'), tierSelect),
        field(t('combatSimUi.dungeonPlayers'), players),
        field(t('combatSimUi.dungeonMinutes'), minutes),
        field(t('combatSimUi.dungeonDropQuantity'), dropQuantity),
        field(t('combatSimUi.dungeonConsumables'), consumables)
    );

    const row = (label, value, { color = '#e0e0e0', bold = false, indent = false } = {}) => {
        const line = document.createElement('div');
        line.style.cssText = `display:flex; justify-content:space-between; padding:2px 0; font-size:12px; ${
            indent ? 'padding-left:14px;' : ''
        }`;
        const left = document.createElement('span');
        left.style.cssText = `color:${indent ? '#999' : '#aaa'};`;
        left.textContent = label;
        const right = document.createElement('span');
        right.style.cssText = `color:${color}; font-weight:${bold ? 700 : 500};`;
        right.textContent = value;
        line.append(left, right);
        return line;
    };
    const heading = (text) => {
        const el = document.createElement('div');
        el.style.cssText = 'color:#e8a87c; font-weight:700; font-size:12px; margin:10px 0 4px;';
        el.textContent = text;
        return el;
    };

    function syncInputs() {
        dungeonSelect.value = state.dungeon;
        tierSelect.value = String(state.tier);
        players.value = String(state.players);
        minutes.value = String(Math.round(state.minutes * 100) / 100);
        dropQuantity.value = String(Math.round(state.dropQuantity * 1000) / 10);
        consumables.value = String(state.consumables);
    }

    function render() {
        const dungeons = getZones().filter((zone) => zone.isDungeon);
        if (!dungeons.length) {
            results.replaceChildren(row(t('combatSimUi.dungeonNoData'), ''));
            return;
        }
        if (!state.dungeon || !dungeons.some((zone) => zone.hrid === state.dungeon)) state.dungeon = dungeons[0].hrid;
        if (state.minutes === null) state.minutes = getDefaultMinutes() ?? 15;
        if (state.dropQuantity === null) state.dropQuantity = getDefaultDropQuantity();
        dungeonSelect.replaceChildren(
            ...dungeons.map((zone) => new Option(getActionName(zone.hrid, zone.name), zone.hrid))
        );
        syncInputs();

        const plan = planDungeonRuns({
            gameData: getGameData(),
            dungeonHrid: state.dungeon,
            tier: state.tier,
            players: state.players,
            minutesPerRun: state.minutes,
            dropQuantity: state.dropQuantity,
            consumablesPerDay: state.consumables,
        });
        if (!plan) {
            results.replaceChildren(row(t('combatSimUi.dungeonBadMinutes'), ''));
            return;
        }

        const money = (value) => formatKMB(Math.round(value));
        const nodes = [
            row(t('combatSimUi.dungeonRunsPerDay'), formatWithSeparator(plan.runsPerDay, 1)),
            row(t('combatSimUi.dungeonKeysPerDay'), formatWithSeparator(Math.round(plan.keysPerDay))),
            heading(t('combatSimUi.dungeonValueHeading')),
            row(t('combatSimUi.dungeonChestValue'), money(plan.chestValuePerDay), { color: '#e8a87c', bold: true }),
        ];
        for (const drop of plan.drops.slice(0, 6)) {
            nodes.push(
                row(`${drop.name} ×${formatWithSeparator(drop.countPerDay, 1)}`, money(drop.valuePerDay), {
                    indent: true,
                })
            );
        }
        nodes.push(
            heading(t('combatSimUi.dungeonCostHeading')),
            row(t('combatSimUi.dungeonKeyCost'), `-${money(plan.keyCostPerDay)}`, { color: BAD, bold: true })
        );
        for (const key of plan.keys) {
            nodes.push(
                row(
                    `${getItemName(key.itemHrid, key.name)} ×${formatWithSeparator(Math.round(key.count))}`,
                    key.unitCost > 0 ? `-${money(key.totalCost)}` : '—',
                    { indent: true }
                )
            );
        }
        if (plan.consumablesPerDay > 0) {
            nodes.push(
                row(t('combatSimUi.dungeonConsumablesCost'), `-${money(plan.consumablesPerDay)}`, { color: BAD })
            );
        }
        nodes.push(
            heading(t('combatSimUi.dungeonNetHeading')),
            row(t('combatSimUi.dungeonNet'), money(plan.netPerDay), {
                color: plan.netPerDay >= 0 ? GOOD : BAD,
                bold: true,
            })
        );
        const note = document.createElement('div');
        note.style.cssText = 'margin-top:10px; color:#777; font-size:11px;';
        note.textContent = plan.hasMissingPrices
            ? `${t('combatSimUi.dungeonMissingPrices')} ${t('combatSimUi.dungeonAssumptions')}`
            : t('combatSimUi.dungeonAssumptions');
        nodes.push(note);
        results.replaceChildren(...nodes);
    }

    return { element, refresh: render };
}

export default createDungeonTab;
