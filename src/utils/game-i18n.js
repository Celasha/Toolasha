/**
 * Game i18n Bridge
 *
 * Obtains the game's i18next instance from the React fiber tree and provides
 * locale-independent translation of game data names (items, actions, monsters,
 * skills, etc.). Falls back to the English name when the i18n instance is
 * unavailable or the key is missing.
 */

let cachedI18n = null;

/**
 * Walk the React fiber tree from #root to find the i18next instance.
 * @returns {import('i18next').i18n | null}
 */
function getGameI18n() {
    if (cachedI18n) return cachedI18n;
    if (typeof document === 'undefined') return null;

    const root = document.getElementById('root');
    const fiber = root?._reactRootContainer?.current || root?._reactRootContainer?._internalRoot?.current;
    if (!fiber) return null;

    const stack = [fiber];
    while (stack.length > 0) {
        const f = stack.pop();
        if (!f) continue;
        try {
            const props = f.memoizedProps || {};
            if (props.i18n && typeof props.i18n.t === 'function') {
                cachedI18n = props.i18n;
                return cachedI18n;
            }
            if (props.value?.i18n && typeof props.value.i18n.t === 'function') {
                cachedI18n = props.value.i18n;
                return cachedI18n;
            }
        } catch (error) {
            console.error('[GameI18n] Fiber access error during tree walk:', error);
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
    }
    return null;
}

/**
 * Translate a game data name via the game's i18next instance.
 * @param {string} namespace - i18n namespace (e.g. 'itemNames')
 * @param {string} hrid - Game data HRID (e.g. '/items/abyssal_essence')
 * @param {string} [fallback=''] - English name to fall back to
 * @returns {string} Translated name or fallback
 */
export function translateGameName(namespace, hrid, fallback = '') {
    if (!hrid) return fallback;
    const i18n = getGameI18n();
    if (!i18n) return fallback;

    const key = `${namespace}.${hrid}`;
    try {
        const translated = i18n.t(key);
        // i18next returns the key itself when no translation exists
        if (translated === key) return fallback;
        return translated;
    } catch (error) {
        console.error('[GameI18n] i18n.t() failed for key:', key, error);
        return fallback;
    }
}

export const getItemName = (hrid, fallback = '') => translateGameName('itemNames', hrid, fallback);
export const getItemDescription = (hrid, fallback = '') => translateGameName('itemDescriptions', hrid, fallback);
export const getActionName = (hrid, fallback = '') => translateGameName('actionNames', hrid, fallback);
export const getActionTypeName = (hrid, fallback = '') => translateGameName('actionTypeNames', hrid, fallback);
export const getActionCategoryName = (hrid, fallback = '') => translateGameName('actionCategoryNames', hrid, fallback);
export const getMonsterName = (hrid, fallback = '') => translateGameName('monsterNames', hrid, fallback);
export const getSkillName = (hrid, fallback = '') => translateGameName('skillNames', hrid, fallback);
export const getAbilityName = (hrid, fallback = '') => translateGameName('abilityNames', hrid, fallback);
export const getAbilityDescription = (hrid, fallback = '') => translateGameName('abilityDescriptions', hrid, fallback);
export const getItemCategoryName = (hrid, fallback = '') => translateGameName('itemCategoryNames', hrid, fallback);
/**
 * Translate an equipment slot name. The game exposes slot display names under
 * `equipmentTypeNames` with `/equipment_types/<slot>` HRIDs; item location
 * HRIDs (`/item_locations/<slot>`) share the same final segment.
 * @param {string} hrid - Item location or equipment type HRID
 * @param {string} [fallback=''] - English name to fall back to
 * @returns {string} Translated slot name or fallback
 */
export const getItemLocationName = (hrid, fallback = '') => {
    if (!hrid) return fallback;
    const equipmentHrid = hrid.startsWith('/item_locations/')
        ? `/equipment_types/${hrid.slice('/item_locations/'.length)}`
        : hrid;
    return translateGameName('equipmentTypeNames', equipmentHrid, fallback);
};
export const getEquipmentTypeName = (hrid, fallback = '') => translateGameName('equipmentTypeNames', hrid, fallback);
export const getCombatStyleName = (hrid, fallback = '') => translateGameName('combatStyleNames', hrid, fallback);
export const getDamageTypeName = (hrid, fallback = '') => translateGameName('damageTypeNames', hrid, fallback);
export const getBuffTypeName = (hrid, fallback = '') => translateGameName('buffTypeNames', hrid, fallback);
export const getBuffTypeDescription = (hrid, fallback = '') =>
    translateGameName('buffTypeDescriptions', hrid, fallback);
export const getHouseRoomName = (hrid, fallback = '') => translateGameName('houseRoomNames', hrid, fallback);
export const getShopCategoryName = (hrid, fallback = '') => translateGameName('shopCategoryNames', hrid, fallback);
export const getGameModeName = (hrid, fallback = '') => translateGameName('gameModeNames', hrid, fallback);
export const getAchievementName = (hrid, fallback = '') => translateGameName('achievementNames', hrid, fallback);
export const getAchievementDescription = (hrid, fallback = '') =>
    translateGameName('achievementDescriptions', hrid, fallback);
export const getGuildShrineName = (hrid, fallback = '') => translateGameName('guildShrineNames', hrid, fallback);
