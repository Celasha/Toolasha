/**
 * i18n DOM-literal gate (AST-based).
 *
 * Catches the bug class behind ZH-I18N-REMAINING-ISSUES.md: script code comparing
 * game-rendered DOM text against hardcoded English literals. In a zh client the game
 * localizes those texts, so every such comparison silently breaks.
 *
 * What gets flagged (all require an English-looking literal at the match site):
 *   - binary ===/!==/==/!= where one side is a literal and the other is DOM-text-derived
 *   - .includes/.startsWith/.endsWith/.match/.matchAll called on DOM-text-derived text
 *     with a literal/regex argument, and /regex/.test(domText)
 *   - inverted form: ['Sell', ...].includes(domText) / set.has(domText) where the
 *     collection literal/const contains English literals and the argument is DOM text
 *   - reverse lookups: ENGLISH_KEYED_OBJECT[domText] (name -> key maps indexed by
 *     localized rendered text never hit in zh)
 *   - querySelector/matches/closest with [aria-label|title|placeholder="English"] selectors
 *
 * Data-flow cases (no literal at the match site — the 2026-10 zh audit bug class):
 *   - name-map reverse lookups: map.set(detail.name, ...) built without a matching
 *     i18n-helper registration, then queried with DOM text (map.get(domText) / obj[domText])
 *   - DOM text compared against English data `.name` fields (x === detail.name) or against
 *     variables derived from them / from hrid slug transforms
 *   - hrid construction from DOM text: '/items/' + domText.toLowerCase().replace(...)
 *     (binary or template literal), and hrid.includes('/' + domTextSlug)
 *   - English literals forwarded through local helper parameters (findButton('Buy') where
 *     the helper compares param against DOM text)
 *   - DOM-text-derived arguments reaching same-file function parameters (taint seeding),
 *     so the literal cases above also fire inside extract/parse helpers
 *
 * "DOM-text-derived" means the expression contains: a .textContent/.innerText/.innerHTML
 * read, .getAttribute('aria-label'|'title'|'placeholder'), or a local const/let aliasing
 * one of those (one-level alias taint, inherited by nested functions; assignments and
 * per-property object aliases like `info.name = el.textContent` count too).
 *
 * False-positive suppression:
 *   - literal shape: HRIDs ('/items/...'), sprite hrefs ('#'), dotted i18n keys,
 *     class-fragment-like literals containing '_', fewer than 3 letters
 *   - dual-match code: the enclosing function also calls a known game-i18n helper, or the
 *     hit's own logical (||/?:) chain contains such a call. Note this can mask a missed
 *     second label inside an otherwise dual-matching function — triage new code carefully.
 *   - ALLOWLIST below: every entry is either a bug already tracked in
 *     ZH-I18N-REMAINING-ISSUES.md (known: '#N') or a verified-safe site (safe: reason).
 *
 * Wired into `npm run build` like the other gates; fails on any hit not allowlisted so new
 * hardcoded-English DOM matching can't land unnoticed. Allowlist matching is file+literal
 * based (line numbers drift); stale entries only print a warning.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as espree from 'espree';

const SRC_DIR = 'src';
const EXCLUDED_DIR_NAMES = new Set(['locales', 'node_modules']);

const DOM_TEXT_PROPS = new Set(['textContent', 'innerText', 'innerHTML']);
const DOM_TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder']);
const STRING_MATCH_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'match', 'matchAll']);
const COLLECTION_METHODS = new Set(['includes', 'indexOf', 'has', 'some', 'find', 'findIndex']);

/**
 * Game-i18n bridge helpers. A function that calls one of these is attempting a
 * dual (English + translated) match, so its literal comparisons are the English half.
 */
const I18N_HELPERS = new Set([
    'translateGameName',
    'getItemName',
    'getActionName',
    'getActionCategoryName',
    'getItemCategoryName',
    'getMonsterName',
    'getHouseRoomName',
    'getGuildShrineName',
    'getAchievementName',
    'getGameI18n',
    'equalsMarketplaceLabel',
    'includesMarketplaceLabel',
    'matchesMarketplaceTabLabel',
]);

/**
 * Allowlist: hit is identified by (file, literal). Every entry needs a reason —
 * either the tracking bug number from ZH-I18N-REMAINING-ISSUES.md or why it's safe.
 * Populated from the initial triage run; keep sorted by file.
 */
