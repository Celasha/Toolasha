/**
 * Character Activity Status Feature
 * Character-scoped half of the feature: observes the active character's queue/offline state and
 * persists a projection. The Character Select renderer half is always-on and wired separately
 * (see `character-select-renderer.js`), since it must run even before any character initializes.
 */

import characterActivityCollector from './character-activity-collector.js';

async function initialize() {
    await characterActivityCollector.initialize();
}

function cleanup() {
    characterActivityCollector.cleanup();
}

export default {
    name: 'Character Activity Status',
    initialize,
    cleanup,
};
