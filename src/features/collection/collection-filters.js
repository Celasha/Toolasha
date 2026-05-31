/**
 * Collection Filters
 * Adds count-range filter checkboxes, dungeon/skilling-outfit filters,
 * favorites (star buttons), and skilling-badge overlays to the Collections panel.
 *
 * Ported from Collection_Filters.txt by sentientmilk.
 */

import { t } from '../../core/i18n.js';
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';
import marketAPI from '../../api/marketplace.js';
import { getActionEfficiencyContext } from '../../utils/efficiency.js';
import { formatRelativeTime } from '../../utils/formatters.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DUNGEON_ITEMS = {
    d1: new Set([
        'chimerical_chest',
        'chimerical_refinement_chest',
        'chimerical_token',
        'chimerical_quiver',
        'chimerical_quiver_refined',
        'griffin_leather',
        'manticore_sting',
        'jackalope_antler',
        'dodocamel_plume',
        'griffin_talon',
        'chimerical_refinement_shard',
        'chimerical_essence',
        'shield_bash',
        'crippling_slash',
        'pestilent_shot',
        'griffin_tunic',
        'griffin_chaps',
        'manticore_shield',
        'jackalope_staff',
        'dodocamel_gauntlets',
        'griffin_bulwark',
    ]),
    d2: new Set([
        'sinister_chest',
        'sinister_refinement_chest',
        'sinister_token',
        'sinister_cape',
        'sinister_cape_refined',
        'acrobats_ribbon',
        'magicians_cloth',
        'chaotic_chain',
        'cursed_ball',
        'sinister_refinement_shard',
        'sinister_essence',
        'penetrating_strike',
        'pestilent_shot',
        'smoke_burst',
        'acrobatic_hood',
        'magicians_hat',
        'chaotic_flail',
        'cursed_bow',
    ]),
    d3: new Set([
        'enchanted_chest',
        'enchanted_refinement_chest',
        'enchanted_token',
        'enchanted_cloak',
        'enchanted_cloak_refined',
        'royal_cloth',
        'knights_ingot',
        'bishops_scroll',
        'regal_jewel',
        'sundering_jewel',
        'enchanted_refinement_shard',
        'enchanted_essence',
        'crippling_slash',
        'penetrating_shot',
        'retribution',
        'mana_spring',
        'knights_aegis',
        'bishops_codex',
        'royal_water_robe_top',
        'royal_water_robe_bottoms',
        'royal_nature_robe_top',
        'royal_nature_robe_bottoms',
        'royal_fire_robe_top',
        'royal_fire_robe_bottoms',
        'furious_spear',
        'regal_sword',
        'sundering_crossbow',
    ]),
    d4: new Set([
        'pirate_chest',
        'pirate_refinement_chest',
        'pirate_token',
        'marksman_brooch',
        'corsair_crest',
        'damaged_anchor',
        'maelstrom_plating',
        'kraken_leather',
        'kraken_fang',
        'pirate_refinement_shard',
        'pirate_essence',
        'shield_bash',
        'fracturing_impact',
        'life_drain',
        'marksman_bracers',
        'corsair_helmet',
        'anchorbound_plate_body',
        'anchorbound_plate_legs',
        'maelstrom_plate_body',
        'maelstrom_plate_legs',
        'kraken_tunic',
        'kraken_chaps',
        'rippling_trident',
        'blooming_trident',
        'blazing_trident',
    ]),
};

const SKILLING_OUTFITS = new Set([
    'dairyhands_top',
    'foragers_top',
    'lumberjacks_top',
    'cheesemakers_top',
    'crafters_top',
    'tailors_top',
    'chefs_top',
    'brewers_top',
    'alchemists_top',
    'enhancers_top',
    'dairyhands_bottoms',
    'foragers_bottoms',
    'lumberjacks_bottoms',
    'cheesemakers_bottoms',
    'crafters_bottoms',
    'tailors_bottoms',
    'chefs_bottoms',
    'brewers_bottoms',
    'alchemists_bottoms',
    'enhancers_bottoms',
]);