const ALLOWLIST = [
    // --- known bugs tracked in ZH-I18N-REMAINING-ISSUES.md (remove entry when fixed) ---
    {
        file: 'src/features/combat/dungeon-tracker-chat-annotations.js',
        literal: String.raw`/\[(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/`,
        reason: 'to-verify: zh chat timestamp format (上午/下午 vs AM/PM)',
    },
    {
        file: 'src/features/combat/dungeon-tracker.js',
        literal: String.raw`/\[(\d{1,2})([-/])(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/`,
        reason: 'to-verify: zh chat timestamp format (上午/下午 vs AM/PM)',
    },
    {
        file: 'src/features/combat/dungeon-tracker.js',
        literal: String.raw`/\[(\d{1,2})([-/.])(\d{1,2})\.?\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/`,
        reason: 'to-verify: zh chat timestamp format (上午/下午 vs AM/PM)',
    },
    {
        file: 'src/features/guild/guild-credit-value.js',
        literal: String.raw`/Lv\.(\d+)/`,
        reason: 'to-verify: zh trial level format',
    },
    // --- known bugs from the 2026-10 dataflow audit (#24-#34 in ZH-I18N-REMAINING-ISSUES.md; remove when fixed) ---
    {
        file: 'src/features/abilities/ability-book-calculator.js',
        literal: '"/"+itemName',
        reason: 'known: fixed by PR #748 (additive dual-match via getItemName/getAbilityName); stale once that merges',
    },
    {
        file: 'src/features/abilities/ability-book-calculator.js',
        literal: `'+ itemName`,
        reason: 'known: fixed by PR #748 (additive dual-match via getItemName/getAbilityName); stale once that merges',
    },
    {
        file: 'src/features/abilities/ability-tooltip-timing.js',
        literal: 'Cooldown:',
        reason: "known: '#27' English line prefix never matches zh tooltip (冷却：)",
    },
    {
        file: 'src/features/abilities/ability-tooltip-timing.js',
        literal: 'Cast Time:',
        reason: "known: '#27' English line prefix never matches zh tooltip (施法时间：)",
    },
    {
        file: 'src/features/abilities/ability-tooltip-timing.js',
        literal: 'map:map',
        reason: "known: '#26' ability name→hrid map keyed by English .name only",
    },
    {
        file: 'src/features/actions/action-time-display.js',
        literal: '/items/*',
        reason: "known: '#28' hrid built from localized queue text (matchActionFromDiv)",
    },
    {
        file: 'src/features/actions/action-time-display.js',
        literal: 'itemHrid',
        reason: "known: '#28' DOM slug matched against primaryItemHash",
    },
    {
        file: 'src/features/actions/action-time-display.js',
        literal: 'actionDetails.name',
        reason: "known: '#28' English data name compared to localized queue text",
    },
    {
        file: 'src/features/chat/mention-tracker.js',
        literal: 'Party|Guild|Local|…',
        reason: "known: '#31' English channel-name map reverse-looked-up with localized tab text",
    },
    {
        file: 'src/features/chat/pop-out-chat.js',
        literal: 'c.name',
        reason: "known: '#34' English CHANNELS table matched against localized tab text",
    },
    {
        file: 'src/features/collection/collection-navigation.js',
        literal: 'map:map',
        reason: "known: '#30' item name→hrid map keyed by English .name only",
    },
    {
        file: 'src/features/inventory/dungeon-token-tooltips.js',
        literal: 'map:map',
        reason: "known: '#25' item name→hrid map keyed by English .name only",
    },
    {
        file: 'src/features/market/marketplace-shortcuts.js',
        literal: 'map:this.itemNameToHridCache',
        reason: "known: '#24' item name→hrid cache keyed by English .name only",
    },
    {
        file: 'src/features/navigation/alt-click-navigation.js',
        literal: '/items/*',
        reason: "known: '#33' fallback at :142 builds hrid from localized tooltip name (sibling hit :129 is a sprite-href fragment, locale-independent, flagged via name collision)",
    },
    {
        file: 'src/features/tasks/task-reroll-tracker.js',
        literal: 'monsterName.toLowerCase(…)',
        reason: "known: '#29' English monster data name matched against localized task text",
    },
    // --- verified safe (reason required) ---
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'stamina',
        reason: 'safe: matches DOM of an external English-only site (Shykai calculator), not the game',
    },
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'intelligence',
        reason: 'safe: external English-only site DOM',
    },
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'attack',
        reason: 'safe: external English-only site DOM',
    },
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'melee',
        reason: 'safe: external English-only site DOM',
    },
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'defense',
        reason: 'safe: external English-only site DOM',
    },
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'ranged',
        reason: 'safe: external English-only site DOM',
    },
    {
        file: 'src/features/combat-sim-integration/skill-calculator-ui.js',
        literal: 'magic',
        reason: 'safe: external English-only site DOM',
    },
    {
        file: 'src/features/market/listing-price-display.js',
        literal: String.raw`/([0-9,.]+)\s*([KMB]?)\s*\/\s*([0-9,.]+)\s*([KMB]?)/i`,
        reason: 'safe: number/KMB quantity format is locale-independent',
    },
    {
        file: 'src/features/tasks/task-reroll-protection.js',
        literal: 'Pay',
        reason: 'safe: locale-independent container check is primary; English text is fallback only (291-315)',
    },
    {
        file: 'src/features/tasks/task-reroll-protection.js',
        literal: 'free',
        reason: 'safe: locale-independent container check is primary; English text is fallback only (291-315)',
    },
    {
        file: 'src/features/market/auto-fill-price.js',
        literal: 'best buy',
        reason: 'safe: additive OR against bestOfferPrefix(), a local wrapper around translateGameName() the AST scan cannot see through (not in I18N_HELPERS)',
    },
    {
        file: 'src/features/market/auto-fill-price.js',
        literal: 'best sell',
        reason: 'safe: additive OR against bestOfferPrefix(), a local wrapper around translateGameName() the AST scan cannot see through (not in I18N_HELPERS)',
    },
    {
        file: 'src/features/actions/quick-input-buttons.js',
        literal: 'actionDetails.name',
        reason: 'safe: comparison only gates a re-resolve via getActionDetailsByName (React-fiber based, carries its own dual matching)',
    },
    {
        file: 'src/features/guild/guild-xp-display.js',
        literal: 's.name',
        reason: 'safe: player character names are user-chosen, not localized',
    },
    {
        file: 'src/features/market/estimated-listing-age.js',
        literal: String.raw`/^([\d,.]+)([KMB])?$/`,
        reason: 'safe: locale-independent number/KMB quantity format (same class as listing-price-display)',
    },
    {
        file: 'src/features/market/market-history-viewer.js',
        literal: String.raw`/^([\d.]+)([KMB])?$/`,
        reason: 'safe: locale-independent number/KMB quantity format',
    },
    {
        file: 'src/features/tasks/task-icons.js',
        literal: 'monster.name',
        reason: 'safe: fallback behind the locale-independent fiber path getQuestFromTaskCard (report #4 note)',
    },
];

const allowlistWarnings = [];
const hits = []; // {file, line, kind, literal, snippet}
const parseErrors = [];

function collectSourceFiles(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        if (EXCLUDED_DIR_NAMES.has(entry)) continue;
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            collectSourceFiles(fullPath, files);
        } else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function isNode(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.type === 'string';
}

/** Generic recursive walk; does not prune anything. */
function walk(node, visit) {
    if (!isNode(node)) return;
    visit(node);
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) if (isNode(child)) walk(child, visit);
        } else if (isNode(value)) {
            walk(value, visit);
        }
    }
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Walk a function's direct body without descending into nested functions. */
function walkDirectBody(fnNode, visit) {
    const body = fnNode.type === 'Program' ? fnNode : fnNode.body;
    if (!isNode(body)) return;
    function recurse(node) {
        if (!isNode(node)) return;
        if (node !== body && FUNCTION_TYPES.has(node.type)) return;
        visit(node);
        for (const key of Object.keys(node)) {
            const value = node[key];
            if (Array.isArray(value)) {
                for (const child of value) if (isNode(child)) recurse(child);
            } else if (isNode(value)) {
                recurse(value);
            }
        }
    }
    recurse(body);
}

function getPropName(memberExpr) {
    if (memberExpr.computed) {
        return memberExpr.property.type === 'Literal' ? String(memberExpr.property.value) : null;
    }
    return memberExpr.property.type === 'Identifier' ? memberExpr.property.name : null;
}

/**
 * True if the expression contains a read of game-rendered text or a tainted alias.
 * `LOCAL_FUNCTION_NAMES` holds the current file's same-file function names: a call to
 * one of those is treated as a resolver whose return value has its own semantics, so
 * tainted ARGUMENTS do not taint the call result (e.g. `const colKey =
 * this._textToColKey(headerDomText)` yields an internal canonical key, not DOM text).
 */
let LOCAL_FUNCTION_NAMES = new Set();

