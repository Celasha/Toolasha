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
            const itemName = gameData.itemDetailMap?.[itemHrid]?.name || spriteId.replace(/_/g, ' ');
            const isToken = itemHrid.includes('guild_token');
            const isCredit = itemHrid.includes('guild_credit');

            let sellEach = getItemPrice(itemHrid, { mode: 'ask' });
            let buyEach = getItemPrice(itemHrid, { mode: 'bid' });

            if (isCredit) {
                if (!sellEach || sellEach <= 0) sellEach = cheapestSell[itemHrid] || null;
                if (!buyEach || buyEach <= 0) buyEach = cheapestBuy[itemHrid] || null;
            }

            const sellSub = sellEach && required ? sellEach * required : null;
            const buySub = buyEach && required ? buyEach * required : null;

            if (sellSub !== null) totalSell += sellSub;
            else if (!isToken) allSellPriced = false;

            if (buySub !== null) totalBuy += buySub;
            else if (!isToken) allBuyPriced = false;

            rows.push({
                itemName,
                required,
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
                    <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.required.toLocaleString()}</td>
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
                        const qtyNeeded = Math.ceil(row.required / opt.creditCount) * opt.itemCount;
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
        const inventory = dataManager.getInventory();
        const missingMats = [];
        for (const row of rows) {
            if (!row.isCredit || !row.creditHrid) continue;
            const top = (topConversions[row.creditHrid] || [])[0];
            if (!top?.hrid) continue;
            const qtyNeeded = Math.ceil(row.required / top.creditCount) * top.itemCount;
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
        tierSpan.style.cssText = 'color:#9ca3af; margin-left:4px;';
        tierSpan.textContent = `(T${tier})`;
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
        this.initialized = false;
    }
}

const guildCreditValue = new GuildCreditValue();

export default {
    name: 'Guild Credit Value',
    initialize: () => guildCreditValue.initialize(),
    cleanup: () => guildCreditValue.cleanup(),
};