const ACTION_TO_ITEM = {
    cow: 'milk',
    verdant_cow: 'verdant_milk',
    azure_cow: 'azure_milk',
    burble_cow: 'burble_milk',
    crimson_cow: 'crimson_milk',
    unicow: 'rainbow_milk',
    holy_cow: 'holy_milk',
    tree: 'log',
    birch_tree: 'birch_log',
    cedar_tree: 'cedar_log',
    purpleheart_tree: 'purpleheart_log',
    ginkgo_tree: 'ginkgo_log',
    redwood_tree: 'redwood_log',
    arcane_tree: 'arcane_log',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Parse a formatted number string (e.g. "1.5K", "2.3M") into a plain number.
 * @param {string} s
 * @returns {number}
 */
function unformatNumber(s) {
    if (!s) return 0;
    const t = s.trim();
    if (t.endsWith('T')) return parseFloat(t) * 1_000_000_000_000;
    if (t.endsWith('B')) return parseFloat(t) * 1_000_000_000;
    if (t.endsWith('M')) return parseFloat(t) * 1_000_000;
    if (t.endsWith('K')) return parseFloat(t) * 1000;
    return parseFloat(t) || 0;
}

/**
 * Format a number for display (matches original f() function).
 * @param {number} n
 * @returns {string}
 */
function formatCount(n) {
    if (typeof n !== 'number') return 'NaN';
    if (n === 0) return '0';
    if (Math.abs(n) < 10_000) {
        return n % 1 === 0 ? String(n) : n.toFixed(1);
    }
    if (Math.abs(n) <= 1_000_000) {
        const k = n / 1000;
        return k % 1 === 0 ? k + 'K' : k.toFixed(1) + 'K';
    }
    const m = n / 1_000_000;
    if (m % 0.01 === 0) return m.toFixed(m % 1 === 0 ? 0 : m % 0.1 === 0 ? 1 : 2) + 'M';
    return m.toFixed(2) + 'M';
}

/**
 * Return the tier CSS class name for a given count.
 * @param {number} n
 * @returns {string}
 */
function tierColorClass(n) {
    if (n === 0) return 'Collection_tierGray__279Mp';
    if (n < 10) return 'Collection_tierWhite__2m0_1';
    if (n < 100) return 'Collection_tierGreen__ExgCi';
    if (n < 1000) return 'Collection_tierBlue__3uYl-';
    if (n < 10_000) return 'Collection_tierPurple__13F_l';
    if (n < 100_000) return 'Collection_tierRed__3dV_1';
    if (n < 1_000_000) return 'Collection_tierOrange__2wpdX';
    return 'Collection_tierRainbow__1eS_P';
}

/**
 * Return the next tier threshold for a given count.
 * Returns Infinity if already at max tier (≥ 1,000,000).
 * @param {number} n
 * @returns {number}
 */
function nextTierThreshold(n) {
    if (n < 10) return 10;
    if (n < 100) return 100;
    if (n < 1_000) return 1_000;
    if (n < 10_000) return 10_000;
    if (n < 100_000) return 100_000;
    if (n < 1_000_000) return 1_000_000;
    if (n < 10_000_000) return 10_000_000;
    if (n < 100_000_000) return 100_000_000;
    if (n < 1_000_000_000) return 1_000_000_000;
    if (n < 10_000_000_000) return 10_000_000_000;
    if (n < 100_000_000_000) return 100_000_000_000;
    if (n < 1_000_000_000_000) return 1_000_000_000_000;
    if (n < 10_000_000_000_000) return 10_000_000_000_000;
    if (n < 100_000_000_000_000) return 100_000_000_000_000;
    if (n < 1_000_000_000_000_000) return 1_000_000_000_000_000;
    return Infinity;
}

/**
 * Check whether an item belongs to a given dungeon (also checks _refined suffix).
 * @param {string} dungeon
 * @param {string} itemId
 * @returns {boolean}
 */
function matchDungeon(dungeon, itemId) {
    return DUNGEON_ITEMS[dungeon].has(itemId) || DUNGEON_ITEMS[dungeon].has(itemId.replace('_refined', ''));
}

/**
 * Build the initial FLAGS array (called once per instance construction).
 * @returns {Array}
 */
function buildFlags(includeFilters = true, includeFavorites = true) {
    // Each flag object:
    //   { label, className, checked, fn, generateCSS? }
    const matchFromTo = (from, to, _itemId, n) => from <= n && n <= to;
    const matchNoDungeon = (itemId) =>
        !matchDungeon('d1', itemId) &&
        !matchDungeon('d2', itemId) &&
        !matchDungeon('d3', itemId) &&
        !matchDungeon('d4', itemId);

    const flags = [];

    if (includeFilters) {
        flags.push(
            { from: 1, to: 9, checked: true },
            { from: 10, to: 79, checked: true },
            { from: 80, to: 99, checked: true },
            { from: 100, to: 799, checked: true },
            { from: 800, to: 999, checked: true },
            { from: 1000, to: 7999, checked: true },
            { from: 8000, to: 9999, checked: true },
            { label: '10k-100k', from: 10000, to: 99999, checked: true },
            { label: '100k+', from: 100000, to: Infinity, checked: true },
            { label: 'Not dungeon', className: 'nod', checked: true, fn: matchNoDungeon },
            { dungeon: 'd1', checked: true },
            { dungeon: 'd2', checked: true },
            { dungeon: 'd3', checked: true },
            { dungeon: 'd4', checked: true },
            {
                label: 'Skilling Outfits',
                className: 'skilling-outfit',
                checked: true,
                fn: (itemId) => SKILLING_OUTFITS.has(itemId),
            },
            {
                label: 'Uncollected Charms',
                className: 'charm',
                checked: false,
                fn: (itemId, n) => itemId.includes('charm') && n === 0,
            },
            {
                label: 'Uncollected Celestials',
                className: 'celestial',
                checked: false,
                fn: (itemId, n) => itemId.includes('celestial') && n === 0,
            }
        );
    }

    if (includeFavorites) {
        flags.push({
            label: 'Always Show Favorites',
            className: 'favorite',
            checked: true,
            fn: null,
            generateCSS: false,
        });
    }

    // Fill in derived fields (same logic as original script)
    flags.forEach((f) => {
        if ('from' in f && !f.label) {
            f.label = f.from + '-' + (f.to === Infinity ? '∞' : f.to);
        }
        if ('from' in f && !f.className) {
            f.className = 'cf-c' + f.from + '-' + f.to;
        }
        if ('from' in f && !f.fn) {
            const from = f.from;
            const to = f.to;
            f.fn = (itemId, n) => matchFromTo(from, to, itemId, n);
        }
        if ('dungeon' in f && !f.label) {
            f.label = f.dungeon.toUpperCase();
            f.className = 'cf-' + f.dungeon;
            f.fn = (itemId) => matchDungeon(f.dungeon, itemId);
        }
    });

    return flags;
}

// ---------------------------------------------------------------------------
// Checkbox HTML builder (mirrors original script)
// ---------------------------------------------------------------------------

/**
 * Build MUI-style checkbox HTML for a flag entry.
 * @param {{ label: string, className: string, checked: boolean, showIf?: Function }} f
 * @returns {string}
 */
function buildCheckboxHtml(f) {
    const hidden = f.showIf && !f.showIf() ? 'display: none;' : '';
    const checkedClass = f.checked ? 'Mui-checked' : '';
    const checkedSvg = f.checked
        ? `<svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeSmall css-1k33q06" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="CheckBoxIcon"><path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg>`
        : '';
    const uncheckedSvg = !f.checked
        ? `<svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeSmall css-1k33q06" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="CheckBoxOutlineBlankIcon"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"></path></svg>`
        : '';
    return (
        `<div class="AchievementsPanel_checkboxControl__3e6CJ ${f.className} toolasha-cf" style="${hidden}">` +
        `<label class="MuiFormControlLabel-root MuiFormControlLabel-labelPlacementEnd Checkbox_checkbox__dP0DH css-1jaw3da">` +
        `<span class="MuiButtonBase-root MuiCheckbox-root MuiCheckbox-colorPrimary MuiCheckbox-sizeSmall ` +
        `PrivateSwitchBase-root MuiCheckbox-root MuiCheckbox-colorPrimary MuiCheckbox-sizeSmall ${checkedClass} ` +
        `MuiCheckbox-root MuiCheckbox-colorPrimary MuiCheckbox-sizeSmall css-zun73v">` +
        checkedSvg +
        uncheckedSvg +
        `</span>` +
        `<span class="MuiTypography-root MuiTypography-body1 MuiFormControlLabel-label css-9l3uo3">${f.label}</span>` +
        `</label></div>`
    );
}

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

/**
 * Build the CSS string for all flag hide-rules + star styles.
 * @param {Array} flags
 * @returns {string}
 */
function buildCSSText(flags, includeFavorites = true) {
    const hideRules = flags
        .filter((f) => f.generateCSS !== false)
        .map(
            (f) =>
                `.AchievementsPanel_categories__34hno.toolasha-cf:not(.show-${f.className})` +
                ` .Collection_collectionContainer__3ZlUO.${f.className} { display: none; }`
        )
        .join('\n');

    const starCSS = includeFavorites
        ? `
.Collection_collectionContainer__3ZlUO .toolasha-cf.star {
    position: absolute;
    top: 0;
    right: 0;
    width: 25px;
    height: 25px;
}

.Collection_collectionContainer__3ZlUO .toolasha-cf.star::before {
    display: block;
    content: "☆";
    font-size: 15px;
    margin-left: 5px;
}

.Collection_collectionContainer__3ZlUO.cf-favorite .toolasha-cf.star::before {
    content: "★";
    color: orange;
    font-size: 21px;
    margin-top: -5px;
}

.AchievementsPanel_categories__34hno.toolasha-cf.show-favorite .Collection_collectionContainer__3ZlUO.cf-favorite {
    display: initial !important;
}
`
        : '';

    return `
.toolasha-cf.Collection_collection__3H6c8 {
    border-radius: var(--radius-sm, 4px);
    margin-left: 4px;
    padding: 2px;
}

.AchievementsPanel_controls__3bGFT .Checkbox_checkbox__dP0DH {
    margin-right: 0;
}

.AchievementsPanel_controls__3bGFT {
    row-gap: 10px;
}

.Collection_collectionContainer__3ZlUO {
    position: relative;
}

${hideRules}

${starCSS}

.toolasha-cf-favorites-header {
    width: 100%;
    font-size: 11px;
    font-weight: 600;
    color: orange;
    margin-bottom: 4px;
    padding: 4px 0 2px;
    display: flex;
    align-items: center;
    gap: 4px;
}

.toolasha-cf-favorites-header::before {
    content: "\\2605";
}

.toolasha-cf-favorites-section {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 0 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    margin-bottom: 6px;
}
`;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

class CollectionFilters {
    constructor() {
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.flags = buildFlags();
        this.collections = {};
        this.collectionsLastUpdated = null;
        this.favorites = {};
        this.showUncollected = false;
        this.sortMode = 'default'; // 'default' | 'items-needed' | 'gold-cost' | 'time-to-next-tier'
        this.catsObserver = null;
        this.itemActionCache = null;
    }

    // -------------------------------------------------------------------------
    // Feature interface
    // -------------------------------------------------------------------------

    setupSettingListener() {
        const reinit = () => {
            this.disable();
            if (config.getSetting('collectionFilters') || config.getSetting('collectionFavorites')) {
                this.initialize();
            }
        };

        config.onSettingChange('collectionFilters', reinit);
        config.onSettingChange('collectionFavorites', reinit);

        config.onSettingChange('collectionFilters_skillingBadges', (value) => {
            if (!this.isInitialized) return;
            if (value) {
                this.disable();
                this.initialize();
            } else {
                document.querySelectorAll('.toolasha-cf.collection-badge').forEach((el) => el.remove());
            }
        });
    }

    async initialize() {
        if (this.isInitialized) return;
        const filtersOn = config.getSetting('collectionFilters');
        const favoritesOn = config.getSetting('collectionFavorites');
        if (!filtersOn && !favoritesOn) return;

        this.isInitialized = true;
        this._filtersEnabled = filtersOn;
        this._favoritesEnabled = favoritesOn;

        // Rebuild flags based on which features are active
        this.flags = buildFlags(filtersOn, favoritesOn);

        // Inject CSS
        this._buildCSS();

        // Load persisted state
        await this._load();

        // Watch for Collections panel controls bar being added to the DOM
        const unregPanel = domObserver.onClass(
            'CollectionFilters-panel',
            'AchievementsPanel_controls__3bGFT',
            (node) => {
                const isCollections = node.parentElement?.className?.includes('AchievementsPanel_collections');
                if (!isCollections) return;
                const collectionsPanel = node.closest('.AchievementsPanel_collections__qA6CY');
                if (!collectionsPanel) return;
                this._rerenderPanel(node);
            }
        );
        this.unregisterHandlers.push(unregPanel);

        // Watch for skilling screens
        if (config.getSetting('collectionFilters_skillingBadges')) {
            const unregSkilling = domObserver.onClass(
                'CollectionFilters-skilling',
                'SkillActionGrid_skillActionGrid__1tJFk',
                (node) => {
                    this._addSkillingBadges(node);
                }
            );
            this.unregisterHandlers.push(unregSkilling);
        }

        // Reload data on character switch
        dataManager.on('character_initialized', async () => {
            await this._load();
            // Re-apply flags to any currently visible Collections panel
            const panelEl = document.querySelector(
                '.TabPanel_tabPanel__tXMJF:not(.TabPanel_hidden__26UM3)' +
                    ' .AchievementsPanel_collections__qA6CY .AchievementsPanel_controls__3bGFT'
            );
            if (panelEl) {
                this._rerenderPanel(panelEl);
            }
        });
    }

    disable() {
        this.unregisterHandlers.forEach((fn) => fn());
        this.unregisterHandlers = [];
        this.isInitialized = false;
        this.itemActionCache = null;
        this._removeCSS();
        if (this.catsObserver) {
            this.catsObserver.disconnect();
            this.catsObserver = null;
        }
        // Remove injected UI elements
        document.querySelectorAll('.toolasha-cf').forEach((el) => el.remove());
    }

    // -------------------------------------------------------------------------
    // Storage helpers
    // -------------------------------------------------------------------------

    _charKey(key) {
        return `${key}:${dataManager.getCurrentCharacterId()}`;
    }

    async _load() {
        // Reset flags to defaults before loading saved state
        this.flags = buildFlags(this._filtersEnabled, this._favoritesEnabled);

        const [savedFlags, savedFavorites, savedCollections, savedShowUncollected, savedTimestamp] = await Promise.all([
            storage.getJSON(this._charKey('flags'), 'collections', {}),
            storage.getJSON(this._charKey('favorites'), 'collections', {}),
            storage.getJSON(this._charKey('collections'), 'collections', {}),
            storage.getJSON(this._charKey('showUncollected'), 'collections', false),
            storage.get(this._charKey('collectionsUpdatedAt'), 'collections', null),
        ]);

        // Apply saved flag states
        this.flags.forEach((f) => {
            if (f.className in savedFlags) {
                f.checked = savedFlags[f.className];
            }
        });

        if (savedFlags.__sortMode) {
            this.sortMode = savedFlags.__sortMode;
        }

        this.favorites = this._favoritesEnabled ? savedFavorites : {};
        this.collections = savedCollections;
        this.collectionsLastUpdated = savedTimestamp;
        this.showUncollected = savedShowUncollected;
    }

    async _saveFlags() {
        const fs = {};
        this.flags.forEach((f) => {
            fs[f.className] = f.checked;
        });
        fs.__sortMode = this.sortMode;
        await storage.setJSON(this._charKey('flags'), fs, 'collections');
    }

    async _saveFavorites() {
        await storage.setJSON(this._charKey('favorites'), this.favorites, 'collections');
    }

    async _saveCollections() {
        await storage.setJSON(this._charKey('collections'), this.collections, 'collections');
    }

    async _saveShowUncollected(value) {
        this.showUncollected = value;
        await storage.setJSON(this._charKey('showUncollected'), value, 'collections');
    }

    // -------------------------------------------------------------------------
    // CSS
    // -------------------------------------------------------------------------

    _buildCSS() {
        this._removeCSS();
        const style = document.createElement('style');
        style.id = 'toolasha-cf-styles';
        style.textContent = buildCSSText(this.flags, this._favoritesEnabled);
        document.head.appendChild(style);
    }

    _removeCSS() {
        document.getElementById('toolasha-cf-styles')?.remove();
    }

    // -------------------------------------------------------------------------
    // Collections panel rendering
    // -------------------------------------------------------------------------

    /**
     * Scan the Collections panel and apply filter classes + inject controls.
     * @param {Element} panelEl — the .AchievementsPanel_controls__3bGFT element
     */
    _rerenderPanel(panelEl) {
        const catsEl = panelEl.parentElement?.querySelector('.AchievementsPanel_categories__34hno');
        if (!catsEl) return;

        // Move tiles back from favorites section before scanning
        const existingSection = catsEl.parentElement?.querySelector('.toolasha-cf-favorites-section');
        if (existingSection) {
            const movedTiles = Array.from(existingSection.querySelectorAll('.Collection_collectionContainer__3ZlUO'));
            for (let i = movedTiles.length - 1; i >= 0; i--) {
                const tile = movedTiles[i];
                if (tile._favOrigParent && tile._favOrigParent.contains(tile._favOrigNext)) {
                    tile._favOrigParent.insertBefore(tile, tile._favOrigNext);
                } else if (tile._favOrigParent) {
                    tile._favOrigParent.appendChild(tile);
                } else {
                    catsEl.appendChild(tile);
                }
            }
            existingSection.remove();
        }

        // --- Scan all collection tiles ---
        let tileCount = 0;
        catsEl.querySelectorAll('.Collection_collectionContainer__3ZlUO').forEach((el) => {
            tileCount++;
            const useEl = el.querySelector('use');
            if (!useEl) return;
            const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
            const itemId = href.split('#')[1] || '';
            if (!itemId) return;

            const countText = el.querySelector('[class*="Collection_count"]')?.textContent ?? '0';
            const n = unformatNumber(countText);

            // Update cached counts
            this.collections[itemId] = n;

            // Apply/remove filter classes (only when filters enabled)
            if (this._filtersEnabled) {
                this.flags.forEach((f) => {
                    if (f.fn === null) return;
                    if (f.fn(itemId, n)) {
                        el.classList.add(f.className);
                    } else {
                        el.classList.remove(f.className);
                    }
                });
            }

            // Favorites class + star button (only when favorites enabled)
            if (this._favoritesEnabled) {
                if (this.favorites[itemId]) {
                    el.classList.add('cf-favorite');
                } else {
                    el.classList.remove('cf-favorite');
                }

                let starEl = el.querySelector('.toolasha-cf.star');
                if (!starEl) {
                    el.insertAdjacentHTML('beforeend', '<div class="toolasha-cf star"></div>');
                    starEl = el.querySelector('.toolasha-cf.star');
                    starEl.addEventListener(
                        'click',
                        (event) => {
                            event.stopPropagation();
                            if (this.favorites[itemId]) {
                                delete this.favorites[itemId];
                                el.classList.remove('cf-favorite');
                            } else {
                                this.favorites[itemId] = true;
                                el.classList.add('cf-favorite');
                            }
                            this._saveFavorites();
                            this._renderFavoritesSection(catsEl);
                        },
                        true
                    );
                }
            }
        });

        // Persist the scanned counts and update timestamp
        this._saveCollections();
        this.collectionsLastUpdated = Date.now();
        storage.set(this._charKey('collectionsUpdatedAt'), this.collectionsLastUpdated, 'collections');

        // --- Inject checkboxes ---
        // Remove old Toolasha checkboxes (but not stars, which are inside catsEl)
        panelEl.querySelectorAll('.toolasha-cf').forEach((el) => el.remove());

        // Determine showUncollected from the native checkbox
        const nativeCheckbox = panelEl.parentElement.querySelector(
            '.AchievementsPanel_controls__3bGFT > .AchievementsPanel_checkboxControl__3e6CJ'
        );

        // Build showIf for charms/celestials (depend on showUncollected, only relevant for filters)
        if (this._filtersEnabled) {
            this.flags.forEach((f) => {
                if (f.className === 'charm' || f.className === 'celestial') {
                    f.showIf = () => this.showUncollected;
                }
            });
        }

        // Inject checkbox HTML
        panelEl.insertAdjacentHTML('beforeend', this.flags.map((f) => buildCheckboxHtml(f)).join(''));

        // Inject sort dropdown
        panelEl.insertAdjacentHTML(
            'beforeend',
            `<div class="toolasha-cf cf-sort-row" style="display:flex;align-items:center;gap:6px;margin-top:4px;">` +
                `<span style="font-size:12px;color:#aaa;">${t('Sort:')}</span>` +
                `<select class="toolasha-cf cf-sort-select" style="font-size:12px;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:1px 4px;">` +
                `<option value="default"${this.sortMode === 'default' ? ' selected' : ''}>${t('Default')}</option>` +
                `<option value="items-needed"${this.sortMode === 'items-needed' ? ' selected' : ''}>${t('Items to next tier')}</option>` +
                `<option value="gold-cost"${this.sortMode === 'gold-cost' ? ' selected' : ''}>${t('Gold cost to next tier')}</option>` +
                `<option value="time-to-next-tier"${this.sortMode === 'time-to-next-tier' ? ' selected' : ''}>${t('Time to next tier')}</option>` +
                `</select></div>`
        );
        panelEl.querySelector('.cf-sort-select').addEventListener('change', (e) => {
            this.sortMode = e.target.value;
            this._saveFlags();
            this._applySorting(catsEl);
        });

        // Wire click handlers on each injected checkbox
        this.flags.forEach((f) => {
            const checkEl = panelEl.querySelector('.' + f.className + '.toolasha-cf');
            if (!checkEl) return;
            checkEl.addEventListener('click', (event) => {
                event.stopPropagation();
                f.checked = !f.checked;
                this._saveFlags();
                this._rerenderPanel(panelEl);
            });
        });

        // --- Apply show-* classes on catsEl ---
        catsEl.classList.add('toolasha-cf');
        this.flags.forEach((f) => {
            if (f.checked) {
                catsEl.classList.add('show-' + f.className);
            } else {
                catsEl.classList.remove('show-' + f.className);
            }
        });

        // --- Restore showUncollected ---
        if (nativeCheckbox) {
            const isChecked = nativeCheckbox.querySelector('label > span')?.classList.contains('Mui-checked') ?? false;
            if (this.showUncollected && !isChecked) {
                nativeCheckbox.querySelector('input')?.click();
            }
        }

        // --- Wire native checkbox change ---
        if (nativeCheckbox && !nativeCheckbox._toolashaWired) {
            nativeCheckbox._toolashaWired = true;
            nativeCheckbox.addEventListener('click', () => {
                requestAnimationFrame(() => {
                    const isChecked =
                        nativeCheckbox.querySelector('label > span')?.classList.contains('Mui-checked') ?? false;
                    this._saveShowUncollected(isChecked);
                    this._rerenderPanel(panelEl);
                });
            });
        }

        // --- Wire Refresh button ---
        const refreshBtn = panelEl.querySelector('.AchievementsPanel_refreshButton__3RYCh');
        if (refreshBtn && !refreshBtn._toolashaWired) {
            refreshBtn._toolashaWired = true;
            refreshBtn.addEventListener('click', () => {
                setTimeout(() => this._rerenderPanel(panelEl), 500);
            });
        }

        // --- Apply sorting ---
        this._applySorting(catsEl);

        // --- Render favorites section at top ---
        this._renderFavoritesSection(catsEl);

        // --- Watch for tiles being added (tiles load after controls bar) ---
        if (this.catsObserver) {
            this.catsObserver.disconnect();
            this.catsObserver = null;
        }
        // Only register when catsEl is empty — once tiles are present there is no need to watch
        // for further mutations, and doing so causes spurious re-renders (e.g. when the game
        // adds/removes tiles in response to the Show Uncollected toggle).
        // Observe panelEl.parentElement (not just catsEl) so we detect tiles even when the game
        // replaces the catsEl element entirely on first data load (React reconciliation).
        const hasTiles = catsEl.querySelectorAll('.Collection_collectionContainer__3ZlUO').length > 0;
        if (hasTiles && tileCount === 0) {
            this._rerenderPanel(panelEl);
            return;
        }
        if (!hasTiles) {
            const observeTarget = panelEl.parentElement ?? catsEl;
            this.catsObserver = new MutationObserver(() => {
                const liveCatsEl = observeTarget.querySelector('.AchievementsPanel_categories__34hno');
                if (!liveCatsEl) return;
                const tileCount = liveCatsEl.querySelectorAll('.Collection_collectionContainer__3ZlUO').length;
                if (tileCount > 0) {
                    this.catsObserver.disconnect();
                    this.catsObserver = null;
                    const livePanelEl = observeTarget.querySelector('.AchievementsPanel_controls__3bGFT') ?? panelEl;
                    this._rerenderPanel(livePanelEl);
                }
            });
            this.catsObserver.observe(observeTarget, { childList: true, subtree: true });
        }
    }

    // -------------------------------------------------------------------------
    // Favorites section
    // -------------------------------------------------------------------------

    _renderFavoritesSection(catsEl) {
        const parent = catsEl.parentElement;
        if (!parent) return;

        // Move tiles back to their original positions (reverse order to keep references valid)
        const existingSection = parent.querySelector('.toolasha-cf-favorites-section');
        if (existingSection) {
            const movedTiles = Array.from(existingSection.querySelectorAll('.Collection_collectionContainer__3ZlUO'));
            // Restore in reverse order so _favOrigNext references remain valid
            for (let i = movedTiles.length - 1; i >= 0; i--) {
                const tile = movedTiles[i];
                if (tile._favOrigParent && tile._favOrigParent.contains(tile._favOrigNext)) {
                    tile._favOrigParent.insertBefore(tile, tile._favOrigNext);
                } else if (tile._favOrigParent) {
                    tile._favOrigParent.appendChild(tile);
                } else {
                    catsEl.appendChild(tile);
                }
            }
            existingSection.remove();
        }

        if (!config.getSetting('collectionFavoritesSection')) return;
        if (!this._favoritesEnabled || Object.keys(this.favorites).length === 0) return;

        const favTiles = catsEl.querySelectorAll('.Collection_collectionContainer__3ZlUO.cf-favorite');
        if (favTiles.length === 0) return;

        const section = document.createElement('div');
        section.className = 'toolasha-cf-favorites-section';

        const header = document.createElement('div');
        header.className = 'toolasha-cf-favorites-header';
        header.textContent = t('Favorites');
        section.appendChild(header);

        // Record positions: use the next non-favorite sibling as reference
        for (const tile of favTiles) {
            tile._favOrigParent = tile.parentElement;
            let next = tile.nextSibling;
            while (next && next.classList?.contains('cf-favorite')) {
                next = next.nextSibling;
            }
            tile._favOrigNext = next;
            section.appendChild(tile);
        }

        parent.insertBefore(section, catsEl);
    }

    // -------------------------------------------------------------------------
    // Sorting
    // -------------------------------------------------------------------------

    /**
     * Apply CSS order to collection tiles based on the current sortMode.
     * @param {Element} catsEl — the .AchievementsPanel_categories__34hno element
     */
    _applySorting(catsEl) {
        const tiles = Array.from(catsEl.querySelectorAll('.Collection_collectionContainer__3ZlUO'));

        // Always clear time badges and margin overrides so they disappear when switching modes
        catsEl.querySelectorAll('.toolasha-cf.time-to-tier').forEach((el) => {
            el.parentElement?.style.removeProperty('margin-bottom');
            el.parentElement?.style.removeProperty('overflow');
            el.remove();
        });

        if (this.sortMode === 'default') {
            tiles.forEach((el) => el.style.removeProperty('order'));
            return;
        }

        const scored = tiles.map((el) => {
            const useEl = el.querySelector('use');
            const href = useEl?.getAttribute('href') || useEl?.getAttribute('xlink:href') || '';
            const itemId = href.split('#')[1] || '';
            const n = this.collections[itemId] ?? 0;
            const threshold = nextTierThreshold(n);
            const needed = threshold === Infinity ? Infinity : threshold - n;

            let score;
            if (this.sortMode === 'items-needed') {
                score = needed;
            } else if (this.sortMode === 'gold-cost') {
                const price = marketAPI.getPrice('/items/' + itemId, 0);
                const ask = price?.ask ?? 0;
                score = ask > 0 && needed !== Infinity ? needed * ask : Infinity;
            } else {
                // time-to-next-tier
                const itemsPerHour = this._getEffectiveItemsPerHour(itemId);
                score = itemsPerHour > 0 && needed !== Infinity ? needed / itemsPerHour : Infinity;
            }
            return { el, score, itemId };
        });

        scored.sort((a, b) => a.score - b.score);
        scored.forEach(({ el }, i) => {
            el.style.order = i;
        });

        if (this.sortMode === 'time-to-next-tier') {
            scored.forEach(({ el, score }) => {
                if (score === Infinity) return;
                el.style.marginBottom = '16px';
                el.style.overflow = 'visible';

                // Compact time format that fits tile width
                const totalSec = score * 3600;
                let timeStr;
                if (totalSec >= 86400) {
                    const d = Math.floor(totalSec / 86400);
                    const h = Math.floor((totalSec % 86400) / 3600);
                    timeStr = d + 'd ' + h + 'h';
                } else if (totalSec >= 3600) {
                    const h = Math.floor(totalSec / 3600);
                    const m = Math.floor((totalSec % 3600) / 60);
                    timeStr = h + 'h ' + m + 'm';
                } else {
                    const m = Math.floor(totalSec / 60);
                    timeStr = m + 'm';
                }

                el.insertAdjacentHTML(
                    'beforeend',
                    '<span class="toolasha-cf time-to-tier" style="position:absolute;bottom:-14px;left:0;right:0;font-size:9px;color:#aaa;text-align:center;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                        timeStr +
                        '</span>'
                );
            });
        }
    }

    // -------------------------------------------------------------------------
    // Time-to-next-tier helpers
    // -------------------------------------------------------------------------

    /**
     * Lazily build a map of itemId → actionDetails for the first action that produces each item.
     * Gathering actions take priority over production (first-come wins, and actionDetailMap
     * iteration order is stable within a session).
     */
    _buildItemActionCache() {
        if (this.itemActionCache) return;
        this.itemActionCache = {};
        const actionDetailMap = dataManager.getInitClientData()?.actionDetailMap ?? {};
        for (const actionDetails of Object.values(actionDetailMap)) {
            // Production actions use outputItems
            if (actionDetails.outputItems?.length) {
                for (const output of actionDetails.outputItems) {
                    const itemId = output.itemHrid?.split('/').pop();
                    if (itemId && !(itemId in this.itemActionCache)) {
                        this.itemActionCache[itemId] = {
                            actionDetails,
                            outputIndex: actionDetails.outputItems.indexOf(output),
                            source: 'outputItems',
                        };
                    }
                }
            }
            // Gathering actions use dropTable
            if (actionDetails.dropTable?.length) {
                for (const drop of actionDetails.dropTable) {
                    const itemId = drop.itemHrid?.split('/').pop();
                    if (itemId && !(itemId in this.itemActionCache)) {
                        this.itemActionCache[itemId] = {
                            actionDetails,
                            outputIndex: actionDetails.dropTable.indexOf(drop),
                            source: 'dropTable',
                        };
                    }
                }
            }
        }
    }

    /**
     * Returns the effective items per hour for a collection item, accounting for
     * the player's current action speed, efficiency, and gathering quantity bonuses.
     * Returns 0 if no direct gather/craft action exists for the item.
     * @param {string} itemId - e.g. 'milk', 'log'
     * @returns {number}
     */
    _getEffectiveItemsPerHour(itemId) {
        this._buildItemActionCache();
        const cached = this.itemActionCache[itemId];
        if (!cached) return 0;

        const { actionDetails, outputIndex, source } = cached;

        // Production actions consume input items; gathering actions do not
        const isProduction = !!actionDetails.inputItems?.length;

        try {
            const ctx = getActionEfficiencyContext(actionDetails, { isProduction });

            let outputCount;
            if (source === 'dropTable') {
                const drop = actionDetails.dropTable[outputIndex];
                outputCount = (drop.count ?? 1) * (drop.dropRate ?? 1);
            } else {
                outputCount = actionDetails.outputItems[outputIndex].count ?? 1;
            }

            // totalGathering is 0 for production actions (efficiency.js zeroes it out)
            const rate = (3600 / ctx.actionTime) * ctx.efficiencyMultiplier * (1 + ctx.totalGathering) * outputCount;
            return rate;
        } catch (err) {
            console.warn('[CollectionFilters] _getEffectiveItemsPerHour error for ' + itemId + ':', err);
            return 0;
        }
    }

    // -------------------------------------------------------------------------
    // Skilling badges
    // -------------------------------------------------------------------------

    /**
     * Get staleness color override for collection badges.
     * Returns null when data is fresh enough to use the normal tier color.
     * @returns {string|null}
     * @private
     */
    _getBadgeStalenessColor() {
        if (!this.collectionsLastUpdated) return '#999999'; // gray — never scanned
        const hours = (Date.now() - this.collectionsLastUpdated) / 3_600_000;
        if (hours < 4) return null; // fresh — use tier color
        if (hours < 12) return '#FFAA00'; // yellow — getting stale
        return '#FF6600'; // orange — stale
    }

    /**
     * Get tooltip text for a collection badge showing count and freshness.
     * @param {number} count
     * @returns {string}
     * @private
     */
    _getBadgeStalenessTooltip(count) {
        if (!this.collectionsLastUpdated) {
            return t('Collection data not yet loaded \u2014 visit Collections page to refresh');
        }
        const age = Date.now() - this.collectionsLastUpdated;
        const relativeTime = formatRelativeTime(age);
        return t('{0} collected \u2014 updated {1} ago', formatCount(count), relativeTime);
    }

    /**
     * Overlay collection count badges on skilling action tiles.
     * @param {Element} containerEl — the .SkillActionGrid_skillActionGrid__... element
     */
    _addSkillingBadges(containerEl) {
        const stalenessColor = this._getBadgeStalenessColor();

        containerEl.querySelectorAll('.SkillAction_skillAction__1esCp').forEach((el) => {
            const useEl = el.querySelector('use');
            if (!useEl) return;
            const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
            let itemId = href.split('#')[1] || '';
            if (!itemId) return;

            if (itemId in ACTION_TO_ITEM) {
                itemId = ACTION_TO_ITEM[itemId];
            }

            if (!(itemId in this.collections)) return;

            const n = this.collections[itemId];
            const nameEl = el.querySelector('.SkillAction_name__2VPXa');
            if (!nameEl) return;

            // Remove old badge
            el.querySelector('.toolasha-cf.collection-badge')?.remove();

            const tooltip = this._getBadgeStalenessTooltip(n);
            const colorStyle = stalenessColor ? ` style="color:${stalenessColor}"` : '';

            nameEl.insertAdjacentHTML(
                'beforeend',
                `<span class="toolasha-cf collection-badge Collection_collection__3H6c8 ${tierColorClass(n)}"` +
                    ` title="${tooltip}">` +
                    `<span class="Collection_count__3oj-t"${colorStyle}>${formatCount(n)}</span></span>`
            );
        });
    }
}

const collectionFilters = new CollectionFilters();
collectionFilters.setupSettingListener();
export default collectionFilters;
