import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Userscript header for standalone enhancement library
const standaloneHeader = `// ==UserScript==
// @name         Toolasha Enhancement Calculator (Standalone)
// @namespace    https://github.com/Celasha/Toolasha
// @version      1.0.0
// @description  Pure math library for MWI enhancement calculations. No game data dependencies.
// @author       Celasha
// @license      MIT
// @match        *://*/*
// @grant        none
// ==/UserScript==
`;

// Custom plugin to inject mathjs after header
function injectMathJS(headerContent) {
    return {
        name: 'inject-mathjs',
        renderChunk(code) {
            // Read mathjs from node_modules
            const mathjs = readFileSync(join(__dirname, 'node_modules/mathjs/lib/browser/math.js'), 'utf-8');

            // Strip IIFE wrapper from mathjs
            const stripIIFE = (libCode) => {
                let stripped = libCode.replace(/^\s*\(function\s*\([^)]*\)\s*\{/, '');
                stripped = stripped.replace(/\}\s*\)\s*\([^)]*\)\s*;?\s*$/, '');
                stripped = stripped.replace(/\}\s*\)\s*\.call\s*\([^)]*\)\s*;?\s*$/, '');
                return stripped;
            };

            const mathjsUnwrapped = stripIIFE(mathjs);

            // Build complete file: header + mathjs + our code
            return `${headerContent}

// ===== MATHJS LIBRARY (vendored) =====
${mathjsUnwrapped}

// ===== TOOLASHA ENHANCEMENT CALCULATOR =====
${code}
`;
        },
    };
}

export default {
    input: 'src/libraries/enhancement-standalone.js',
    output: {
        file: 'dist/libraries/toolasha-enhancement-standalone.js',
        format: 'iife',
        name: 'ToolashaEnhancementBundle',
    },
    plugins: [
        resolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs(),
        injectMathJS(standaloneHeader),
    ],
};
