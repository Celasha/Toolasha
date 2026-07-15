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
            const sellPrice = getItemPrice(hrid, { context: 'profit', side: 'sell' });
            const buyPrice = getItemPrice(hrid, { context: 'profit', side: 'buy' });
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
            const askPrice = getItemPrice(hrid, { context: 'profit', side: 'sell' });
            const bidPrice = getItemPrice(hrid, { context: 'profit', side: 'buy' });
            if (!askPrice && !bidPrice) continue;
            const askGPC = askPrice > 0 ? (askPrice * conv.itemCount) / conv.creditCount : null;
            const bidGPC = bidPrice > 0 ? (bidPrice * conv.itemCount) / conv.creditCount : null;
            if (!byCredit[creditHrid]) byCredit[creditHrid] = [];
            byCredit[creditHrid].push({
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
    }

    initialize() {
        if (this.initialized) return;

        const unregister = domObserver.onClass('GuildCreditValue', 'GuildPanel_exchangeModalContent', (el) =>
            this._render(el)
        );
        this.unregisterObservers.push(unregister);

        const unregisterShrine = domObserver.onClass('GuildCreditValue-Shrine', 'GuildPanel_guildModalContent', (el) =>
            this._renderShrine(el)
        );
        this.unregisterObservers.push(unregisterShrine);

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

            const sellPrice = getItemPrice(hrid, { context: 'profit', side: 'sell' });
            const buyPrice = getItemPrice(hrid, { context: 'profit', side: 'buy' });
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

        // Sort by sell side cheapest first (null last)
        rows.sort((a, b) => {
            if (a.sellGPC === null && b.sellGPC === null) return 0;
            if (a.sellGPC === null) return 1;
            if (b.sellGPC === null) return -1;
            return a.sellGPC - b.sellGPC;
        });

        const exchangeBtn = modalEl.querySelector('button');
        if (!exchangeBtn) return;

        const wrapper = document.createElement('div');
        wrapper.className = CSS_CLASS;
        wrapper.style.cssText = 'margin-top:12px; font-size:12px; width:100%; max-height:260px; overflow-y:auto;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; color:#9ca3af; margin-bottom:6px; text-align:center;';
        hdr.textContent = 'Gold cost per credit — cheapest ask first';
        wrapper.appendChild(hdr);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse;';
        table.innerHTML = `
            <thead>
                <tr style="color:#6b7280; font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);">
                    <th style="text-align:left; padding:3px 6px; font-weight:500;">Item</th>
                    <th style="text-align:center; padding:3px 6px; font-weight:500;">Rate</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Ask ea.</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Bid ea.</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Ask/credit</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Bid/credit</th>
                </tr>
            </thead>
        `;

        const tbody = document.createElement('tbody');
        rows.forEach((row, i) => {
            const tr = document.createElement('tr');
            tr.style.cssText = `border-bottom:1px solid rgba(255,255,255,0.05); color:${i === 0 ? '#4ade80' : '#e0e0e0'};`;
            const rate = row.creditCount === 1 ? `${row.itemCount} → 1` : `${row.itemCount} → ${row.creditCount}`;
            tr.innerHTML = `
                <td style="padding:4px 6px; text-align:left;">${row.name}</td>
                <td style="padding:4px 6px; text-align:center; color:#9ca3af;">${rate}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.sellPrice ? formatKMB(row.sellPrice) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buyPrice ? formatKMB(row.buyPrice) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; font-weight:${i === 0 ? '700' : '400'};">${row.sellGPC ? formatKMB(row.sellGPC) : '–'}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${row.buyGPC ? formatKMB(row.buyGPC) : '–'}</td>
            `;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrapper.appendChild(table);
        exchangeBtn.insertAdjacentElement('afterend', wrapper);
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

            let sellEach = getItemPrice(itemHrid, { context: 'profit', side: 'sell' });
            let buyEach = getItemPrice(itemHrid, { context: 'profit', side: 'buy' });

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

        const wrapper = document.createElement('div');
        wrapper.className = 'mwi-shrine-cost';
        wrapper.style.cssText = 'margin-top:12px; font-size:12px; width:100%;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; color:#9ca3af; margin-bottom:6px; text-align:center;';
        hdr.textContent = 'Gold cost of upgrade';
        wrapper.appendChild(hdr);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse;';
        table.innerHTML = `
            <thead>
                <tr style="color:#6b7280; font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);">
                    <th style="text-align:left; padding:3px 6px; font-weight:500;">Item</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Qty</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Ask ea.</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Bid ea.</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Ask cost</th>
                    <th style="text-align:right; padding:3px 6px; font-weight:500;">Bid cost</th>
                </tr>
            </thead>
        `;

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
                const options = topConversions[row.creditHrid] || [];
                options.forEach((opt, idx) => {
                    const qtyNeeded = Math.ceil(row.required / opt.creditCount) * opt.itemCount;
                    const askTotal = opt.askPrice ? opt.askPrice * qtyNeeded : null;
                    const bidTotal = opt.bidPrice ? opt.bidPrice * qtyNeeded : null;
                    const isTop = idx === 0;
                    const nameColor = isTop ? '#4ade80' : '#9ca3af';
                    const rankPrefix = `↳ #${idx + 1}`;
                    const subTr = document.createElement('tr');
                    subTr.style.cssText = `border-bottom:1px solid rgba(255,255,255,0.03); font-size:11px;`;
                    subTr.innerHTML = `
                        <td style="padding:2px 6px 2px 16px; text-align:left; color:${nameColor};">${rankPrefix} ${opt.name}</td>
                        <td style="padding:2px 6px; text-align:right; color:${nameColor};">${qtyNeeded.toLocaleString()}</td>
                        <td style="padding:2px 6px; text-align:right; color:#6b7280;">${opt.askPrice ? formatKMB(opt.askPrice) : '–'}</td>
                        <td style="padding:2px 6px; text-align:right; color:#6b7280;">${opt.bidPrice ? formatKMB(opt.bidPrice) : '–'}</td>
                        <td style="padding:2px 6px; text-align:right; color:${isTop ? '#4ade80' : '#9ca3af'}; font-weight:${isTop ? '600' : '400'};">${askTotal ? formatKMB(askTotal) : '–'}</td>
                        <td style="padding:2px 6px; text-align:right; color:#6b7280;">${bidTotal ? formatKMB(bidTotal) : '–'}</td>
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
        table.appendChild(tbody);
        wrapper.appendChild(table);

        if (!allSellPriced || !allBuyPriced) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:10px; color:#6b7280; margin-top:4px; text-align:center;';
            note.textContent = '* some items have no market price data';
            wrapper.appendChild(note);
        }

        upgradeBtn.insertAdjacentElement('afterend', wrapper);
    }

    cleanup() {
        this.unregisterObservers.forEach((fn) => fn());
        this.unregisterObservers = [];
        document.querySelectorAll(`.${CSS_CLASS}`).forEach((el) => el.remove());
        document.querySelectorAll('.mwi-shrine-cost').forEach((el) => el.remove());
        this.initialized = false;
    }
}

const guildCreditValue = new GuildCreditValue();

export default {
    name: 'Guild Credit Value',
    initialize: () => guildCreditValue.initialize(),
    cleanup: () => guildCreditValue.cleanup(),
};
