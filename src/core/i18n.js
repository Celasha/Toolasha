/**
 * i18n
 *
 * Resolves Toolasha's effective UI locale from the game's own language selection and exposes
 * translated strings via t(). MWI persists its selected language under
 * localStorage['i18nextLng'] (standard i18next-browser-languagedetector key); Toolasha mirrors
 * that choice rather than adding a separate language setting, since the game's own item/action/
 * monster names already come translated through dataManager once the player picks a language
 * in-game — Toolasha's own UI should follow the same choice.
 */
import en from '../locales/en.js';
import zh from '../locales/zh.js';

const LOCALE_TABLES = { en, zh };
const SUPPORTED_LOCALES = ['en', 'zh'];
const DEFAULT_LOCALE = 'en';

class I18n {
    /**
     * Effective locale for Toolasha's own UI strings and Intl formatting.
     * @returns {'en'|'zh'}
     */
    getLocale() {
        let raw = null;
        try {
            raw = window.localStorage.getItem('i18nextLng');
        } catch {
            raw = null;
        }

        if (!raw) return DEFAULT_LOCALE;

        const normalized = raw.toLowerCase();
        // MWI ships both zh (Simplified) and zh-TW (Traditional); Toolasha only has Simplified
        // strings for now, so any zh* variant maps to 'zh' rather than falling back to English.
        if (normalized.startsWith('zh')) return 'zh';
        return SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE;
    }

    /**
     * Look up a translated string by dot-nested key, e.g. t('settings.clearButton').
     * Falls back to the English string, then to the key itself, so a missing translation never
     * surfaces as undefined and never throws.
     * @param {string} key
     * @param {Object} [params] - Named placeholders substituted for `{{name}}` in string
     *   templates; passed through as-is to function templates (used for pluralization).
     * @returns {string}
     */
    t(key, params = {}) {
        const locale = this.getLocale();
        const template = this._lookup(LOCALE_TABLES[locale], key) ?? this._lookup(LOCALE_TABLES[DEFAULT_LOCALE], key);

        if (template === undefined) return key;
        if (typeof template === 'function') return template(params);
        return this._interpolate(template, params);
    }

    _lookup(table, key) {
        return key
            .split('.')
            .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), table);
    }

    _interpolate(template, params) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }
}

const i18n = new I18n();
export default i18n;
export const t = (key, params) => i18n.t(key, params);
