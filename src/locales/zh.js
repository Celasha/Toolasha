/**
 * Simplified Chinese (zh) strings for Toolasha's own UI text.
 *
 * Same dot-nested key shape as `en.js`. A key missing here falls back to the English string via
 * `core/i18n.js` — a translation gap degrades to English, it never crashes or renders a raw key.
 *
 * Split into per-area batch files under ./zh/ for parallel native-speaker review.
 */
import batchA from './zh/batch-a.js';
import batchB from './zh/batch-b.js';
import batchC from './zh/batch-c.js';
import batchD from './zh/batch-d.js';
import batchE from './zh/batch-e.js';

export default {
    ...batchA,
    ...batchB,
    ...batchC,
    ...batchD,
    ...batchE,
};
