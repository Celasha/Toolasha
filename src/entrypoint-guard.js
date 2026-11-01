/**
 * Entrypoint Guard
 *
 * The entrypoint runs after its @require libraries, which define window.Toolasha. If the CDN was
 * slow or unreachable, those libraries never ran and the entrypoint would crash on its first line
 * with an unhelpful "Cannot read properties of undefined (reading 'Core')". This checks first,
 * shows a plain banner and stops with a clear message instead.
 *
 * Deliberately self-contained: the libraries (including core's i18n) are exactly what is missing,
 * so nothing here may import from them. Text is inline in English and Chinese for that reason.
 */

const BANNER_ID = 'mwi-libraries-warning';
const REQUIRED_LIBRARIES = ['Core', 'Utils', 'Market', 'Sim', 'Actions', 'Combat', 'UI'];

const MESSAGES = {
    en: {
        message:
            "Toolasha's libraries didn't load, so it can't start. The CDN may be slow or blocked. Refresh to retry.",
        reload: 'Refresh page',
        dismiss: 'Dismiss',
    },
    zh: {
        message: 'Toolasha 的库文件未能加载，因此无法启动。CDN 可能较慢或被屏蔽。请刷新页面重试。',
        reload: '刷新页面',
        dismiss: '关闭',
    },
};

/**
 * @param {Object|undefined} root - The window.Toolasha namespace
 * @returns {string[]} Names of required libraries that are missing
 */
export function findMissingLibraries(root) {
    return REQUIRED_LIBRARIES.filter((name) => !root || !root[name]);
}

function pickMessages() {
    const language = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return language.toLowerCase().startsWith('zh') ? MESSAGES.zh : MESSAGES.en;
}

function buildBanner() {
    const text = pickMessages();
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
    message.textContent = text.message;

    const reloadButton = document.createElement('button');
    reloadButton.textContent = text.reload;
    reloadButton.style.cssText = `
        background: #fff; color: #b91c1c;
        border: none; border-radius: 4px;
        padding: 4px 12px; font-weight: 700; cursor: pointer;
    `;
    reloadButton.addEventListener('click', () => window.location.reload());

    const dismissButton = document.createElement('button');
    dismissButton.textContent = '×';
    dismissButton.setAttribute('aria-label', text.dismiss);
    dismissButton.style.cssText = `
        position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
        background: none; border: none; color: #fff;
        font-size: 22px; line-height: 1; cursor: pointer;
    `;
    dismissButton.addEventListener('click', () => banner.remove());

    banner.append(message, reloadButton, dismissButton);
    return banner;
}

/**
 * Show the banner now, or as soon as the page has a body (userscripts run at document-start).
 */
export function showLibrariesWarning() {
    if (typeof document === 'undefined') return;

    const attach = () => {
        if (!document.body || document.getElementById(BANNER_ID)) return;
        document.body.appendChild(buildBanner());
    };

    if (document.body) {
        attach();
    } else {
        document.addEventListener('DOMContentLoaded', attach, { once: true });
    }
}

/**
 * Throws (after showing the banner) when any required library is missing.
 * @param {Object|undefined} [root] - The window.Toolasha namespace (defaults to the global one)
 */
export function assertLibrariesLoaded(root = typeof window !== 'undefined' ? window.Toolasha : undefined) {
    const missing = findMissingLibraries(root);
    if (missing.length === 0) return;

    showLibrariesWarning();
    throw new Error(
        `[Toolasha] Libraries failed to load (missing: ${missing.join(', ')}). ` +
            'The CDN may be slow or blocked - refresh to retry.'
    );
}