/** True if the expression contains a read of game-rendered text or a tainted alias. */
function containsDomTextSource(node, taintStack) {
    let found = false;
    // Tainted identifiers don't propagate through a nested function boundary: in
    // `list.find(x => x.price === priceText)` the captured tainted priceText doesn't
    // make the find() result game text. Direct .textContent reads inside callbacks
    // (e.g. `.map(x => x.textContent)`) still count.
    function recurse(n, insideNestedFunction) {
        if (found || !isNode(n)) return;
        // typeof x is a type string, never game text — don't let taint leak through.
        if (n.type === 'UnaryExpression' && n.operator === 'typeof') return;
        if (n.type === 'MemberExpression' && DOM_TEXT_PROPS.has(getPropName(n))) {
            found = true;
            return;
        }
        if (
            n.type === 'CallExpression' &&
            n.callee.type === 'MemberExpression' &&
            getPropName(n.callee) === 'getAttribute' &&
            n.arguments.length > 0 &&
            n.arguments[0].type === 'Literal' &&
            DOM_TEXT_ATTRS.has(String(n.arguments[0].value))
        ) {
            found = true;
            return;
        }
        // Same-file resolver call: taint may flow via the receiver (this.x chains)
        // but arguments don't taint the result.
        if (n.type === 'CallExpression') {
            let calleeIsLocal = false;
            const c = n.callee;
            if (c.type === 'Identifier' && LOCAL_FUNCTION_NAMES.has(c.name)) calleeIsLocal = true;
            if (
                c.type === 'MemberExpression' &&
                !c.computed &&
                c.property.type === 'Identifier' &&
                LOCAL_FUNCTION_NAMES.has(c.property.name)
            ) {
                calleeIsLocal = true;
            }
            if (calleeIsLocal) {
                recurse(c.object, insideNestedFunction);
                return;
            }
        }
        if (n.type === 'Identifier' && !insideNestedFunction) {
            for (let i = taintStack.length - 1; i >= 0; i--) {
                if (taintStack[i].has(n.name)) {
                    found = true;
                    return;
                }
            }
        }
        // Composite alias keys ('obj.prop'): objects whose fields are seeded from DOM
        // text (const info = { name: el.textContent.trim() }) taint per-property, so
        // `info.name` is game text without tainting sibling fields like info.count.
        if (
            n.type === 'MemberExpression' &&
            !n.computed &&
            n.object.type === 'Identifier' &&
            n.property.type === 'Identifier'
        ) {
            const composite = `${n.object.name}.${n.property.name}`;
            if (!insideNestedFunction) {
                for (let i = taintStack.length - 1; i >= 0; i--) {
                    if (taintStack[i].has(composite)) {
                        found = true;
                        return;
                    }
                }
            }
        }
        // For non-computed member access (x.status), the property is an Identifier node
        // but not a variable reference — don't let it match a tainted local of the same name.
        if (n.type === 'MemberExpression' && !n.computed) {
            recurse(n.object, insideNestedFunction);
            return;
        }
        const nested = insideNestedFunction || FUNCTION_TYPES.has(n.type);
        for (const key of Object.keys(n)) {
            const value = n[key];
            if (Array.isArray(value)) {
                for (const child of value) recurse(child, nested);
            } else {
                recurse(value, nested);
            }
        }
    }
    recurse(node, false);
    return found;
}

const HAS_ENGLISH_WORD = /[A-Za-z]{3,}/;
const DOTTED_I18N_KEY = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/;

/** True for literals that are clearly not player-facing English words. */
function isNonEnglishLiteral(value) {
    const text = String(value).trim();
    if (!HAS_ENGLISH_WORD.test(text)) return true; // numbers, punctuation, ≤2 letters
    if (text.startsWith('/') || text.startsWith('#')) return true; // HRID / sprite href
    if (text.includes('#')) return true; // sprite href fragment
    if (text.includes('_')) return true; // CSS class fragment, e.g. MarketplacePanel_buyContainer
    if (DOTTED_I18N_KEY.test(text)) return true; // i18n key, e.g. marketplacePanel.sell
    return false;
}

function englishLiteralsIn(arrayExpr) {
    const literals = [];
    for (const el of arrayExpr.elements) {
        if (isNode(el) && el.type === 'Literal' && typeof el.value === 'string' && !isNonEnglishLiteral(el.value)) {
            literals.push(el.value);
        }
    }
    return literals;
}

function isEnglishStringLiteral(node) {
    return (
        isNode(node) && node.type === 'Literal' && typeof node.value === 'string' && !isNonEnglishLiteral(node.value)
    );
}

/** True if the expression subtree contains a call to a known game-i18n helper. */
function containsI18nHelperCall(node) {
    let found = false;
    walk(node, (n) => {
        if (
            !found &&
            n.type === 'CallExpression' &&
            n.callee.type === 'Identifier' &&
            I18N_HELPERS.has(n.callee.name)
        ) {
            found = true;
        }
    });
    return found;
}

function isEnglishRegexLiteral(node) {
    return isNode(node) && node.type === 'Literal' && node.regex && /[A-Za-z]{2,}/.test(node.regex.pattern);
}

function literalLabel(node) {
    if (node.regex) return `/${node.regex.pattern}/${node.regex.flags}`;
    return String(node.value);
}

/** HRID-shaped string prefixes: '/items/', '/abilities/', '/chat_channel_types/', ... */
const HRID_PREFIX_RE = /^\/[a-z][a-z_]*\//;

/**
 * Minimal stable serialization of a small expression for allowlist keys.
 * Handles identifiers, member chains, literals and call names; anything else
 * collapses to 'expr'.
 */
function serializeExpr(node) {
    if (!isNode(node)) return 'expr';
    switch (node.type) {
        case 'Identifier':
            return node.name;
        case 'ThisExpression':
            return 'this';
        case 'Literal':
            return node.regex ? `/${node.regex.pattern}/` : JSON.stringify(node.value);
        case 'MemberExpression': {
            const obj = serializeExpr(node.object);
            const prop = node.computed
                ? `[${node.property.type === 'Literal' ? serializeExpr(node.property) : '*'}]`
                : `.${node.property.name ?? '*'}`;
            return `${obj}${prop}`;
        }
        case 'CallExpression':
            return `${serializeExpr(node.callee)}(…)`;
        case 'BinaryExpression':
            return `${serializeExpr(node.left)}${node.operator}${serializeExpr(node.right)}`;
        default:
            return 'expr';
    }
}

/** True if the subtree reads a `.name` data field (object not itself DOM text). */
function containsDataNameRead(node, taintStack) {
    let found = false;
    walk(node, (n) => {
        if (found || n.type !== 'MemberExpression' || n.computed) return;
        if (getPropName(n) !== 'name') return;
        // Exclude reads on DOM-text-derived objects (el.textContent-ish aliases).
        if (!containsDomTextSource(n.object, taintStack)) found = true;
    });
    return found;
}

