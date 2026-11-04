/**
 * Combat Live results as plain text, for pasting into chat or Discord. Pure: takes a summary, returns a
 * string.
 */

import { formatLargeNumber, timeReadable } from '../../utils/formatters.js';

const NAME_WIDTH = 14;

const pad = (text, width) => (String(text).length > width ? String(text).slice(0, width) : String(text).padEnd(width));
const number = (value) => formatLargeNumber(Math.round(value));
const rate = (value) => formatLargeNumber(value, 1);

/**
 * @param {Object} summary - BattleStats.getSummary() (or a saved copy of it)
 * @param {{label?: string, date?: number}} [options] - A name for the session and when it ended
 * @returns {string}
 */
export function summaryToText(summary, { label = '', date = Date.now() } = {}) {
    const when = new Date(date).toISOString().slice(0, 16).replace('T', ' ');
    const lines = [
        `=== Combat Live${label ? ` - ${label}` : ''} | ${when} | ${timeReadable(summary.seconds || 0)} ===`,
    ];
    const party = summary.party || {};
    lines.push(`Party: ${rate(party.dps || 0)} dps | ${number(party.damage || 0)} damage | ${party.kills || 0} kills`);

    const dealt = [...(summary.dealt || [])].filter((row) => row.damage > 0).sort((a, b) => b.damage - a.damage);
    dealt.forEach((row, index) => {
        const share = party.damage > 0 ? Math.round((row.damage / party.damage) * 100) : 0;
        lines.push(
            `${String(index + 1).padStart(2)}. ${pad(row.name || '?', NAME_WIDTH)} ${rate(row.dps).padStart(7)} dps ` +
                `${number(row.damage).padStart(8)} ${String(share).padStart(3)}%`
        );
    });
    if (summary.unattributed?.damage > 0) {
        lines.push(`Not assigned to a player: ${Math.round((summary.unattributed.share || 0) * 100)}%`);
    }

    const healers = [...(summary.healers || [])].filter((row) => row.healing > 0).sort((a, b) => b.healing - a.healing);
    if (healers.length) {
        lines.push('Healing:');
        for (const row of healers) {
            lines.push(
                `    ${pad(row.name || '?', NAME_WIDTH)} ${rate(row.hps).padStart(7)} hps ${number(row.healing).padStart(8)}`
            );
        }
    }

    const taken = [...(summary.players || [])].filter((row) => row.damage > 0).sort((a, b) => b.damage - a.damage);
    if (taken.length) {
        lines.push('Damage taken:');
        for (const row of taken) {
            lines.push(
                `    ${pad(row.name || '?', NAME_WIDTH)} ${number(row.damage).padStart(8)}  deaths ${row.deaths || 0}`
            );
        }
    }
    return lines.join('\n');
}

export default summaryToText;
