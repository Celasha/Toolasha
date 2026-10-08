/**
 * Guild Credit Value Display
 *
 * Injects cost-efficiency tables into guild credit exchange modals and shrine
 * upgrade modals. Shows both sell-side (opportunity cost) and buy-side
 * (acquisition cost) columns. Pricing mode is taken from the user's profit
 * calculation settings.
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { marketplaceSession, MARKETPLACE_OWNER } from '../../core/marketplace-session.js';
import { formatKMB } from '../../utils/formatters.js';
import { getItemPriceOutlierInfo } from '../../utils/market-data.js';
import {
    navigateToMarketplace,
    createMaterialTab,
    removeShrineMarketTabs,
    removeMaterialTabsForOwner,
    updateTabBadge,
    setupMarketplaceCleanupObserver,
    getVisibleMarketplaceTabContainer,
    watchNativeTabExit,
    isElementActuallyVisible,
    MARKETPLACE_REMOUNT_GRACE_MS,
    isMarketplaceMarketListingsSelected,
} from '../../utils/marketplace-tabs.js';
import { createAutofillManager } from '../../utils/marketplace-autofill.js';
import { getItemName, translateGameName } from '../../utils/game-i18n.js';
import { getItemHridFromIconHref } from '../../utils/game-lookups.js';
import { buildOutlierPriceWarningIcon } from '../../utils/warning-icon.js';
import { normalizeGuildShrineReturnLabel } from './guild-marketplace-label.js';
import {
    buildCheapestPerCredit,
    buildGuildTokenValueByCredit,
    GUILD_TOKEN_HRID,
} from '../../utils/guild-credit-conversion.js';
import { MARKET_TAX } from '../../utils/profit-constants.js';
import { setReactInputValue } from '../../utils/react-input.js';

/**
 * Check whether a marketplace tab label is the native "My Listings" tab. The label is
 * localized by the game (zh: 我的挂牌), so match the translated label too.
 * @param {string} text - Tab textContent
 * @returns {boolean}
 */
function isMyListingsTabLabel(text) {
    return (
        text.includes('My Listings') ||
        text.includes(translateGameName('marketplacePanel', 'myListings', 'My Listings'))
    );
}

function getVisibleGuildNavigationButton() {
    const buttons = new Set();
    for (const icon of document.querySelectorAll('svg[aria-label="navigationBar.guild"]')) {
        const button = icon.closest('[class*="NavigationBar_nav__"]');
        if (button && isElementActuallyVisible(button)) buttons.add(button);
    }
    return buttons.size === 1 ? buttons.values().next().value : null;
}

const CSS_CLASS = 'mwi-guild-credit-value';

// Mirrors the game's own MAX_GUILD_CREDIT_EXCHANGE_BATCH_COUNT constant (client_code
// main chunk), which caps the exchange modal's displayed "You give (Max: ...)" value.
const MAX_GUILD_CREDIT_EXCHANGE_BATCH_COUNT = 1_000_000;

/**
 * Find the give-item's conversion rate for the credit type currently open in the exchange
 * modal. Deliberately independent of market price data (unlike `rows` in _render, which
 * skips unpriced items) since filling "ALL" shouldn't depend on the item having a listing.
 * @param {Object} itemDetailMap
 * @param {string} creditHrid
 * @param {string} selectedItemName
 * @returns {{hrid: string, itemCount: number}|null}
 */
function findExchangeConversion(itemDetailMap, creditHrid, selectedItemName) {
    for (const [hrid, item] of Object.entries(itemDetailMap)) {
        if (item.name !== selectedItemName) continue;
        const conv = (item.guildCreditConversions || []).find((c) => c.creditItemHrid === creditHrid);
        if (conv) return { hrid, itemCount: conv.itemCount };
    }
    return null;
}

export { findExchangeConversion, MAX_GUILD_CREDIT_EXCHANGE_BATCH_COUNT };

/**
 * Build the "Gold cost per credit" ranking rows for a single credit type: one row per
 * tradeable item with a matching guildCreditConversions entry, plus a synthetic row for
 * Guild Token itself (unless disabled via includeToken). Guild Token has no market price of
 * its own, so without this it would be silently dropped by the price filter that keeps
 * unpriced junk items out of the ranking -- its "price" here is the opportunity cost of the
 * cheapest tradeable route to this same credit type, i.e. what you'd otherwise have to pay in
 * gold to get one more of this credit.
 * @param {Object} itemDetailMap
 * @param {string} creditHrid
 * @param {Object} [options]
 * @param {boolean} [options.includeToken=true] - gated by the guildTokenValueComparison setting
 * @returns {Array} rows in itemDetailMap iteration order (buildTbody sorts on demand)
 */
function buildCreditRows(itemDetailMap, creditHrid, { includeToken = true } = {}) {
    const {
        sell: cheapestSellAll,
        buy: cheapestBuyAll,
        sellOutlier,
        buyOutlier,
    } = buildCheapestPerCredit(itemDetailMap);
    const tokenSellRow = buildGuildTokenValueByCredit(itemDetailMap, cheapestSellAll, sellOutlier).find(
        (r) => r.creditItemHrid === creditHrid
    );
    const tokenBuyRow = buildGuildTokenValueByCredit(itemDetailMap, cheapestBuyAll, buyOutlier).find(
        (r) => r.creditItemHrid === creditHrid
    );
    const tokenAskGPC = tokenSellRow?.goldPerToken ?? null;
    const tokenBidGPC = tokenBuyRow?.goldPerToken ?? null;

    const rows = [];
    for (const [hrid, item] of Object.entries(itemDetailMap)) {
        const isToken = hrid === GUILD_TOKEN_HRID;
        if (isToken && !includeToken) continue;

        const conv = (item.guildCreditConversions || []).find((c) => c.creditItemHrid === creditHrid);
        if (!conv) continue;

        const sellInfo = isToken ? null : getItemPriceOutlierInfo(hrid, { mode: 'ask' });
        const buyInfo = isToken ? null : getItemPriceOutlierInfo(hrid, { mode: 'bid' });
        const sellPrice = isToken ? null : sellInfo.value;
        const buyPrice = isToken ? null : buyInfo.value;
        const sellGPC = isToken ? tokenAskGPC : sellPrice > 0 ? (sellPrice * conv.itemCount) / conv.creditCount : null;
        const buyGPC = isToken ? tokenBidGPC : buyPrice > 0 ? (buyPrice * conv.itemCount) / conv.creditCount : null;

        if (sellGPC === null && buyGPC === null) continue;

        rows.push({
            hrid,
            name: item.name,
            itemCount: conv.itemCount,
            creditCount: conv.creditCount,
            sellPrice,
            buyPrice,
            sellGPC,
            buyGPC,
            sellOutlier: isToken ? tokenSellRow?.isOutlier || false : sellInfo.isOutlier,
            buyOutlier: isToken ? tokenBuyRow?.isOutlier || false : buyInfo.isOutlier,
            isToken,
        });
    }
    return rows;
}

export { buildCreditRows };

function createGuildReturnTab(referenceTab, returnLabel, sessionId) {
    const returnTab = referenceTab.cloneNode(true);
    returnTab.setAttribute('data-mwi-custom-tab', 'true');
    returnTab.setAttribute('data-mwi-tab-owner', MARKETPLACE_OWNER.GUILD);
    // A custom tab must not duplicate the native tab/panel identity.
    returnTab.removeAttribute('id');
    returnTab.removeAttribute('aria-controls');
    returnTab.classList.remove('Mui-selected');
    returnTab.setAttribute('aria-selected', 'false');
    returnTab.setAttribute('tabindex', '-1');
    returnTab.setAttribute('aria-disabled', 'false');
    returnTab.style.cursor = 'pointer';
    returnTab.style.opacity = '1';
    returnTab.replaceChildren();

    const returnContent = document.createElement('div');
    returnContent.style.textAlign = 'center';
    const returnTitle = document.createElement('div');
    returnTitle.textContent = t('guildCreditValue.returnTabLabel');
    const returnSubtitle = document.createElement('div');
    returnSubtitle.style.cssText = 'font-size:0.75em;color:#60a5fa;';
    returnSubtitle.textContent = returnLabel || t('guildCreditValue.returnLabelFallback');
    returnContent.append(returnTitle, returnSubtitle);
    returnTab.appendChild(returnContent);

    returnTab.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!marketplaceSession.isActive(sessionId)) return;

        // Resolve the live navigation button at click time. The sidebar can remount
        // while Marketplace is open, so a button captured during tab creation may be detached.
        const guildButton = getVisibleGuildNavigationButton();
        if (!guildButton) {
            marketplaceSession.end(sessionId);
            return;
        }
        guildButton.click();
        marketplaceSession.end(sessionId);
    });

    return returnTab;
}

