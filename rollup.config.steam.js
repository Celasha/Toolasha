import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the userscript header and strip @require directives
const userscriptHeaderRaw = readFileSync(join(__dirname, 'userscript-header.txt'), 'utf-8');

// Strip all @require lines (external CDN dependencies)
// Keep @grant directives and other metadata
const userscriptHeader = userscriptHeaderRaw
    .split('\n')
    .filter((line) => !line.includes('@require'))
    .join('\n');

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

// Custom plugin to inject vendor libraries after header
function injectVendorLibraries(headerContent) {
    return {
        name: 'inject-vendor-libraries',
        renderChunk(code, chunk, options) {
            // Read vendor libraries from node_modules
            const mathjs = readFileSync(join(__dirname, 'node_modules/mathjs/lib/browser/math.js'), 'utf-8');
            const chartjs = readFileSync(join(__dirname, 'node_modules/chart.js/dist/chart.js'), 'utf-8');
            const datalabels = readFileSync(
                join(__dirname, 'node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.js'),
                'utf-8'
            );

            // Strip IIFE wrappers from libraries to bundle them cleanly
            // Match common IIFE patterns: (function(){...})(), (function(){...}).call(this), etc.
            const stripIIFE = (libCode) => {
                // Remove opening IIFE wrapper
                let stripped = libCode.replace(/^\s*\(function\s*\([^)]*\)\s*\{/, '');
                // Remove closing IIFE wrapper
                stripped = stripped.replace(/\}\s*\)\s*\([^)]*\)\s*;?\s*$/, '');
                stripped = stripped.replace(/\}\s*\)\s*\.call\s*\([^)]*\)\s*;?\s*$/, '');
                return stripped;
            };

            const mathjsUnwrapped = stripIIFE(mathjs);
            const chartjsUnwrapped = stripIIFE(chartjs);
            const datalabelsUnwrapped = stripIIFE(datalabels);

            // Build complete file: header + vendor libs + Toolasha code
            return `${headerContent}

// ===== VENDORED LIBRARIES (mathjs, chart.js, chartjs-plugin-datalabels) =====
${mathjsUnwrapped}

${chartjsUnwrapped}

${datalabelsUnwrapped}

// ===== TOOLASHA CODE =====
${code}
`;
        },
    };
}

// Steam build configuration (single bundle with all dependencies)
const steamConfig = {
    input: 'src/dev-entrypoint.js',
    output: {
        file: 'dist/Toolasha.steam.js',
        format: 'iife',
        name: 'Toolasha',
        // No banner - we inject it via plugin for proper ordering
    },
    plugins: [
        cssRawPlugin(),
        resolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs(),
        injectVendorLibraries(userscriptHeader),
    ],
};

export default steamConfig;
