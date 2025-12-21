# MWI Tools - Refactoring Project

Modular, maintainable rewrite of MWITools userscript for Milky Way Idle.

## 🚀 Quick Start

### Build the userscript
```bash
npm run build
```

This creates `dist/MWITools-refactor.user.js` which you can install in Tampermonkey.

### Watch mode (auto-rebuild on changes)
```bash
npm run watch
```

### Run tests
```bash
# Test formatters
node tests/formatters.test.js

# Test storage
node tests/storage.test.js
```

## 📁 Project Structure

```
MWI Tools/
├── src/
│   ├── main.js                    # Entry point
│   ├── core/                      # Core systems
│   │   └── storage.js            ✅ EXTRACTED
│   ├── api/                       # External API integrations
│   ├── features/                  # Feature modules
│   │   ├── actions/              # Action panel enhancements
│   │   ├── combat/               # Combat statistics & DPS
│   │   ├── enhancement/          # Enhancement optimizer
│   │   ├── integration/          # Combat sim & calculator integrations
│   │   ├── market/               # Market system
│   │   ├── networth/             # Networth & build scores
│   │   └── tooltips/             # Tooltip enhancements
│   ├── ui/                        # UI components
│   └── utils/                     # Utility functions
│       └── formatters.js         ✅ EXTRACTED
├── tests/                         # Test files
│   ├── formatters.test.js        ✅ CREATED
│   └── storage.test.js           ✅ CREATED
├── dist/                          # Built userscript (gitignored)
├── MWITools-25.0.user.js         # Original monolith (reference)
├── package.json                   # NPM configuration
└── rollup.config.js              # Build configuration
```

## ✅ Completed Modules

### Core
- **storage.js** - GM_getValue/GM_setValue wrapper with clean API
  - `storage.get(key, defaultValue)` - Get value from storage
  - `storage.set(key, value)` - Set value in storage
  - `storage.getJSON(key, defaultValue)` - Get JSON object
  - `storage.setJSON(key, value)` - Set JSON object
  - `storage.has(key)` - Check if key exists
  - `storage.delete(key)` - Delete key
  - Designed for easy IndexedDB migration later

### Utils
- **formatters.js** - Number and time formatting utilities
  - `numberFormatter(num, digits)` - Format with K/M/B suffixes
  - `timeReadable(sec)` - Convert seconds to readable format
  - `formatWithSeparator(num)` - Add thousand separators

## 📋 Next Steps

### Phase C: Core Infrastructure (In Progress)
- [x] `storage.js` - Storage wrapper ✅
- [x] `config.js` - Settings and constants ✅
- [ ] `data-manager.js` - Game data management
- [ ] `websocket.js` - WebSocket message hooking

**⚠️ CRITICAL for Data Manager:** Use `localStorageUtil.getInitClientData()` to access game data. This is the official API exposed by the game - do NOT manually access localStorage or decompress LZ-string!

### Phase 2: More Utilities
- [ ] `dom.js` - DOM manipulation helpers
- [ ] `efficiency.js` - Buff and efficiency calculators

### Phase 3: Feature Modules
- [ ] Market system
- [ ] Networth calculation
- [ ] Action panel enhancements
- [ ] Tooltip system
- [ ] Enhancement optimizer
- [ ] Combat statistics
- [ ] And more...

## 🧪 Testing

Each module has a corresponding test file in `tests/`. Run tests with:

```bash
node tests/MODULE_NAME.test.js
```

**Note**: Storage tests use mocks since `GM_getValue/GM_setValue` are only available in the userscript environment.

## 📚 Documentation

- **PROJECT_DOCS.md** - Complete project overview and refactoring plan
- **TABLE_OF_CONTENTS.md** - Detailed function index of original code
- **EXCLUDED_FEATURES.md** - Features intentionally excluded (Chinese language support)

## 🔧 Development Workflow

1. **Identify module to extract** (see PROJECT_DOCS.md)
2. **Create module file** in appropriate `src/` subdirectory
3. **Write tests** in `tests/`
4. **Import in main.js** and test
5. **Build**: `npm run build`
6. **Test in browser** with Tampermonkey
7. **Commit** once verified working

## 🎯 Design Principles

- **Modularity**: Small, focused modules with clear responsibilities
- **Testability**: Pure functions where possible, dependency injection
- **Backwards Compatibility**: Use same GM storage keys as original
- **Future-Proof**: Design for IndexedDB migration, async support
- **Clean API**: Simple, intuitive interfaces

## 📝 Notes

- Original file: 6,706 lines, 466KB
- Build output: Significantly smaller and more maintainable
- All external dependencies loaded via `@require` in userscript header
- ES6 modules bundled into single IIFE for userscript compatibility
- Chinese language support removed (see EXCLUDED_FEATURES.md)

## 🎯 Goals

- ✅ Modular architecture
- ✅ Better code organization
- ✅ Easier testing
- ✅ Improved maintainability
- ⏳ Performance optimization opportunities

---

**Version:** 25.1-refactor
**Original Author:** bot7420
**Updated By:** Celasha and Claude
**License:** CC-BY-NC-SA-4.0