/**
 * Build top-N conversion options per credit type, ranked by ask/credit ascending.
 * @param {Object} itemDetailMap
 * @param {number} n
 * @returns {Object} Map of creditHrid → array of up to n options
 */
function buildTopConversions(itemDetailMap, n) {
    const byCredit = {};
    for (const [hrid, item] of Object.entries(itemDetailMap)) {
        for (const conv of item.guildCreditConversions || []) {
            const creditHrid = conv.creditItemHrid;
            const askInfo = getItemPriceOutlierInfo(hrid, { mode: 'ask' });
            const bidInfo = getItemPriceOutlierInfo(hrid, { mode: 'bid' });
            const askPrice = askInfo.value;
            const bidPrice = bidInfo.value;
            if (!askPrice && !bidPrice) continue;
            const askGPC = askPrice > 0 ? (askPrice * conv.itemCount) / conv.creditCount : null;
            const bidGPC = bidPrice > 0 ? (bidPrice * conv.itemCount) / conv.creditCount : null;
            if (!byCredit[creditHrid]) byCredit[creditHrid] = [];
            byCredit[creditHrid].push({
                hrid,
                name: item.name,
                itemCount: conv.itemCount,
                creditCount: conv.creditCount,
                askPrice,
                bidPrice,
                askGPC,
                bidGPC,
                askOutlier: askInfo.isOutlier,
                bidOutlier: bidInfo.isOutlier,
            });
        }
    }
    for (const creditHrid of Object.keys(byCredit)) {
        byCredit[creditHrid].sort((a, b) => {
            if (a.askGPC === null && b.askGPC === null) return 0;
            if (a.askGPC === null) return 1;
            if (b.askGPC === null) return -1;
            return a.askGPC - b.askGPC;
        });
        byCredit[creditHrid] = byCredit[creditHrid].slice(0, n);
    }
    return byCredit;
}

class GuildCreditValue {
    constructor() {
        this.initialized = false;
        this.unregisterObservers = [];
        this.autofillManager = createAutofillManager('GuildCreditValue-MissingMats');
        this._shrineTabCleanup = null;
        this._guildSessionId = null;
        this._guildCleanupObserver = null;
        this._guildInventoryHandler = null;
        this._guildActiveWorkflowModel = null;
    }

    teardownGuildMarketplaceSession() {
        const sessionId = this._guildSessionId;
        this._guildSessionId = null;
        removeMaterialTabsForOwner(MARKETPLACE_OWNER.GUILD);
        // Also remove shrine tabs (they have a different attribute)
        document.querySelectorAll('[data-mwi-shrine-tab="true"]').forEach((el) => el.remove());
        if (this._guildInventoryHandler) {
            dataManager.off('items_updated', this._guildInventoryHandler);
            this._guildInventoryHandler = null;
        }
        if (this._guildCleanupObserver) {
            this._guildCleanupObserver();
            this._guildCleanupObserver = null;
        }
        if (this._shrineTabCleanup) {
            this._shrineTabCleanup();
            this._shrineTabCleanup = null;
        }
        this._guildActiveWorkflowModel = null;
        this.autofillManager.exitSession(sessionId);
    }

    _reinjectGuildMarketplaceTabs(tabContainer, capturedSessionId) {
        const model = this._guildActiveWorkflowModel;
        if (!model || model.sessionId !== capturedSessionId || !marketplaceSession.isActive(capturedSessionId)) {
            return false;
        }

        removeMaterialTabsForOwner(MARKETPLACE_OWNER.GUILD);
        document.querySelectorAll('[data-mwi-shrine-tab="true"]').forEach((el) => el.remove());

        const referenceTab = Array.from(tabContainer.children).find((btn) => isMyListingsTabLabel(btn.textContent));
        if (!referenceTab) return false;

        tabContainer.style.flexWrap = 'wrap';
        const scroller = tabContainer.closest('[class*="MuiTabs-scroller"]');
        const muiRoot = scroller?.closest('[class*="MuiTabs-root"]');
        if (scroller) scroller.style.overflow = 'visible';
        if (muiRoot) muiRoot.style.height = 'auto';

        for (const mat of model.materials) {
            const capturedMat = mat;
            const tab = createMaterialTab(
                { ...mat, itemName: getItemName(mat.itemHrid, mat.itemName) },
                referenceTab,
                (_e, m) => {
                    if (!marketplaceSession.isActive(capturedSessionId)) return;
                    const currentModel = this._guildActiveWorkflowModel;
                    const entry = currentModel?.materials.find((e) => e.itemHrid === capturedMat.itemHrid);
                    const armed = this.autofillManager.arm({
                        sessionId: capturedSessionId,
                        itemHrid: m.itemHrid,
                        enhancementLevel: 0,
                        modalMode: 'buy',
                        quantityProvider: () => entry?.missing ?? 0,
                    });
                    if (!armed || !navigateToMarketplace(m.itemHrid, 0)) {
                        marketplaceSession.end(capturedSessionId);
                    }
                },
                MARKETPLACE_OWNER.GUILD
            );
            tab.setAttribute('data-required-quantity', mat.required.toString());
            tab.setAttribute('data-item-name', mat.itemName);
            tabContainer.appendChild(tab);
        }

        if (!getVisibleGuildNavigationButton()) return false;
        tabContainer.appendChild(createGuildReturnTab(referenceTab, model.returnLabel, capturedSessionId));

        if (this._shrineTabCleanup) this._shrineTabCleanup();
        this._shrineTabCleanup = watchNativeTabExit(tabContainer, () => {
            marketplaceSession.end(capturedSessionId);
        });
        return true;
    }

    initialize() {
        if (this.initialized) return;

        this.autofillManager.initialize();

        const unregister = domObserver.onClass('GuildCreditValue', 'GuildPanel_exchangeModalContent', (el) =>
            this._render(el)
        );
        this.unregisterObservers.push(unregister);

        const unregisterShrine = domObserver.onClass('GuildCreditValue-Shrine', 'GuildPanel_guildModalContent', (el) =>
            this._renderShrine(el)
        );
        this.unregisterObservers.push(unregisterShrine);

        const unregisterTrial = domObserver.onClass('GuildCreditValue-Trial', 'GuildPanel_signupModal', (el) =>
            this._renderTrialSignup(el)
        );
        this.unregisterObservers.push(unregisterTrial);

        const unregisterTileSummary = domObserver.onClass(
            'GuildCreditValue-TileSummary',
            'GuildPanel_tileSummary',
            (el) => this._renderTrialTier(el)
        );
        this.unregisterObservers.push(unregisterTileSummary);

        this.initialized = true;
    }