/** True if the subtree contains a whitespace<->underscore slug transform call. */
function containsSlugTransform(node) {
    let found = false;
    walk(node, (n) => {
        if (found || n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression') return;
        const method = getPropName(n.callee);
        if (method !== 'replace' && method !== 'replaceAll') return;
        const [pattern, replacement] = n.arguments;
        if (!isNode(pattern) || !isNode(replacement) || replacement.type !== 'Literal') return;
        const patternText =
            pattern.type === 'Literal' ? (pattern.regex ? pattern.regex.pattern : String(pattern.value)) : null;
        if (patternText === null) return;
        const toUnderscore = replacement.value === '_' && /(\\s|\s)/.test(patternText);
        const toSpace = replacement.value === ' ' && patternText.includes('_');
        if (toUnderscore || toSpace) found = true;
    });
    return found;
}

/** Parameter names of a function node (best effort — destructured/rest params are skipped). */
function paramNames(fnNode) {
    const names = [];
    for (const p of fnNode.params || []) {
        if (p.type === 'Identifier') names.push(p.name);
        else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') names.push(p.left.name);
        else names.push(null);
    }
    return names;
}

/**
 * Flatten `'/items/' + a + b` (or a template literal whose first quasi is an HRID prefix).
 * Returns { prefix, rest: [nodes] } or null.
 */
function hridConcatParts(node) {
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        const operands = [];
        (function flatten(n) {
            if (n.type === 'BinaryExpression' && n.operator === '+') {
                flatten(n.left);
                flatten(n.right);
            } else {
                operands.push(n);
            }
        })(node);
        const literalIndex = operands.findIndex(
            (o) => o.type === 'Literal' && typeof o.value === 'string' && HRID_PREFIX_RE.test(o.value)
        );
        if (literalIndex === -1) return null;
        return { prefix: operands[literalIndex].value, rest: operands.filter((_, i) => i !== literalIndex) };
    }
    if (node.type === 'TemplateLiteral' && node.quasis.length > 1) {
        const raw = node.quasis[0].value.raw;
        if (HRID_PREFIX_RE.test(raw)) return { prefix: raw, rest: node.expressions };
    }
    return null;
}

