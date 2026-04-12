# Toolasha

![Version](https://img.shields.io/badge/version-2.7.2-orange?style=flat-square) ![Status](https://img.shields.io/badge/status-pre--release-yellow?style=flat-square) ![License](https://img.shields.io/badge/license-CC--BY--NC--SA--4.0-blue?style=flat-square)

A modular userscript that enhances [Milky Way Idle](https://www.milkywayidle.com/game) with quality-of-life features, market tools, combat statistics, alchemy tracking, and comprehensive game data overlays.

**📚 [Documentation](DOCUMENTATION.md)** | **📝 [Changelog](CHANGELOG.md)** | **🤝 [Contributing](CONTRIBUTING.md)**

---

## About

Toolasha is a complete rewrite of the popular MWITools userscript, rebuilt from the ground up with modern JavaScript architecture. All features are modular and can be individually enabled or disabled through an in-game settings panel.

## Features

### 🏪 Market & Economy

- **Market Prices** — 24-hour average prices on item tooltips
- **Profit Calculations** — Crafting costs and profit margins with Conservative/Hybrid/Optimistic pricing modes
- **Net Worth Display** — Real-time asset valuation
- **Inventory Sorting** — Sort inventory by value, type, or custom criteria
- **Listing Age** — Estimated age of market listings
- **Queue Length Estimates** — Estimated wait time for market orders
- **Trade History** — View recent trade activity
- **Auto-Fill Pricing** — Automatically fill bid/ask prices based on market data
- **Order Totals** — Display total value of open orders
- **Philo Gamba Calculator** — Calculates expected profit from philosopher's stone gambling

### ⚔️ Combat & Dungeons

- **Combat Score** — Gear score calculation displayed on equipment
- **Combat Stats** — Detailed statistics tab in the Combat panel
- **Combat Summary** — Full breakdown of stats on returning from combat
- **Dungeon Tracker** — Run times, wave progress, and team statistics
- **Labyrinth Tracker** — Tracks best defeated enemy level per monster type
- **Ability Triggers** — Displays ability trigger conditions
- **Loadout Display** — Enhancement levels shown on loadout equipment
- **Combat Sim Integration** — Import character data directly into the Shykai combat simulator

### ⚗️ Alchemy

- **Alchemy Profit Display** — Profit calculator for transmute and coinify actions
- **Transmute History** — Records and displays transmute session history
- **Coinify History** — Records and displays coinify session history with catalyst tracking

### 🔨 Enhancement & Crafting

- **Enhancement Tracker** — Success rates and cost tracking per session
- **Enhancement Simulator** — Optimal strategy calculator with cost projections
- **Enhancement Milestones** — Expected cost and XP to reach key enhancement levels
- **Production Profit** — Material costs and profit breakdown for crafting
- **Max Produceable** — Shows craftable quantity with current materials

### 📋 Tasks & Actions

- **Action Queue Time** — Total completion time for queued actions
- **Task Profit Display** — Reward value calculations per task
- **Task Efficiency Rating** — Ranks tasks by tokens or gold per hour
- **Task Reroll Tracker** — Tracks cumulative reroll costs
- **Task Sorter** — Auto-sorts tasks by skill or time
- **Task Icons** — Visual icons on task cards including dungeon indicators
- **Task Inventory Highlighter** — Dims inventory items not needed for current tasks
- **Task Statistics** — Summary statistics for completed tasks
- **Quick Input Buttons** — Preset buttons for 1 / 10 / 100 / Max quantities
- **Ability Book Calculator** — Books needed to reach a target ability level

### 📊 Skills & XP

- **XP Rate Display** — Shows XP/hr rate on skill bars
- **Time to Next Level** — Estimated time to level up in skill tooltip
- **Remaining XP** — Remaining XP to next level displayed on skill bars
- **XP Percentage** — Progress percentage to next level

### 💬 Chat

- **Pop-Out Chat** — Detachable chat window with multi-channel split view
- **Mention Tracker** — Badge indicator when your name is mentioned
- **Chat Commands** — `/item`, `/wiki`, `/market` quick-navigation commands
- **Block List** — Filters messages from blocked players in pop-out chat

### 🏠 House

- **Upgrade Costs** — Shows room upgrade costs with current market prices

### 🧭 Navigation

- **Alt+Click Navigation** — Alt+click items to navigate to their crafting action, gathering zone, or market page
- **Collection Navigation** — Navigation buttons on collection panel items
- **Dictionary** — Item dictionary with quick lookup

### 🔔 Notifications

- **Empty Queue Alert** — Browser notification when your action queue runs out

### 🎨 UI Enhancements

- **Equipment Level Display** — Enhancement level shown on item icons
- **Inventory Badges** — Price and count badges on inventory items
- **Alchemy Item Dimming** — Dims alchemy items below your skill level
- **Key Info on Icons** — Contextual info overlaid on item icons
- **External Tool Links** — Quick links to external tools from relevant panels
- **Color Customization** — 14 configurable UI color options

## Installation

### Prerequisites

- **Browser**: Chrome, Firefox, or Edge with [Tampermonkey](https://www.tampermonkey.net/)
- **Steam**: No additional extensions required — Steam has a built-in extension manager

### Install from Greasy Fork (Recommended)

1. Visit [Toolasha on Greasy Fork](https://greasyfork.org/en/scripts/562662-toolasha)
2. Click **Install this script**
3. Tampermonkey will prompt you to confirm installation
4. Visit [Milky Way Idle](https://www.milkywayidle.com/game) — Toolasha loads automatically

### Install from GitHub Release

1. **Download the latest release**
    - Visit the [Releases page](../../releases)
    - Download `Toolasha.user.js` from the latest release

2. **Install in Tampermonkey**
    - Click the downloaded file, or
    - Open Tampermonkey dashboard → Utilities → Import from file

3. **Visit the game**
    - Go to [Milky Way Idle](https://www.milkywayidle.com/game)
    - Toolasha loads automatically

> The entrypoint loads required libraries automatically from GitHub raw URLs.

### Install on Steam

Steam's embedded browser has its own built-in extension manager. Use the Steam-specific single-file build instead of the standard version.

1. **Download the Steam build**
    - Visit the [Releases page](../../releases)
    - Download `Toolasha.steam.user.js` from the latest release

2. **Open the extension manager**
    - Launch Milky Way Idle on Steam
    - In the top-left menu, click **Game**
    - Select **Manage Extensions**
    - A panel will open on the side of the game window

3. **Install the script**
    - Paste the contents of `Toolasha.steam.user.js` into the editor
    - Click **Save**
    - The game will reload automatically

> **Note**: If Toolasha doesn't appear after saving, close and reopen the game in Steam to ensure the script is fully loaded.

### Install from Source

```bash
git clone https://github.com/Celasha/Toolasha.git
cd Toolasha
npm install
npm run build:dev
# Install dist/Toolasha-dev.user.js in Tampermonkey
```

## Usage

### Accessing Settings

1. Open the game at [milkywayidle.com/game](https://www.milkywayidle.com/game)
2. Click your **character icon** (top-right of screen)
3. Click **Settings**
4. Click the **Toolasha** tab in the settings menu
5. Enable/disable features as desired — settings are saved automatically

### Troubleshooting

If features aren't working:

1. **Refresh the page** — Some features require a page reload after enabling
2. **Check browser console** — Look for `[Toolasha]` error messages (F12 → Console)
3. **Verify the extension is enabled** — Check your extension manager icon
4. **Report issues** — [Open an issue](../../issues) with details

## For Developers

Toolasha is built with modern JavaScript (ES6+) using a modular, feature-based architecture. Contributions are welcome!

### Quick Start

```bash
npm install           # Install dependencies
npm run build:dev     # Build dev standalone userscript
npm run build         # Build production libraries + entrypoint
npm run build:steam   # Build Steam single-file bundle
npm run dev           # Watch mode (auto-rebuild)
npm test              # Run test suite (202 tests)
```

### Documentation

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Contribution guide and development workflow
- **[AGENTS.md](AGENTS.md)** — Developer guide for AI coding agents
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System architecture and design patterns
- **[DOCUMENTATION.md](DOCUMENTATION.md)** — Complete documentation index

### Key Technologies

- **Build**: Rollup with ES6 modules
- **Testing**: Vitest with 202 tests
- **Storage**: IndexedDB with debounced writes
- **Code Quality**: ESLint + Prettier with pre-commit hooks
- **CI/CD**: GitHub Actions with automated releases

## Project Structure

```
Toolasha/
├── src/
│   ├── core/                      # Core systems (storage, config, websocket, data-manager)
│   ├── features/                  # Feature modules
│   │   ├── actions/              # Action panel enhancements
│   │   ├── alchemy/              # Alchemy profit and history tracking
│   │   ├── chat/                 # Chat enhancements and pop-out
│   │   ├── combat/               # Combat statistics, dungeon tracker, labyrinth
│   │   ├── combat-sim-integration/ # Shykai combat simulator integration
│   │   ├── combat-stats/         # Detailed combat statistics
│   │   ├── enhancement/          # Enhancement optimizer and tracker
│   │   ├── house/                # House upgrade costs
│   │   ├── inventory/            # Inventory badges and sorting
│   │   ├── market/               # Market tools and profit calculations
│   │   ├── navigation/           # Alt+click and quick navigation
│   │   ├── notifications/        # Browser notifications
│   │   ├── profile/              # Character profile and combat score
│   │   ├── skills/               # XP rate and level tracking
│   │   ├── tasks/                # Task efficiency and sorting
│   │   └── ui/                   # UI enhancements and overlays
│   ├── api/                       # External API integrations
│   ├── libraries/                 # Module bundle entry points
│   └── utils/                     # Shared utilities
├── dist/                          # Built userscript (gitignored)
└── docs/                          # Documentation
```

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm test -- --coverage      # Coverage report
```

202 tests across 13 test suites with automated CI/CD pipeline validation on every commit.

## License & Credits

**License**: [CC-BY-NC-SA-4.0](LICENSE)

**Original Author**: bot7420 (MWITools)
**Rewrite & Maintenance**: Celasha and Claude
