/**
 * Guild Credit Value Display
 *
 * Injects a cost-efficiency table into each guild credit exchange modal showing
 * how many gold each credit costs depending on which item you exchange, sorted
 * cheapest first. Pricing honours the user's profit calculation pricing mode.
 */

import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { getItemPrice } from '../../utils/market-data.js';
import { formatKMB } from '../../utils/formatters.js';

const CSS_CLASS = 'mwi-guild-credit-value';

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
        this.initialized = true;
    }

    _render(modalEl) {
        if (!config.getSetting('guildCreditValue', true)) return;

        // Remove any previous injection
        modalEl.querySelectorAll(`.${CSS_CLASS}`).forEach((el) => el.remove());

        const gameData = dataManager.getInitClientData();
        if (!gameData) return;

        // Identify which credit type by matching the modal title to item names
        const titleEl = modalEl.querySelector('[class*="GuildPanel_header"]');
        const titleText = titleEl?.textContent?.trim() || '';
        if (!titleText) return;

        const creditHrid = Object.keys(gameData.itemDetailMap || {}).find(
            (hrid) => hrid.includes('guild_credit') && gameData.itemDetailMap[hrid].name === titleText
        );
        if (!creditHrid) return;

        // Collect all items that convert to this credit type
        const rows = [];
        for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
            const conv = (item.guildCreditConversions || []).find((c) => c.creditItemHrid === creditHrid);
            if (!conv) continue;

            const price = getItemPrice(hrid, { context: 'profit', side: 'sell' });
            if (!price || price <= 0) continue;

            const goldPerCredit = (price * conv.itemCount) / conv.creditCount;
            rows.push({
                name: item.name,
                itemCount: conv.itemCount,
                creditCount: conv.creditCount,
                pricePerItem: price,
                goldPerCredit,
            });
        }

        if (rows.length === 0) return;

        rows.sort((a, b) => a.goldPerCredit - b.goldPerCredit);

        // Find the Exchange button and inject after it
        const exchangeBtn = modalEl.querySelector('button');
        if (!exchangeBtn) return;

        const wrapper = document.createElement('div');
        wrapper.className = CSS_CLASS;
        wrapper.style.cssText = `
            margin-top: 12px;
            font-size: 12px;
            width: 100%;
            max-height: 260px;
            overflow-y: auto;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            font-size: 11px;
            color: #9ca3af;
            margin-bottom: 6px;
            text-align: center;
        `;
        header.textContent = 'Gold cost per credit — cheapest first';
        wrapper.appendChild(header);

        const table = document.createElement('table');
        table.style.cssText = `width: 100%; border-collapse: collapse;`;

        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr style="color:#6b7280; font-size:11px; border-bottom:1px solid rgba(255,255,255,0.1);">
                <th style="text-align:left; padding:3px 6px; font-weight:500;">Item</th>
                <th style="text-align:center; padding:3px 6px; font-weight:500;">Rate</th>
                <th style="text-align:right; padding:3px 6px; font-weight:500;">Price/item</th>
                <th style="text-align:right; padding:3px 6px; font-weight:500;">Gold/credit</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach((row, i) => {
            const tr = document.createElement('tr');
            tr.style.cssText = `
                border-bottom: 1px solid rgba(255,255,255,0.05);
                color: ${i === 0 ? '#4ade80' : '#e0e0e0'};
            `;
            const rate = row.creditCount === 1 ? `${row.itemCount} → 1` : `${row.itemCount} → ${row.creditCount}`;
            tr.innerHTML = `
                <td style="padding:4px 6px; text-align:left;">${row.name}</td>
                <td style="padding:4px 6px; text-align:center; color:#9ca3af;">${rate}</td>
                <td style="padding:4px 6px; text-align:right; color:#9ca3af;">${formatKMB(row.pricePerItem)}</td>
                <td style="padding:4px 6px; text-align:right; font-weight:${i === 0 ? '700' : '400'};">${formatKMB(row.goldPerCredit)}</td>
            `;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrapper.appendChild(table);

        exchangeBtn.insertAdjacentElement('afterend', wrapper);
    }

    cleanup() {
        this.unregisterObservers.forEach((fn) => fn());
        this.unregisterObservers = [];
        document.querySelectorAll(`.${CSS_CLASS}`).forEach((el) => el.remove());
        this.initialized = false;
    }
}

const guildCreditValue = new GuildCreditValue();

export default {
    name: 'Guild Credit Value',
    initialize: () => guildCreditValue.initialize(),
    cleanup: () => guildCreditValue.cleanup(),
};