    _render(modalEl) {
        if (!config.getSetting('guildCreditValue', true)) return;

        modalEl.querySelectorAll(`.${CSS_CLASS}`).forEach((el) => el.remove());

        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        const titleEl = modalEl.querySelector('[class*="GuildPanel_header"]');
        const titleText = titleEl?.textContent?.trim() || '';
        if (!titleText) return;

        // The modal title is rendered in the game's current language, while itemDetailMap
        // names are English — match both the raw name and its in-game translation.
        const creditHrid = Object.keys(gameData.itemDetailMap || {}).find((hrid) => {
            if (!hrid.includes('guild_credit')) return false;
            const name = gameData.itemDetailMap[hrid].name;
            return name === titleText || getItemName(hrid, name) === titleText;
        });
        if (!creditHrid) return;

        const rows = buildCreditRows(gameData.itemDetailMap, creditHrid, {
            includeToken: config.getSetting('guildTokenValueComparison', true),
        });

        if (rows.length === 0) return;

        const exchangeBtn = modalEl.querySelector('button');
        if (!exchangeBtn) return;

        let sortKey = 'ask';

        const buildTbody = () => {
            const sorted = [...rows].sort((a, b) => {
                const aVal = sortKey === 'bid' ? a.buyGPC : a.sellGPC;
                const bVal = sortKey === 'bid' ? b.buyGPC : b.sellGPC;
                if (aVal === null && bVal === null) return 0;
                if (aVal === null) return 1;
                if (bVal === null) return -1;
                return aVal - bVal;
            });
            const tbody = document.createElement('tbody');
            sorted.forEach((row, i) => {
                const isTop = i === 0;
                const tr = document.createElement('tr');
                tr.style.cssText = `border-bottom:1px solid rgba(255,255,255,0.05); color:${isTop ? '#4ade80' : '#e0e0e0'};`;
                const rate = row.creditCount === 1 ? `${row.itemCount} → 1` : `${row.itemCount} → ${row.creditCount}`;
                const localizedName = getItemName(row.hrid, row.name);
                const nameDisplay = row.isToken
                    ? `${localizedName} <span style="color:#6b7280;font-size:9px;">${t('guildCreditValue.tokensLabel')}</span>`
                    : localizedName;
                tr.innerHTML = `
                <td style="padding:4px 6px; text-align:left;">${nameDisplay}</td>
                <td style="padding:4px 6px; text-align:center; color:#9ca3af;">${rate}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.sellPrice ? formatKMB(row.sellPrice) + buildOutlierPriceWarningIcon(row.sellOutlier) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buyPrice ? formatKMB(row.buyPrice) + buildOutlierPriceWarningIcon(row.buyOutlier) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; ${sortKey === 'bid' ? 'color:#9ca3af;' : `font-weight:${isTop ? '700' : '400'};`}">${row.sellGPC ? formatKMB(row.sellGPC) + buildOutlierPriceWarningIcon(row.sellOutlier) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; ${sortKey === 'ask' ? 'color:#9ca3af;' : `font-weight:${isTop ? '700' : '400'};`}">${row.buyGPC ? formatKMB(row.buyGPC) + buildOutlierPriceWarningIcon(row.buyOutlier) : '–'}</td>
            `;
                tbody.appendChild(tr);
            });
            return tbody;
        };

        const wrapper = document.createElement('div');
        wrapper.className = CSS_CLASS;
        wrapper.style.cssText = 'margin-top:12px; font-size:12px; width:100%; max-height:260px; overflow-y:auto;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; color:#9ca3af; margin-bottom:6px; text-align:center;';
        hdr.textContent = t('guildCreditValue.rankingHeader');
        wrapper.appendChild(hdr);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse;';

        const thead = document.createElement('thead');
        const thRow = document.createElement('tr');
        thRow.style.cssText = 'font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);';

        [
            { text: t('guildCreditValue.columnItem'), align: 'left' },
            { text: t('guildCreditValue.columnRate'), align: 'center' },
            { text: t('guildCreditValue.columnAskEach'), align: 'right' },
            { text: t('guildCreditValue.columnBidEach'), align: 'right' },
        ].forEach(({ text, align }) => {
            const th = document.createElement('th');
            th.style.cssText = `text-align:${align}; padding:3px 6px; font-weight:500; color:#6b7280;`;
            th.textContent = text;
            thRow.appendChild(th);
        });

        const askTh = document.createElement('th');
        askTh.textContent = t('guildCreditValue.columnAskPerCredit');
        const bidTh = document.createElement('th');
        bidTh.textContent = t('guildCreditValue.columnBidPerCredit');
        thRow.appendChild(askTh);
        thRow.appendChild(bidTh);
        thead.appendChild(thRow);
        table.appendChild(thead);

        const updateThStyles = () => {
            const isAsk = sortKey === 'ask';
            const active = 'font-weight:600; color:#e0e0e0; text-decoration:underline;';
            const inactive = 'font-weight:500; color:#6b7280;';
            askTh.style.cssText = `text-align:right; padding:3px 6px; cursor:pointer; ${isAsk ? active : inactive}`;
            bidTh.style.cssText = `text-align:right; padding:3px 6px; cursor:pointer; ${!isAsk ? active : inactive}`;
        };
        updateThStyles();

        let currentTbody = buildTbody();
        table.appendChild(currentTbody);

        const setSort = (key) => {
            sortKey = key;
            updateThStyles();
            const newTbody = buildTbody();
            table.replaceChild(newTbody, currentTbody);
            currentTbody = newTbody;
        };

        askTh.addEventListener('click', () => setSort('ask'));
        bidTh.addEventListener('click', () => setSort('bid'));

        wrapper.appendChild(table);

        if (rows.some((row) => row.isToken)) {
            const tokenNote = document.createElement('div');
            tokenNote.style.cssText = 'font-size:10px; color:#6b7280; margin-top:4px; text-align:center;';
            tokenNote.textContent = t('guildCreditValue.tokenValueNote');
            wrapper.appendChild(tokenNote);
        }

        exchangeBtn.insertAdjacentElement('afterend', wrapper);

        // Exchange advisor — initial render + re-render on item selection change
        if (config.getSetting('guildCreditExchangeAdvisor', true)) {
            this._renderExchangeAdvisor(modalEl, creditHrid, rows);

            const itemSelector = modalEl.querySelector('[class*="ItemSelector_itemContainer"]');
            if (itemSelector) {
                const observer = new MutationObserver(() => {
                    this._renderExchangeAdvisor(modalEl, creditHrid, rows);
                    this._renderExchangeAllButton(modalEl, creditHrid);
                });
                observer.observe(itemSelector, { subtree: true, childList: true, attributes: true });
            }
        }

        // "ALL" quick-fill button — the two quantity inputs only exist once an item is
        // selected, so this also needs the initial call here (covers a pre-selected item).
        this._renderExchangeAllButton(modalEl, creditHrid);

        // Shrine upgrade planner
        if (config.getSetting('guildShrineUpgradePlanner', true)) {
            this._renderShrinePlanner(modalEl);
        }
    }

