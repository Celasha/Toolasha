import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';

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

const normalizeModuleId = (id) => (id ? normalize(id.split('?')[0]) : id);

const coreExternalGlobals = new Map([
    [normalize(join(__dirname, 'src/core/storage.js')), 'Toolasha.Core.storage'],
    [normalize(join(__dirname, 'src/core/config.js')), 'Toolasha.Core.config'],
    [normalize(join(__dirname, 'src/core/websocket.js')), 'Toolasha.Core.webSocketHook'],
    [normalize(join(__dirname, 'src/core/dom-observer.js')), 'Toolasha.Core.domObserver'],
    [normalize(join(__dirname, 'src/core/data-manager.js')), 'Toolasha.Core.dataManager'],
    [normalize(join(__dirname, 'src/core/feature-registry.js')), 'Toolasha.Core.featureRegistry'],
    [normalize(join(__dirname, 'src/core/settings-storage.js')), 'Toolasha.Core.settingsStorage'],
    [normalize(join(__dirname, 'src/core/settings-schema.js')), 'Toolasha.Core'],
    [normalize(join(__dirname, 'src/core/profile-manager.js')), 'Toolasha.Core.profileManager'],
    [normalize(join(__dirname, 'src/api/marketplace.js')), 'Toolasha.Core.marketAPI'],
]);

const utilsExternalGlobals = new Map([
    [normalize(join(__dirname, 'src/utils/formatters.js')), 'Toolasha.Utils.formatters'],
    [normalize(join(__dirname, 'src/utils/efficiency.js')), 'Toolasha.Utils.efficiency'],
    [normalize(join(__dirname, 'src/utils/profit-helpers.js')), 'Toolasha.Utils.profitHelpers'],
    [normalize(join(__dirname, 'src/utils/profit-constants.js')), 'Toolasha.Utils.profitConstants'],
    [normalize(join(__dirname, 'src/utils/dom.js')), 'Toolasha.Utils.dom'],
    [normalize(join(__dirname, 'src/utils/dom-observer-helpers.js')), 'Toolasha.Utils.domObserverHelpers'],
    [normalize(join(__dirname, 'src/utils/timer-registry.js')), 'Toolasha.Utils.timerRegistry'],
    [normalize(join(__dirname, 'src/utils/bonus-revenue-calculator.js')), 'Toolasha.Utils.bonusRevenueCalculator'],
    [normalize(join(__dirname, 'src/utils/enhancement-multipliers.js')), 'Toolasha.Utils.enhancementMultipliers'],
    [normalize(join(__dirname, 'src/utils/experience-parser.js')), 'Toolasha.Utils.experienceParser'],
    [normalize(join(__dirname, 'src/utils/market-listings.js')), 'Toolasha.Utils.marketListings'],
    [normalize(join(__dirname, 'src/utils/action-calculator.js')), 'Toolasha.Utils.actionCalculator'],
    [normalize(join(__dirname, 'src/utils/action-panel-helper.js')), 'Toolasha.Utils.actionPanelHelper'],
    [normalize(join(__dirname, 'src/utils/tea-parser.js')), 'Toolasha.Utils.teaParser'],
    [normalize(join(__dirname, 'src/utils/buff-parser.js')), 'Toolasha.Utils.buffParser'],
    [normalize(join(__dirname, 'src/utils/selectors.js')), 'Toolasha.Utils.selectors'],
    [normalize(join(__dirname, 'src/utils/house-efficiency.js')), 'Toolasha.Utils.houseEfficiency'],
    [normalize(join(__dirname, 'src/utils/experience-calculator.js')), 'Toolasha.Utils.experienceCalculator'],
    [normalize(join(__dirname, 'src/utils/market-data.js')), 'Toolasha.Utils.marketData'],
    [normalize(join(__dirname, 'src/utils/ability-cost-calculator.js')), 'Toolasha.Utils.abilityCalc'],
    [normalize(join(__dirname, 'src/utils/equipment-parser.js')), 'Toolasha.Utils.equipmentParser'],
    [normalize(join(__dirname, 'src/utils/ui-components.js')), 'Toolasha.Utils.uiComponents'],
    [normalize(join(__dirname, 'src/utils/enhancement-config.js')), 'Toolasha.Utils.enhancementConfig'],
    [normalize(join(__dirname, 'src/utils/enhancement-gear-detector.js')), 'Toolasha.Utils.enhancementGearDetector'],
    [normalize(join(__dirname, 'src/utils/react-input.js')), 'Toolasha.Utils.reactInput'],
    [normalize(join(__dirname, 'src/utils/material-calculator.js')), 'Toolasha.Utils.materialCalculator'],
    [normalize(join(__dirname, 'src/utils/token-valuation.js')), 'Toolasha.Utils.tokenValuation'],
    [normalize(join(__dirname, 'src/utils/pricing-helper.js')), 'Toolasha.Utils.pricingHelper'],
    [normalize(join(__dirname, 'src/utils/cleanup-registry.js')), 'Toolasha.Utils.cleanupRegistry'],
    [normalize(join(__dirname, 'src/utils/house-cost-calculator.js')), 'Toolasha.Utils.houseCostCalculator'],
    [normalize(join(__dirname, 'src/utils/enhancement-calculator.js')), 'Toolasha.Utils.enhancementCalculator'],
]);

