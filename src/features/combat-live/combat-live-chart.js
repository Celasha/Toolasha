/**
 * Combat Live DPS visual
 *
 * A "hit tape" (one bar per hit over the last minute: height is damage, gold is a crit, hollow is a
 * miss, gaps are the time between waves) and a one-line bar of damage by ability. The builders are pure
 * so they can be tested without a canvas; only drawHitTape touches the DOM.
 */

import { TAPE_WINDOW_MS } from './battle-stats.js';

export const TAPE_WIDTH = 296;
export const TAPE_HEIGHT = 44;
export const OTHER_KEY = '__other';

const PALETTE = ['#4fc3ff', '#7dff8a', '#ff9f4a', '#c78bff', '#ff6a8a', '#7ff6ff', '#ffe27a', '#8fa8ff'];
const FIXED_COLORS = {
    auto: '#9aa4b2',
    'over-time': '#b86bff',
    reflect: '#ff9a3c',
    'reflect-guess': '#ff9a3c',
    '': '#6b7280',
    [OTHER_KEY]: '#4b5563',
};
const CRIT_COLOR = '#ffd24a';
const MISS_COLOR = '#8b93a1';
// Width of a hit bar in px; a crit cap overhangs it by one px each side
const BAR_WIDTH = 3;
// A tiny hit still gets a visible bar, as a fraction of the tape height
const MIN_BAR = 0.08;
const MISS_BAR = 0.12;
// Within this much of the average, the pace counts as steady
const STEADY_PERCENT = 3;

/**
 * A stable color per ability: the same ability keeps its color from one redraw to the next.
 * @param {string} key - Ability hrid or a special source key
 * @returns {string} CSS color
 */
export function abilityColor(key) {
    if (key in FIXED_COLORS) return FIXED_COLORS[key];
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return PALETTE[hash % PALETTE.length];
}

/**
 * How current DPS compares with the session average.
 * @param {{currentDps: number, averageDps: number}} pace
 * @returns {{direction: 'up'|'down'|'flat', arrow: string, percent: number}}
 */
export function buildPaceModel({ currentDps, averageDps }) {
    if (!(averageDps > 0)) return { direction: 'flat', arrow: '•', percent: 0 };
    const percent = Math.round(((currentDps - averageDps) / averageDps) * 100);
    if (Math.abs(percent) < STEADY_PERCENT) return { direction: 'flat', arrow: '•', percent: Math.abs(percent) };
    return percent > 0
        ? { direction: 'up', arrow: '▲', percent }
        : { direction: 'down', arrow: '▼', percent: Math.abs(percent) };
}

/**
 * Turn recent hits into bars on a tape of a given width. The newest hit is at the right edge.
 * @param {Array<{t: number, amount: number, crit: boolean, miss: boolean, key: string}>} hits
 * @param {number} now - Right edge of the tape, in ms
 * @param {number} [width] - Tape width in px
 * @param {number} [windowMs] - Time the tape covers
 * @returns {{bars: Array<{x: number, height: number, kind: 'hit'|'crit'|'miss', key: string}>, max: number}}
 */
export function buildTapeModel(hits, now, width = TAPE_WIDTH, windowMs = TAPE_WINDOW_MS) {
    const start = now - windowMs;
    const visible = hits.filter((hit) => hit.t > start && hit.t <= now);
    const max = visible.reduce((largest, hit) => (hit.miss ? largest : Math.max(largest, hit.amount)), 1);

    const bars = visible.map((hit) => {
        const x = Math.min(width - 1, Math.max(0, Math.floor(((hit.t - start) / windowMs) * width)));
        if (hit.miss) return { x, height: MISS_BAR, kind: 'miss', key: hit.key };
        return {
            x,
            height: Math.min(1, Math.max(MIN_BAR, hit.amount / max)),
            kind: hit.crit ? 'crit' : 'hit',
            key: hit.key,
        };
    });
    return { bars, max };
}

/**
 * Segments for a one-line "damage by ability" bar. Abilities under minShare are folded into "other".
 * @param {Array<{key: string, damage: number}>} abilities
 * @param {number} [minShare] - Smallest share that gets its own segment
 * @returns {Array<{key: string, share: number}>} Largest first, shares summing to 1
 */