    _renderShrinePlanner(modalEl) {
        modalEl.querySelectorAll('.mwi-shrine-planner').forEach((el) => el.remove());

        const gameData = dataManager.getInitClientData();
        if (!gameData?.guildBuffDetailMap) return;

        // Group buffs by shrine
        const byShrine = {};
        for (const [buffHrid, buff] of Object.entries(gameData.guildBuffDetailMap)) {
            const shrineHrid = buff.shrineHrid;
            if (!byShrine[shrineHrid]) byShrine[shrineHrid] = [];
            byShrine[shrineHrid].push({ buffHrid, buff });
        }
        if (Object.keys(byShrine).length === 0) return;

        const SHRINE_LABELS = {
            '/guild_shrines/force': t('guildCreditValue.shrineForce'),
            '/guild_shrines/tempo': t('guildCreditValue.shrineTempo'),
            '/guild_shrines/rarity': t('guildCreditValue.shrineRarity'),
            '/guild_shrines/scholar': t('guildCreditValue.shrineScholar'),
            '/guild_shrines/spirit': t('guildCreditValue.shrineSpirit'),
        };

        // Aggregate total costs across all target levels selected
        const aggregateCosts = (plans) => {
            const tokens = { total: 0 };
            const credits = {};
            for (const { buffHrid, fromLevel, toLevel } of plans) {
                const levelCosts = gameData.guildBuffDetailMap[buffHrid]?.levelCosts || {};
                for (let lvl = fromLevel + 1; lvl <= toLevel; lvl++) {
                    const cost = levelCosts[String(lvl)];
                    if (!cost) continue;
                    tokens.total += cost.guildTokenCost || 0;
                    for (const { itemHrid, count } of cost.creditCosts || []) {
                        credits[itemHrid] = (credits[itemHrid] || 0) + count;
                    }
                }
            }
            return { tokens, credits };
        };

        const wrapper = document.createElement('div');
        wrapper.className = 'mwi-shrine-planner';
        wrapper.style.cssText = 'margin-top:10px; font-size:12px; width:100%;';

        // Collapsible header
        const header = document.createElement('div');
        header.style.cssText = `
        display:flex; justify-content:space-between; align-items:center;
        padding:5px 6px; background:rgba(255,255,255,0.04); border-radius:4px;
        cursor:pointer; font-size:11px; color:#9ca3af; user-select:none;
        border:1px solid rgba(255,255,255,0.08); margin-bottom:4px;
    `;
        const headerTitle = document.createElement('span');
        headerTitle.textContent = t('guildCreditValue.shrinePlannerHeader');
        const headerArrow = document.createElement('span');
        headerArrow.textContent = '▶';
        header.appendChild(headerTitle);
        header.appendChild(headerArrow);
        wrapper.appendChild(header);

        const body = document.createElement('div');
        body.style.display = 'none';
        wrapper.appendChild(body);

        header.addEventListener('click', () => {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            headerArrow.textContent = isOpen ? '▶' : '▼';
        });

        // Track target inputs for cost recalculation
        const planInputs = []; // [{buffHrid, currentLevel, capLevel, inputEl}]

        const totalsEl = document.createElement('div');
        totalsEl.style.cssText =
            'margin-top:8px; padding:6px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2);';

        const recalculate = () => {
            const plans = planInputs
                .map(({ buffHrid, currentLevel, inputEl }) => ({
                    buffHrid,
                    fromLevel: currentLevel,
                    toLevel: Math.min(parseInt(inputEl.value, 10) || currentLevel, parseInt(inputEl.max, 10)),
                }))
                .filter(({ fromLevel, toLevel }) => toLevel > fromLevel);

            totalsEl.innerHTML = '';

            if (plans.length === 0) {
                totalsEl.innerHTML = `<div style="color:#6b7280; text-align:center; font-size:11px;">${t('guildCreditValue.shrinePlannerEmptyHint')}</div>`;
                return;
            }

            const { tokens, credits } = aggregateCosts(plans);
            const itemDetailMap = gameData.itemDetailMap || {};

            const titleEl = document.createElement('div');
            titleEl.style.cssText = 'color:#9ca3af; font-size:11px; margin-bottom:6px;';
            titleEl.textContent = t('guildCreditValue.shrinePlannerTotalCostTitle');
            totalsEl.appendChild(titleEl);

            // Guild tokens row
            if (tokens.total > 0) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; padding:2px 0; font-size:12px;';
                row.innerHTML = `<span style="color:#aaa;">${t('guildCreditValue.guildTokensLabel')}</span><span style="color:#e0e0e0; font-weight:600;">${tokens.total.toLocaleString()}</span>`;
                totalsEl.appendChild(row);
            }

            // Credit costs
            for (const [itemHrid, count] of Object.entries(credits)) {
                const name = getItemName(itemHrid, itemDetailMap[itemHrid]?.name || itemHrid.split('/').pop());
                const priceInfo = getItemPriceOutlierInfo(itemHrid, { mode: 'ask' });
                const price = priceInfo.value;
                const goldStr =
                    price > 0
                        ? ` (${formatKMB(price * count)}${buildOutlierPriceWarningIcon(priceInfo.isOutlier)})`
                        : '';
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; padding:2px 0; font-size:12px;';
                row.innerHTML = `<span style="color:#aaa;">${name}</span><span style="color:#e0e0e0; font-weight:600;">${count.toLocaleString()}<span style="color:#6b7280; font-weight:400;">${goldStr}</span></span>`;
                totalsEl.appendChild(row);
            }
        };

        // Build rows per shrine
        for (const [shrineHrid, buffs] of Object.entries(byShrine).sort()) {
            const shrineLabel = SHRINE_LABELS[shrineHrid] || shrineHrid.split('/').pop();
            const shrineCapLevel = dataManager.getGuildBuildingLevel(shrineHrid);

            const shrineSection = document.createElement('div');
            shrineSection.style.cssText = 'margin-bottom:6px;';

            const shrineTitleEl = document.createElement('div');
            shrineTitleEl.style.cssText =
                'color:#c4b5fd; font-size:11px; font-weight:600; margin-bottom:3px; padding:2px 0;';
            shrineTitleEl.textContent = t('guildCreditValue.shrineSectionTitle', {
                shrine: shrineLabel,
                cap: shrineCapLevel > 0 ? shrineCapLevel : null,
            });
            shrineSection.appendChild(shrineTitleEl);

            for (const { buffHrid, buff } of buffs.sort((a, b) => a.buffHrid.localeCompare(b.buffHrid))) {
                const isCombat = buff.isCombat;
                const buffLabel = isCombat
                    ? t('guildCreditValue.buffLabelCombat')
                    : t('guildCreditValue.buffLabelSkilling');
                const currentLevel = dataManager.getCharacterGuildBuffLevel(buffHrid);
                const maxLevel = Math.max(...Object.keys(buff.levelCosts).map(Number));
                const capLevel = shrineCapLevel > 0 ? Math.min(shrineCapLevel, maxLevel) : maxLevel;

                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:2px 0; font-size:11px;';

                const label = document.createElement('span');
                label.style.cssText = 'flex:1; color:#9ca3af;';
                label.textContent = t('guildCreditValue.buffRowLabel', { buffLabel, level: currentLevel });

                const input = document.createElement('input');
                input.type = 'number';
                input.min = String(currentLevel);
                input.max = String(capLevel);
                input.value = String(currentLevel);
                input.style.cssText = `
                width:52px; padding:2px 4px; background:#1a1a2e; border:1px solid #374151;
                border-radius:3px; color:#e0e0e0; font-size:11px; text-align:center;
            `;
                input.addEventListener('input', recalculate);

                const capLabel = document.createElement('span');
                capLabel.style.cssText = 'color:#4b5563; font-size:10px;';
                capLabel.textContent = `/ ${capLevel}`;

                row.appendChild(label);
                row.appendChild(input);
                row.appendChild(capLabel);
                shrineSection.appendChild(row);

                planInputs.push({ buffHrid, currentLevel, capLevel, inputEl: input });
            }

            body.appendChild(shrineSection);
        }

        body.appendChild(totalsEl);
        recalculate();

