/**
 * i18n coverage gate.
 *
 * Scans src/**\/*.js (excluding tests and the locale files themselves) for user-facing string
 * sinks — .textContent/.innerHTML/.innerText assignments, translatable setAttribute() calls,
 * alert()/confirm() — and flags any hardcoded English text in them that isn't routed through
 * t(). Also cross-checks every key actually used via t() against src/locales/zh.js so a key
 * added to en.js/used in code but never translated fails the build instead of silently
 * falling back to English forever.
 *
 * Modeled on check-loadout-state-integrity.js's plain text-scan + failures-array convention.
 * Chained into `npm run build` so new hardcoded strings can't land without a t() wrapper.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = 'src';
const EXCLUDED_DIR_NAMES = new Set(['locales', 'node_modules']);
const HAS_ENGLISH_WORD = /[A-Za-z]{3,}/;

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

function lineNumberAt(text, index) {
    return text.slice(0, index).split('\n').length;
}

/**
 * Blank out /* ... *\/ block comments (JSDoc examples referencing t('key') would otherwise
 * false-positive as real usage) while preserving newlines, so reported line numbers stay correct.
 */
function stripBlockComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Strip ${...} interpolations so only the static (hardcoded) parts of a template literal remain.
 * Brace-depth aware so a nested template literal inside an interpolation (e.g. a ternary that
 * returns its own `${...}`) doesn't prematurely close on the nested placeholder's brace, which
 * would otherwise leak raw JS expression text into the reported candidate.
 */
function stripInterpolation(literal) {
    let result = '';
    let i = 0;
    while (i < literal.length) {
        if (literal[i] === '$' && literal[i + 1] === '{') {
            let depth = 1;
            i += 2;
            while (i < literal.length && depth > 0) {
                if (literal[i] === '{') depth++;
                else if (literal[i] === '}') depth--;
                i++;
            }
        } else {
            result += literal[i];
            i++;
        }
    }
    return result;
}

// A candidate whose only brace-delimited content looks like `selector { property: value; }` is
// CSS injected into a <style> element's textContent, not player-facing prose — e.g.
// `styleEl.textContent = \`[class*="Foo"] { display: none !important; }\`;`.
const LOOKS_LIKE_CSS_RULE = /\{[^{}]*:[^{}]*\}/;

// A candidate that's nothing but a bare HTML character entity (&times;, &nbsp;, ...) is markup,
// not translatable text.
const IS_BARE_HTML_ENTITY = /^&[a-zA-Z]+;$/;

const TRANSLATABLE_ATTRS = /(?:title|aria-label|placeholder|alt)\s*=\s*["']([^"']+)["']/g;

/**
 * For an innerHTML template/string literal, return only the parts a player would actually read:
 * text between tags, and translatable attribute values. Tag names, ids, classes, and CSS are
 * deliberately excluded so ordinary markup doesn't drown out real findings.
 */
function extractHtmlTextSnippets(literalBody) {
    const snippets = [];
    for (const m of literalBody.matchAll(/>([^<>]+)</g)) snippets.push(m[1]);
    for (const m of literalBody.matchAll(TRANSLATABLE_ATTRS)) snippets.push(m[1]);
    return snippets;
}

const STRING_LITERAL = /`[\s\S]*?`|'[^'\n]*'|"[^"\n]*"/;

const SINK_PATTERNS = [
    { name: 'textContent', regex: new RegExp(`\\.textContent\\s*=\\s*(${STRING_LITERAL.source})`, 'g'), html: false },
    { name: 'innerText', regex: new RegExp(`\\.innerText\\s*=\\s*(${STRING_LITERAL.source})`, 'g'), html: false },
    { name: 'innerHTML', regex: new RegExp(`\\.innerHTML\\s*=\\s*(${STRING_LITERAL.source})`, 'g'), html: true },
    { name: 'alert', regex: new RegExp(`\\balert\\(\\s*(${STRING_LITERAL.source})`, 'g'), html: false },
    { name: 'confirm', regex: new RegExp(`\\bconfirm\\(\\s*(${STRING_LITERAL.source})`, 'g'), html: false },
    {
        name: 'setAttribute',
        regex: new RegExp(
            `\\.setAttribute\\(\\s*['"](?:title|aria-label|placeholder|alt)['"]\\s*,\\s*(${STRING_LITERAL.source})`,
            'g'
        ),
        html: false,
    },
];

const KEY_USAGE_REGEX = /\bt\(\s*['"]([^'"]+)['"]/g;

const failures = [];
const usedKeys = new Map(); // key -> first file:line seen at, for a useful error message

for (const filePath of collectSourceFiles(SRC_DIR)) {
    const text = stripBlockComments(readFileSync(filePath, 'utf8'));
    const relPath = relative(process.cwd(), filePath);

    for (const { name, regex, html } of SINK_PATTERNS) {
        for (const match of text.matchAll(regex)) {
            const rawLiteral = match[1];
            const body = stripInterpolation(rawLiteral.slice(1, -1));
            const candidates = html ? extractHtmlTextSnippets(body) : [body];

            for (const candidate of candidates) {
                const trimmed = candidate.trim();
                if (!HAS_ENGLISH_WORD.test(candidate)) continue;
                if (LOOKS_LIKE_CSS_RULE.test(rawLiteral)) continue;
                if (IS_BARE_HTML_ENTITY.test(trimmed)) continue;
                const line = lineNumberAt(text, match.index);
                failures.push(
                    `${relPath}:${line} — hardcoded string in ${name} not wrapped in t(): ${candidate.trim().slice(0, 80)}`
                );
            }
        }
    }

    for (const match of text.matchAll(KEY_USAGE_REGEX)) {
        if (!usedKeys.has(match[1])) {
            usedKeys.set(match[1], `${relPath}:${lineNumberAt(text, match.index)}`);
        }
    }
}

function hasKey(table, dottedKey) {
    return (
        dottedKey
            .split('.')
            .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), table) !== undefined
    );
}

const { default: zh } = await import('../src/locales/zh.js');

for (const [key, location] of usedKeys) {
    if (!hasKey(zh, key)) {
        failures.push(`Translation key "${key}" (used at ${location}) is missing from src/locales/zh.js`);
    }
}

if (failures.length > 0) {
    for (const failure of failures) console.error(`❌ ${failure}`);
    console.error(`\n${failures.length} i18n issue(s) found.`);
    process.exit(1);
}

console.log('✅ i18n coverage verified: no hardcoded UI strings outside t(), all used keys translated.');
