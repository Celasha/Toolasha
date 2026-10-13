/**
 * Character Data Warning
 * Full-width banner shown when init_character_data never arrives, since most features depend on it
 * and only a page refresh recovers.
 */

import { t } from './i18n.js';

const BANNER_ID = 'mwi-character-data-warning';

/**
 * Show the banner (no-op if already shown or the document isn't ready).
 */
export function showCharacterDataWarning() {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById(BANNER_ID)) return;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'alert');
    banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0;
        z-index: 100000;
        display: flex; align-items: center; justify-content: center; gap: 12px;
        padding: 8px 40px 8px 12px;
        background: #b91c1c; color: #fff;
        font-size: 14px; font-weight: 600;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    `;

    const message = document.createElement('span');
    message.textContent = t('characterDataWarning.message');

    const reloadButton = document.createElement('button');
    reloadButton.textContent = t('characterDataWarning.reloadButton');
    reloadButton.style.cssText = `
        background: #fff; color: #b91c1c;
        border: none; border-radius: 4px;
        padding: 4px 12px; font-weight: 700; cursor: pointer;
    `;
    reloadButton.addEventListener('click', () => window.location.reload());

    const dismissButton = document.createElement('button');
    dismissButton.textContent = '×';
    dismissButton.setAttribute('aria-label', t('characterDataWarning.dismissLabel'));
    dismissButton.style.cssText = `
        position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
        background: none; border: none; color: #fff;
        font-size: 22px; line-height: 1; cursor: pointer;
    `;
    dismissButton.addEventListener('click', () => banner.remove());

    banner.append(message, reloadButton, dismissButton);
    document.body.appendChild(banner);
}

/**
 * Remove the banner if present.
 */
export function hideCharacterDataWarning() {
    if (typeof document === 'undefined') return;
    document.getElementById(BANNER_ID)?.remove();
}