        // Insert after the advisor (or after the ranking table if no advisor)
        const advisorEl = modalEl.querySelector('.mwi-exchange-advisor');
        const rankingEl = modalEl.querySelector(`.${CSS_CLASS}`);
        const insertAfter = advisorEl || rankingEl;
        insertAfter?.insertAdjacentElement('afterend', wrapper);
    }

    /**
     * Resolve the selected item HRID from the modal's ItemSelector SVG.
     * Uses the `<use href>` fragment (locale-independent) rather than the
     * aria-label (which is localized and breaks name→HRID matching in non-English
     * clients). Falls back to the aria-label name lookup for older DOM shapes.
     * @param {Element} modalEl - The modal content element
     * @returns {string|null} Item HRID or null
     */
    _getSelectedItemHrid(modalEl) {
        const selectorContainer = modalEl.querySelector('[class*="ItemSelector_itemContainer"]');
        if (!selectorContainer) return null;
        const useEl = selectorContainer.querySelector('use');
        const href = useEl?.getAttribute('href') || useEl?.getAttribute('xlink:href') || '';
        return getItemHridFromIconHref(href);
    }

    _renderExchangeAdvisor(modalEl, creditHrid, rows) {
        modalEl.querySelectorAll('.mwi-exchange-advisor').forEach((el) => el.remove());

        // Resolve the selected item HRID from the icon's sprite href (locale-independent)
        const selectedItemHrid = this._getSelectedItemHrid(modalEl);

        // Read batch quantity
        const quantityInput = modalEl.querySelector('input[type="number"]');
        const batches = Math.max(1, parseInt(quantityInput?.value || '1', 10) || 1);

        // Find best and selected rows (rows are pre-built from _render)
        const validRows = rows.filter((r) => r.sellGPC !== null || r.buyGPC !== null);
        if (validRows.length === 0) return;

        const bestRow = [...validRows].sort((a, b) => {
            const aVal = a.sellGPC ?? Infinity;
            const bVal = b.sellGPC ?? Infinity;
            return aVal - bVal;
        })[0];

        const advisor = document.createElement('div');
        advisor.className = 'mwi-exchange-advisor';
        advisor.style.cssText = `
        margin-top:8px; padding:8px 10px; border-radius:6px; font-size:12px;
        border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.2);
    `;

        if (!selectedItemHrid) {
            // No item selected yet
            advisor.innerHTML = `<div style="color:#6b7280; text-align:center;">${t('guildCreditValue.advisorSelectItemHint')}</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        const selectedRow = validRows.find((r) => r.hrid === selectedItemHrid);

        if (!selectedRow) {
            // Item in modal has no conversion for this credit type
            advisor.innerHTML = `<div style="color:#6b7280; text-align:center;">${t('guildCreditValue.advisorNoConversionHint')}</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        if (selectedRow === bestRow) {
            advisor.style.borderColor = 'rgba(74,222,128,0.4)';
            advisor.innerHTML = `<div style="color:#4ade80; font-weight:600; text-align:center;">${t('guildCreditValue.advisorOptimalChoice')}</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        // Calculate sell → rebuy scenario
        const SELLER_TAX = MARKET_TAX;
        const sellPrice = selectedRow.buyPrice; // bid price = what market will buy at
        const directCredits = batches * selectedRow.creditCount;

        if (!sellPrice || sellPrice <= 0 || !bestRow.sellPrice || bestRow.sellPrice <= 0) {
            const bestName = `<b style="color:#e0e0e0;">${getItemName(bestRow.hrid, bestRow.name)}</b>`;
            advisor.innerHTML = `<div style="color:#6b7280; text-align:center;">${t('guildCreditValue.advisorNoPriceData', { name: bestName })}</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        const gross = batches * selectedRow.itemCount * sellPrice;
        const tax = Math.floor(gross * SELLER_TAX);
        const net = gross - tax;

        // How many batches of the best item can we buy with net proceeds?
        const bestBatchCost = bestRow.itemCount * bestRow.sellPrice;
        const bestBatches = Math.floor(net / bestBatchCost);
        const bestCredits = bestBatches * bestRow.creditCount;
        const creditDiff = bestCredits - directCredits;

        const diffColor = creditDiff > 0 ? '#4ade80' : '#ff6b6b';
        const diffSign = creditDiff > 0 ? '+' : '';
        const diffLabel =
            creditDiff > 0 ? t('guildCreditValue.advisorBetterLabel') : t('guildCreditValue.advisorWorseLabel');

        advisor.style.borderColor = creditDiff > 0 ? 'rgba(74,222,128,0.3)' : 'rgba(255,107,107,0.3)';
        advisor.innerHTML = `
        <div style="color:#9ca3af; margin-bottom:6px; font-size:11px;">${t('guildCreditValue.advisorSellRebuyHeader', { taxPercent: SELLER_TAX * 100 })}</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
            <span style="color:#aaa;">${t('guildCreditValue.advisorDirectExchangeLabel')}</span>
            <span style="color:#e0e0e0; font-weight:600;">${t('guildCreditValue.creditsAmount', { amount: directCredits.toLocaleString() })}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
            <span style="color:#aaa;">${t('guildCreditValue.advisorSellProceedsLabel')}</span>
            <span style="color:#e0e0e0;">${formatKMB(net)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:#aaa;">${t('guildCreditValue.advisorBuyLabel', { name: `<b style="color:#e0e0e0;">${getItemName(bestRow.hrid, bestRow.name)}</b>` })}</span>
            <span style="color:#e0e0e0; font-weight:600;">${t('guildCreditValue.creditsAmount', { amount: bestCredits.toLocaleString() })}</span>
        </div>
        <div style="display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px;">
            <span style="color:#aaa;">${t('guildCreditValue.advisorDifferenceLabel')}</span>
            <span style="color:${diffColor}; font-weight:700;">${t('guildCreditValue.differenceValue', { sign: diffSign, amount: creditDiff.toLocaleString(), label: diffLabel })}</span>
        </div>
    `;

        modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
    }

    /**
     * Inject an "ALL" button next to the "You give" quantity input that fills it with the
     * maximum the player can exchange (owned count floored to a whole batch), matching the
     * game's own "You give (Max: ...)" label exactly.
     * @param {HTMLElement} modalEl
     * @param {string} creditHrid
     */
    _renderExchangeAllButton(modalEl, creditHrid) {
        modalEl.querySelectorAll('.mwi-guild-exchange-all-btn').forEach((el) => el.remove());

        // The "You give"/"You receive" fields render as type="text" inputs sharing the shared
        // Input component's class (verified via live DOM: `Input_input__<hash>`), NOT
        // type="number" — the Shrine Upgrade Planner injected lower in this same modal owns
        // the type="number" inputs instead. Fixed JSX order: give-input first, receive second.
        const giveInput = modalEl.querySelectorAll('input[class*="Input_input"]')[0];
        if (!giveInput) return;

        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        // Resolve the selected item HRID from the icon's sprite href (locale-independent)
        const selectedItemHrid = this._getSelectedItemHrid(modalEl);
        if (!selectedItemHrid) return;

        const itemDetail = gameData.itemDetailMap?.[selectedItemHrid];
        const conv = (itemDetail?.guildCreditConversions || []).find((c) => c.creditItemHrid === creditHrid);
        if (!conv) return;
        const conversion = { hrid: selectedItemHrid, itemCount: conv.itemCount };

        const inventory = dataManager.getInventory() || [];
        const owned = inventory
            .filter(
                (item) => item.itemHrid === conversion.hrid && item.itemLocationHrid === '/item_locations/inventory'
            )
            .reduce((sum, item) => sum + (item.count || 0), 0);

        const maxBatches = Math.min(Math.floor(owned / conversion.itemCount), MAX_GUILD_CREDIT_EXCHANGE_BATCH_COUNT);
        const maxUnits = maxBatches * conversion.itemCount;
        if (maxUnits <= 0) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mwi-guild-exchange-all-btn';
        btn.textContent = t('guildCreditValue.allButtonLabel');
        btn.title = t('guildCreditValue.fillMaxTooltip', { amount: maxUnits.toLocaleString() });
        btn.style.cssText = `
            flex-shrink: 0; padding: 6px 10px; font-size: 12px; font-weight: 700;
            border-radius: 6px; border: none; background: #6366f1; color: #fff;
            cursor: pointer; line-height: 1;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#4f46e5';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#6366f1';
        });
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setReactInputValue(giveInput, maxUnits);
        });

        // Put the button and the input's own generic wrapper side by side in the same cell
        // (one level up from the input) so it sits inline to the left, matching the native
        // Marketplace quantity row's Min/-/+/Max buttons rather than floating above the input.
        const inputCell = giveInput.parentElement?.parentElement;
        if (!inputCell) return;
        inputCell.style.display = 'flex';
        inputCell.style.alignItems = 'center';
        inputCell.style.gap = '6px';
        inputCell.insertBefore(btn, inputCell.firstChild);
    }

    _renderTrialSignup(modalEl) {
        modalEl.querySelectorAll('.mwi-trial-copy-btn').forEach((el) => el.remove());

        const memberList = modalEl.querySelector('[class*="GuildPanel_memberList"]');
        if (!memberList) return;

        const buttonsContainer = modalEl.querySelector('[class*="GuildPanel_buttonsContainer"]');
        if (!buttonsContainer) return;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'mwi-trial-copy-btn';
        copyBtn.style.cssText = `
        width:100%; padding:8px 12px; margin-bottom:6px;
        background:linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%);
        color:#fff; border:1px solid rgba(91,141,239,0.4); border-radius:6px;
        cursor:pointer; font-size:12px; font-weight:600;
    `;
        copyBtn.textContent = t('guildCreditValue.copyListButtonLabel');
        copyBtn.addEventListener('mouseenter', () => {
            copyBtn.style.background = 'linear-gradient(180deg,rgba(91,141,239,0.35) 0%,rgba(91,141,239,0.25) 100%)';
        });
        copyBtn.addEventListener('mouseleave', () => {
            copyBtn.style.background = 'linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%)';
        });
        copyBtn.addEventListener('click', async () => {
            const names = Array.from(memberList.querySelectorAll('[class*="GuildPanel_memberName"]'))
                .map((el) => el.textContent.trim())
                .filter(Boolean)
                .join('\n');
            if (!names) return;
            try {
                await navigator.clipboard.writeText(names);
                copyBtn.textContent = t('guildCreditValue.copiedButtonLabel');
                setTimeout(() => {
                    copyBtn.textContent = t('guildCreditValue.copyListButtonLabel');
                }, 1500);
            } catch (error) {
                console.error('[GuildCreditValue] Failed to copy member list:', error);
            }
        });

        buttonsContainer.insertAdjacentElement('beforebegin', copyBtn);
    }

    _renderShrine(modalEl) {
        if (!config.getSetting('guildCreditValue', true)) return;

        modalEl.querySelectorAll('.mwi-shrine-cost').forEach((el) => el.remove());

        const requirements = modalEl.querySelector('[class*="GuildPanel_itemRequirements"]');
        if (!requirements) return;

        const upgradeBtn = modalEl.querySelector('button');
        if (!upgradeBtn) return;

        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        // Preserve the shrine's native domain label while normalising textContent's
        // camel-case concatenation: ForceCombatLevel -> Force Combat Level and
        // SpiritSkillingLevel -> Spirit Skilling Level.
        const shrineReturnLabel = normalizeGuildShrineReturnLabel(modalEl.textContent);

        const topConversions = buildTopConversions(gameData.itemDetailMap, 3);
        // Still need cheapest sell/buy for the credit row's own cost columns
        const {
            sell: cheapestSell,
            buy: cheapestBuy,
            sellOutlier: cheapestSellOutlier,
            buyOutlier: cheapestBuyOutlier,
        } = buildCheapestPerCredit(gameData.itemDetailMap);

        const itemContainers = Array.from(requirements.querySelectorAll('[class*="Item_itemContainer"]'));
        const inputCounts = Array.from(requirements.querySelectorAll('[class*="GuildPanel_inputCount"]'));
        if (itemContainers.length === 0) return;

        const inventory = dataManager.getInventory();
        const rows = [];
        let totalSell = 0;
        let totalBuy = 0;
        let allSellPriced = true;
        let allBuyPriced = true;

        itemContainers.forEach((container, i) => {
            const use = container.querySelector('use');
            const spriteId = use?.getAttribute('href')?.split('#')[1];
            if (!spriteId) return;

            const itemHrid = `/items/${spriteId}`;
            const required = parseInt(inputCounts[i]?.textContent?.replace(/[^0-9]/g, '') || '', 10) || 0;
            const owned = inventory
                .filter((inv) => inv.itemHrid === itemHrid && inv.itemLocationHrid === '/item_locations/inventory')
                .reduce((sum, inv) => sum + (inv.count || 0), 0);
            const effectiveRequired = Math.max(0, required - owned);
            const itemName = gameData.itemDetailMap?.[itemHrid]?.name || spriteId.replace(/_/g, ' ');
            const isToken = itemHrid.includes('guild_token');
            const isCredit = itemHrid.includes('guild_credit');

            const sellInfo = getItemPriceOutlierInfo(itemHrid, { mode: 'ask' });
            const buyInfo = getItemPriceOutlierInfo(itemHrid, { mode: 'bid' });
            let sellEach = sellInfo.value;
            let buyEach = buyInfo.value;
            let sellEachOutlier = sellInfo.isOutlier;
            let buyEachOutlier = buyInfo.isOutlier;

            if (isCredit) {
                if (!sellEach || sellEach <= 0) {
                    sellEach = cheapestSell[itemHrid] || null;
                    sellEachOutlier = cheapestSellOutlier[itemHrid] || false;
                }
                if (!buyEach || buyEach <= 0) {
                    buyEach = cheapestBuy[itemHrid] || null;
                    buyEachOutlier = cheapestBuyOutlier[itemHrid] || false;
                }
            }

            let sellSub = sellEach && effectiveRequired ? sellEach * effectiveRequired : null;
            let buySub = buyEach && effectiveRequired ? buyEach * effectiveRequired : null;
            let sellSubOutlier = sellEachOutlier;
            let buySubOutlier = buyEachOutlier;

            if (isCredit && effectiveRequired > 0) {
                const creditOptions = topConversions[itemHrid] || [];
                const askTop = creditOptions.find((o) => o.askGPC !== null);
                const bidTop = [...creditOptions].sort((a, b) => {
                    if (a.bidGPC === null) return 1;
                    if (b.bidGPC === null) return -1;
                    return a.bidGPC - b.bidGPC;
                })[0];
                sellSub = askTop?.askPrice
                    ? Math.ceil(effectiveRequired / askTop.creditCount) * askTop.itemCount * askTop.askPrice
                    : null;
                sellSubOutlier = askTop?.askOutlier || false;
                buySub = bidTop?.bidPrice
                    ? Math.ceil(effectiveRequired / bidTop.creditCount) * bidTop.itemCount * bidTop.bidPrice
                    : null;
                buySubOutlier = bidTop?.bidOutlier || false;
            }

            if (sellSub !== null) totalSell += sellSub;
            else if (!isToken && effectiveRequired > 0) allSellPriced = false;

            if (buySub !== null) totalBuy += buySub;
            else if (!isToken && effectiveRequired > 0) allBuyPriced = false;

            rows.push({
                itemHrid,
                itemName,
                required,
                effectiveRequired,
                owned,
                sellEach,
                buyEach,
                sellSub,
                buySub,
                sellEachOutlier,
                buyEachOutlier,
                sellSubOutlier,
                buySubOutlier,
                isCredit,
                creditHrid: isCredit ? itemHrid : null,
            });
        });

        if (rows.length === 0) return;

        let sortKey = 'ask';

        const buildTbody = () => {
            const tbody = document.createElement('tbody');
            rows.forEach((row) => {
                const tr = document.createElement('tr');
                tr.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.05); color:#e0e0e0;';
                tr.innerHTML = `
                <td style="padding:4px 6px; text-align:left;">${getItemName(row.itemHrid, row.itemName)}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.effectiveRequired.toLocaleString()}${row.owned > 0 ? ` <span style="color:#6b7280;font-size:10px;">${t('guildCreditValue.ownedSuffix', { count: row.owned.toLocaleString() })}</span>` : ''}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.sellEach ? formatKMB(row.sellEach) + buildOutlierPriceWarningIcon(row.sellEachOutlier) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buyEach ? formatKMB(row.buyEach) + buildOutlierPriceWarningIcon(row.buyEachOutlier) : '–'}</td>
                <td style="padding:4px 6px; text-align:right;">${row.sellSub ? formatKMB(row.sellSub) + buildOutlierPriceWarningIcon(row.sellSubOutlier) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buySub ? formatKMB(row.buySub) + buildOutlierPriceWarningIcon(row.buySubOutlier) : '–'}</td>
            `;
                tbody.appendChild(tr);

                if (row.isCredit && row.creditHrid) {
                    const options = [...(topConversions[row.creditHrid] || [])];
                    options.sort((a, b) => {
                        const aVal = sortKey === 'bid' ? a.bidGPC : a.askGPC;
                        const bVal = sortKey === 'bid' ? b.bidGPC : b.askGPC;
                        if (aVal === null && bVal === null) return 0;
                        if (aVal === null) return 1;
                        if (bVal === null) return -1;
                        return aVal - bVal;
                    });
                    options.forEach((opt, idx) => {
                        const qtyNeeded = Math.ceil(row.effectiveRequired / opt.creditCount) * opt.itemCount;
                        const askTotal = opt.askPrice ? opt.askPrice * qtyNeeded : null;
                        const bidTotal = opt.bidPrice ? opt.bidPrice * qtyNeeded : null;
                        const isTop = idx === 0;
                        const nameColor = isTop ? '#4ade80' : '#9ca3af';
                        const rankPrefix = `↳ #${idx + 1}`;
                        const subTr = document.createElement('tr');
                        subTr.style.cssText = `border-bottom:1px solid rgba(255,255,255,0.03); font-size:11px;`;
                        const askStyle = `color:${sortKey === 'bid' ? '#6b7280' : isTop ? '#4ade80' : '#9ca3af'}; font-weight:${sortKey === 'ask' && isTop ? '600' : '400'};`;
                        const bidStyle = `color:${sortKey === 'ask' ? '#6b7280' : isTop ? '#4ade80' : '#9ca3af'}; font-weight:${sortKey === 'bid' && isTop ? '600' : '400'};`;
                        subTr.innerHTML = `
                        <td style="padding:2px 6px 2px 16px; text-align:left; color:${nameColor};">${rankPrefix} ${getItemName(opt.hrid, opt.name)}</td>
                        <td style="padding:2px 6px; text-align:right; color:${nameColor};">${qtyNeeded.toLocaleString()}</td>
                        <td style="padding:2px 6px; text-align:right; color:#6b7280;">${opt.askPrice ? formatKMB(opt.askPrice) + buildOutlierPriceWarningIcon(opt.askOutlier) : '–'}</td>
                        <td style="padding:2px 6px; text-align:right; color:#6b7280;">${opt.bidPrice ? formatKMB(opt.bidPrice) + buildOutlierPriceWarningIcon(opt.bidOutlier) : '–'}</td>
                        <td style="padding:2px 6px; text-align:right; ${askStyle}">${askTotal ? formatKMB(askTotal) + buildOutlierPriceWarningIcon(opt.askOutlier) : '–'}</td>
                        <td style="padding:2px 6px; text-align:right; ${bidStyle}">${bidTotal ? formatKMB(bidTotal) + buildOutlierPriceWarningIcon(opt.bidOutlier) : '–'}</td>
                    `;
                        tbody.appendChild(subTr);
                    });
                }
            });

            const totalRow = document.createElement('tr');
            totalRow.style.cssText = 'border-top:1px solid rgba(255,255,255,0.2); color:#4ade80; font-weight:700;';
            totalRow.innerHTML = `
            <td style="padding:5px 6px;" colspan="4">${t('guildCreditValue.totalRowLabel')}</td>
            <td style="padding:5px 6px; text-align:right;">${totalSell > 0 ? formatKMB(totalSell) : '–'}${!allSellPriced ? '*' : ''}</td>
            <td style="padding:5px 6px; text-align:right;">${totalBuy > 0 ? formatKMB(totalBuy) : '–'}${!allBuyPriced ? '*' : ''}</td>
        `;
            tbody.appendChild(totalRow);
            return tbody;
        };

        const wrapper = document.createElement('div');
        wrapper.className = 'mwi-shrine-cost';
        wrapper.style.cssText = 'margin-top:12px; font-size:12px; width:100%;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; color:#9ca3af; margin-bottom:6px; text-align:center;';
        hdr.textContent = t('guildCreditValue.upgradeCostHeader');
        wrapper.appendChild(hdr);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse;';

        const thead = document.createElement('thead');
        const thRow = document.createElement('tr');
        thRow.style.cssText = 'font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);';

        [
            { text: t('guildCreditValue.columnItem'), align: 'left' },
            { text: t('guildCreditValue.columnQty'), align: 'right' },
            { text: t('guildCreditValue.columnAskEach'), align: 'right' },
            { text: t('guildCreditValue.columnBidEach'), align: 'right' },
        ].forEach(({ text, align }) => {
            const th = document.createElement('th');
            th.style.cssText = `text-align:${align}; padding:3px 6px; font-weight:500; color:#6b7280;`;
            th.textContent = text;
            thRow.appendChild(th);
        });

        const askTh = document.createElement('th');
        askTh.textContent = t('guildCreditValue.columnAskCost');
        const bidTh = document.createElement('th');
        bidTh.textContent = t('guildCreditValue.columnBidCost');
        thRow.appendChild(askTh);
        thRow.appendChild(bidTh);
        thead.appendChild(thRow);
        table.appendChild(thead);

        const updateThStyles = () => {
            const isAsk = sortKey === 'ask';
            const active = 'font-weight:600; color:#e0e0e0; text-decoration:underline;';
            const inactive = 'font-weight:500; color:#6b7280;';
            askTh.style.cssText = `text-align:right; padding:3px 6px; cursor:pointer; ${isAsk ? active : inactive}`;
            bidTh.style.cssText = `text-align:right; padding:3px 6px; cursor:pointer; ${!isAsk ? active : inactive}`;
        };
        updateThStyles();

        let currentTbody = buildTbody();
        table.appendChild(currentTbody);

        const setSort = (key) => {
            sortKey = key;
            updateThStyles();
            const newTbody = buildTbody();
            table.replaceChild(newTbody, currentTbody);
            currentTbody = newTbody;
        };

        askTh.addEventListener('click', () => setSort('ask'));
        bidTh.addEventListener('click', () => setSort('bid'));

        wrapper.appendChild(table);

        if (!allSellPriced || !allBuyPriced) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:10px; color:#6b7280; margin-top:4px; text-align:center;';
            note.textContent = t('guildCreditValue.unpricedItemsNote');
            wrapper.appendChild(note);
        }

        // Build missing mats list from top-1 conversion per credit row
        const missingMats = [];
        for (const row of rows) {
            if (!row.isCredit || !row.creditHrid) continue;
            const top = (topConversions[row.creditHrid] || [])[0];
            if (!top?.hrid) continue;
            const qtyNeeded = Math.ceil(row.effectiveRequired / top.creditCount) * top.itemCount;
            const have = inventory
                .filter((i) => i.itemHrid === top.hrid && i.itemLocationHrid === '/item_locations/inventory')
                .reduce((sum, i) => sum + (i.count || 0), 0);
            const missing = Math.max(0, qtyNeeded - have);
            if (missing > 0) {
                missingMats.push({
                    itemHrid: top.hrid,
                    itemName: top.name,
                    missing,
                    required: qtyNeeded,
                    isTradeable: true,
                });
            }
        }

        if (missingMats.length > 0) {
            const missingBtn = document.createElement('button');
            missingBtn.type = 'button';
            missingBtn.style.cssText = `
            width:100%; padding:8px 12px; margin-top:8px;
            background:linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%);
            color:#fff; border:1px solid rgba(91,141,239,0.4); border-radius:6px;
            cursor:pointer; font-size:12px; font-weight:600;
        `;
            missingBtn.textContent = t('guildCreditValue.missingMatsButtonLabel');
            missingBtn.addEventListener('mouseenter', () => {
                missingBtn.style.background =
                    'linear-gradient(180deg,rgba(91,141,239,0.35) 0%,rgba(91,141,239,0.25) 100%)';
            });
            missingBtn.addEventListener('mouseleave', () => {
                missingBtn.style.background =
                    'linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%)';
            });
            missingBtn.addEventListener('click', async () => {
                let sessionId = null;
                try {
                    // Claim session BEFORE first await
                    sessionId = marketplaceSession.start({
                        owner: MARKETPLACE_OWNER.GUILD,
                        onEnd: () => this.teardownGuildMarketplaceSession(),
                    });
                    this._guildSessionId = sessionId;

                    // Open the Marketplace (navigate to the first missing material's page)
                    if (!navigateToMarketplace(missingMats[0].itemHrid, 0)) {
                        marketplaceSession.end(sessionId);
                        return;
                    }

                    // Wait for the marketplace tablist to render
                    let tabsContainer = null;
                    let referenceTab = null;
                    for (let i = 0; i < 20; i++) {
                        if (!marketplaceSession.isActive(sessionId)) return;
                        await new Promise((r) => setTimeout(r, 100));
                        if (!marketplaceSession.isActive(sessionId)) return;
                        tabsContainer = getVisibleMarketplaceTabContainer();
                        referenceTab = tabsContainer
                            ? Array.from(tabsContainer.children).find((btn) => isMyListingsTabLabel(btn.textContent))
                            : null;
                        if (referenceTab) break;
                    }
                    if (!referenceTab) {
                        marketplaceSession.end(sessionId);
                        return;
                    }
                    if (!marketplaceSession.isActive(sessionId)) return;

                    // Allow tabs to wrap and make the scroller visible
                    const scroller = tabsContainer.closest('[class*="MuiTabs-scroller"]');
                    const muiRoot = scroller?.closest('[class*="MuiTabs-root"]');
                    tabsContainer.style.flexWrap = 'wrap';
                    if (scroller) scroller.style.overflow = 'visible';
                    if (muiRoot) muiRoot.style.height = 'auto';

                    // Remove any existing guild and shrine tabs before inserting new ones
                    removeMaterialTabsForOwner(MARKETPLACE_OWNER.GUILD);
                    document.querySelectorAll('[data-mwi-shrine-tab="true"]').forEach((el) => el.remove());

                    this._guildActiveWorkflowModel = {
                        sessionId,
                        materials: missingMats.map((m) => ({ ...m })),
                        returnLabel: shrineReturnLabel,
                    };

                    // Arm autofill
                    this.autofillManager.startSession({ sessionId });

                    for (const mat of missingMats) {
                        const capturedMat = mat;
                        const tab = createMaterialTab(
                            { ...mat, itemName: getItemName(mat.itemHrid, mat.itemName) },
                            referenceTab,
                            (_e, m) => {
                                if (!marketplaceSession.isActive(sessionId)) return;
                                const model = this._guildActiveWorkflowModel;
                                const entry = model?.materials.find((e) => e.itemHrid === capturedMat.itemHrid);
                                const armed = this.autofillManager.arm({
                                    sessionId,
                                    itemHrid: m.itemHrid,
                                    enhancementLevel: 0,
                                    modalMode: 'buy',
                                    quantityProvider: () => entry?.missing ?? 0,
                                });
                                if (!armed || !navigateToMarketplace(m.itemHrid, 0)) marketplaceSession.end(sessionId);
                            },
                            MARKETPLACE_OWNER.GUILD
                        );
                        tab.setAttribute('data-required-quantity', mat.required.toString());
                        tab.setAttribute('data-item-name', mat.itemName);
                        tabsContainer.appendChild(tab);
                    }

                    // Add Return tab that resolves the live Guild navigation control at click time.
                    if (!getVisibleGuildNavigationButton()) {
                        marketplaceSession.end(sessionId);
                        return;
                    }
                    tabsContainer.appendChild(
                        createGuildReturnTab(referenceTab, this._guildActiveWorkflowModel?.returnLabel, sessionId)
                    );

                    if (this._shrineTabCleanup) this._shrineTabCleanup();
                    this._shrineTabCleanup = watchNativeTabExit(tabsContainer, () => {
                        marketplaceSession.end(sessionId);
                    });

                    // Arm and navigate to first missing material automatically.
                    if (!marketplaceSession.isActive(sessionId)) return;
                    const firstMat = missingMats[0];
                    if (firstMat) {
                        const firstEntry = this._guildActiveWorkflowModel?.materials.find(
                            (e) => e.itemHrid === firstMat.itemHrid
                        );
                        const armed = this.autofillManager.arm({
                            sessionId,
                            itemHrid: firstMat.itemHrid,
                            enhancementLevel: 0,
                            modalMode: 'buy',
                            quantityProvider: () => firstEntry?.missing ?? 0,
                        });
                        if (!armed || !navigateToMarketplace(firstMat.itemHrid, 0)) {
                            marketplaceSession.end(sessionId);
                            return;
                        }
                    }

                    // Watch for inventory/market changes and update shrine tabs accordingly
                    const inventoryUpdateHandler = () => {
                        if (!marketplaceSession.isActive(sessionId)) {
                            dataManager.off('items_updated', inventoryUpdateHandler);
                            this._guildInventoryHandler = null;
                            return;
                        }

                        const inventory = dataManager.getInventory() || [];
                        const model = this._guildActiveWorkflowModel;
                        if (!model || model.sessionId !== sessionId) return;

                        let anyRemaining = false;
                        for (const material of model.materials) {
                            const have = inventory
                                .filter(
                                    (item) =>
                                        item.itemHrid === material.itemHrid &&
                                        item.itemLocationHrid === '/item_locations/inventory'
                                )
                                .reduce((sum, item) => sum + (item.count || 0), 0);
                            material.missing = Math.max(0, material.required - have);
                            if (material.missing > 0) anyRemaining = true;
                        }

                        const shrineTabs = document.querySelectorAll(
                            `[data-mwi-tab-owner="${MARKETPLACE_OWNER.GUILD}"][data-required-quantity]`
                        );
                        for (const tab of shrineTabs) {
                            const material = model.materials.find(
                                (entry) => entry.itemHrid === tab.getAttribute('data-item-hrid')
                            );
                            if (material) updateTabBadge(tab, material);
                        }

                        if (!anyRemaining) {
                            dataManager.off('items_updated', inventoryUpdateHandler);
                            this._guildInventoryHandler = null;
                        }
                    };

                    dataManager.on('items_updated', inventoryUpdateHandler);
                    this._guildInventoryHandler = inventoryUpdateHandler;

                    // Watch for tab disappearance; reinject on React remount or tear down on panel exit
                    const capturedSessionId = sessionId;
                    this._guildCleanupObserver = setupMarketplaceCleanupObserver({
                        owner: MARKETPLACE_OWNER.GUILD,
                        invalidStateGraceMs: MARKETPLACE_REMOUNT_GRACE_MS,
                        onTabsGone: () => {
                            if (!marketplaceSession.isActive(capturedSessionId)) return;
                            const visibleContainer = getVisibleMarketplaceTabContainer();
                            if (
                                visibleContainer &&
                                isMarketplaceMarketListingsSelected(visibleContainer) &&
                                this._reinjectGuildMarketplaceTabs(visibleContainer, capturedSessionId)
                            ) {
                                return;
                            }
                            marketplaceSession.end(capturedSessionId);
                        },
                    });
                } catch (error) {
                    console.error('[GuildCreditValue] Missing-materials workflow failed:', error);
                    if (sessionId !== null && marketplaceSession.isActive(sessionId)) {
                        marketplaceSession.end(sessionId);
                    }
                }
            });
            wrapper.appendChild(missingBtn);
        }

        upgradeBtn.insertAdjacentElement('afterend', wrapper);

        const levelEl = modalEl.querySelector('[class*="GuildPanel_level"]');

        upgradeBtn.addEventListener(
            'click',
            () => {
                const observer = new MutationObserver(() => {
                    observer.disconnect();
                    this._renderShrine(modalEl);
                });
                observer.observe(levelEl, { subtree: true, childList: true, characterData: true });
            },
            { once: true }
        );
    }

    _renderTrialTier(el) {
        if (el.dataset.mwiTierInjected) return;
        el.dataset.mwiTierInjected = 'true';

        const match = el.textContent.match(/Lv\.(\d+)/);
        if (!match) return;

        const level = parseInt(match[1], 10);
        if (level < 100) return;

        const tier = Math.min(20, Math.floor((level - 100) / 10) + 1);

        const tierSpan = document.createElement('span');
        tierSpan.className = 'mwi-trial-tier';
        tierSpan.style.cssText = 'color:#9ca3af; margin-left:3px; font-size:0.85em; white-space:nowrap;';
        tierSpan.textContent = `T${tier}`;
        el.appendChild(tierSpan);
    }

    cleanup() {
        const sessionId = this._guildSessionId ?? this._guildActiveWorkflowModel?.sessionId ?? null;
        if (sessionId !== null && marketplaceSession.isActive(sessionId)) marketplaceSession.end(sessionId);
        else this.teardownGuildMarketplaceSession();
        this.unregisterObservers.forEach((fn) => fn());
        this.unregisterObservers = [];
        if (this._shrineTabCleanup) {
            this._shrineTabCleanup();
            this._shrineTabCleanup = null;
        }
        removeShrineMarketTabs();
        document.querySelectorAll(`.${CSS_CLASS}`).forEach((el) => el.remove());
        document.querySelectorAll('.mwi-shrine-cost').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-trial-copy-btn').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-trial-tier').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-exchange-advisor').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-shrine-planner').forEach((el) => el.remove());
        document.querySelectorAll('.mwi-guild-exchange-all-btn').forEach((el) => el.remove());
        this.initialized = false;
    }
}

const guildCreditValue = new GuildCreditValue();

export default {
    name: 'Guild Credit Value',
    initialize: () => guildCreditValue.initialize(),
    cleanup: () => guildCreditValue.cleanup(),
};