/** Collect (file, literal) hits for one parsed file. */
function analyzeFile(filePath, ast) {
    // Scope stack entries: { taint:Set<string>, i18nAliases:Set<string>, nameAliases:Set<string>,
    //   slugVars:Set<string>, literalCollections:Map<string,string[]>,
    //   keyedObjects:Map<string,string[]>, hasI18nHelper:boolean, fnName:?string, fnParams:?string[] }
    const scopeStack = [];

    // --- File-level registries (data-flow extension) ---
    // Same-file named functions, by name. Collisions (same method name in several
    // classes) are unioned — same-named helpers are usually copies of one pattern.
    const namedFunctions = new Map(); // name -> [{ node, params, hasHelper }]
    const fnNodeToName = new Map(); // function node -> name
    const paramTaintByName = new Map(); // fnName -> Set(paramName) seeded from call sites
    const forwardedByName = new Map(); // fnName -> Map(paramIndex -> Set(englishLiteral))
    // Reverse-lookup maps keyed by English `.name` data fields, by variable name
    // ('map' / 'this.cache'). File-level so lazy build-after-read orders work.
    const mapVars = new Map(); // name -> { keyed:boolean, dual:boolean }
    // DOM-text props that a named function hands back to callers via a returned
    // object (parseTaskCard() → { taskName: el.textContent }), by function name.
    // Lets `const info = this.parseTaskCard(card)` seed `info.taskName` composites.
    const returnsCompositeByName = new Map(); // fnName -> Set(propName)
    let recording = false; // pass 1 collects registries, pass 2 records hits

    function makeMapEntry(name) {
        let entry = mapVars.get(name);
        if (!entry) {
            entry = { keyed: false, dual: false };
            mapVars.set(name, entry);
        }
        return entry;
    }

    /** Resolve the mapVars key for a `.get()`/`[...]` object node, or null. */
    function mapVarKey(objNode) {
        if (objNode.type === 'Identifier') return objNode.name;
        if (
            objNode.type === 'MemberExpression' &&
            !objNode.computed &&
            objNode.object.type === 'ThisExpression' &&
            objNode.property.type === 'Identifier'
        ) {
            return 'this.' + objNode.property.name;
        }
        return null;
    }

    /** Register named functions of the file and whether each calls an i18n helper. */
    (function collectNamedFunctions() {
        function register(name, fnNode) {
            if (!fnNodeToName.has(fnNode)) fnNodeToName.set(fnNode, name);
            if (!namedFunctions.has(name)) namedFunctions.set(name, []);
            namedFunctions.get(name).push({
                node: fnNode,
                params: paramNames(fnNode),
                hasHelper: containsI18nHelperCall(fnNode),
            });
            if (!paramTaintByName.has(name)) paramTaintByName.set(name, new Set());
            if (!forwardedByName.has(name)) forwardedByName.set(name, new Map());
        }
        walk(ast, (n) => {
            if (n.type === 'FunctionDeclaration' && n.id) {
                register(n.id.name, n);
            } else if (
                n.type === 'VariableDeclarator' &&
                n.id.type === 'Identifier' &&
                isNode(n.init) &&
                FUNCTION_TYPES.has(n.init.type)
            ) {
                register(n.id.name, n.init);
            } else if (
                (n.type === 'MethodDefinition' || n.type === 'Property') &&
                isNode(n.value) &&
                FUNCTION_TYPES.has(n.value.type)
            ) {
                const key =
                    n.key.type === 'Identifier' ? n.key.name : n.key.type === 'Literal' ? String(n.key.value) : null;
                if (key) register(key, n.value);
            }
        });
    })();
    // Publish for containsDomTextSource: same-file calls are resolvers whose result
    // has its own semantics (args don't taint it).
    LOCAL_FUNCTION_NAMES = new Set(namedFunctions.keys());

    /** Call-site name: foo(...), this.foo(...), obj.foo(...), obj['foo'](...). */
    function calleeName(callNode) {
        const c = callNode.callee;
        if (c.type === 'Identifier') return c.name;
        if (c.type === 'MemberExpression') {
            if (!c.computed && c.property.type === 'Identifier') return c.property.name;
            if (c.computed && c.property.type === 'Literal' && typeof c.property.value === 'string')
                return c.property.value;
        }
        return null;
    }

    /** True if the subtree references any var in `sets` (scope-resolved alias sets). */
    function referencesAliasVar(node, setsPicker) {
        let found = false;
        walk(node, (n) => {
            if (found || n.type !== 'Identifier') return;
            for (let i = scopeStack.length - 1; i >= 0; i--) {
                if (setsPicker(scopeStack[i]).has(n.name)) {
                    found = true;
                    return;
                }
            }
        });
        return found;
    }

    /** True if the expression is DOM-tainted, slug-transformed, or a hrid concat of those. */
    function isDomSlugish(node, taintStack) {
        if (containsDomTextSource(node, taintStack)) return true;
        if (containsSlugTransform(node) && containsDomTextSource(node, taintStack)) return true;
        const parts = hridConcatParts(node);
        if (parts && parts.rest.some((r) => containsDomTextSource(r, taintStack) || containsSlugTransform(r)))
            return true;
        if (referencesAliasVar(node, (s) => s.slugVars)) return true;
        return false;
    }

    /** First `.name` data read in the subtree, serialized for the allowlist key. */
    function findDataNameLabel(node, taintStack) {
        let label = null;
        walk(node, (n) => {
            if (label || n.type !== 'MemberExpression' || n.computed || getPropName(n) !== 'name') return;
            if (!containsDomTextSource(n.object, taintStack)) label = serializeExpr(n);
        });
        return label;
    }

    function currentScope() {
        return scopeStack[scopeStack.length - 1];
    }

    function makeScope(fnNode) {
        const scope = {
            taint: new Set(),
            i18nAliases: new Set(),
            nameAliases: new Set(), // vars initialized from data `.name` reads / hrid-phrase derivations
            slugVars: new Set(), // DOM-text-derived slug/hrid-concat variables
            literalCollections: new Map(), // name -> { literals: string[], dual: boolean }
            keyedObjects: new Map(), // name -> { keys: string[], dual: boolean }
            hasI18nHelper: false,
            fnName: fnNodeToName.get(fnNode) || null,
            fnParams: paramNames(fnNode),
        };
        // Seed params that receive DOM text at same-file call sites (pass 2 has the
        // complete map; pass 1 seeding is partial and only aids call-site analysis).
        if (scope.fnName) {
            for (const p of paramTaintByName.get(scope.fnName) || []) scope.taint.add(p);
        }
        walkDirectBody(fnNode, (n) => {
            if (n.type === 'CallExpression') {
                const callee = n.callee;
                if (callee.type === 'Identifier' && I18N_HELPERS.has(callee.name)) {
                    scope.hasI18nHelper = true;
                }
            }
            // A reverse-lookup object that also gets translated keys assigned
            // (obj[translateGameName(...)] = ...) is a dual-match map.
            if (
                n.type === 'AssignmentExpression' &&
                n.left.type === 'MemberExpression' &&
                n.left.computed &&
                n.left.object.type === 'Identifier' &&
                containsI18nHelperCall(n.left.property)
            ) {
                // The object may be declared in this scope (walk is in source order) or an outer one.
                const entry =
                    scope.keyedObjects.get(n.left.object.name) ||
                    [...scopeStack]
                        .reverse()
                        .map((s) => s.keyedObjects.get(n.left.object.name))
                        .find(Boolean);
                if (entry) entry.dual = true;
            }
            // Assignment taint: let text; if (cond) { text = el.textContent.trim(); }
            if (
                n.type === 'AssignmentExpression' &&
                n.operator === '=' &&
                n.left.type === 'Identifier' &&
                isNode(n.right)
            ) {
                if (
                    n.right.type !== 'ObjectExpression' &&
                    containsDomTextSource(n.right, [...scopeStack.map((s) => s.taint), scope.taint])
                ) {
                    scope.taint.add(n.left.name);
                }
            }
            // Per-property assignment taint: obj.label = el.textContent.trim()
            if (
                n.type === 'AssignmentExpression' &&
                n.operator === '=' &&
                n.left.type === 'MemberExpression' &&
                !n.left.computed &&
                n.left.object.type === 'Identifier' &&
                n.left.property.type === 'Identifier' &&
                isNode(n.right) &&
                containsDomTextSource(n.right, [...scopeStack.map((s) => s.taint), scope.taint])
            ) {
                scope.taint.add(`${n.left.object.name}.${n.left.property.name}`);
            }
            // `return { title: el.textContent.trim() }` — the returned object never gets
            // a local name, so publish its DOM-text props for callers directly.
            if (
                n.type === 'ReturnStatement' &&
                isNode(n.argument) &&
                n.argument.type === 'ObjectExpression' &&
                scope.fnName
            ) {
                let props = returnsCompositeByName.get(scope.fnName);
                if (!props) returnsCompositeByName.set(scope.fnName, (props = new Set()));
                for (const prop of n.argument.properties) {
                    if (prop.type !== 'Property' || prop.computed || !isNode(prop.value)) continue;
                    const keyName =
                        prop.key.type === 'Identifier' && !prop.computed
                            ? prop.key.name
                            : prop.key.type === 'Literal'
                              ? String(prop.key.value)
                              : null;
                    if (
                        keyName &&
                        containsDomTextSource(prop.value, [...scopeStack.map((s) => s.taint), scope.taint])
                    ) {
                        props.add(keyName);
                    }
                }
            }
            if (n.type !== 'VariableDeclarator' || !isNode(n.init)) return;
            // Text aliases: const text = el.textContent.trim()
            // Include this scope's own partially-built taint so sequential chains work
            // (const a = el.textContent; const b = a.trim();). Object literals are
            // excluded here — their fields taint per-property below instead of
            // tainting every reference to the whole object.
            if (
                n.init.type !== 'ObjectExpression' &&
                containsDomTextSource(n.init, [...scopeStack.map((s) => s.taint), scope.taint])
            ) {
                if (n.id.type === 'Identifier') {
                    scope.taint.add(n.id.name);
                } else if (n.id.type === 'ArrayPattern') {
                    for (const el of n.id.elements) {
                        if (isNode(el) && el.type === 'Identifier') scope.taint.add(el.name);
                    }
                }
            }
            // Per-property taint: const info = { name: el.textContent.trim() } → 'info.name'
            if (n.id.type === 'Identifier' && n.init.type === 'ObjectExpression') {
                const initTaint = [...scopeStack.map((s) => s.taint), scope.taint];
                for (const prop of n.init.properties) {
                    if (prop.type !== 'Property' || prop.computed || !isNode(prop.value)) continue;
                    const keyName =
                        prop.key.type === 'Identifier' && !prop.computed
                            ? prop.key.name
                            : prop.key.type === 'Literal'
                              ? String(prop.key.value)
                              : null;
                    if (keyName && containsDomTextSource(prop.value, initTaint)) {
                        scope.taint.add(`${n.id.name}.${keyName}`);
                    }
                }
            }
            // Local-call composite seeding: const info = this.parseTaskCard(card) —
            // the helper hands back an object whose text fields are DOM-derived.
            if (n.id.type === 'Identifier' && n.init.type === 'CallExpression') {
                const callee = calleeName(n.init);
                const props = callee ? returnsCompositeByName.get(callee) : null;
                if (props) {
                    for (const prop of props) scope.taint.add(`${n.id.name}.${prop}`);
                }
            }
            // i18n aliases: const label = translateGameName(..., 'English')
            if (n.id.type === 'Identifier' && containsI18nHelperCall(n.init)) {
                scope.i18nAliases.add(n.id.name);
            }
            // Data-name aliases: const label = detail.name (or an OR chain mixing it with
            // hrid-phrase derivations). Used by the data-name-includes case.
            if (n.id.type === 'Identifier') {
                const initTaint = [...scopeStack.map((s) => s.taint), scope.taint];
                if (containsDataNameRead(n.init, initTaint) || containsSlugTransform(n.init)) {
                    scope.nameAliases.add(n.id.name);
                }
                // DOM-derived slug variables: '/items/' + name.toLowerCase().replace(...)
                // or name.toLowerCase().replaceAll(' ', '_') from DOM text.
                const concatParts = hridConcatParts(n.init);
                if (
                    (containsDomTextSource(n.init, initTaint) && containsSlugTransform(n.init)) ||
                    (concatParts &&
                        concatParts.rest.some(
                            (r) => containsDomTextSource(r, initTaint) || containsSlugTransform(r)
                        )) ||
                    referencesAliasVar(n.init, (s) => s.slugVars)
                ) {
                    scope.slugVars.add(n.id.name);
                }
            }
            // Literal collections: const TABS = ['Sell', 'Buy'] / new Set([...])
            let arrayExpr = null;
            if (n.init.type === 'ArrayExpression') {
                arrayExpr = n.init;
            } else if (
                n.init.type === 'NewExpression' &&
                n.init.callee.type === 'Identifier' &&
                n.init.callee.name === 'Set' &&
                n.init.arguments.length > 0 &&
                n.init.arguments[0].type === 'ArrayExpression'
            ) {
                arrayExpr = n.init.arguments[0];
            }
            if (arrayExpr && n.id.type === 'Identifier') {
                const literals = englishLiteralsIn(arrayExpr);
                if (literals.length > 0) {
                    // A collection mixing literals with i18n-helper results is a dual-match set.
                    scope.literalCollections.set(n.id.name, {
                        literals,
                        dual: containsI18nHelperCall(arrayExpr) || scope.i18nAliases.has(n.id.name),
                    });
                }
            }
            // English-keyed objects: const KEY_BY_NAME = { 'Dining Room': 'dining_room', ... }
            if (n.init.type === 'ObjectExpression' && n.id.type === 'Identifier') {
                const keys = [];
                for (const prop of n.init.properties) {
                    if (prop.type !== 'Property') continue;
                    const keyNode = prop.key;
                    const keyValue =
                        keyNode.type === 'Literal'
                            ? String(keyNode.value)
                            : keyNode.type === 'Identifier' && !prop.computed
                              ? keyNode.name
                              : null;
                    if (keyValue && !isNonEnglishLiteral(keyValue)) keys.push(keyValue);
                }
                if (keys.length > 0) scope.keyedObjects.set(n.id.name, { keys, dual: false });
            }
        });
        // Publish DOM-text props built in this function so callers of this local
        // helper can seed composites from its call result (collected on every pass;
        // the union is stable once the first collect pass completes).
        if (scope.fnName) {
            let props = returnsCompositeByName.get(scope.fnName);
            if (!props) returnsCompositeByName.set(scope.fnName, (props = new Set()));
            for (const entry of scope.taint) {
                const dot = entry.indexOf('.');
                if (dot !== -1) props.add(entry.slice(dot + 1));
            }
        }
        return scope;
    }

    function isSuppressed(parents) {
        // Function-level dual match: the nearest enclosing function calls a game-i18n
        // helper, so its English literals are fallbacks (e.g. alchemy-best-items.js:226-236).
        if (currentScope().hasI18nHelper) return true;
        // Inline dual match: `x === 'Sell' || x === translatedLabel` — check the enclosing
        // logical/conditional chain for an i18n helper call or an alias bound to one
        // (covers dual matches written inside nested arrow functions).
        for (let i = parents.length - 1; i >= 0; i--) {
            const p = parents[i];
            if (p.type === 'LogicalExpression' || p.type === 'ConditionalExpression') {
                let dualFound = containsI18nHelperCall(p);
                if (!dualFound) {
                    walk(p, (n) => {
                        if (dualFound || n.type !== 'Identifier') return;
                        for (let s = scopeStack.length - 1; s >= 0; s--) {
                            if (scopeStack[s].i18nAliases.has(n.name)) {
                                dualFound = true;
                                return;
                            }
                        }
                    });
                }
                if (dualFound) return true;
            } else if (!['BinaryExpression', 'CallExpression', 'UnaryExpression', 'ChainExpression'].includes(p.type)) {
                break;
            }
        }
        return false;
    }

    function record(siteNode, kind, literal, parents, forceSuppressed = false) {
        if (!recording) return;
        hits.push({
            file: filePath,
            line: siteNode.loc.start.line,
            kind,
            literal,
            suppressed: forceSuppressed || isSuppressed(parents),
        });
    }

    /**
     * Forwarded-literal lookup (Case 10): the match site's literal side is an
     * Identifier that is a parameter of an enclosing named function, and some
     * same-file call site passes an English literal in that position.
     * Returns the forwarded English literals (possibly none).
     */
    function forwardedLiteralsFor(paramIdentifier) {
        for (let i = scopeStack.length - 1; i >= 0; i--) {
            const scope = scopeStack[i];
            if (!scope.fnName || !scope.fnParams) continue;
            const index = scope.fnParams.indexOf(paramIdentifier.name);
            if (index !== -1) {
                const forwarded = forwardedByName.get(scope.fnName)?.get(index);
                if (forwarded && forwarded.size > 0) {
                    return [...forwarded].filter((l) => !isNonEnglishLiteral(l));
                }
            }
        }
        return [];
    }

    /** Suppression for forwarded hits: any same-named function calls an i18n helper. */
    function forwardedCalleeIsDual(fnName) {
        return (namedFunctions.get(fnName) || []).some((fn) => fn.hasHelper);
    }

    // Visit with parent tracking via manual recursion so we can maintain the scope stack.
    function visit(node, parents) {
        const isFunction = FUNCTION_TYPES.has(node.type) || node.type === 'Program';
        if (isFunction) {
            scopeStack.push(makeScope(node));
        }

        if (!isFunction) {
            const taintStack = scopeStack.map((s) => s.taint);

            // Pass-1 registry collection: call-site taint seeding, forwarded literals,
            // and .name-keyed reverse-lookup map registration/marking.
            if (!recording) {
                if (node.type === 'CallExpression') {
                    const name = calleeName(node);
                    if (name && namedFunctions.has(name)) {
                        node.arguments.forEach((argNode, index) => {
                            if (!isNode(argNode)) return;
                            if (containsDomTextSource(argNode, taintStack)) {
                                for (const fn of namedFunctions.get(name)) {
                                    const paramName = fn.params[index];
                                    if (paramName) paramTaintByName.get(name).add(paramName);
                                }
                            }
                            // Composite propagation: helper(card, info) where the caller
                            // knows `info.taskName` is DOM text → the callee's param keeps
                            // a `paramName.taskName` composite.
                            if (argNode.type === 'Identifier') {
                                const prefix = `${argNode.name}.`;
                                const props = [];
                                for (const set of taintStack) {
                                    for (const entry of set) {
                                        if (entry.startsWith(prefix)) props.push(entry.slice(prefix.length));
                                    }
                                }
                                if (props.length > 0) {
                                    for (const fn of namedFunctions.get(name)) {
                                        const paramName = fn.params[index];
                                        if (paramName) {
                                            for (const prop of props)
                                                paramTaintByName.get(name).add(`${paramName}.${prop}`);
                                        }
                                    }
                                }
                            }
                            if (isEnglishStringLiteral(argNode)) {
                                const byIndex = forwardedByName.get(name);
                                if (!byIndex.has(index)) byIndex.set(index, new Set());
                                byIndex.get(index).add(String(argNode.value));
                            }
                        });
                    }
                    // map.set(detail.name, hrid) — mark the reverse-lookup map entry.
                    if (
                        node.callee.type === 'MemberExpression' &&
                        getPropName(node.callee) === 'set' &&
                        isNode(node.arguments[0])
                    ) {
                        const key = mapVarKey(node.callee.object);
                        if (key) {
                            const entry = makeMapEntry(key);
                            if (containsDataNameRead(node.arguments[0], taintStack)) entry.keyed = true;
                            if (containsI18nHelperCall(node.arguments[0])) entry.dual = true;
                        }
                    }
                }
                // this.cache = new Map() / obj[detail.name] = hrid registrations.
                if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isNode(node.init)) {
                    if (
                        (node.init.type === 'NewExpression' &&
                            node.init.callee.type === 'Identifier' &&
                            node.init.callee.name === 'Map') ||
                        node.init.type === 'ObjectExpression'
                    ) {
                        makeMapEntry(node.id.name);
                    }
                }
                if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
                    const key = mapVarKey(node.left.object);
                    if (key && isNode(node.right)) {
                        if (
                            (node.right.type === 'NewExpression' &&
                                node.right.callee.type === 'Identifier' &&
                                node.right.callee.name === 'Map') ||
                            node.right.type === 'ObjectExpression'
                        ) {
                            makeMapEntry(key);
                        } else if (node.left.computed && isNode(node.left.property)) {
                            const entry = makeMapEntry(key);
                            if (containsDataNameRead(node.left.property, taintStack)) entry.keyed = true;
                            if (containsI18nHelperCall(node.left.property)) entry.dual = true;
                        } else if (node.right.type === 'Identifier') {
                            // Map aliasing: this.cache = map — propagate keyed/dual flags
                            // so later this.cache.get(domText) hits register too.
                            const src = mapVars.get(node.right.name);
                            if (src) {
                                const entry = makeMapEntry(key);
                                if (src.keyed) entry.keyed = true;
                                if (src.dual) entry.dual = true;
                            }
                        }
                    }
                }
            }

            // Case 1: binary comparison, literal vs DOM text
            if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
                const leftLit = isEnglishStringLiteral(node.left);
                const rightLit = isEnglishStringLiteral(node.right);
                if (leftLit !== rightLit) {
                    const literal = leftLit ? node.left : node.right;
                    const subject = leftLit ? node.right : node.left;
                    if (containsDomTextSource(subject, taintStack)) {
                        record(node, 'compare', literalLabel(literal), [...parents, node]);
                    }
                }
                // Case 10 (compare form): findButton('Buy') — the helper compares its
                // param against DOM text and the English literal lives at the call site.
                if (node.left.type === 'Identifier' && containsDomTextSource(node.right, taintStack)) {
                    for (const literal of forwardedLiteralsFor(node.left)) {
                        record(
                            node,
                            'compare(forwarded)',
                            literal,
                            [...parents, node],
                            forwardedCalleeIsDual(
                                scopeStack.find((s) => s.fnParams?.includes(node.left.name))?.fnName || ''
                            )
                        );
                    }
                } else if (node.right.type === 'Identifier' && containsDomTextSource(node.left, taintStack)) {
                    for (const literal of forwardedLiteralsFor(node.right)) {
                        record(
                            node,
                            'compare(forwarded)',
                            literal,
                            [...parents, node],
                            forwardedCalleeIsDual(
                                scopeStack.find((s) => s.fnParams?.includes(node.right.name))?.fnName || ''
                            )
                        );
                    }
                }
                // Case 7: DOM text vs English data `.name` field (no literal at the site).
                const dataNameLeft = findDataNameLabel(node.left, taintStack);
                const dataNameRight = findDataNameLabel(node.right, taintStack);
                if (!dataNameLeft !== !dataNameRight) {
                    const dataSide = dataNameLeft ? node.left : node.right;
                    const otherSide = dataNameLeft ? node.right : node.left;
                    if (containsDomTextSource(otherSide, taintStack)) {
                        record(node, 'data-name-compare', dataNameLeft || dataNameRight, [...parents, node]);
                    }
                }
                // Case 7b: DOM-derived slug variable compared against data (or a literal).
                const slugLeft = referencesAliasVar(node.left, (s) => s.slugVars);
                const slugRight = referencesAliasVar(node.right, (s) => s.slugVars);
                if (slugLeft !== slugRight) {
                    const otherSide = slugLeft ? node.right : node.left;
                    if (!containsDomTextSource(otherSide, taintStack)) {
                        record(node, 'dom-slug-compare', serializeExpr(slugLeft ? node.left : node.right), [
                            ...parents,
                            node,
                        ]);
                    }
                }
            }

            // Case 2: text.includes('X') / .match(/X/) on DOM text
            if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
                const method = getPropName(node.callee);
                const obj = node.callee.object;
                const arg = node.arguments[0];
                if (STRING_MATCH_METHODS.has(method) && isNode(arg)) {
                    const literalArg = isEnglishStringLiteral(arg) || isEnglishRegexLiteral(arg) ? arg : null;
                    if (literalArg && containsDomTextSource(obj, taintStack)) {
                        record(node, `.${method}`, literalLabel(literalArg), [...parents, node]);
                    }
                    // Case 10 (method form): el.textContent.startsWith(prefixParam)
                    if (!literalArg && arg.type === 'Identifier' && containsDomTextSource(obj, taintStack)) {
                        for (const literal of forwardedLiteralsFor(arg)) {
                            const scope = scopeStack.find((s) => s.fnParams?.includes(arg.name));
                            record(
                                node,
                                `.${method}(forwarded)`,
                                literal,
                                [...parents, node],
                                forwardedCalleeIsDual(scope?.fnName || '')
                            );
                        }
                    }
                    // Case 8: domText.includes(detail.name) / (var derived from .name or hrid phrases)
                    if (containsDomTextSource(obj, taintStack)) {
                        const label = findDataNameLabel(arg, taintStack);
                        if (label || referencesAliasVar(arg, (s) => s.nameAliases)) {
                            record(node, `.${method}(data-name)`, label || serializeExpr(arg), [...parents, node]);
                        }
                    }
                    // Case 8b: data.includes(domDerivedSlug) — the DOM text arrives via the
                    // argument (e.g. primaryItemHash.includes(itemHridFromDiv)).
                    if (!containsDomTextSource(obj, taintStack)) {
                        const slugish =
                            referencesAliasVar(arg, (s) => s.slugVars) ||
                            (isNode(arg) && containsDomTextSource(arg, taintStack) && containsSlugTransform(arg));
                        if (slugish) {
                            record(node, `.${method}(dom-slug)`, serializeExpr(arg), [...parents, node]);
                        }
                    }
                    // Case 9b: hrid.includes('/' + domSlug)
                    if (
                        isNode(arg) &&
                        arg.type === 'BinaryExpression' &&
                        arg.operator === '+' &&
                        arg.left.type === 'Literal' &&
                        arg.left.value === '/' &&
                        isDomSlugish(arg.right, taintStack)
                    ) {
                        record(node, `.${method}(hrid-slug)`, `'+ ${serializeExpr(arg.right)}`, [...parents, node]);
                    }
                }
                // Case 2b: /regex/.test(domText)
                if (
                    method === 'test' &&
                    isEnglishRegexLiteral(obj) &&
                    isNode(arg) &&
                    containsDomTextSource(arg, taintStack)
                ) {
                    record(node, '.test', literalLabel(obj), [...parents, node]);
                }
                // Case 3: inverted — ['Sell',...].includes(domText), set.has(domText)
                if (COLLECTION_METHODS.has(method) && isNode(arg) && containsDomTextSource(arg, taintStack)) {
                    let collection = null; // { literals, dual }
                    if (obj.type === 'ArrayExpression') {
                        const literals = englishLiteralsIn(obj);
                        if (literals.length > 0) collection = { literals, dual: containsI18nHelperCall(obj) };
                    } else if (obj.type === 'Identifier') {
                        for (let i = scopeStack.length - 1; i >= 0 && !collection; i--) {
                            collection = scopeStack[i].literalCollections.get(obj.name) || null;
                        }
                    }
                    if (collection) {
                        record(
                            node,
                            `.${method}(collection)`,
                            collection.literals.join('|'),
                            [...parents, node],
                            collection.dual
                        );
                    }
                }
                // Case 6: name-keyed reverse-lookup map queried with DOM text.
                if (method === 'get' && isNode(arg) && containsDomTextSource(arg, taintStack)) {
                    const key = mapVarKey(obj);
                    const entry = key ? mapVars.get(key) : null;
                    if (entry && entry.keyed) {
                        record(node, 'name-map-lookup', `map:${key}`, [...parents, node], entry.dual);
                    }
                }
            }

            // Case 4: reverse lookup ENGLISH_KEYED_OBJECT[domText]
            if (node.type === 'MemberExpression' && node.computed && containsDomTextSource(node.property, taintStack)) {
                if (node.object.type === 'Identifier') {
                    for (let i = scopeStack.length - 1; i >= 0; i--) {
                        const entry = scopeStack[i].keyedObjects.get(node.object.name);
                        if (entry) {
                            record(
                                node,
                                'reverse-lookup',
                                entry.keys.slice(0, 3).join('|') + (entry.keys.length > 3 ? '|…' : ''),
                                [...parents, node],
                                entry.dual
                            );
                            break;
                        }
                    }
                }
                // Object form of Case 6: nameKeyedObj[domText]
                const key = mapVarKey(node.object);
                const mapEntry = key ? mapVars.get(key) : null;
                if (mapEntry && mapEntry.keyed) {
                    record(node, 'name-map-lookup', `map:${key}`, [...parents, node], mapEntry.dual);
                }
            }

            // Case 9: '/items/' + domText-derived slug (binary or template literal)
            {
                const parts = hridConcatParts(node);
                if (parts && parts.rest.some((r) => isDomSlugish(r, taintStack))) {
                    record(node, 'hrid-built-from-dom', `${parts.prefix}*`, [...parents, node]);
                }
            }

            // Case 5: querySelector/matches/closest with [aria-label="English"] selector
            if (
                node.type === 'CallExpression' &&
                node.callee.type === 'MemberExpression' &&
                ['querySelector', 'querySelectorAll', 'matches', 'closest'].includes(getPropName(node.callee)) &&
                node.arguments.length > 0 &&
                node.arguments[0].type === 'Literal' &&
                typeof node.arguments[0].value === 'string'
            ) {
                const selector = node.arguments[0].value;
                const attrMatch = selector.match(
                    /\[\s*(?:aria-label|title|placeholder)\s*[\^*$~|]?=\s*["']([^"']+)["']\s*\]/
                );
                if (attrMatch && !isNonEnglishLiteral(attrMatch[1])) {
                    record(node, 'attr-selector', attrMatch[1], [...parents, node]);
                }
            }
        }

        for (const key of Object.keys(node)) {
            const value = node[key];
            if (Array.isArray(value)) {
                for (const child of value) if (isNode(child)) visit(child, [...parents, node]);
            } else if (isNode(value)) {
                visit(value, [...parents, node]);
            }
        }

        if (isFunction) {
            scopeStack.pop();
        }
    }

    // Collect passes seed param taint, forwarded literals, map markings and
    // returned-object composites across the whole file; the second collect pass
    // re-runs scope building with the complete registry (call-site → param →
    // return-object chains are order-free that way). Final pass records hits.
    recording = false;
    visit(ast, []);
    scopeStack.length = 0;
    visit(ast, []);
    scopeStack.length = 0;
    recording = true;
    visit(ast, []);
}

