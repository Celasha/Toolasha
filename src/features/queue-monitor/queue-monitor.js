/**
 * Queue Monitor
 * Cross-character queue monitor — shows estimated queue time remaining
 * for other characters by snapshotting queue state on character switch.
 */

import config from '../../core/config.js';
import queueSnapshot from './queue-snapshot.js';
import queueMonitorUI from './queue-monitor-ui.js';

let settingChangeHandler = null;

export default {
    name: 'Queue Monitor',

    initialize: () => {
        // Always init snapshot listener (must survive setting toggles)
        queueSnapshot.initialize();

        if (config.getSetting('queueMonitor')) {
            queueMonitorUI.initialize();
        }

        settingChangeHandler = (enabled) => {
            if (enabled) {
                queueMonitorUI.initialize();
            } else {
                queueMonitorUI.disable();
            }
        };
        config.onSettingChange('queueMonitor', settingChangeHandler);
    },

    disable: () => {
        queueSnapshot.disable();
        queueMonitorUI.disable();

        if (settingChangeHandler) {
            config.offSettingChange('queueMonitor', settingChangeHandler);
            settingChangeHandler = null;
        }
    },
};
