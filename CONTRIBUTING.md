# Contributing to Toolasha

Thank you for your interest in contributing to Toolasha! This guide will help you get started with contributing to this Tampermonkey userscript for Milky Way Idle.

> **Note for AI Agents**: See [AGENTS.md](AGENTS.md) for AI-specific development guidelines.

## Quick Start

1. **Fork and clone the repository**

    ```bash
    git clone https://github.com/yourusername/Toolasha.git
    cd Toolasha
    ```

2. **Install dependencies**

    ```bash
    npm install
    ```

3. **Create a feature branch**

    ```bash
    git checkout -b feature/your-feature-name
    ```

4. **Make your changes and test**

    ```bash
    npm test           # Run tests
    npm run build      # Build userscript
    npm run lint       # Check code quality
    ```

5. **Commit and push**

    ```bash
    git add .
    git commit -m "✨ feat: add your feature"
    git push origin feature/your-feature-name
    ```

6. **Open a Pull Request**

## Development Workflow

### Setting Up Your Environment

**Prerequisites:**

- **Node.js**: Version 16 or higher ([Download here](https://nodejs.org/))
- **Browser**: Chrome or Firefox
- **Tampermonkey**: Browser extension ([Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) | [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/))
- **Code Editor**: VS Code recommended ([Download here](https://code.visualstudio.com/))
    - Install ESLint extension for code quality
    - Install Prettier extension for formatting

### Building and Testing

1. **Build the userscript**

    ```bash
    npm run build
    ```

    This creates `dist/Toolasha.user.js`

2. **Install in Tampermonkey**
    - Open Tampermonkey dashboard
    - Click "+" to create new script
    - Copy contents of `dist/Toolasha.user.js`
    - Save

3. **Test in-game**
    - Visit <https://www.milkywayidle.com/game>
    - Your changes should be active

4. **Development mode** (auto-rebuild on save)

    ```bash
    npm run dev
    ```

    After each change, refresh the game page to see updates

### Running Tests

```bash
npm test                # Run all tests once
npm run test:watch      # Run tests in watch mode (re-runs on changes)
```

**Note**: Pre-commit hooks automatically run tests before each commit, so you'll know if something breaks!

## Code Guidelines

**Don't worry if you're new to coding!** Our automated tools (Prettier, ESLint) will help format your code correctly. Just focus on making your feature work, and the tools will handle the style.

### Basic Rules

- **Indentation**: 4 spaces (your editor can auto-format this)
- **Quotes**: Use single quotes `'like this'` not double quotes `"like this"`
- **Semicolons**: Add them at the end of statements `;`
- **File extensions**: Always include `.js` when importing files

### Naming Things

- **Files**: Use dashes between words: `my-feature.js`
- **Variables/Functions**: Use camelCase: `myFunction`, `itemCount`
- **Classes**: Use PascalCase: `DataManager`, `MyFeature`
- **Constants**: Use UPPER_SNAKE_CASE: `MAX_ITEMS`, `DEFAULT_VALUE`

### Common Patterns

**Getting game data:**

```javascript
import dataManager from './core/data-manager.js';

const itemDetails = dataManager.getItemDetails('/items/cheese');
```

**Saving settings:**

```javascript
import storage from './core/storage.js';

await storage.set('myFeatureSetting', true, 'settings');
const value = await storage.get('myFeatureSetting', 'settings', false);
```

**Error handling:**

```javascript
try {
    const result = await doSomething();
    return result;
} catch (error) {
    console.error('[MyFeature] Something went wrong:', error);
    return null;
}
```

> **For detailed code patterns and architecture**, see [AGENTS.md](AGENTS.md)

### Async/Await

Always use async/await, never `.then()` chains:

```javascript
// ✅ Good
async function initialize() {
    await storage.initialize();
    await config.initialize();
}

// ❌ Bad
function initialize() {
    storage.initialize().then(() => config.initialize());
}
```

### Error Handling

Use try-catch with module-prefixed console logging:

```javascript
try {
    const result = await someAsyncOperation();
    return result;
} catch (error) {
    console.error('[ModuleName] Operation failed:', error);
    return null;
}
```

### JSDoc Documentation

Document all public functions:

```javascript
/**
 * Calculate profit for a crafted item
 * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
 * @returns {Promise<Object|null>} Profit data or null if not craftable
 */
async calculateProfit(itemHrid) { }
```

## Architecture Patterns

### Singleton Pattern (Core Modules)

```javascript
class DataManager {
    constructor() {
        this.data = null;
    }
}
const dataManager = new DataManager();
export default dataManager;
```

### Feature Interface

```javascript
export default {
    name: 'Feature Name',
    initialize: async () => {
        /* setup */
    },
    cleanup: () => {
        /* teardown */
    },
};
```

### Data Access

Always use DataManager for game data:

```javascript
import dataManager from './core/data-manager.js';

const itemDetails = dataManager.getItemDetails(itemHrid);
const equipment = dataManager.getEquipment();
```

### Storage

Use the storage module for persistence:

```javascript
import storage from './core/storage.js';

await storage.set('key', value, 'storeName');
const value = await storage.get('key', 'storeName', defaultValue);
```

## Commit Message Guidelines

We use conventional commits with emojis:

- ✨ `feat`: New feature
- 🐛 `fix`: Bug fix
- 📝 `docs`: Documentation changes
- 💄 `style`: Code style/formatting
- ♻️ `refactor`: Code refactoring
- ⚡️ `perf`: Performance improvements
- ✅ `test`: Adding or fixing tests
- 🔧 `chore`: Tooling, configuration

**Format**: `<emoji> <type>: <description>`

**Examples**:

```
✨ feat: add dungeon tracker feature
🐛 fix: resolve memory leak in rendering
📝 docs: update API documentation
♻️ refactor: simplify error handling logic
```

## Pull Request Process

1. **Update documentation** if you've added/changed features
2. **Add tests** for new functionality
3. **Ensure all tests pass** (`npm test`)
4. **Update CHANGELOG.md** with your changes
5. **Follow commit message conventions**
6. **Keep PRs focused** - one feature/fix per PR

### PR Title Format

Use the same format as commit messages:

```
✨ feat: add dungeon tracker feature
```

### PR Description Template

```markdown
## Description

Brief description of what this PR does

## Changes

- List of changes made
- Another change

## Testing

How to test these changes

## Screenshots (if applicable)

Add screenshots for UI changes
```

## Adding New Features

### Before You Start

1. **Check if it already exists**
    - Search existing [issues](../../issues) and [pull requests](../../pulls)
    - Review [FEATURES.md](FEATURES.md) for similar functionality

2. **Discuss your idea** (optional but recommended)
    - Open an issue describing your feature
    - Get feedback from maintainers
    - Avoid duplicate work

### Creating Your Feature

**Basic structure:**

```
src/features/your-feature/
├── your-feature.js        # Main code
├── your-feature-ui.js     # UI elements (if needed)
```

**Example feature:**

```javascript
// src/features/my-feature/my-feature.js
export default {
    name: 'My Feature',

    initialize: async () => {
        console.log('[My Feature] Starting...');
        // Your feature code here
    },

    cleanup: () => {
        console.log('[My Feature] Cleaning up...');
        // Remove event listeners, etc.
    },
};
```

### Adding Settings

If your feature needs user settings, add them to `src/features/settings/settings-config.js`:

```javascript
{
    id: 'myFeature',
    label: 'My Feature',
    description: 'What your feature does',
    type: 'checkbox',  // or 'number', 'text', 'select'
    defaultValue: true,
    category: 'UI Enhancements'  // Choose appropriate category
}
```

### Testing Your Feature

1. **Manual testing** (required)
    - Build and install in Tampermonkey
    - Test in the actual game
    - Try edge cases (empty inventory, no items, etc.)

2. **Automated tests** (if applicable)
    - Add tests for utility functions
    - See existing tests in `tests/` folder for examples

> **Need help?** Look at existing features in `src/features/` for examples!
> src/features/your-feature/
> ├── your-feature.js # Main module
> ├── your-feature-ui.js # UI components (if needed)
> └── your-feature-storage.js # Storage logic (if needed)

````

### 3. Register Feature

Add to `src/core/feature-registry.js`:

```javascript
import yourFeature from '../features/your-feature/your-feature.js';

const features = [
    // ... existing features
    {
        key: 'yourFeature',
        name: 'Your Feature Name',
        category: 'Category',
        initialize: () => yourFeature.initialize(),
        async: false,
    },
];
````

### 4. Add Settings (if needed)

Add to `src/features/settings/settings-config.js`:

```javascript
{
    id: 'yourFeature',
    label: 'Your Feature',
    description: 'Description of your feature',
    type: 'checkbox',
    defaultValue: true,
    category: 'Category'
}
```

### 5. Write Tests

Create tests in `tests/your-feature.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import yourFeature from '../src/features/your-feature/your-feature.js';

describe('Your Feature', () => {
    it('should do something', () => {
        expect(yourFeature.doSomething()).toBe(expected);
    });
});
```

## Reporting Issues

### Bug Reports

Include:

- **Description**: Clear description of the bug
- **Steps to Reproduce**: Detailed steps
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: Browser, Tampermonkey version, Toolasha version
- **Screenshots**: If applicable

### Feature Requests

Include:

- **Description**: Clear description of the feature
- **Use Case**: Why this feature is needed
- **Proposed Solution**: How you think it should work
- **Alternatives**: Other solutions you've considered

## Getting Help

- **Documentation**: Check [DOCUMENTATION.md](DOCUMENTATION.md)
- **Issues**: Search existing issues first
- **Discussions**: Use GitHub Discussions for questions
- **Code**: Review [AGENTS.md](AGENTS.md) for developer guide

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Help others learn and grow

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (CC-BY-NC-SA-4.0).

---

Thank you for contributing to Toolasha! 🎉