for (const filePath of collectSourceFiles(SRC_DIR)) {
    const relPath = relative(process.cwd(), filePath);
    let ast;
    try {
        ast = espree.parse(readFileSync(filePath, 'utf8'), {
            ecmaVersion: 'latest',
            sourceType: 'module',
            loc: true,
        });
    } catch (error) {
        parseErrors.push(`${relPath}: ${error.message}`);
        continue;
    }
    analyzeFile(relPath, ast);
}

// Triage: suppressed-by-heuristic hits are informational; allowlisted hits are known;
// anything else fails the gate.
const allowlistKeys = new Set(ALLOWLIST.map((e) => `${e.file}::${e.literal}`));
const matchedAllowlist = new Set();
const failures = [];
const known = [];

for (const hit of hits) {
    const key = `${hit.file}::${hit.literal}`;
    if (allowlistKeys.has(key)) {
        matchedAllowlist.add(key);
        known.push(hit);
    } else if (!hit.suppressed) {
        failures.push(hit);
    }
}

for (const key of allowlistKeys) {
    if (!matchedAllowlist.has(key)) {
        allowlistWarnings.push(`allowlist entry no longer matches any hit (fixed or drifted): ${key}`);
    }
}

for (const hit of known) {
    console.log(`ℹ️  known/allowlisted: ${hit.file}:${hit.line} — ${hit.kind} "${hit.literal}"`);
}

