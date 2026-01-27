import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
    {
        // Global ignores
        ignores: ['dist/**', 'node_modules/**', '*.min.js', 'Archive/**'],
    },
    {
        // Main config for source files
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,

                // Tampermonkey globals
                GM_addStyle: 'readonly',
                GM: 'readonly',
                GM_xmlhttpRequest: 'readonly',
                GM_notification: 'readonly',
                GM_getValue: 'readonly',
                GM_setValue: 'readonly',
                unsafeWindow: 'readonly',

                // External libraries loaded via @require
                math: 'readonly',
                Chart: 'readonly',
                ChartDataLabels: 'readonly',
                LZString: 'readonly',

                // Game globals (available at runtime on game page)
                localStorageUtil: 'readonly',
            },
        },
        rules: {
            // Possible errors - catch common mistakes
            'no-undef': 'error',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': 'off', // Console logging is intentional in this project
            'no-debugger': 'warn',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-extra-boolean-cast': 'warn',
            'no-func-assign': 'error',
            'no-irregular-whitespace': 'error',
            'no-unreachable': 'error',
            'valid-typeof': 'error',

            // Best practices - prevent bugs
            eqeqeq: ['warn', 'smart'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-extend-native': 'error',
            'no-extra-bind': 'warn',
            'no-fallthrough': 'warn',
            'no-global-assign': 'error',
            'no-loop-func': 'warn',
            'no-new-wrappers': 'error',
            'no-octal': 'error',
            'no-redeclare': 'error',
            'no-self-assign': 'error',
            'no-self-compare': 'error',
            'no-sequences': 'error',
            'no-throw-literal': 'warn',
            'no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
            'no-useless-concat': 'warn',
            'no-useless-escape': 'warn',
            'no-useless-return': 'warn',
            'prefer-promise-reject-errors': 'warn',

            // ES6+ features
            'no-var': 'error',
            'prefer-const': 'warn',
            'prefer-arrow-callback': ['warn', { allowNamedFunctions: true }],
            'prefer-template': 'off', // String concat is fine
            'no-duplicate-imports': 'error',

            // Style (mostly handled by Prettier, but a few semantic ones)
            'no-lonely-if': 'warn',
            'no-unneeded-ternary': 'warn',
            'prefer-object-spread': 'warn',
        },
    },
    {
        // Config files (rollup.config.js, eslint.config.js, etc.)
        files: ['*.config.js', '*.config.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-undef': 'error',
        },
    },
    // Disable formatting rules that conflict with Prettier
    prettier,
];
