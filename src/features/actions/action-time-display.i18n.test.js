/* @vitest-environment jsdom */

/**
 * Locale regression tests for queue/header action matching (ZH-I18N-REMAINING-ISSUES #28).
 *
 * Five probe scenarios (3 lesions, 5 control groups):
 *   1. EN queue entry, no battle counter            - baseline, unchanged behavior
 *   2. EN header + active #mwi-battle-counter       - counter text must not pollute the name
 *   3. ZH queue entry with full-width colon "："     - action/item split + dual-name match
 *   4. ZH queue entry without colon (gathering)      - translated action-name match
 *   5. ZH enhancing queue entry ("奶酪剑 +3")        - translated item-name match via hash
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Localized display names, e.g. translations['actionNames:/actions/alchemy/coinify'] = '炼金'.
// Empty by default = English client (helpers fall back to the English data name).
const translations = vi.hoisted(() => ({}));

vi.mock('../../utils/game-i18n.js', () => ({
    translateGameName: (ns, hrid, fallback = '') => translations[`${ns}:${hrid}`] ?? fallback,
    getActionName: (hrid, fallback = '') => translations[`actionNames:${hrid}`] ?? fallback,
    getItemName: (hrid, fallback = '') => translations[`itemNames:${hrid}`] ?? fallback,
}));

const actionDetailsMap = vi.hoisted(() => ({}));
const itemDetailsMap = vi.hoisted(() => ({}));

vi.mock('../../core/data-manager.js', () => ({
    default: {
        on: vi.fn(),
        off: vi.fn(),
        getCurrentActions: vi.fn(() => []),
        getInventory: vi.fn(() => []),
        getEquipment: vi.fn(() => ({})),
        getSkills: vi.fn(() => ({})),
        getInitClientData: vi.fn(() => ({ itemDetailMap: itemDetailsMap })),
        getActionDetails: vi.fn((hrid) => actionDetailsMap[hrid]),
        getItemDetails: vi.fn((hrid) => itemDetailsMap[hrid]),
        getActionDrinkSlots: vi.fn(() => []),
        getCommunityBuffLevel: vi.fn(() => 0),
        getAchievementBuffFlatBoost: vi.fn(() => 0),
        getPersonalBuffFlatBoost: vi.fn(() => 0),
        getHouseRooms: vi.fn(() => new Map()),
        isTaskAction: vi.fn(() => false),
        getTaskSpeedBonus: vi.fn(() => 0),
        getElapsedSecondsInCurrentUnit: vi.fn(() => 0),
        characterData: { guildActionTypeBuffsMap: {} },
    },
}));

vi.mock('../../core/config.js', () => ({
    default: {
        getSetting: vi.fn(() => false),
        getSettingValue: vi.fn((_key, fallback) => fallback),
        onSettingChange: vi.fn(),
        offSettingChange: vi.fn(),
        setSetting: vi.fn(),
        COLOR_TEXT_SECONDARY: '#999999',
        COLOR_TOOLTIP_INFO: '#999999',
    },
}));

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: vi.fn(() => () => {}) },
}));

vi.mock('../../core/tooltip-observer.js', () => ({
    default: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock('../../api/marketplace.js', () => ({
    default: { isLoaded: vi.fn(() => false) },
}));

vi.mock('./gathering-profit.js', () => ({
    calculateGatheringProfit: vi.fn(),
}));

vi.mock('../market/profit-calculator.js', () => ({
    default: { calculateProfit: vi.fn() },
}));

vi.mock('../market/alchemy-profit-calculator.js', () => ({
    default: {},
}));

vi.mock('../../utils/action-calculator.js', () => ({
    calculateActionStats: vi.fn(),
}));

vi.mock('../../utils/action-context.js', () => ({
    resolveActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [], source: 'saved-loadout' })),
    resolveCurrentActionContext: vi.fn(() => ({ equipment: new Map(), drinks: [], source: 'current' })),
}));

vi.mock('../../utils/formatters.js', () => ({
    timeReadable: vi.fn((s) => `${s}s`),
    formatWithSeparator: vi.fn((n) => `${n}`),
    formatDateTime: vi.fn(() => ''),
}));

vi.mock('../../utils/efficiency.js', () => ({
    calculateEfficiencyMultiplier: vi.fn(() => 1),
}));

vi.mock('../../utils/tea-parser.js', () => ({
    parseArtisanBonus: vi.fn(() => 0),
    getDrinkConcentration: vi.fn(() => 0),
    parseGatheringBonus: vi.fn(() => 0),
    parseGourmetBonus: vi.fn(() => 0),
}));

vi.mock('../../utils/buff-parser.js', () => ({
    getAlchemySuccessBonus: vi.fn(() => 0),
}));

vi.mock('../../utils/profit-helpers.js', () => ({
    calculateProductionActionTotalsFromBase: vi.fn(),
    calculateGatheringActionTotalsFromBase: vi.fn(),
    calculateActionsPerHour: vi.fn(() => 0),
    calculateEffectiveActionsPerHour: vi.fn(() => 0),
}));

vi.mock('../enhancement/enhancement-xp.js', () => ({
    calculateEnhancementPredictions: vi.fn(),
}));

vi.mock('../../utils/enhancement-calculator.js', () => ({
    BASE_SUCCESS_RATES: [],
    isMathJsAvailable: vi.fn(() => true),
}));

const { ActionTimeDisplay } = await import('./action-time-display.js');

function seedGameData() {
    Object.assign(actionDetailsMap, {
        '/actions/alchemy/coinify': {
            hrid: '/actions/alchemy/coinify',
            name: 'Coinify',
            type: '/action_types/alchemy',
            outputItems: [],
            dropTable: [],
        },
        '/actions/gathering/chop_wood': {
            hrid: '/actions/gathering/chop_wood',
            name: 'Chop Wood',
            type: '/action_types/gathering',
            outputItems: [],
            dropTable: [],
        },
        '/actions/enhancing/enhance': {
            hrid: '/actions/enhancing/enhance',
            name: 'Enhance',
            type: '/action_types/enhancing',
        },
        '/actions/combat/chimerical_den': {
            hrid: '/actions/combat/chimerical_den',
            name: 'Chimerical Den',
            type: '/action_types/combat',
            outputItems: [],
            dropTable: [],
        },
    });
    Object.assign(itemDetailsMap, {
        '/items/foraging_essence': { hrid: '/items/foraging_essence', name: 'Foraging Essence' },
        '/items/cheese_sword': { hrid: '/items/cheese_sword', name: 'Cheese Sword' },
    });
}

function seedChineseTranslations() {
    Object.assign(translations, {
        'actionNames:/actions/alchemy/coinify': '炼金',
        'itemNames:/items/foraging_essence': '林中精华',
        'actionNames:/actions/gathering/chop_wood': '伐木',
        'itemNames:/items/cheese_sword': '奶酪剑',
        'actionNames:/actions/combat/chimerical_den': '奇美拉巢穴',
    });
}

/** Build a queue entry div mirroring the game's QueuedActions markup. */
function makeQueueDiv(text, { enhancing = false } = {}) {
    const actionDiv = document.createElement('div');
    actionDiv.className = 'QueuedActions_action__abc';

    const actionText = document.createElement('div');
    actionText.className = 'QueuedActions_actionText__abc';

    const textDiv = document.createElement('div');
    textDiv.className = 'QueuedActions_text__abc';
    if (enhancing) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#enhancing_cheese_sword');
        svg.appendChild(use);
        textDiv.appendChild(svg);
    }
    textDiv.appendChild(document.createTextNode(text));

    actionText.appendChild(textDiv);
    actionDiv.appendChild(actionText);
    return actionDiv;
}

