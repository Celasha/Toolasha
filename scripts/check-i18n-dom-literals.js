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
 * "DOM-text-derived" means the expression contains: a .textContent/.innerText/.innerHTML
 * read, .getAttribute('aria-label'|'title'|'placeholder'), or a local const/let aliasing
 * one of those (one-level alias taint, inherited by nested functions).
 *
 * Known blind spots (by design — these need data-flow, not literals; tracked in the report):
 *   - comparisons with no literal at the site (x === data.name, findButton(label) helpers,
 *     aria-label values compared to English data names)
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
    { file: 'src/features/guild/guild-credit-value.js', literal: String.raw`/Lv\.(\d+)/`, reason: 'to-verify: zh trial level format' },
    // --- verified safe (reason required) ---
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'stamina', reason: 'safe: matches DOM of an external English-only site (Shykai calculator), not the game' },
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'intelligence', reason: 'safe: external English-only site DOM' },
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'attack', reason: 'safe: external English-only site DOM' },
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'melee', reason: 'safe: external English-only site DOM' },
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'defense', reason: 'safe: external English-only site DOM' },
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'ranged', reason: 'safe: external English-only site DOM' },
    { file: 'src/features/combat-sim-integration/skill-calculator-ui.js', literal: 'magic', reason: 'safe: external English-only site DOM' },
    {
        file: 'src/features/market/listing-price-display.js',
        literal: String.raw`/([0-9,.]+)\s*([KMB]?)\s*\/\s*([0-9,.]+)\s*([KMB]?)/i`,
        reason: 'safe: number/KMB quantity format is locale-independent',
    },
    { file: 'src/features/tasks/task-reroll-protection.js', literal: 'Pay', reason: 'safe: locale-independent container check is primary; English text is fallback only (291-315)' },
    { file: 'src/features/tasks/task-reroll-protection.js', literal: 'free', reason: 'safe: locale-independent container check is primary; English text is fallback only (291-315)' },
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

/** True if the expression contains a read of game-rendered text or a tainted alias. */
function containsDomTextSource(node, taintStack) {
    let found = false;
    // Tainted identifiers don't propagate through a nested function boundary: in
    // `list.find(x => x.price === priceText)` the captured tainted priceText doesn't
    // make the find() result game text. Direct .textContent reads inside callbacks
    // (e.g. `.map(x => x.textContent)`) still count.
    function recurse(n, insideNestedFunction) {
        if (found || !isNode(n)) return;
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
        if (n.type === 'Identifier' && !insideNestedFunction) {
            for (let i = taintStack.length - 1; i >= 0; i--) {
                if (taintStack[i].has(n.name)) {
                    found = true;
                    return;
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
    return isNode(node) && node.type === 'Literal' && typeof node.value === 'string' && !isNonEnglishLiteral(node.value);
}

/** True if the expression subtree contains a call to a known game-i18n helper. */
function containsI18nHelperCall(node) {
    let found = false;
    walk(node, (n) => {
        if (!found && n.type === 'CallExpression' && n.callee.type === 'Identifier' && I18N_HELPERS.has(n.callee.name)) {
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

/** Collect (file, literal) hits for one parsed file. */
function analyzeFile(filePath, ast) {
    // Scope stack entries: { taint:Set<string>, literalCollections:Map<string,string[]>,
    //   keyedObjects:Map<string,string[]>, hasI18nHelper:boolean }
    const scopeStack = [];

    function currentScope() {
        return scopeStack[scopeStack.length - 1];
    }

    function makeScope(fnNode) {
        const scope = {
            taint: new Set(),
            i18nAliases: new Set(),
            literalCollections: new Map(), // name -> { literals: string[], dual: boolean }
            keyedObjects: new Map(), // name -> { keys: string[], dual: boolean }
            hasI18nHelper: false,
        };
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
                    [...scopeStack].reverse().map((s) => s.keyedObjects.get(n.left.object.name)).find(Boolean);
                if (entry) entry.dual = true;
            }
            if (n.type !== 'VariableDeclarator' || !isNode(n.init)) return;
            // Text aliases: const text = el.textContent.trim()
            // Include this scope's own partially-built taint so sequential chains work
            // (const a = el.textContent; const b = a.trim();).
            if (containsDomTextSource(n.init, [...scopeStack.map((s) => s.taint), scope.taint])) {
                if (n.id.type === 'Identifier') {
                    scope.taint.add(n.id.name);
                } else if (n.id.type === 'ArrayPattern') {
                    for (const el of n.id.elements) {
                        if (isNode(el) && el.type === 'Identifier') scope.taint.add(el.name);
                    }
                }
            }
            // i18n aliases: const label = translateGameName(..., 'English')
            if (n.id.type === 'Identifier' && containsI18nHelperCall(n.init)) {
                scope.i18nAliases.add(n.id.name);
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
                        keyNode.type === 'Literal' ? String(keyNode.value) : keyNode.type === 'Identifier' && !prop.computed ? keyNode.name : null;
                    if (keyValue && !isNonEnglishLiteral(keyValue)) keys.push(keyValue);
                }
                if (keys.length > 0) scope.keyedObjects.set(n.id.name, { keys, dual: false });
            }
        });
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
        hits.push({
            file: filePath,
            line: siteNode.loc.start.line,
            kind,
            literal,
            suppressed: forceSuppressed || isSuppressed(parents),
        });
    }

    // Visit with parent tracking via manual recursion so we can maintain the scope stack.
    function visit(node, parents) {
        const isFunction = FUNCTION_TYPES.has(node.type) || node.type === 'Program';
        if (isFunction) {
            scopeStack.push(makeScope(node));
        }

        if (!isFunction) {
            const taintStack = scopeStack.map((s) => s.taint);

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
                }
                // Case 2b: /regex/.test(domText)
                if (method === 'test' && isEnglishRegexLiteral(obj) && isNode(arg) && containsDomTextSource(arg, taintStack)) {
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
                        record(node, `.${method}(collection)`, collection.literals.join('|'), [...parents, node], collection.dual);
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
                const attrMatch = selector.match(/\[\s*(?:aria-label|title|placeholder)\s*[\^*$~|]?=\s*["']([^"']+)["']\s*\]/);
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
        console.error(`❌ ${hit.file}:${hit.line} — DOM text matched against English literal (${hit.kind} "${hit.literal}")`);
    }
    console.error(
        `\n${failures.length} new i18n DOM-literal issue(s). Fix with a dual match (translateGameName/getItemName/...)\n` +
            `or, if verified locale-independent, add an allowlist entry with the reason in scripts/check-i18n-dom-literals.js.`
    );
    process.exit(1);
}

console.log(
    `✅ i18n DOM-literal scan passed: ${hits.length} raw hit(s), ${known.length} allowlisted, no unaccounted English-literal DOM matches.`
);