// Triage mode: `--all` also prints heuristic-suppressed hits so they can be reviewed.
if (process.argv.includes('--all')) {
    for (const hit of hits) {
        const key = `${hit.file}::${hit.literal}`;
        if (!allowlistKeys.has(key) && hit.suppressed) {
            console.log(`🔎 suppressed: ${hit.file}:${hit.line} — ${hit.kind} "${hit.literal}"`);
        }
    }
}
for (const warning of allowlistWarnings) {
    console.warn(`⚠️  ${warning}`);
}
for (const error of parseErrors) {
    console.warn(`⚠️  parse skipped: ${error}`);
}

if (failures.length > 0) {
    for (const hit of failures) {
        console.error(
            `❌ ${hit.file}:${hit.line} — DOM text matched against English literal (${hit.kind} "${hit.literal}")`
        );
    }
    console.error(
        `\n${failures.length} new i18n DOM-literal issue(s). Fix with a dual match (translateGameName/getItemName/...)\n` +
            `or, if verified locale-independent, add an allowlist entry with the reason in scripts/check-i18n-dom-literals.js.`
    );
    process.exit(1);
}

const heuristicallySuppressed = hits.filter(
    (hit) => !allowlistKeys.has(`${hit.file}::${hit.literal}`) && hit.suppressed
);

console.log(
    `✅ i18n DOM-literal scan passed: ${hits.length} raw hit(s), ${known.length} allowlisted, ` +
        `${heuristicallySuppressed.length} heuristically dual-match-suppressed (unverified — rerun with --all to list), ` +
        `no unaccounted English-literal DOM matches.`
);