describe('ActionTimeDisplay locale-aware queue/header matching (#28)', () => {
    let instance;

    beforeEach(() => {
        document.body.innerHTML = '';
        for (const key of Object.keys(translations)) delete translations[key];
        for (const key of Object.keys(actionDetailsMap)) delete actionDetailsMap[key];
        for (const key of Object.keys(itemDetailsMap)) delete itemDetailsMap[key];
        seedGameData();
        instance = new ActionTimeDisplay();
    });

    describe('parseActionNameFromDom', () => {
        test('splits "Action: Item" on the half-width colon as before', () => {
            expect(instance.parseActionNameFromDom('Coinify: Foraging Essence')).toEqual({
                actionNameFromDom: 'Coinify',
                itemNameFromDom: 'Foraging Essence',
            });
        });

        test('splits "动作：物品" on the full-width colon rendered by the Chinese client', () => {
            expect(instance.parseActionNameFromDom('炼金：林中精华')).toEqual({
                actionNameFromDom: '炼金',
                itemNameFromDom: '林中精华',
            });
        });

        test('keeps colons inside the item name (split only at the first colon)', () => {
            expect(instance.parseActionNameFromDom('Cook: Fish: Steak')).toEqual({
                actionNameFromDom: 'Cook',
                itemNameFromDom: 'Fish: Steak',
            });
        });

        test('no colon yields the full text as action name', () => {
            expect(instance.parseActionNameFromDom('伐木')).toEqual({
                actionNameFromDom: '伐木',
                itemNameFromDom: null,
            });
        });
    });

    test('scenario 1 (EN baseline): queue entry "Coinify: Foraging Essence" matches via English names', () => {
        const cachedActions = [
            {
                id: 1,
                actionHrid: '/actions/alchemy/coinify',
                primaryItemHash: '/item_locations/inventory::/items/foraging_essence::0',
            },
        ];
        const div = makeQueueDiv('#3Coinify: Foraging Essence');

        const matched = instance.matchActionFromDiv(div, cachedActions);

        expect(matched).toBe(cachedActions[0]);
    });

    test('scenario 2 (EN + battle counter): #mwi-battle-counter text does not pollute the header name', () => {
        const actionNameElement = document.createElement('div');
        actionNameElement.className = 'Header_actionName__abc';
        actionNameElement.appendChild(document.createTextNode('Chimerical Den'));
        const counter = document.createElement('span');
        counter.id = 'mwi-battle-counter';
        counter.textContent = 'Battle #3';
        actionNameElement.appendChild(counter);
        document.body.appendChild(actionNameElement);

        // Pre-fix, getCleanActionName joined the counter text in ("Chimerical Den Battle #3")
        // and matchCurrentActionFromText could not match the running combat action.
        expect(instance.getCleanActionName(actionNameElement)).toBe('Chimerical Den');

        const matched = instance.matchCurrentActionFromText(
            [{ id: 9, actionHrid: '/actions/combat/chimerical_den', primaryItemHash: null }],
            instance.getCleanActionName(actionNameElement)
        );
        expect(matched?.id).toBe(9);
    });

    test('scenario 2b (ZH + battle counter): localized counter text does not pollute either', () => {
        seedChineseTranslations();
        const actionNameElement = document.createElement('div');
        actionNameElement.className = 'Header_actionName__abc';
        actionNameElement.appendChild(document.createTextNode('奇美拉巢穴'));
        const counter = document.createElement('span');
        counter.id = 'mwi-battle-counter';
        counter.textContent = '第 3 场战斗';
        actionNameElement.appendChild(counter);
        document.body.appendChild(actionNameElement);

        expect(instance.getCleanActionName(actionNameElement)).toBe('奇美拉巢穴');

        const matched = instance.matchCurrentActionFromText(
            [{ id: 9, actionHrid: '/actions/combat/chimerical_den', primaryItemHash: null }],
            instance.getCleanActionName(actionNameElement)
        );
        expect(matched?.id).toBe(9);
    });

    test('scenario 3 (ZH full-width colon): queue entry "炼金：林中精华" matches via translated names', () => {
        seedChineseTranslations();
        const cachedActions = [
            {
                id: 1,
                actionHrid: '/actions/alchemy/coinify',
                primaryItemHash: '/item_locations/inventory::/items/foraging_essence::0',
            },
        ];
        const div = makeQueueDiv('#3炼金：林中精华');

        const matched = instance.matchActionFromDiv(div, cachedActions);

        expect(matched).toBe(cachedActions[0]);
    });

    test('scenario 4 (ZH no colon): queue entry "伐木" matches the translated action name', () => {
        seedChineseTranslations();
        const cachedActions = [{ id: 2, actionHrid: '/actions/gathering/chop_wood', primaryItemHash: null }];
        const div = makeQueueDiv('#2伐木');

        const matched = instance.matchActionFromDiv(div, cachedActions);

        expect(matched).toBe(cachedActions[0]);
    });

    test('scenario 5 (ZH enhancing): queue entry "奶酪剑 +3" matches via primaryItemHash item names', () => {
        seedChineseTranslations();
        const cachedActions = [
            {
                id: 3,
                actionHrid: '/actions/enhancing/enhance',
                primaryItemHash: '/item_locations/inventory::/items/cheese_sword::3',
            },
        ];
        const div = makeQueueDiv('#4奶酪剑 +3', { enhancing: true });

        const matched = instance.matchActionFromDiv(div, cachedActions);

        expect(matched).toBe(cachedActions[0]);
    });

    test('scenario 6 (ZH): output-item fallback resolves localized item names via the dual-name index', () => {
        // 「Coinify XL」matches neither the English data name nor the translation, so the
        // actionNameMatches gate fails. The DOM item name 「林中精华」 must resolve through
        // getItemHridFromName to hit outputItems; the old slug fallback built
        // '/items/林中精华', which can never match on a zh client.
        seedChineseTranslations();
        actionDetailsMap['/actions/alchemy/coinify'].outputItems = [{ itemHrid: '/items/foraging_essence' }];
        const cachedActions = [{ id: 7, actionHrid: '/actions/alchemy/coinify', primaryItemHash: null }];
        const div = makeQueueDiv('#7Coinify XL：林中精华');

        const matched = instance.matchActionFromDiv(div, cachedActions);

        expect(matched).toBe(cachedActions[0]);
    });

    test('EN enhancing entry still matches via the slug-built HRID fallback', () => {
        const cachedActions = [
            {
                id: 3,
                actionHrid: '/actions/enhancing/enhance',
                primaryItemHash: '/item_locations/inventory::/items/cheese_sword::3',
            },
        ];
        const div = makeQueueDiv('#4Cheese Sword +3', { enhancing: true });

        const matched = instance.matchActionFromDiv(div, cachedActions);

        expect(matched).toBe(cachedActions[0]);
    });

    test('usedActionIds still prevents the same cached action from matching two divs', () => {
        const cachedActions = [
            {
                id: 1,
                actionHrid: '/actions/alchemy/coinify',
                primaryItemHash: '/item_locations/inventory::/items/foraging_essence::0',
            },
            {
                id: 5,
                actionHrid: '/actions/alchemy/coinify',
                primaryItemHash: '/item_locations/inventory::/items/foraging_essence::0',
            },
        ];
        const divA = makeQueueDiv('#1Coinify: Foraging Essence');
        const divB = makeQueueDiv('#2Coinify: Foraging Essence');
        const used = new Set();

        expect(instance.matchActionFromDiv(divA, cachedActions, used)).toBe(cachedActions[0]);
        used.add(instance.matchActionFromDiv(divA, cachedActions, used).id);
        expect(instance.matchActionFromDiv(divB, cachedActions, used)).toBe(cachedActions[1]);
    });

    test('a queue entry whose text matches nothing returns no match (no false positives from translation lookup)', () => {
        seedChineseTranslations();
        const cachedActions = [{ id: 2, actionHrid: '/actions/gathering/chop_wood', primaryItemHash: null }];
        const div = makeQueueDiv('#2烹饪');

        expect(instance.matchActionFromDiv(div, cachedActions)).toBeUndefined();
    });
});
