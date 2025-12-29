// Debug script for enhancement tracking
// Paste this into the browser console while on the game page

console.log('[Debug] Enhancement Tracker Status:');
console.log('- Feature enabled:', Toolasha.config.getSetting('enhancementTracker'));
console.log('- Auto-start enabled:', Toolasha.config.getSetting('enhancementTracker_autoStart'));
console.log('- Tracker initialized:', Toolasha.enhancementTracker.isInitialized);
console.log('- Current session:', Toolasha.enhancementTracker.getCurrentSession());

// Monitor ALL WebSocket messages for 30 seconds
console.log('\n[Debug] Monitoring WebSocket messages for 30 seconds...');
console.log('Start an enhancement action now\!\n');

const originalEmit = Toolasha.websocket.emit;
let messageCount = 0;

Toolasha.websocket.emit = function(eventName, data) {
    messageCount++;
    console.log(`\n[WS Message ${messageCount}] Event: ${eventName}`);
    
    // Log relevant enhancement-related messages in detail
    if (eventName === 'actions_updated') {
        console.log('  - endCharacterActions:', data.endCharacterActions);
        if (data.endCharacterActions) {
            data.endCharacterActions.forEach(action => {
                console.log('    Action:', action.actionTypeHrid, 'isDone:', action.isDone, 'currentCount:', action.currentCount);
                if (action.actionTypeHrid === '/action_types/enhancing') {
                    console.log('    *** ENHANCEMENT ACTION DETECTED ***');
                    console.log('    Item:', action.primaryItemHash?.hrid || action.inputItemHrid);
                    console.log('    Level:', action.primaryItemHash?.level);
                    console.log('    Target:', action.enhancingMaxLevel);
                }
            });
        }
    } else if (eventName === 'action_completed') {
        console.log('  - endCharacterAction:', data.endCharacterAction);
        if (data.endCharacterAction?.actionTypeHrid === '/action_types/enhancing') {
            console.log('    *** ENHANCEMENT COMPLETED ***');
            console.log('    Item:', data.endCharacterAction.primaryItemHash?.hrid);
            console.log('    New Level:', data.endCharacterAction.primaryItemHash?.level);
        }
    }
    
    return originalEmit.apply(this, arguments);
};

// Restore after 30 seconds
setTimeout(() => {
    Toolasha.websocket.emit = originalEmit;
    console.log(`\n[Debug] Monitoring stopped. Captured ${messageCount} messages.`);
}, 30000);

console.log('[Debug] Script ready. Waiting for WebSocket messages...');
