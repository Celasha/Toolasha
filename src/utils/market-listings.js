/**
 * Merge market listing updates into the current list.
 * @param {Array} currentListings - Existing market listings.
 * @param {Array} updatedListings - Updated listings from WebSocket.
 * @returns {Array} New merged listings array.
 */
export const mergeMarketListings = (currentListings = [], updatedListings = []) => {
    const safeCurrent = Array.isArray(currentListings) ? currentListings : [];
    const safeUpdates = Array.isArray(updatedListings) ? updatedListings : [];

    if (safeUpdates.length === 0) {
        return [...safeCurrent];
    }

    const indexById = new Map();
    safeCurrent.forEach((listing, index) => {
        if (!listing || listing.id === undefined || listing.id === null) {
            return;
        }
        indexById.set(listing.id, index);
    });

    const merged = [...safeCurrent];

    for (const listing of safeUpdates) {
        if (!listing || listing.id === undefined || listing.id === null) {
            continue;
        }

        const existingIndex = indexById.get(listing.id);
        if (existingIndex !== undefined) {
            merged[existingIndex] = listing;
        } else {
            merged.push(listing);
        }
    }

    return merged;
};
