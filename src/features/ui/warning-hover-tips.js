/**
 * Warning Hover Tips
 * Toolasha marks missing, estimated and substituted prices with a ⚠ appended to the number
 * ("123K ⚠", "-- ⚠"). Most of those marks are plain text inside a larger line, which cannot carry a
 * tooltip of its own, so this adds one on hover: when the pointer is over an element whose own text
 * holds a ⚠ and which has no title yet, it gets a title explaining the mark.
 *
 * Only a ⚠ that follows a value is explained. A ⚠ that opens a message ("⚠ Partial - could not value
 * 2 items") or is followed by its own explanation ("Equipped ⚠ (saved loadout unavailable)") already
 * says what it means. Elements with a title of their own, inputs, and chat are left alone.
 */

import { t } from '../../core/i18n.js';

const MARK_ATTR = 'data-mwi-warning-title';
const WARNING = '⚠';
const MAX_ANCESTOR_DEPTH = 3;
const MISSING_PRICE_KEY = 'warningHover.missingPrice';
const ESTIMATED_PRICE_KEY = 'warningHover.estimatedPrice';
const IGNORED_SELECTOR = 'input, textarea, select, [contenteditable="true"], [class*="Chat_"]';

/**
 * Work out which explanation a ⚠ in a piece of text needs.
 * @param {string} text - The element's own text
 * @returns {string|null} The i18n key of its explanation, or null when the ⚠ needs none from us
 */
export function warningTitleKey(text) {
    const index = text.indexOf(WARNING);
    if (index === -1) return null;

    const before = text.slice(0, index).trim();
    // "⚠ Some message": the message is the explanation
    if (!before) return null;

    // "⚠ reason" or "⚠ (reason)": words after it are the explanation. "⚠ (456K/day ⚠)" is just the
    // next value of the same line, so a parenthesis followed by a number does not count.
    const after = text.slice(index + WARNING.length).trim();
    if (/^(?:[(（]\s*)?\p{L}/u.test(after)) return null;

    return before.endsWith('--') ? MISSING_PRICE_KEY : ESTIMATED_PRICE_KEY;
}

/**
 * Text held directly by an element, not by its children
 * @param {Element} el
 * @returns {string}
 */
function ownText(el) {
    let text = '';
    for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
    }
    return text;
}

/**
 * Explain the ⚠ under the pointer, if there is one that needs it.
 * @param {Element} start - The element the pointer entered
 */
export function explainWarningAt(start) {
    for (let el = start, depth = 0; el && depth <= MAX_ANCESTOR_DEPTH; el = el.parentElement, depth++) {
        const ours = el.hasAttribute(MARK_ATTR);
        const titleKey = el.textContent?.includes(WARNING) ? warningTitleKey(ownText(el)) : null;

        if (ours) {
            // Re-check: the text may have been re-rendered since the title was set
            if (titleKey) {
                el.title = t(titleKey);
                return;
            }
            el.removeAttribute('title');
            el.removeAttribute(MARK_ATTR);
            continue;
        }

        // Someone else already explains this element
        if (el.getAttribute('title')) return;
        if (!titleKey) continue;
        if (el.closest(IGNORED_SELECTOR)) return;

        el.title = t(titleKey);
        el.setAttribute(MARK_ATTR, 'true');
        return;
    }
}

const warningHoverTips = {
    handler: null,

    initialize() {
        if (this.handler) return;
        this.handler = (event) => {
            if (event.target instanceof Element) explainWarningAt(event.target);
        };
        document.addEventListener('mouseover', this.handler, { capture: true, passive: true });
    },

    disable() {
        if (this.handler) {
            document.removeEventListener('mouseover', this.handler, { capture: true });
            this.handler = null;
        }
        document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => {
            el.removeAttribute('title');
            el.removeAttribute(MARK_ATTR);
        });
    },
};

export default warningHoverTips;