export function buildAbilityBar(abilities, minShare = 0.03) {
    const total = abilities.reduce((sum, ability) => sum + ability.damage, 0);
    if (!(total > 0)) return [];

    const segments = [];
    let other = 0;
    for (const ability of [...abilities].sort((a, b) => b.damage - a.damage)) {
        const share = ability.damage / total;
        if (share < minShare) other += share;
        else segments.push({ key: ability.key, share });
    }
    if (other > 0) segments.push({ key: OTHER_KEY, share: other });
    return segments;
}

/**
 * Draw the hit tape. Does nothing where there is no canvas support (tests, odd embeds).
 * @param {HTMLCanvasElement} canvas
 * @param {{bars: Array}} model - From buildTapeModel
 * @param {number} [width]
 * @param {number} [height]
 */
export function drawHitTape(canvas, model, width = TAPE_WIDTH, height = TAPE_HEIGHT) {
    const context = canvas.getContext?.('2d');
    if (!context) return;

    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Resizing the canvas also clears it
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);

    context.fillStyle = 'rgba(255, 255, 255, 0.04)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    context.fillRect(0, height - 1, width, 1);

    const usable = height - 3;
    for (const bar of model.bars) {
        const barHeight = Math.max(2, Math.round(bar.height * usable));
        const top = height - 1 - barHeight;
        // Centre the bar on its time, and keep it inside the tape at either edge
        const left = Math.min(Math.max(0, bar.x - 1), width - BAR_WIDTH);
        if (bar.kind === 'miss') {
            context.strokeStyle = MISS_COLOR;
            context.lineWidth = 1;
            context.strokeRect(left + 0.5, top + 0.5, BAR_WIDTH - 1, barHeight - 1);
        } else {
            context.fillStyle = abilityColor(bar.key);
            context.fillRect(left, top, BAR_WIDTH, barHeight);
            if (bar.kind === 'crit') {
                context.fillStyle = CRIT_COLOR;
                context.fillRect(left - 1, top - 1, BAR_WIDTH + 2, 3);
            }
        }
    }
}

export const SPARK_BUCKETS = 12;
export const SPARK_BUCKET_WIDTH = 5;
export const SPARK_HEIGHT = 16;

/**
 * DPS over time for the bar's sparkline: the last window cut into equal steps, each the damage dealt in
 * it per second, as a share of the best step.
 * @param {Array<{t: number, amount: number, miss: boolean}>} hits
 * @param {number} now - Right edge in ms
 * @param {number} [buckets]
 * @param {number} [windowMs]
 * @returns {number[]} One value per step, oldest first, each 0 to 1 (all 0 when there was no damage)
 */
export function buildSparkModel(hits, now, buckets = SPARK_BUCKETS, windowMs = TAPE_WINDOW_MS) {
    const start = now - windowMs;
    const step = windowMs / buckets;
    const totals = new Array(buckets).fill(0);
    for (const hit of hits) {
        if (hit.miss || hit.t <= start || hit.t > now) continue;
        const index = Math.min(buckets - 1, Math.floor((hit.t - start) / step));
        totals[index] += hit.amount;
    }
    const best = Math.max(...totals);
    return best > 0 ? totals.map((total) => total / best) : totals;
}

/**
 * Draw the sparkline. Does nothing where there is no canvas support (tests, odd embeds).
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values - From buildSparkModel
 */
export function drawSparkline(canvas, values) {
    const context = canvas.getContext?.('2d');
    if (!context) return;

    const width = values.length * SPARK_BUCKET_WIDTH;
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Resizing the canvas also clears it
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(SPARK_HEIGHT * ratio);
    context.scale(ratio, ratio);

    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    context.fillRect(0, SPARK_HEIGHT - 1, width, 1);
    context.fillStyle = '#00c896';
    values.forEach((value, index) => {
        const height = value > 0 ? Math.max(2, Math.round(value * (SPARK_HEIGHT - 2))) : 0;
        context.fillRect(index * SPARK_BUCKET_WIDTH, SPARK_HEIGHT - 1 - height, SPARK_BUCKET_WIDTH - 1, height);
    });
}
