/**
 * Guild Credit Value Display
 *
 * Injects cost-efficiency tables into guild credit exchange modals and shrine
 * upgrade modals. Shows both sell-side (opportunity cost) and buy-side
 * (acquisition cost) columns. Pricing mode is taken from the user's profit
 * calculation settings.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { getItemPrice } from '../../utils/market-data.js';
import { formatKMB } from '../../utils/formatters.js';
import webSocketHook from '../../core/websocket.js';
import {
    navigateToMarketplace,
    createMaterialTab,
    removeMaterialTabs,
    removeShrineMarketTabs,
    updateTabBadge,
} from '../../utils/marketplace-tabs.js';
import { createAutofillManager } from '../../utils/marketplace-autofill.js';

const CSS_CLASS = 'mwi-guild-credit-value';

/**
 * Build cheapest-gold-per-credit maps for both sell and buy sides.
 * @param {Object} itemDetailMap
 * @returns {{ sell: Object, buy: Object }}
 */
function buildCheapestPerCredit(itemDetailMap) {
    const sell = {};
    const buy = {};
    for (const [hrid, item] of Object.entries(itemDetailMap)) {
        for (const conv of item.guildCreditConversions || []) {
            const creditHrid = conv.creditItemHrid;
            const sellPrice = getItemPrice(hrid, { mode: 'ask' });
            const buyPrice = getItemPrice(hrid, { mode: 'bid' });
            if (sellPrice > 0) {
                const gpc = (sellPrice * conv.itemCount) / conv.creditCount;
                if (!sell[creditHrid] || gpc < sell[creditHrid]) sell[creditHrid] = gpc;
            }
            if (buyPrice > 0) {
                const gpc = (buyPrice * conv.itemCount) / conv.creditCount;
                if (!buy[creditHrid] || gpc < buy[creditHrid]) buy[creditHrid] = gpc;
            }
        }
    }
    return { sell, buy };
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
            const askPrice = getItemPrice(hrid, { mode: 'ask' });
            const bidPrice = getItemPrice(hrid, { mode: 'bid' });
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

        const creditHrid = Object.keys(gameData.itemDetailMap || {}).find(
            (hrid) => hrid.includes('guild_credit') && gameData.itemDetailMap[hrid].name === titleText
        );
        if (!creditHrid) return;

        const rows = [];
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            const conv = (item.guildCreditConversions || []).find((c) => c.creditItemHrid === creditHrid);
            if (!conv) continue;

            const sellPrice = getItemPrice(hrid, { mode: 'ask' });
            const buyPrice = getItemPrice(hrid, { mode: 'bid' });
            if (!sellPrice && !buyPrice) continue;

            const sellGPC = sellPrice > 0 ? (sellPrice * conv.itemCount) / conv.creditCount : null;
            const buyGPC = buyPrice > 0 ? (buyPrice * conv.itemCount) / conv.creditCount : null;

            rows.push({
                name: item.name,
                itemCount: conv.itemCount,
                creditCount: conv.creditCount,
                sellPrice,
                buyPrice,
                sellGPC,
                buyGPC,
            });
        }

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
                tr.innerHTML = `
                    <td style="padding:4px 6px; text-align:left;">${row.name}</td>
                    <td style="padding:4px 6px; text-align:center; color:#9ca3af;">${rate}</td>
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.sellPrice ? formatKMB(row.sellPrice) : '–'}</td>
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buyPrice ? formatKMB(row.buyPrice) : '–'}</td>
                    <td style="padding:4px 6px; text-align:right; ${sortKey === 'bid' ? 'color:#9ca3af;' : `font-weight:${isTop ? '700' : '400'};`}">${row.sellGPC ? formatKMB(row.sellGPC) : '–'}</td>
                    <td style="padding:4px 6px; text-align:right; ${sortKey === 'ask' ? 'color:#9ca3af;' : `font-weight:${isTop ? '700' : '400'};`}">${row.buyGPC ? formatKMB(row.buyGPC) : '–'}</td>
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
        hdr.textContent = 'Gold cost per credit — click to sort';
        wrapper.appendChild(hdr);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse;';

        const thead = document.createElement('thead');
        const thRow = document.createElement('tr');
        thRow.style.cssText = 'font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);';

        [
            { text: 'Item', align: 'left' },
            { text: 'Rate', align: 'center' },
            { text: 'Ask ea.', align: 'right' },
            { text: 'Bid ea.', align: 'right' },
        ].forEach(({ text, align }) => {
            const th = document.createElement('th');
            th.style.cssText = `text-align:${align}; padding:3px 6px; font-weight:500; color:#6b7280;`;
            th.textContent = text;
            thRow.appendChild(th);
        });

        const askTh = document.createElement('th');
        askTh.textContent = 'Ask/credit';
        const bidTh = document.createElement('th');
        bidTh.textContent = 'Bid/credit';
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
        exchangeBtn.insertAdjacentElement('afterend', wrapper);

        // Exchange advisor — initial render + re-render on item selection change
        if (config.getSetting('guildCreditExchangeAdvisor', true)) {
            this._renderExchangeAdvisor(modalEl, creditHrid, rows);

            const itemSelector = modalEl.querySelector('[class*="ItemSelector_itemContainer"]');
            if (itemSelector) {
                const observer = new MutationObserver(() => {
                    this._renderExchangeAdvisor(modalEl, creditHrid, rows);
                });
                observer.observe(itemSelector, { subtree: true, childList: true, attributes: true });
            }
        }

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
            '/guild_shrines/force': 'Force',
            '/guild_shrines/tempo': 'Tempo',
            '/guild_shrines/rarity': 'Rarity',
            '/guild_shrines/scholar': 'Scholar',
            '/guild_shrines/spirit': 'Spirit',
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
        headerTitle.textContent = 'Shrine Upgrade Planner';
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
                totalsEl.innerHTML =
                    '<div style="color:#6b7280; text-align:center; font-size:11px;">Set target levels above current to see costs</div>';
                return;
            }

            const { tokens, credits } = aggregateCosts(plans);
            const itemDetailMap = gameData.itemDetailMap || {};

            const titleEl = document.createElement('div');
            titleEl.style.cssText = 'color:#9ca3af; font-size:11px; margin-bottom:6px;';
            titleEl.textContent = 'Total upgrade cost';
            totalsEl.appendChild(titleEl);

            // Guild tokens row
            if (tokens.total > 0) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; padding:2px 0; font-size:12px;';
                row.innerHTML = `<span style="color:#aaa;">Guild Tokens</span><span style="color:#e0e0e0; font-weight:600;">${tokens.total.toLocaleString()}</span>`;
                totalsEl.appendChild(row);
            }

            // Credit costs
            for (const [itemHrid, count] of Object.entries(credits)) {
                const name = itemDetailMap[itemHrid]?.name || itemHrid.split('/').pop();
                const price = getItemPrice(itemHrid, { mode: 'ask' });
                const goldStr = price > 0 ? ` (${formatKMB(price * count)})` : '';
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
            shrineTitleEl.textContent = `${shrineLabel} Shrine${shrineCapLevel > 0 ? ` (cap: ${shrineCapLevel})` : ''}`;
            shrineSection.appendChild(shrineTitleEl);

            for (const { buffHrid, buff } of buffs.sort((a, b) => a.buffHrid.localeCompare(b.buffHrid))) {
                const isCombat = buff.isCombat;
                const buffLabel = isCombat ? 'Combat' : 'Skilling';
                const currentLevel = dataManager.getCharacterGuildBuffLevel(buffHrid);
                const maxLevel = Math.max(...Object.keys(buff.levelCosts).map(Number));
                const capLevel = shrineCapLevel > 0 ? Math.min(shrineCapLevel, maxLevel) : maxLevel;

                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:2px 0; font-size:11px;';

                const label = document.createElement('span');
                label.style.cssText = 'flex:1; color:#9ca3af;';
                label.textContent = `${buffLabel} (lvl ${currentLevel})`;

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

    _renderExchangeAdvisor(modalEl, creditHrid, rows) {
        modalEl.querySelectorAll('.mwi-exchange-advisor').forEach((el) => el.remove());

        // The source item is inside ItemSelector_itemContainer; its SVG has aria-label="Item Name"
        const selectorContainer = modalEl.querySelector('[class*="ItemSelector_itemContainer"]');
        const itemSvg = selectorContainer?.querySelector('svg[aria-label]');
        const selectedItemName = itemSvg?.getAttribute('aria-label') || null;

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

        if (!selectedItemName) {
            // No item selected yet
            advisor.innerHTML = `<div style="color:#6b7280; text-align:center;">Select an item to see exchange advice</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        const selectedRow = validRows.find((r) => r.name === selectedItemName);

        if (!selectedRow) {
            // Item in modal has no conversion for this credit type
            advisor.innerHTML = `<div style="color:#6b7280; text-align:center;">Selected item has no conversion for this credit</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        if (selectedRow === bestRow) {
            advisor.style.borderColor = 'rgba(74,222,128,0.4)';
            advisor.innerHTML = `<div style="color:#4ade80; font-weight:600; text-align:center;">✓ Optimal choice for this credit type</div>`;
            modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
            return;
        }

        // Calculate sell → rebuy scenario
        const SELLER_TAX = 0.02;
        const sellPrice = selectedRow.buyPrice; // bid price = what market will buy at
        const directCredits = batches * selectedRow.creditCount;

        if (!sellPrice || sellPrice <= 0 || !bestRow.sellPrice || bestRow.sellPrice <= 0) {
            advisor.innerHTML = `<div style="color:#6b7280; text-align:center;">Best: <b style="color:#e0e0e0;">${bestRow.name}</b> — no price data for comparison</div>`;
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
        const diffLabel = creditDiff > 0 ? '↑ better' : '↓ worse';

        advisor.style.borderColor = creditDiff > 0 ? 'rgba(74,222,128,0.3)' : 'rgba(255,107,107,0.3)';
        advisor.innerHTML = `
            <div style="color:#9ca3af; margin-bottom:6px; font-size:11px;">Sell → rebuy best item (2% tax)</div>
            <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                <span style="color:#aaa;">Direct exchange</span>
                <span style="color:#e0e0e0; font-weight:600;">${directCredits.toLocaleString()} credits</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                <span style="color:#aaa;">Sell proceeds (after tax)</span>
                <span style="color:#e0e0e0;">${formatKMB(net)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <span style="color:#aaa;">Buy <b style="color:#e0e0e0;">${bestRow.name}</b> → credits</span>
                <span style="color:#e0e0e0; font-weight:600;">${bestCredits.toLocaleString()} credits</span>
            </div>
            <div style="display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px;">
                <span style="color:#aaa;">Difference</span>
                <span style="color:${diffColor}; font-weight:700;">${diffSign}${creditDiff.toLocaleString()} credits ${diffLabel}</span>
            </div>
        `;

        modalEl.querySelector(`.${CSS_CLASS}`)?.insertAdjacentElement('afterend', advisor);
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
        copyBtn.textContent = 'Copy List';
        copyBtn.addEventListener('mouseenter', () => {
            copyBtn.style.background = 'linear-gradient(180deg,rgba(91,141,239,0.35) 0%,rgba(91,141,239,0.25) 100%)';
        });
        copyBtn.addEventListener('mouseleave', () => {
            copyBtn.style.background = 'linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%)';
        });
        copyBtn.addEventListener('click', () => {
            const names = Array.from(memberList.querySelectorAll('[class*="GuildPanel_memberName"]'))
                .map((el) => el.textContent.trim())
                .filter(Boolean)
                .join('\n');
            if (!names) return;
            navigator.clipboard.writeText(names).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy List';
                }, 1500);
            });
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

        const topConversions = buildTopConversions(gameData.itemDetailMap, 3);
        // Still need cheapest sell/buy for the credit row's own cost columns
        const { sell: cheapestSell, buy: cheapestBuy } = buildCheapestPerCredit(gameData.itemDetailMap);

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

            let sellEach = getItemPrice(itemHrid, { mode: 'ask' });
            let buyEach = getItemPrice(itemHrid, { mode: 'bid' });

            if (isCredit) {
                if (!sellEach || sellEach <= 0) sellEach = cheapestSell[itemHrid] || null;
                if (!buyEach || buyEach <= 0) buyEach = cheapestBuy[itemHrid] || null;
            }

            let sellSub = sellEach && effectiveRequired ? sellEach * effectiveRequired : null;
            let buySub = buyEach && effectiveRequired ? buyEach * effectiveRequired : null;

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
                buySub = bidTop?.bidPrice
                    ? Math.ceil(effectiveRequired / bidTop.creditCount) * bidTop.itemCount * bidTop.bidPrice
                    : null;
            }

            if (sellSub !== null) totalSell += sellSub;
            else if (!isToken && effectiveRequired > 0) allSellPriced = false;

            if (buySub !== null) totalBuy += buySub;
            else if (!isToken && effectiveRequired > 0) allBuyPriced = false;

            rows.push({
                itemName,
                required,
                effectiveRequired,
                owned,
                sellEach,
                buyEach,
                sellSub,
                buySub,
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
                    <td style="padding:4px 6px; text-align:left;">${row.itemName}</td>
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.effectiveRequired.toLocaleString()}${row.owned > 0 ? ` <span style="color:#6b7280;font-size:10px;">(own ${row.owned.toLocaleString()})</span>` : ''}</td>
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.sellEach ? formatKMB(row.sellEach) : '–'}</td>
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buyEach ? formatKMB(row.buyEach) : '–'}</td>
                    <td style="padding:4px 6px; text-align:right;">${row.sellSub ? formatKMB(row.sellSub) : '–'}</td>
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buySub ? formatKMB(row.buySub) : '–'}</td>
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
                            <td style="padding:2px 6px 2px 16px; text-align:left; color:${nameColor};">${rankPrefix} ${opt.name}</td>
                            <td style="padding:2px 6px; text-align:right; color:${nameColor};">${qtyNeeded.toLocaleString()}</td>
                            <td style="padding:2px 6px; text-align:right; color:#6b7280;">${opt.askPrice ? formatKMB(opt.askPrice) : '–'}</td>
                            <td style="padding:2px 6px; text-align:right; color:#6b7280;">${opt.bidPrice ? formatKMB(opt.bidPrice) : '–'}</td>
                            <td style="padding:2px 6px; text-align:right; ${askStyle}">${askTotal ? formatKMB(askTotal) : '–'}</td>
                            <td style="padding:2px 6px; text-align:right; ${bidStyle}">${bidTotal ? formatKMB(bidTotal) : '–'}</td>
                        `;
                        tbody.appendChild(subTr);
                    });
                }
            });

            const totalRow = document.createElement('tr');
            totalRow.style.cssText = 'border-top:1px solid rgba(255,255,255,0.2); color:#4ade80; font-weight:700;';
            totalRow.innerHTML = `
                <td style="padding:5px 6px;" colspan="4">Total</td>
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
        hdr.textContent = 'Gold cost of upgrade — click to sort';
        wrapper.appendChild(hdr);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse;';

        const thead = document.createElement('thead');
        const thRow = document.createElement('tr');
        thRow.style.cssText = 'font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);';

        [
            { text: 'Item', align: 'left' },
            { text: 'Qty', align: 'right' },
            { text: 'Ask ea.', align: 'right' },
            { text: 'Bid ea.', align: 'right' },
        ].forEach(({ text, align }) => {
            const th = document.createElement('th');
            th.style.cssText = `text-align:${align}; padding:3px 6px; font-weight:500; color:#6b7280;`;
            th.textContent = text;
            thRow.appendChild(th);
        });

        const askTh = document.createElement('th');
        askTh.textContent = 'Ask cost';
        const bidTh = document.createElement('th');
        bidTh.textContent = 'Bid cost';
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
            note.textContent = '* some items have no market price data';
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
            missingBtn.style.cssText = `
                width:100%; padding:8px 12px; margin-top:8px;
                background:linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%);
                color:#fff; border:1px solid rgba(91,141,239,0.4); border-radius:6px;
                cursor:pointer; font-size:12px; font-weight:600;
            `;
            missingBtn.textContent = 'Missing Mats Marketplace';
            missingBtn.addEventListener('mouseenter', () => {
                missingBtn.style.background =
                    'linear-gradient(180deg,rgba(91,141,239,0.35) 0%,rgba(91,141,239,0.25) 100%)';
            });
            missingBtn.addEventListener('mouseleave', () => {
                missingBtn.style.background =
                    'linear-gradient(180deg,rgba(91,141,239,0.2) 0%,rgba(91,141,239,0.1) 100%)';
            });
            missingBtn.addEventListener('click', async () => {
                navigateToMarketplace(missingMats[0].itemHrid, 0);

                // Tear down any previous shrine tab listener before creating new tabs
                if (this._shrineTabCleanup) {
                    this._shrineTabCleanup();
                    this._shrineTabCleanup = null;
                }

                // Wait for the marketplace tablist to render
                let tabsContainer = null;
                let referenceTab = null;
                for (let i = 0; i < 20; i++) {
                    await new Promise((r) => setTimeout(r, 100));
                    tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                    referenceTab = tabsContainer
                        ? Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'))
                        : null;
                    if (referenceTab) break;
                }
                if (!referenceTab) return;

                // Allow tabs to wrap and make the scroller visible
                const scroller = tabsContainer.closest('[class*="MuiTabs-scroller"]');
                const muiRoot = scroller?.closest('[class*="MuiTabs-root"]');
                tabsContainer.style.flexWrap = 'wrap';
                if (scroller) scroller.style.overflow = 'visible';
                if (muiRoot) muiRoot.style.height = 'auto';

                // Remove any existing action tabs and shrine tabs before inserting new ones
                removeMaterialTabs();
                removeShrineMarketTabs();

                for (const mat of missingMats) {
                    let tabEl = null;
                    const tab = createMaterialTab(mat, referenceTab, (_e, m) => {
                        this.autofillManager.setPendingCalculation(() =>
                            parseInt(tabEl?.getAttribute('data-missing-quantity') || '0', 10)
                        );
                        navigateToMarketplace(m.itemHrid, 0);
                    });
                    // Opt out of global removeMaterialTabs() cleanup so tabs survive tab-to-tab navigation
                    tab.removeAttribute('data-mwi-custom-tab');
                    tab.setAttribute('data-mwi-shrine-tab', 'true');
                    tab.setAttribute('data-required-quantity', mat.required.toString());
                    tab.setAttribute('data-item-name', mat.itemName);
                    tabEl = tab;
                    tabsContainer.appendChild(tab);
                }

                // Watch for inventory/market changes and update shrine tabs accordingly
                const shrineTabs = Array.from(document.querySelectorAll('[data-mwi-shrine-tab="true"]'));
                const inventoryUpdateHandler = (message) => {
                    const msgType = message?.type || '';
                    if (
                        !msgType.includes('item') &&
                        !msgType.includes('inventory') &&
                        !msgType.includes('market') &&
                        !message?.inventory &&
                        !message?.characterItems
                    )
                        return;

                    const inventory = dataManager.getInventory();
                    let anyRemaining = false;

                    for (const tab of shrineTabs) {
                        if (!tab.isConnected) continue;
                        const itemHrid = tab.getAttribute('data-item-hrid');
                        const required = parseInt(tab.getAttribute('data-required-quantity') || '0', 10);
                        const itemName = tab.getAttribute('data-item-name') || '';
                        const have = inventory
                            .filter(
                                (i) => i.itemHrid === itemHrid && i.itemLocationHrid === '/item_locations/inventory'
                            )
                            .reduce((sum, i) => sum + (i.count || 0), 0);
                        const missing = Math.max(0, required - have);

                        if (missing === 0) {
                            tab.remove();
                        } else {
                            updateTabBadge(tab, { itemHrid, itemName, missing, required, isTradeable: true });
                            anyRemaining = true;
                        }
                    }

                    if (!anyRemaining) {
                        webSocketHook.off('*', inventoryUpdateHandler);
                        this._shrineTabCleanup = null;
                    }
                };

                webSocketHook.on('*', inventoryUpdateHandler);
                this._shrineTabCleanup = () => webSocketHook.off('*', inventoryUpdateHandler);
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
        this.initialized = false;
    }
}

const guildCreditValue = new GuildCreditValue();

export default {
    name: 'Guild Credit Value',
    initialize: () => guildCreditValue.initialize(),
    cleanup: () => guildCreditValue.cleanup(),
};
