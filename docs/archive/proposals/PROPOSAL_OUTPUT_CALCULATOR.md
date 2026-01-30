# Proposal: Output Totals Display & Max Produceable

## Overview

Two features from MWI Tools Extended that enhance action planning:

1. **Output Totals Display**: Shows total expected outputs below per-action outputs when user enters a quantity in the action input box
2. **Max Produceable Display**: Shows maximum craftable quantity based on current inventory

---

## Feature 1: Output Totals Display

### How It Works in MWI-E

**The game shows:**

```
Gather Flax: [100] actions
Outputs: 1.3 - 3.9 Flax
```

**MWI-E adds below the output:**

```
Outputs: 1.3 - 3.9 Flax
         130.0 - 390.0    ← Gold colored, shows total from 100 actions
```

**Calculation:**

```javascript
// User typed "100" in the input box
const amount = 100;

// Game shows "1.3 - 3.9" per action with 100% drop rate
const minOutput = 1.3;
const maxOutput = 3.9;
const dropRate = 1.0;

// Calculate totals
const expectedMin = minOutput × amount × dropRate;  // 1.3 × 100 × 1.0 = 130.0
const expectedMax = maxOutput × amount × dropRate;  // 3.9 × 100 × 1.0 = 390.0

// Display: "130.0 - 390.0" in styled gold text
```

**For items with drop rates:**

```
Outputs: 1 Star Fragment ~3%
         3.0              ← Shows expected total accounting for 3% drop rate
```

**MWI-E Implementation Details:**

