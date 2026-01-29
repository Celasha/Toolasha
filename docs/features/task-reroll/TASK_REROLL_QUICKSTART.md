# Task Reroll Diagnostic - Quick Start Guide

## Installation

1. Build MWI Tools: `npm run build`
2. Reload the game page
3. Open browser console (F12)

## Usage

### Start Diagnostic
```javascript
MWITools.diagnostics.startTaskRerollDiagnostic()
```

### Perform Actions
1. Open a task that can be rerolled
2. Click the "Reroll" button
3. Select "Pay X Gold" or "Pay X Cowbells"
4. Repeat several times to see cost progression
5. Try different tasks

### Stop and View Results
```javascript
MWITools.diagnostics.stopTaskRerollDiagnostic()
```

## What It Will Show

- **WebSocket Messages**: All messages containing task/reroll/cowbell keywords
- **Button Clicks**: Before/after state comparison for each reroll
- **DOM Elements**: All UI elements related to reroll system
- **Recommendations**: What data sources are available

## Results Export

Results are saved to:
```javascript
window.__taskRerollDiagnosticResults
```

Access individual parts:
```javascript
window.__taskRerollDiagnosticResults.messages     // WebSocket messages
window.__taskRerollDiagnosticResults.rerollCosts  // Cost tracking
window.__taskRerollDiagnosticResults.uiElements   // UI elements found
```

## Alternative: Manual Console Logging

If the diagnostic doesn't work, try this in console while performing rerolls:

```javascript
// Log all WebSocket messages
const originalSend = WebSocket.prototype.send;
WebSocket.prototype.send = function(...args) {
    console.log('[WS Send]', args[0]);
    return originalSend.apply(this, args);
};

// Log all DOM mutations
new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.textContent?.includes('Reroll') ||
                node.textContent?.includes('Cowbell') ||
                node.textContent?.includes('Gold')) {
                console.log('[DOM Added]', node.textContent, node);
            }
        });
    });
}).observe(document.body, { childList: true, subtree: true });
```

## Troubleshooting

**No WebSocket messages captured:**
- Reroll data may not use WebSocket
- Check browser Network tab → WS filter
- Look for HTTP requests instead

**No button clicks captured:**
- Make sure you click buttons WHILE diagnostic is running
- Try starting diagnostic before opening task panel

**No UI elements found:**
- Reroll UI may use different class names
- Open task panel WHILE diagnostic is running
- Check browser console for "Found task/reroll element" logs

## Next Steps

1. Run diagnostic while performing rerolls
2. Review console output carefully
3. Document findings in `docs/TASK_REROLL_INVESTIGATION.md`
4. Share results for implementation planning
