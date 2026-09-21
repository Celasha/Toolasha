/**
 * Combat Simulator Integration Module (Metz)
 * Injects an "Import from Toolasha" button on the Metz Combat Simulator's Setup screen
 * (https://metzlii.github.io/metz-combat-simulator/).
 *
 * Metz's Setup screen imports a pasted character/team export off the paste event itself and
 * has no separate Import button to click afterward, unlike Shykai. Its Setup content also
 * mounts and unmounts as the visitor switches tabs (it is a single-page app), so the button is
 * re-attached via an observer rather than injected once at load.
 */

import { constructMetzTeamExport } from './combat-sim-export-metz.js';
import config from '../../core/config.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const timerRegistry = createTimerRegistry();
const BUTTON_ID = 'toolasha-metz-import-button';
const DEFAULT_LABEL = 'Import from Toolasha';

let mutationObserver = null;
let mountTimeout = null;

/**
 * Initialize the Metz integration (runs on the Metz Combat Simulator page only). The userscript
 * runs at document-start, so `document.body` may not exist yet - starting the MutationObserver
 * before it does would throw and abort the whole script for this page.
 */
export function initialize() {
    disable();
    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
}

function start() {
    mount();
    mutationObserver = new MutationObserver(() => scheduleMount());
    mutationObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Disable the integration and remove any injected UI.
 */
export function disable() {
    timerRegistry.clearAll();

    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    if (mountTimeout) {
        clearTimeout(mountTimeout);
        mountTimeout = null;
    }

    const button = document.getElementById(BUTTON_ID);
    if (button) {
        button.remove();
    }
}

function scheduleMount() {
    if (mountTimeout) {
        return;
    }
    mountTimeout = setTimeout(() => {
        mountTimeout = null;
        mount();
    }, 250);
}

/**
 * The character-export paste box. Metz's own docs call it "the import box" and describe it as
 * the page's paste target for one to five character exports; in practice this is the only
 * textarea Setup renders, so that assumption is used first and a placeholder-text match is kept
 * as a fallback in case a future build adds another textarea elsewhere on the page.
 * @returns {HTMLTextAreaElement|null}
 */
function findImportTextarea() {
    const textareas = Array.from(document.querySelectorAll('textarea'));
    if (!textareas.length) {
        return null;
    }
    if (textareas.length === 1) {
        return textareas[0];
    }
    return textareas.find((t) => /export/i.test(t.placeholder || '')) || textareas[0];
}

/**
 * Put the button where it belongs, and do nothing when it is already there - this idempotence
 * is what stops the observer above from looping.
 */
function mount() {
    const textarea = findImportTextarea();
    const existing = document.getElementById(BUTTON_ID);

    if (!textarea) {
        if (existing) {
            existing.remove();
        }
        return;
    }
    if (existing) {
        if (existing.previousElementSibling !== textarea) {
            textarea.insertAdjacentElement('afterend', existing);
        }
        return;
    }
    injectImportButton(textarea);
}

/**
 * @param {HTMLTextAreaElement} textarea
 */
function injectImportButton(textarea) {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = DEFAULT_LABEL;
    button.style.backgroundColor = config.COLOR_ACCENT;
    button.style.color = 'white';
    button.style.padding = '6px 16px';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontWeight = 'bold';
    button.style.margin = '8px 0';
    button.style.display = 'block';

    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.8';
    });
    button.addEventListener('mouseleave', () => {
        button.style.opacity = '1';
    });
    button.addEventListener('click', (event) => {
        event.preventDefault();
        importIntoMetz(button);
    });

    textarea.insertAdjacentElement('afterend', button);
}

function resetButton(button) {
    button.textContent = DEFAULT_LABEL;
    button.style.backgroundColor = config.COLOR_ACCENT;
}

function setButtonStatus(button, label, backgroundColor) {
    button.textContent = label;
    button.style.backgroundColor = backgroundColor;
    const resetTimeout = setTimeout(() => resetButton(button), 3000);
    timerRegistry.registerTimeout(resetTimeout);
}

/**
 * @param {Element} button
 */
async function importIntoMetz(button) {
    try {
        const team = await constructMetzTeamExport();

        if (!team) {
            setButtonStatus(button, 'Error: No character data', '#dc3545');
            console.error('[Toolasha Metz Sim] No export data available');
            alert(
                'No character data found. Please:\n1. Refresh the game page\n2. Wait for it to fully load\n3. Try again'
            );
            return;
        }

        console.log('[Toolasha Metz Sim] Export payload:', team);

        const json = JSON.stringify(team);
        const textarea = findImportTextarea();

        if (!textarea) {
            console.error('[Toolasha Metz Sim] Import box not found');
            await copyToClipboard(json);
            setButtonStatus(button, 'Copied - paste manually', '#28a745');
            return;
        }

        firePasteEvent(textarea, json);
        setButtonStatus(button, '✓ Imported', '#28a745');
    } catch (error) {
        console.error('[Toolasha Metz Sim] Import failed:', error);
        setButtonStatus(button, 'Import Failed', '#dc3545');
    }
}

/**
 * Mimic a real clipboard paste into `textarea`. Metz's Setup screen imports itself off the
 * paste event rather than a separate Import button, so this sets the value directly (in case
 * the page reads it after the fact) and also dispatches a real paste event carrying the same
 * text via clipboardData (in case the page reads it directly from the event, which is the more
 * common way a "paste to import" UI is actually implemented), plus input/change for any plain
 * value-watching handler. Dispatching all three is harmless if a given page only needs one.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} text
 */
function firePasteEvent(textarea, text) {
    textarea.focus();
    textarea.value = text;

    if (typeof ClipboardEvent === 'function' && typeof DataTransfer === 'function') {
        try {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', text);
            textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        } catch (error) {
            console.warn('[Toolasha Metz Sim] Synthetic paste event failed, falling back to input/change', error);
        }
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * @param {string} text
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        console.warn('[Toolasha Metz Sim] Clipboard write blocked', error);
    }
}
