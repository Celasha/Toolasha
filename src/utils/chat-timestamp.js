/**
 * Chat Timestamp Parsing
 * Parses the bracketed timestamp the game renders on system chat messages
 * (e.g. "[10-11 12:05:07 AM]"), shared by every dungeon-tracker module that reads it from the DOM.
 */

const TIMESTAMP_PATTERN = /\[(\d{1,2})([-/.])(\d{1,2})\.?\s*(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?\]/;

/**
 * Parse a chat-rendered timestamp into a Date.
 *
 * The game renders this timestamp using the browser's locale, so the day/month order implied by
 * a given separator is not fixed - some clients render "D-M", others "M-D", with the exact same
 * hyphen. When both numeric parts are <=12 the order is genuinely ambiguous from the digits alone
 * (e.g. "10-11"); this resolves it by picking whichever interpretation - combined with whichever
 * of referenceDate's year and its neighbors - lands closest to `referenceDate`. Chat messages are
 * always close together in real time, so the correct interpretation is never more than a few
 * hours away, while a swapped month/day reading lands weeks or months off (the exact failure this
 * replaces: a hard-coded "hyphen always means day-month" assumption misread "[10-11 12:05:07 AM]"
 * as November 10th instead of October 11th, producing a ~30-day gap).
 * @param {string} text - Message text containing a bracketed timestamp
 * @param {Date} [referenceDate] - Anchor time used to disambiguate month/day order and pick the year
 * @returns {Date|null}
 */
export function parseChatTimestamp(text, referenceDate = new Date()) {
    const match = text.match(TIMESTAMP_PATTERN);
    if (!match) return null;

    const [, part1Str, , part2Str, hourStr, minStr, secStr, period] = match;
    const part1 = parseInt(part1Str, 10);
    const part2 = parseInt(part2Str, 10);
    let hour = parseInt(hourStr, 10);
    const min = parseInt(minStr, 10);
    const sec = parseInt(secStr, 10);

    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
    const referenceYear = referenceDate.getFullYear();
    const referenceTime = referenceDate.getTime();

    // Try both (month, day) readings - skip the duplicate when the digits are identical - and
    // every nearby year, so a date near a Dec/Jan boundary isn't stranded a year off by a
    // fixed-year assumption. Keep whichever valid combination lands closest to referenceDate.
    const orders =
        part1 === part2
            ? [[part1, part2]]
            : [
                  [part1, part2],
                  [part2, part1],
              ];
    let best = null;
    let bestDistance = Infinity;
    for (const [month, day] of orders) {
        if (month < 1 || month > 12) continue;
        for (const year of [referenceYear, referenceYear - 1, referenceYear + 1]) {
            if (day < 1 || day > daysInMonth(year, month)) continue;
            const candidate = new Date(year, month - 1, day, hour, min, sec, 0);
            const distance = Math.abs(candidate.getTime() - referenceTime);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
    }

    return best;
}