const buildGlobals = (globalsMap) => Object.fromEntries(globalsMap.entries());
const buildExternal = (globalsMap) => (id) => globalsMap.has(normalizeModuleId(id));

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
const buildTarget = process.env.BUILD_TARGET || 'dev';
const devOutputFile = buildTarget === 'dev-standalone' ? 'dist/Toolasha-dev.user.js' : 'dist/Toolasha.user.js';

const browserBuildIntro = 'window.Toolasha = window.Toolasha || {}; window.Toolasha.__buildTarget = "browser";';

// Development build configuration (single bundle for local testing)
const devConfig = {
    input: 'src/dev-entrypoint.js',
    output: {
        file: devOutputFile,
        format: 'iife',
        name: 'Toolasha',
        banner: userscriptHeader,
        intro: browserBuildIntro,
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
        key: 'core',
        input: 'src/libraries/core.js',
        output: {
            file: 'dist/libraries/toolasha-core.js',
            format: 'iife',
            name: 'ToolashaCore',
            banner: libraryHeaderCore,
        },
    },
    {
        key: 'utils',
        input: 'src/libraries/utils.js',
        output: {
            file: 'dist/libraries/toolasha-utils.js',
            format: 'iife',
            name: 'ToolashaUtils',
            banner: libraryHeaderUtils,
        },
    },
    {
        key: 'market',
        input: 'src/libraries/market.js',
        output: {
            file: 'dist/libraries/toolasha-market.js',
            format: 'iife',
            name: 'ToolashaMarket',
            banner: libraryHeaderMarket,
        },
    },
    {
        key: 'actions',
        input: 'src/libraries/actions.js',
        output: {
            file: 'dist/libraries/toolasha-actions.js',
            format: 'iife',
            name: 'ToolashaActions',
            banner: libraryHeaderActions,
        },
    },
    {
        key: 'combat',
        input: 'src/libraries/combat.js',
        output: {
            file: 'dist/libraries/toolasha-combat.js',
            format: 'iife',
            name: 'ToolashaCombat',
            banner: libraryHeaderCombat,
        },
    },
    {
        key: 'ui',
        input: 'src/libraries/ui.js',
        output: {
            file: 'dist/libraries/toolasha-ui.js',
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
        intro: browserBuildIntro,
    },
    // Entrypoint doesn't need any plugins - it just uses window.Toolasha
    plugins: [],
};

const sharedCoreGlobals = buildGlobals(coreExternalGlobals);
const sharedFeatureGlobals = buildGlobals(new Map([...coreExternalGlobals, ...utilsExternalGlobals]));

const prodConfig = [
    ...prodLibraries.map((lib) => {
        const { key, ...libraryConfig } = lib;
        let external = null;
        let globals = null;

        if (key === 'utils') {
            external = buildExternal(coreExternalGlobals);
            globals = sharedCoreGlobals;
        } else if (key !== 'core') {
            external = buildExternal(new Map([...coreExternalGlobals, ...utilsExternalGlobals]));
            globals = sharedFeatureGlobals;
        }

        return {
            ...libraryConfig,
            external: external || undefined,
            output: {
                ...libraryConfig.output,
                ...(globals ? { globals } : {}),
                intro: browserBuildIntro,
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
    }),
    prodEntrypoint,
];

export default isProduction ? prodConfig : devConfig;
