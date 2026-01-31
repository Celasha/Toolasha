# Toolasha

![Version](https://img.shields.io/badge/version-0.8.1-orange?style=flat-square) ![Status](https://img.shields.io/badge/status-pre--release-yellow?style=flat-square) ![License](https://img.shields.io/badge/license-CC--BY--NC--SA--4.0-blue?style=flat-square)

A modular, maintainable Tampermonkey userscript that enhances [Milky Way Idle](https://www.milkywayidle.com/game) with quality-of-life features, market tools, combat statistics, and comprehensive game data overlays.

**📚 [Documentation](DOCUMENTATION.md)** | **✨ [Features](FEATURES.md)** | **📝 [Changelog](MWI-TOOLS-CHANGELOG.md)** | **🤝 [Contributing](CONTRIBUTING.md)**

---

## About

Toolasha is a complete rewrite of the popular MWITools userscript, rebuilt from the ground up with modern JavaScript architecture. It provides dozens of enhancements for Milky Way Idle, including:

- **Market Intelligence** - Real-time pricing, profit calculations, and inventory management
- **Combat Tools** - DPS tracking, dungeon statistics, and gear score calculations
- **Enhancement Optimizer** - Success rate tracking and cost simulation
- **Action Planning** - Queue time displays, profit calculations, and output predictions
- **Economy Tracking** - Net worth calculations and asset valuation

All features are modular and can be individually enabled/disabled through an in-game settings panel.

## Features

### 🏪 Market & Economy

- **Market Prices** - 24-hour average prices on item tooltips
- **Profit Calculations** - Crafting costs and profit margins
- **Net Worth Display** - Real-time asset valuation
- **Inventory Sorting** - Sort by value, type, or custom criteria

### ⚔️ Combat & Dungeons

- **Combat Score** - Gear score calculation
- **Dungeon Tracker** - Run times, wave progress, and team stats
- **Ability Calculator** - Books needed for target levels

### 🔨 Enhancement & Crafting

- **Enhancement Tracker** - Success rates and cost tracking
- **Enhancement Simulator** - Optimal strategy calculator
- **Production Profit** - Material costs and profit breakdown
- **Max Produceable** - Shows craftable quantity with current materials

### 📋 Tasks & Actions

- **Action Queue Time** - Total completion time display
- **Task Profit Display** - Reward value calculations
- **Quick Input Buttons** - Preset buttons for 1/10/100/Max

### 🎨 UI Enhancements

- **Skill XP Percentage** - Progress to next level
- **Equipment Level Display** - Enhancement level on icons
- **Comprehensive Settings** - Organized feature configuration
- **Color Customization** - Extensive UI color options

**[View complete feature list →](FEATURES.md)**

## Installation

### Prerequisites

- **Browser**: Chrome, Firefox, or Edge
- **Tampermonkey**: [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) | [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) | [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### Install from Greasy Fork (Recommended)

1. Visit [Toolasha on Greasy Fork](https://greasyfork.org/en/scripts/562662-toolasha)
2. Click **Install this script**
3. Tampermonkey will prompt you to confirm installation
4. Visit [Milky Way Idle](https://www.milkywayidle.com/game) - Toolasha loads automatically

### Install from GitHub Release

1. **Download the latest release**
    - Visit the [Releases page](../../releases)
    - Download `Toolasha.user.js` from the latest release

2. **Install in Tampermonkey**
    - Click the downloaded file, or
    - Open Tampermonkey dashboard → Utilities → Import from file

3. **Visit the game**
    - Go to [Milky Way Idle](https://www.milkywayidle.com/game)
    - Toolasha should load automatically

### Install from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/Toolasha.git
cd Toolasha

# Install dependencies
npm install

# Build the userscript
npm run build

# Install dist/Toolasha.user.js in Tampermonkey
```

## Usage

### Accessing Settings

1. Open the game at [milkywayidle.com/game](https://www.milkywayidle.com/game)
2. Click your **character icon** (top-right of screen)
3. Click **Settings**
4. Click the **Toolasha** tab in the settings menu
5. Enable/disable features as desired
6. Settings are saved automatically

### Feature Configuration

Most features work automatically once enabled. Some features have additional configuration:

- **Pricing Mode** - Choose Conservative/Hybrid/Optimistic for profit calculations
- **Enhancement Simulator** - Configure skill levels and buffs
- **Color Customization** - Customize UI element colors (9 color options)

### Troubleshooting

If features aren't working:

1. **Refresh the page** - Some features require a page reload
2. **Check browser console** - Look for error messages (F12 → Console)
3. **Verify Tampermonkey is enabled** - Check the extension icon
4. **Report issues** - [Open an issue](../../issues) with details

For detailed troubleshooting, see [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## For Developers

Toolasha is built with modern JavaScript (ES6+) using a modular, feature-based architecture. Contributions are welcome!

### Quick Start

```bash
npm install          # Install dependencies
npm run build        # Build userscript
npm run dev          # Watch mode (auto-rebuild)
npm test             # Run test suite (143 tests)
```

### Documentation

- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guide and development workflow
- **[AGENTS.md](AGENTS.md)** - Developer guide for AI coding agents
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture and design patterns
- **[DOCUMENTATION.md](DOCUMENTATION.md)** - Complete documentation index

### Key Technologies

- **Build**: Rollup with ES6 modules
- **Testing**: Vitest with 143 tests
- **Storage**: IndexedDB with debounced writes
- **Code Quality**: ESLint + Prettier with pre-commit hooks
- **CI/CD**: GitHub Actions with automated releases

## Project Structure

```
Toolasha/
├── src/
│   ├── main.js                    # Entry point
│   ├── core/                      # Core systems
│   │   ├── storage.js            # IndexedDB wrapper
│   │   ├── config.js             # Settings management
│   │   ├── feature-registry.js   # Feature initialization
│   │   ├── websocket.js          # WebSocket hooking
│   │   ├── data-manager.js       # Game data access
│   │   └── dom-observer.js       # Centralized DOM observer
│   ├── api/                       # External API integrations
│   ├── features/                  # Feature modules
│   │   ├── actions/              # Action panel enhancements
│   │   ├── combat/               # Combat statistics & DPS
│   │   ├── enhancement/          # Enhancement optimizer
│   │   ├── market/               # Market system
│   │   ├── networth/             # Networth calculations
│   │   └── settings/             # Settings UI
│   ├── ui/                        # UI components
│   └── utils/                     # Utility functions
├── tests/                         # Test files (143 tests)
├── dist/                          # Built userscript (gitignored)
└── docs/                          # Documentation
```

For detailed architecture documentation, see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

Toolasha has comprehensive test coverage using **Vitest**:

- **143 tests** across 3 test suites
- **100% coverage** of utility modules
- Automated testing in CI/CD pipeline
- Pre-commit hooks ensure tests pass

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm test -- --coverage # Coverage report
```

**Test Coverage:**

- `formatters.js` - 65 tests, 100% coverage
- `efficiency.js` - 49 tests, 100% coverage
- `enhancement-multipliers.js` - 29 tests, 100% coverage

## Design Principles

- **Modularity** - Small, focused modules with clear responsibilities
- **Testability** - Pure functions where possible, comprehensive test coverage
- **Performance** - IndexedDB with debounced writes, centralized MutationObserver
- **Async-First** - Proper async/await patterns throughout
- **Maintainability** - Clean code, clear documentation, consistent patterns

## License & Credits

**License**: [CC-BY-NC-SA-4.0](LICENSE)

**Original Author**: bot7420 (MWITools)  
**Rewrite & Maintenance**: Celasha and Claude

**Version**: 0.6.2 (Pre-release)

---

**Note**: This is a pre-release version (0.x.x). Version 1.0.0 will be released after comprehensive production testing. See [MWI-TOOLS-CHANGELOG.md](MWI-TOOLS-CHANGELOG.md) for version history.
