/**
 * Character Activity Collector
 * Character-scoped lifecycle: computes an activity projection while a character is actively
 * connected and persists it (plus a small account-level mirror of enable/date-time preferences
 * used later on Character Select, where there is no active character context).
 */

import dataManager from '../../core/data-manager.js';
import config from '../../core/config.js';
import { computeLiveProjection } from './character-activity-projection.js';
import { saveCharacterActivity, saveAccountPreferences } from './character-activity-storage.js';

class CharacterActivityCollector {
    constructor() {
        this.isInitialized = false;
        this.characterId = null;
        this.characterName = null;
        this.lifecycleGeneration = 0;
        this.recomputeHandler = null;
        this.switchingHandler = null;
        this.beforeUnloadHandler = null;
    }

    async initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        const generation = ++this.lifecycleGeneration;

        this.characterId = dataManager.getCurrentCharacterId();
        this.characterName = dataManager.getCurrentCharacterName();

        this.recomputeHandler = () => this.recomputeAndPersist(generation);
        dataManager.on('actions_updated', this.recomputeHandler);
        dataManager.on('character_info_updated', this.recomputeHandler);

        this.switchingHandler = () => this.recomputeAndPersist(generation, true);
        dataManager.on('character_switching', this.switchingHandler);

        this.beforeUnloadHandler = () => this.recomputeAndPersist(generation, true);
        window.addEventListener('beforeunload', this.beforeUnloadHandler);

        await this.recomputeAndPersist(generation);
    }

    /**
     * Recompute the current projection and persist it. Coalesced by storage.js's normal
     * debounced write path (3s) except for character-switch/page-departure, where a delayed
     * write could be lost - those pass `immediate: true`.
     * @param {number} generation - Lifecycle generation captured at registration time
     * @param {boolean} [immediate]
     */
    async recomputeAndPersist(generation, immediate = false) {
        if (generation !== this.lifecycleGeneration) return;
        if (!this.characterId) return;

        const record = {
            characterId: this.characterId,
            characterName: this.characterName,
            observedAt: Date.now(),
            offline: {
                hourCap: dataManager.getOfflineHourCap(),
                mooPassExpireTime: dataManager.getMooPassExpireTime(),
            },
            projection: computeLiveProjection(),
        };

        await saveCharacterActivity(this.characterId, record, immediate);
        if (generation !== this.lifecycleGeneration) return;

        await saveAccountPreferences({
            enabled: config.getSetting('characterActivityStatus'),
            dateFormat: config.getSettingValue('market_listingDateFormat', 'MM-DD'),
            timeFormat: config.getSettingValue('market_listingTimeFormat', '24hour'),
        });
    }

    cleanup() {
        this.lifecycleGeneration += 1;

        if (this.recomputeHandler) {
            dataManager.off('actions_updated', this.recomputeHandler);
            dataManager.off('character_info_updated', this.recomputeHandler);
            this.recomputeHandler = null;
        }
        if (this.switchingHandler) {
            dataManager.off('character_switching', this.switchingHandler);
            this.switchingHandler = null;
        }
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
        }

        this.isInitialized = false;
        this.characterId = null;
        this.characterName = null;
    }
}

const characterActivityCollector = new CharacterActivityCollector();

export default characterActivityCollector;
