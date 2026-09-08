/**
 * Native Timestamp Normalization (TLA-025C)
 * Character Activity's native date-like fields (`character.lastOfflineTime`,
 * `characterInfo.mooPassExpireTime`) are not guaranteed to already be epoch-ms numbers - the
 * official MWI client explicitly wraps them in `new Date(...)` before any arithmetic/comparison.
 * This is the one narrow, pure, fail-closed boundary Character Activity normalizes them through
 * before any stale comparison, offline-cap arithmetic, or MooPass-window comparison.
 */

/**
 * Normalize a native date-like value to a finite epoch-ms number, or null if it cannot be
 * trusted. Never relies on implicit numeric/string coercion.
 * @param {number|string|Date|null|undefined} value
 * @returns {number|null}
 */
export function normalizeNativeTimestamp(value) {
    if (value == null) return null;

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    if (typeof value === 'string') {
        if (value.trim() === '') return null;
        const ms = new Date(value).getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    return null;
}
