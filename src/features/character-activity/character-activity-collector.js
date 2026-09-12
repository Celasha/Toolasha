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

        // Immediate so a previously-unseen character's first observation is visible right away on
        // Character Select, without waiting for the normal 3s debounce or a later action update.
        await this.recomputeAndPersist(generation, true);
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

    /**
     * TLA-025D: native "Switch Character" is a plain `history.push("/characterSelect")` - it never
     * fires `character_switching` or `beforeunload`, so the just-departed character's activity
     * record can still be stale by the time Character Select reads it. Called from Character
     * Select's own mount lifecycle as a final checkpoint before those reads.
     *
     * Persists ONLY the activity projection, immediately - deliberately does not also mirror
     * account preferences (unlike recomputeAndPersist), so a caller awaiting this can never inherit
     * the normal 3s storage debounce that a preference write would otherwise wait on.
     * @returns {Promise<void>}
     */
    async checkpointForCharacterSelect() {
        if (!this.isInitialized || !this.characterId) return;
        if (dataManager.getCurrentCharacterId() !== this.characterId) return;

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

        await saveCharacterActivity(this.characterId, record, true);
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
