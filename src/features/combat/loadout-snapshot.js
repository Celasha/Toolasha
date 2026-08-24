/**
 * Loadout Snapshot compatibility facade.
 *
 * Stateful ownership lives in Core.loadoutState. This module intentionally contains no class,
 * constructor side effects, WebSocket subscriptions, persistence, or enhancement-resolution logic.
 */

import config from '../../core/config.js';
import loadoutState from '../../core/loadout-state.js';

function findAutomaticSnapshot(actionTypeHrid) {
    if (!config.getSetting('loadoutSnapshot')) return null;
    return loadoutState.findSnapshotForActionType(actionTypeHrid);
}

const loadoutSnapshot = {
    get snapshots() {
        return loadoutState.getSnapshotsById();
    },

    onUpdate(listener) {
        loadoutState.onUpdate(listener);
    },

    offUpdate(listener) {
        loadoutState.offUpdate(listener);
    },

    getAllSnapshots() {
        return loadoutState.getAllSnapshots();
    },

    getSnapshotById(snapshotId) {
        return loadoutState.getSnapshotById(snapshotId);
    },

    getSnapshotByName(name) {
        return loadoutState.getSnapshotByName(name);
    },

    resolveSnapshot(snapshot) {
        return loadoutState.resolveSnapshot(snapshot);
    },

    getSnapshotForSkill(actionTypeHrid) {
        const snapshot = findAutomaticSnapshot(actionTypeHrid);
        if (!snapshot) return null;
        return new Map((snapshot.equipment || []).map((entry) => [entry.itemLocationHrid, entry]));
    },

    getSnapshotDrinksForSkill(actionTypeHrid) {
        const snapshot = findAutomaticSnapshot(actionTypeHrid);
        if (!snapshot) return null;
        return (snapshot.drinks || []).filter((entry) => entry.itemHrid);
    },

    getSnapshotInfoForSkill(actionTypeHrid) {
        const snapshot = findAutomaticSnapshot(actionTypeHrid);
        if (!snapshot) return null;
        return { name: snapshot.name, isDefault: !!snapshot.isDefault };
    },
};

export default loadoutSnapshot;
