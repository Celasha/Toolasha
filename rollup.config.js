import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the userscript headers
const userscriptHeader = readFileSync(join(__dirname, 'userscript-header.txt'), 'utf-8');
const libraryHeaderCore = readFileSync(join(__dirname, 'library-headers/core.txt'), 'utf-8');
const libraryHeaderUtils = readFileSync(join(__dirname, 'library-headers/utils.txt'), 'utf-8');
const libraryHeaderMarket = readFileSync(join(__dirname, 'library-headers/market.txt'), 'utf-8');
const libraryHeaderActions = readFileSync(join(__dirname, 'library-headers/actions.txt'), 'utf-8');
const libraryHeaderCombat = readFileSync(join(__dirname, 'library-headers/combat.txt'), 'utf-8');
const libraryHeaderUI = readFileSync(join(__dirname, 'library-headers/ui.txt'), 'utf-8');
const entrypointHeader = readFileSync(join(__dirname, 'library-headers/entrypoint.txt'), 'utf-8');

// Custom plugin to import CSS as raw strings
function cssRawPlugin() {
    const suffix = '?raw';
    return {
        name: 'css-raw',
        resolveId(source, importer) {
            if (source.endsWith(suffix)) {
                // Resolve relative to importer
                if (importer) {
                    const basePath = dirname(importer);
                    const cssPath = join(basePath, source.replace(suffix, ''));
                    return cssPath + suffix; // Keep marker for load phase
                }
            }
            return null;
        },
        load(id) {
            if (id.endsWith(suffix)) {
                const cssPath = id.replace(suffix, '');
                const css = readFileSync(cssPath, 'utf-8');
                return `export default ${JSON.stringify(css)};`;
            }
            return null;
        },
    };
}

// Check if we should build for production (multi-bundle)
const isProduction = process.env.BUILD_MODE === 'production';

// Development build configuration (single bundle like before)
const devConfig = {
    input: 'src/main.js',
    output: {
        file: 'dist/Toolasha.user.js',
        format: 'iife',
        name: 'Toolasha',
        banner: userscriptHeader,
    },
    plugins: [
        cssRawPlugin(),
        resolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs(),
    ],
};

// Production build configuration (multi-bundle for Greasyfork)
const prodLibraries = [
    {
        input: 'src/libraries/core.js',
        output: {
            file: 'dist/libraries/toolasha-core.user.js',
            format: 'iife',
            name: 'ToolashaCore',
            banner: libraryHeaderCore,
        },
    },
    {
        input: 'src/libraries/utils.js',
        output: {
            file: 'dist/libraries/toolasha-utils.user.js',
            format: 'iife',
            name: 'ToolashaUtils',
            banner: libraryHeaderUtils,
        },
    },
    {
        input: 'src/libraries/market.js',
        output: {
            file: 'dist/libraries/toolasha-market.user.js',
            format: 'iife',
            name: 'ToolashaMarket',
            banner: libraryHeaderMarket,
        },
    },
    {
        input: 'src/libraries/actions.js',
        output: {
            file: 'dist/libraries/toolasha-actions.user.js',
            format: 'iife',
            name: 'ToolashaActions',
            banner: libraryHeaderActions,
        },
    },
    {
        input: 'src/libraries/combat.js',
        output: {
            file: 'dist/libraries/toolasha-combat.user.js',
            format: 'iife',
            name: 'ToolashaCombat',
            banner: libraryHeaderCombat,
        },
    },
    {
        input: 'src/libraries/ui.js',
        output: {
            file: 'dist/libraries/toolasha-ui.user.js',
            format: 'iife',
            name: 'ToolashaUI',
            banner: libraryHeaderUI,
        },
    },
];

const prodEntrypoint = {
    input: 'src/entrypoint.js',
    output: {
        file: 'dist/Toolasha.user.js',
        format: 'iife',
        name: 'ToolashaEntrypoint',
        banner: entrypointHeader,
    },
    // Entrypoint doesn't need any plugins - it just uses window.Toolasha
    plugins: [],
};

const prodConfig = [
    ...prodLibraries.map((lib) => ({
        ...lib,
        plugins: [
            cssRawPlugin(),
            resolve({
                browser: true,
                preferBuiltins: false,
            }),
            commonjs(),
        ],
    })),
    prodEntrypoint,
];

export default isProduction ? prodConfig : devConfig;