- Creates styled clone elements below each output
- Color-coded: gold (#FFD700) for regular drops, purple (#9D4EDD) for essences
- Text shadow for visual emphasis
- Removes and recreates on each input change
- Handles both ranges (1.3 - 3.9) and single values (1)

---

### Proposed Toolasha Integration

#### Recommended Approach: Action Panel Observer

**Location:** New module `/src/features/actions/output-totals.js`

**Why This Fits:**

- Enhances existing game UI without replacing it
- Provides immediate visual feedback as user types
- Helps with planning ("I need 500 Flax, so I'll queue 150 actions")
- Complements existing action-time-display calculations

**Implementation Approach:**

1. **Add Setting:**

```javascript
// settings-config.js
actionPanel_outputTotals: {
    id: 'actionPanel_outputTotals',
    label: 'Show total expected outputs below per-action outputs',
    type: 'checkbox',
    default: true,
    help: 'Displays calculated totals when you enter a quantity in the action input'
}
```

1. **Architecture:**

```javascript
// output-totals.js

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';

class OutputTotals {
    constructor() {
        this.observedInputs = new Map(); // input element → cleanup function
    }

    initialize() {
        if (!config.getSetting('actionPanel_outputTotals')) {
            return;
        }

        // Watch for action input boxes appearing
        this.setupObserver();
    }

    setupObserver() {
        // The game's action input is in the skill action detail panel
        // Class: SkillActionDetail_skillActionDetail__*
        this.unregisterObserver = domObserver.onClass(
            'OutputTotals',
            'SkillActionDetail_skillActionDetail',
            (detailPanel) => {
                this.attachToActionPanel(detailPanel);
            }
        );
    }

    attachToActionPanel(detailPanel) {
        // Find the input box where user enters action count
        // The game uses various class names, but it's an input[type="number"]
        const inputBox = detailPanel.querySelector('input[type="number"]');

        if (!inputBox) return;

        // Avoid duplicate observers
        if (this.observedInputs.has(inputBox)) return;

        // Add input listener
        const updateHandler = () => {
            this.updateOutputTotals(detailPanel, inputBox);
        };

        inputBox.addEventListener('input', updateHandler);

        // Store cleanup function
        this.observedInputs.set(inputBox, () => {
            inputBox.removeEventListener('input', updateHandler);
        });

        // Initial update if there's already a value
        if (inputBox.value && inputBox.value > 0) {
            this.updateOutputTotals(detailPanel, inputBox);
        }
    }

    updateOutputTotals(detailPanel, inputBox) {
        const amount = parseFloat(inputBox.value);

        // Remove existing totals
        detailPanel.querySelectorAll('.mwi-output-total').forEach((el) => el.remove());

        // No amount entered - nothing to calculate
        if (isNaN(amount) || amount <= 0) {
            return;
        }

        // Find all output containers
        // Outputs section: contains output items and drop rates
        const outputsSection = detailPanel.querySelector('[class*="SkillActionDetail_drops"]');
        const essencesSection = detailPanel.querySelector('[class*="SkillActionDetail_essences"]');
        const raresSection = detailPanel.querySelector('[class*="SkillActionDetail_rares"]');

        // Process each section
        if (outputsSection) {
            this.processOutputSection(outputsSection, amount, config.COLOR_INFO);
        }
        if (essencesSection) {
            this.processOutputSection(essencesSection, amount, '#9D4EDD'); // Purple for essences
        }
        if (raresSection) {
            this.processOutputSection(raresSection, amount, config.COLOR_WARNING);
        }
    }

    processOutputSection(section, amount, color) {
        // Find all drop elements within this section
        const dropElements = section.querySelectorAll('[class*="SkillActionDetail_drop"]');

        dropElements.forEach((dropElement) => {
            // Find the output text (e.g., "1.3 - 3.9")
            const outputText = this.extractOutputText(dropElement);

            if (!outputText) return;

            // Find drop rate if present (e.g., "~3%")
            const dropRate = this.extractDropRate(dropElement);

            // Calculate totals
            const totalText = this.calculateTotal(outputText, amount, dropRate);

            // Create and insert total display
            const totalElement = this.createTotalElement(totalText, color);

            // Insert after the output text
            const firstChild = dropElement.children[0];
            if (firstChild) {
                firstChild.after(totalElement);
            } else {
                dropElement.appendChild(totalElement);
            }
        });
    }

    extractOutputText(dropElement) {
        // The first child typically contains the output count/range
        const firstChild = dropElement.children[0];

        if (!firstChild) return null;

        const text = firstChild.innerText.trim();

        // Check if it looks like an output (contains numbers or ranges)
        if (text.match(/[\d\.]+(-[\d\.]+)?/)) {
            return text;
        }

        return null;
    }

    extractDropRate(dropElement) {
        // Look for percentage text like "~3%" or "3%"
        const text = dropElement.innerText;
        const match = text.match(/~?([\d\.]+)%/);

        if (match) {
            return parseFloat(match[1]) / 100; // Convert 3% to 0.03
        }

        return 1.0; // Default to 100% (guaranteed drop)
    }

    calculateTotal(outputText, amount, dropRate) {
        // Parse output text
        // Could be: "1.3 - 3.9" (range) or "1" (single value)

        if (outputText.includes('-')) {
            // Range output
            const parts = outputText.split('-');
            const minOutput = parseFloat(parts[0].trim());
            const maxOutput = parseFloat(parts[1].trim());

            if (isNaN(minOutput) || isNaN(maxOutput)) {
                return null;
            }

            const expectedMin = (minOutput * amount * dropRate).toFixed(1);
            const expectedMax = (maxOutput * amount * dropRate).toFixed(1);

            return `${expectedMin} - ${expectedMax}`;
        } else {
            // Single value
            const value = parseFloat(outputText);

            if (isNaN(value)) {
                return null;
            }

            const expectedValue = (value * amount * dropRate).toFixed(1);
            return expectedValue;
        }
    }

    createTotalElement(totalText, color) {
        if (!totalText) return null;

        const element = document.createElement('div');
        element.className = 'mwi-output-total';
        element.style.cssText = `
            color: ${color};
            font-weight: 600;
            margin-top: 2px;
            font-size: 0.95em;
        `;
        element.textContent = totalText;

        return element;
    }

    disable() {
        // Clean up all observers
        for (const cleanup of this.observedInputs.values()) {
            cleanup();
        }
        this.observedInputs.clear();

        // Unregister DOM observer
        if (this.unregisterObserver) {
            this.unregisterObserver();
        }

        // Remove all injected elements
        document.querySelectorAll('.mwi-output-total').forEach((el) => el.remove());
    }
}

const outputTotals = new OutputTotals();
export default outputTotals;
```

1. **Integration:**

```javascript
// main.js
import outputTotals from './features/actions/output-totals.js';

// In initializeFeatures()
outputTotals.initialize();
```

1. **Visual Example (Toolasha Style):**

```
┌──────────────────────────────────┐
│ Foraging: Flax                   │
│ [100] actions                    │
│                                  │
│ Outputs:                         │
│   1.3 - 3.9 Flax                │
│   130.0 - 390.0        ← Blue   │
│                                  │
│ Essences:                        │
│   1 Foraging Essence  ~3%       │
│   3.0                  ← Purple │
└──────────────────────────────────┘
```

**Design Rationale:**

- **Color scheme:**
    - Regular outputs: `config.COLOR_INFO` (blue) - matches Toolasha's info color
    - Essences: Purple (#9D4EDD) - matches MWI-E, essence drops are special
    - Rares: `config.COLOR_WARNING` (orange/yellow) - indicates rare items
- **Minimal styling:** No text shadows or heavy effects (simpler than MWI-E)
- **Compact:** Single line below each output
- **Responsive:** Updates immediately as user types

---

## Feature 2: Max Produceable Display

### How It Works in MWI-E

**Calculation:**

```javascript
// For each crafting recipe
const maxCraftsPerInput = action.inputItems.map((input) => {
    const invCount = getItemCountFromInv(input.itemHrid);
    return Math.floor(invCount / input.count);
});

let minCrafts = Math.min(...maxCraftsPerInput);

// Also check upgrade items
if (action.upgradeItemHrid) {
    const upgradeItemCount = getItemCountFromInv(action.upgradeItemHrid);
    minCrafts = Math.min(minCrafts, upgradeItemCount);
}
```

**Display:**

```
Can produce: 12  ← Gold if > 0, red if = 0
```

**Updates:** Every 1 second

### Proposed Toolasha Integration

**Location:** New module `/src/features/actions/max-produceable.js`

**Implementation:** (Same as in previous proposal - this one I understood correctly)

```javascript
// max-produceable.js

import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';

class MaxProduceable {
    constructor() {
        this.actionElements = new Map(); // actionPanel → {actionHrid, displayElement}
        this.updateTimer = null;
    }

    initialize() {
        if (!config.getSetting('actionPanel_maxProduceable')) {
            return;
        }

        this.setupObserver();
        this.startUpdates();

        // Listen for inventory changes
        dataManager.on('inventory_updated', () => this.updateAllCounts());
    }

    setupObserver() {
        // Watch for skill action panels (in skill screen, not detail modal)
        this.unregisterObserver = domObserver.onClass('MaxProduceable', 'SkillAction_skillAction', (actionPanel) => {
            this.injectMaxProduceable(actionPanel);
        });
    }

    injectMaxProduceable(actionPanel) {
        // Extract action HRID from panel
        const actionHrid = this.getActionHridFromPanel(actionPanel);

        if (!actionHrid) return;

        const actionDetails = dataManager.getActionDetails(actionHrid);

        // Only show for production actions with inputs
        if (!actionDetails || !actionDetails.inputItems || actionDetails.inputItems.length === 0) {
            return;
        }

        // Check if already injected
        if (actionPanel.querySelector('.mwi-max-produceable')) {
            return;
        }

        // Create display element
        const display = document.createElement('div');
        display.className = 'mwi-max-produceable';
        display.style.cssText = `
            font-size: 0.85em;
            margin-top: 4px;
            padding: 4px 8px;
            text-align: center;
            border-top: 1px solid var(--border-color, ${config.COLOR_BORDER});
        `;

        // Insert at bottom of action panel
        actionPanel.appendChild(display);

        // Store reference
        this.actionElements.set(actionPanel, {
            actionHrid: actionHrid,
            displayElement: display,
        });

        // Initial update
        this.updateCount(actionPanel);
    }

    getActionHridFromPanel(actionPanel) {
        // Try to find action name from panel
        const nameElement = actionPanel.querySelector('[class*="SkillAction_name"]');

        if (!nameElement) return null;

        const actionName = nameElement.textContent.trim();

        // Look up action by name in game data
        const initData = dataManager.getInitClientData();
        if (!initData) return null;

        for (const [hrid, action] of Object.entries(initData.actionDetailMap)) {
            if (action.name === actionName) {
                return hrid;
            }
        }

        return null;
    }

    calculateMaxProduceable(actionHrid) {
        const actionDetails = dataManager.getActionDetails(actionHrid);
        const inventory = dataManager.getInventory();

        if (!actionDetails || !inventory) {
            return null;
        }

        // Calculate max crafts per input
        const maxCraftsPerInput = actionDetails.inputItems.map((input) => {
            const invItem = inventory.find(
                (item) => item.itemHrid === input.itemHrid && item.itemLocationHrid === '/item_locations/inventory'
            );

            const invCount = invItem?.count || 0;
            return Math.floor(invCount / input.count);
        });

        let minCrafts = Math.min(...maxCraftsPerInput);

        // Check upgrade item
        if (actionDetails.upgradeItemHrid) {
            const upgradeItem = inventory.find(
                (item) =>
                    item.itemHrid === actionDetails.upgradeItemHrid &&
                    item.itemLocationHrid === '/item_locations/inventory'
            );

            const upgradeCount = upgradeItem?.count || 0;
            minCrafts = Math.min(minCrafts, upgradeCount);
        }

        return minCrafts;
    }

    updateCount(actionPanel) {
        const data = this.actionElements.get(actionPanel);

        if (!data) return;

        const maxCrafts = this.calculateMaxProduceable(data.actionHrid);

        if (maxCrafts === null) {
            data.displayElement.style.display = 'none';
            return;
        }

        // Color coding
        let color;
        if (maxCrafts === 0) {
            color = config.COLOR_LOSS; // Red
        } else if (maxCrafts < 5) {
            color = config.COLOR_WARNING; // Orange/yellow
        } else {
            color = config.COLOR_PROFIT; // Green
        }

        data.displayElement.style.display = 'block';
        data.displayElement.innerHTML = `<span style="color: ${color};">Can produce: ${maxCrafts.toLocaleString()}</span>`;
    }

    updateAllCounts() {
        for (const actionPanel of this.actionElements.keys()) {
            this.updateCount(actionPanel);
        }
    }

    startUpdates() {
        // Update every 2 seconds
        this.updateTimer = setInterval(() => {
            this.updateAllCounts();
        }, 2000);
    }

    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
        }

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        document.querySelectorAll('.mwi-max-produceable').forEach((el) => el.remove());
        this.actionElements.clear();
    }
}

const maxProduceable = new MaxProduceable();
export default maxProduceable;
```

**Setting:**

```javascript
// settings-config.js
actionPanel_maxProduceable: {
    id: 'actionPanel_maxProduceable',
    label: 'Show max produceable count on crafting actions',
    type: 'checkbox',
    default: true,
    help: 'Displays how many items you can make based on current inventory'
}
```

---

## Implementation Complexity

### Feature 1: Output Totals Display

**Complexity:** Medium

**Estimated Effort:**

- Setting configuration: 5 minutes
- DOM observation setup: 30 minutes
- Output parsing and calculation: 45 minutes
- Display creation and styling: 30 minutes
- Testing with various action types: 30 minutes
  **Total:** ~2.5 hours

**Key Challenges:**

- Finding the correct input box element (class names may vary)
- Parsing output formats (ranges vs single values)
- Handling drop rates correctly
- Avoiding conflicts with game updates

### Feature 2: Max Produceable Display

**Complexity:** Medium

**Estimated Effort:**

- Same as previous proposal: ~2.5 hours

**Key Challenges:**

- Extracting action HRID from skill panels
- Handling inventory updates efficiently
- Performance with many actions visible

---

## Recommended Implementation Order

1. **Feature 1 first (Output Totals):**
    - More immediate user feedback (responds to typing)
    - Simpler state management (no periodic updates needed)
    - Visible in the action detail panel users already interact with

2. **Feature 2 second (Max Produceable):**
    - Requires periodic updates and inventory monitoring
    - Can learn from patterns established in Feature 1

---

## User Experience Benefits

### Output Totals Display

- **Instant feedback:** See total outputs as you type the quantity
- **Planning:** "I need 500 Flax, so 150 actions should do it"
- **No mental math:** Automatic calculation with drop rates
- **Visual clarity:** Color-coded by output type

### Max Produceable Display

- **Inventory awareness:** Know what you can craft immediately
- **Material bottlenecks:** Red = missing materials, yellow = low stock
- **Batch planning:** See max batch size at a glance

---

## Success Criteria

### Feature 1: Output Totals Display

- ✅ Updates immediately when user types in input box
- ✅ Correctly calculates ranges (min-max)
- ✅ Accounts for drop rates properly
- ✅ Works with all action types (gathering, production)
- ✅ Clean display that doesn't interfere with game UI
- ✅ Removes totals when input is cleared

### Feature 2: Max Produceable Display

- ✅ Accurate inventory calculations
- ✅ Handles all input materials + upgrade items
- ✅ Color coding identifies bottlenecks
- ✅ Updates smoothly without flickering
- ✅ Works across all production skills
