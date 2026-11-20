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

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import { constructMetzTeamExport } from './combat-sim-export-metz.js';
import { clearSharedLoadouts, describeMetzImport } from './combat-shared-loadout-metz.js';
import { formatRelativeTime } from '../../utils/formatters.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';

const timerRegistry = createTimerRegistry();
const BUTTON_ID = 'toolasha-metz-import-button';
const CONTAINER_ID = 'toolasha-metz-import-container';
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

    document.getElementById(CONTAINER_ID)?.remove();
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
    const existing = document.getElementById(CONTAINER_ID);

    if (!textarea) {
        if (existing) {
            existing.remove();
        }
        return;
    }
    if (existing) {
        // Anywhere after the paste box in its parent will do. Metz's own helper script also inserts its button
        // right after the box, so insisting on being the very next sibling made the two keep moving past each
        // other, and a move between mouse down and up drops the click.
        const isAfterTextarea =
            existing.parentElement === textarea.parentElement &&
            !!(textarea.compareDocumentPosition(existing) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!isAfterTextarea) {
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
    const container = document.createElement('div');
    container.id = CONTAINER_ID;

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

    const detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.textContent = t('sharedLoadoutsMetz.detailsButton');
    detailsButton.style.cssText =
        'background: transparent; color: inherit; padding: 4px 12px; border: 1px solid currentColor; border-radius: 4px; cursor: pointer; font-size: 0.85em; margin: 0 0 8px 0; display: block; opacity: 0.8;';

    const panel = document.createElement('div');
    panel.style.cssText = 'display: none; margin: 0 0 8px 0; font-size: 0.85em; line-height: 1.5;';

    detailsButton.addEventListener('click', async (event) => {
        event.preventDefault();
        const opening = panel.style.display === 'none';
        panel.style.display = opening ? 'block' : 'none';
        detailsButton.textContent = t(
            opening ? 'sharedLoadoutsMetz.hideDetailsButton' : 'sharedLoadoutsMetz.detailsButton'
        );
        if (opening) await renderDetails(panel);
    });

    container.append(button, detailsButton, panel);
    textarea.insertAdjacentElement('afterend', container);
}

/**
 * Fill the details panel with what the next import will contain: where each character's gear comes from
 * and which viewed loadouts will be in their picker.
 * @param {HTMLElement} panel
 */
async function renderDetails(panel) {
    panel.replaceChildren();
    const addLine = (parent, text, style = '') => {
        const line = document.createElement('div');
        line.textContent = text;
        line.style.cssText = style;
        parent.appendChild(line);
        return line;
    };

    try {
        const details = await describeMetzImport();
        if (!details) {
            addLine(panel, t('combatSimIntegrationMetz.noCharacterDataAlert'));
            return;
        }

        const { self, members } = details;
        addLine(
            panel,
            `${self.name || t('sharedLoadoutsMetz.yourCharacter')}: ${t('sharedLoadoutsMetz.savedLoadouts', { count: self.loadoutCount })}`,
            'font-weight: bold;'
        );

        for (const member of members) {
            const block = document.createElement('div');
            block.style.cssText = 'margin-top: 6px;';
            const header = addLine(
                block,
                member.name || t('combatScore.partyExportUnknownMemberLabel'),
                'font-weight: bold;'
            );
            addLine(
                block,
                member.hasProfile
                    ? t('sharedLoadoutsMetz.equippedProfile', {
                          age: formatRelativeTime(Date.now() - (member.profileAt || 0)),
                      })
                    : t('sharedLoadoutsMetz.noProfile'),
                'opacity: 0.8;'
            );

            if (!member.loadouts.length) {
                addLine(block, t('sharedLoadoutsMetz.noSharedLoadouts'), 'opacity: 0.6;');
            }
            for (const loadout of member.loadouts) {
                addLine(
                    block,
                    `${loadout.name} (${t('sharedLoadoutsMetz.viewedAgo', { age: formatRelativeTime(Date.now() - loadout.viewedAt) })})`,
                    'margin-left: 10px;'
                );
                if (loadout.summary) addLine(block, loadout.summary, 'margin-left: 10px; opacity: 0.7;');
            }

            if (member.loadouts.length) {
                const clear = document.createElement('button');
                clear.type = 'button';
                clear.textContent = t('sharedLoadoutsMetz.clear');
                clear.style.cssText = 'margin-left: 6px; cursor: pointer; font-size: 0.85em;';
                clear.addEventListener('click', async (event) => {
                    event.preventDefault();
                    clearSharedLoadouts(member.characterID);
                    await renderDetails(panel);
                });
                header.appendChild(clear);
            }
            panel.appendChild(block);
        }

        addLine(panel, t('sharedLoadoutsMetz.hint'), 'margin-top: 8px; opacity: 0.6;');
    } catch (error) {
        console.error('[Toolasha Metz Sim] Failed to build import details:', error);
    }
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
            alert(t('combatSimIntegrationMetz.noCharacterDataAlert'));
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
