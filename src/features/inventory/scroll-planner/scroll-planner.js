/**
 * Scroll Planner
 * Plan how many of each Labyrinth scroll to open, then be walked through opening them one at a
 * time: the scroll's action menu is opened, its quantity is filled in, and the game's own Open
 * button is highlighted. The player still presses Open, so nothing is spent unattended.
 *
 * - The "Plan scrolls" button lives in the scroll's item action menu, so it works from any
 *   inventory view, including the Toolasha custom tabs.
 * - The last plan used is stored account-wide; "Load last plan" brings it to any character.
 * - An in-progress run is stored per character and survives a reload.
 */

import config from '../../../core/config.js';
import { t } from '../../../core/i18n.js';
import domObserver from '../../../core/dom-observer.js';
import dataManager from '../../../core/data-manager.js';
import { getItemName } from '../../../utils/game-i18n.js';
import { setScrollRunActive } from './scroll-planner-state.js';
import {
    buildRun,
    getCurrentStep,
    getOwnedCount,
    getRemainingQuantity,
    getScrollHrids,
    normalizePlan,
} from './scroll-planner-logic.js';
import { clearRun, loadLastPlan, loadRun, saveLastPlan, saveRun } from './scroll-planner-storage.js';

const OBSERVER_NAME = 'ScrollPlanner_menu';
const BUTTON_CLASS = 'toolasha-scroll-planner-btn';
const HIGHLIGHT_OUTLINE = '2px solid #fbbf24';
const RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PREFILL_CHECK_DELAY_MS = 150;
const AUTO_OPEN_DELAY_MS = 150;

const CSS_FONT = 'font-family: inherit; font-size: 13px;';

class ScrollPlanner {
    constructor() {
        this.unregisterMenu = null;
        this.onItemsUpdated = null;
        this.modal = null;
        this.bar = null;
        this.draft = {};
        this.run = null; // { startedAt, steps }
        this.shortfalls = [];
        this.autoOpenedHrid = null;
        this.prefillFailedHrid = null;
        this.nameToHrid = null;
        this.timers = new Set();
    }

    /**
     * Initialize the feature
     */
    async initialize() {
        if (!config.getSetting('scrollPlanner')) {
            return;
        }

        this.unregisterMenu = domObserver.onClass(OBSERVER_NAME, 'Item_actionMenu', (menu) => {
            this.handleActionMenu(menu);
        });

        this.onItemsUpdated = () => this.handleInventoryChange();
        dataManager.on('items_updated', this.onItemsUpdated);

        await this.resumeSavedRun();
    }

    /**
     * Tear everything down
     */
    cleanup() {
        if (this.unregisterMenu) {
            this.unregisterMenu();
            this.unregisterMenu = null;
        }
        if (this.onItemsUpdated) {
            dataManager.off('items_updated', this.onItemsUpdated);
            this.onItemsUpdated = null;
        }
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.modal?.remove();
        this.bar?.remove();
        this.modal = null;
        this.bar = null;
        this.run = null;
        this.shortfalls = [];
        this.autoOpenedHrid = null;
        this.prefillFailedHrid = null;
        this.nameToHrid = null;
        this.draft = {};
        setScrollRunActive(false);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    schedule(callback, delay) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            callback();
        }, delay);
        this.timers.add(timer);
    }

    getScrollHrids() {
        return getScrollHrids(dataManager.getInitClientData()?.itemDetailMap);
    }

    getItems() {
        return dataManager.characterItems || [];
    }

    getScrollName(itemHrid) {
        const fallback = dataManager.getItemDetails(itemHrid)?.name || itemHrid;
        return getItemName(itemHrid, fallback);
    }

    /**
     * Item name (English and translated) -> scroll HRID, for matching the menu's name label.
     * @returns {Map<string, string>}
     */
    getNameLookup() {
        if (!this.nameToHrid) {
            this.nameToHrid = new Map();
            for (const hrid of this.getScrollHrids()) {
                const englishName = dataManager.getItemDetails(hrid)?.name;
                if (englishName) {
                    this.nameToHrid.set(englishName, hrid);
                }
                this.nameToHrid.set(this.getScrollName(hrid), hrid);
            }
        }
        return this.nameToHrid;
    }

    /**
     * @param {HTMLElement} menu - Item action menu
     * @returns {string|null} Scroll HRID the menu belongs to, or null
     */
    resolveScrollHrid(menu) {
        const nameEl = menu.querySelector('[class*="Item_name"]');
        if (!nameEl) {
            return null;
        }
        return this.getNameLookup().get(nameEl.textContent.trim()) || null;
    }

    getCharacterId() {
        return dataManager.getCurrentCharacterId();
    }

    // ---------------------------------------------------------------------
    // Item action menu
    // ---------------------------------------------------------------------

    handleActionMenu(menu) {
        const itemHrid = this.resolveScrollHrid(menu);
        if (!itemHrid) {
            return;
        }
        this.injectPlanButton(menu);
        this.applyStepToMenu(menu, itemHrid);
    }

    injectPlanButton(menu) {
        if (menu.querySelector(`.${BUTTON_CLASS}`)) {
            return;
        }
        const reference = menu.querySelector(':scope > button');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${reference?.className || ''} ${BUTTON_CLASS}`.trim();
        button.textContent = t('scrollPlanner.planButton');
        button.addEventListener('click', () => this.openModal());
        menu.appendChild(button);
    }

    /**
     * If the menu belongs to the current step, fill in its quantity and highlight Open.
     */
    applyStepToMenu(menu, itemHrid) {
        if (!this.run) {
            return;
        }
        const current = getCurrentStep(this.run.steps, this.getItems());
        if (!current || current.step.itemHrid !== itemHrid) {
            return;
        }

        const quantity = getRemainingQuantity(current.step, this.getItems());
        const input = menu.querySelector('[class*="Item_amountInputContainer"] input[type="number"]');
        const openButton = menu.querySelector(':scope > button');

        if (input) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, String(quantity));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (openButton) {
            openButton.style.outline = HIGHLIGHT_OUTLINE;
            openButton.style.outlineOffset = '2px';
        }

        // The game's Open label carries the quantity ("Open 3"); if it does not, the fill did not
        // take and the player has to type it themselves.
        this.schedule(() => {
            const filled = input && openButton && input.value === String(quantity);
            const labelMatches = openButton?.textContent.includes(String(quantity));
            this.prefillFailedHrid = filled && labelMatches ? null : itemHrid;
            this.renderBar();
        }, PREFILL_CHECK_DELAY_MS);
        this.prefillFailedHrid = null;
        this.renderBar();
    }

    // ---------------------------------------------------------------------
    // Run lifecycle
    // ---------------------------------------------------------------------

    async resumeSavedRun() {
        const characterId = this.getCharacterId();
        if (!characterId || !dataManager.characterItems) {
            return;
        }
        const saved = await loadRun(characterId);
        if (!saved?.steps?.length) {
            return;
        }
        const stale = !(Date.now() - saved.startedAt < RUN_MAX_AGE_MS);
        if (stale || !getCurrentStep(saved.steps, this.getItems())) {
            await clearRun(characterId);
            return;
        }
        this.run = saved;
        setScrollRunActive(true);
        this.renderBar();
        this.autoOpenCurrentScroll();
    }

    async startRun(rawPlan) {
        const plan = normalizePlan(rawPlan, this.getScrollHrids());
        if (Object.keys(plan).length === 0) {
            return { error: t('scrollPlanner.nothingPlanned') };
        }

        await saveLastPlan(plan);

        const { steps, shortfalls } = buildRun(plan, this.getScrollHrids(), this.getItems());
        if (steps.length === 0) {
            return { error: t('scrollPlanner.nothingOwned') };
        }

        this.run = { startedAt: Date.now(), steps };
        this.shortfalls = shortfalls;
        this.autoOpenedHrid = null;
        setScrollRunActive(true);
        await saveRun(this.getCharacterId(), this.run);

        this.closeModal();
        this.renderBar();
        this.autoOpenCurrentScroll();
        return { error: null };
    }

    async stopRun() {
        this.run = null;
        this.shortfalls = [];
        this.autoOpenedHrid = null;
        this.prefillFailedHrid = null;
        setScrollRunActive(false);
        await clearRun(this.getCharacterId());
        this.bar?.remove();
        this.bar = null;
    }

    async skipCurrentStep() {
        if (!this.run) {
            return;
        }
        const current = getCurrentStep(this.run.steps, this.getItems());
        if (current) {
            current.step.skipped = true;
            await saveRun(this.getCharacterId(), this.run);
        }
        this.handleInventoryChange();
    }

    handleInventoryChange() {
        if (!this.run) {
            return;
        }
        const current = getCurrentStep(this.run.steps, this.getItems());
        if (!current) {
            this.finishRun();
            return;
        }
        if (this.autoOpenedHrid !== current.step.itemHrid) {
            this.autoOpenCurrentScroll();
        }
        this.renderBar();
    }

    async finishRun() {
        const skipped = this.run.steps.filter((step) => step.skipped).map((step) => step.itemHrid);
        this.run = null;
        this.autoOpenedHrid = null;
        this.prefillFailedHrid = null;
        setScrollRunActive(false);
        await clearRun(this.getCharacterId());
        this.renderBar({ finished: true, skipped });
    }

    // ---------------------------------------------------------------------
    // Opening the scroll's action menu
    // ---------------------------------------------------------------------

    findInventoryTile(itemHrid) {
        const inventory = document.querySelector('[class*="Inventory_items"]');
        if (!inventory) {
            return null;
        }
        const names = new Set([dataManager.getItemDetails(itemHrid)?.name, this.getScrollName(itemHrid)]);
        for (const svg of inventory.querySelectorAll('[class*="Item_itemContainer"] svg[aria-label]')) {
            if (names.has(svg.getAttribute('aria-label')) && svg.getClientRects().length > 0) {
                return svg;
            }
        }
        return null;
    }

    /**
     * Click the current scroll's inventory tile so the game opens its action menu. Done once per
     * step; the bar's "Show scroll" button repeats it on demand.
     */
    autoOpenCurrentScroll(force = false) {
        if (!this.run) {
            return;
        }
        const current = getCurrentStep(this.run.steps, this.getItems());
        if (!current) {
            return;
        }
        const itemHrid = current.step.itemHrid;
        if (!force && this.autoOpenedHrid === itemHrid) {
            return;
        }
        this.autoOpenedHrid = itemHrid;
        this.schedule(() => {
            this.findInventoryTile(itemHrid)?.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true })
            );
        }, AUTO_OPEN_DELAY_MS);
    }

    // ---------------------------------------------------------------------
    // Progress bar
    // ---------------------------------------------------------------------

    ensureBar() {
        if (this.bar && document.body.contains(this.bar)) {
            return this.bar;
        }
        this.bar = document.createElement('div');
        this.bar.className = 'toolasha-scroll-planner-bar';
        this.bar.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10001;
            background: #2a2a2a;
            border: 1px solid #fbbf24;
            border-radius: 8px;
            padding: 10px 14px;
            color: #fff;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            max-width: 92vw;
            ${CSS_FONT}
        `;
        document.body.appendChild(this.bar);
        return this.bar;
    }

    makeButton(label, onClick, primary = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = `
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid ${primary ? '#fbbf24' : '#666'};
            background: ${primary ? '#fbbf24' : '#3a3a3a'};
            color: ${primary ? '#000' : '#fff'};
            cursor: pointer;
            ${CSS_FONT}
        `;
        button.addEventListener('click', onClick);
        return button;
    }

    makeLine(text, color = '#fff', bold = false) {
        const line = document.createElement('div');
        line.textContent = text;
        line.style.cssText = `color: ${color}; ${bold ? 'font-weight: 600;' : ''}`;
        return line;
    }

    renderBar(result = null) {
        if (!this.run && !result) {
            return;
        }
        const bar = this.ensureBar();
        bar.replaceChildren();

        if (result?.finished) {
            bar.appendChild(this.makeLine(t('scrollPlanner.doneTitle'), '#4ade80', true));
            if (result.skipped.length > 0) {
                const names = result.skipped.map((hrid) => this.getScrollName(hrid)).join(', ');
                bar.appendChild(this.makeLine(t('scrollPlanner.doneSkipped', { items: names }), '#aaa'));
            }
            const actions = document.createElement('div');
            actions.style.cssText = 'margin-top: 8px; display: flex; gap: 8px; justify-content: flex-end;';
            actions.appendChild(
                this.makeButton(
                    t('scrollPlanner.close'),
                    () => {
                        this.bar?.remove();
                        this.bar = null;
                    },
                    true
                )
            );
            bar.appendChild(actions);
            return;
        }

        const current = getCurrentStep(this.run.steps, this.getItems());
        if (!current) {
            return;
        }
        const { step, index } = current;
        const quantity = getRemainingQuantity(step, this.getItems());

        bar.appendChild(
            this.makeLine(
                t('scrollPlanner.barProgress', {
                    index: index + 1,
                    total: this.run.steps.length,
                    name: this.getScrollName(step.itemHrid),
                    quantity,
                }),
                '#fbbf24',
                true
            )
        );

        if (this.prefillFailedHrid === step.itemHrid) {
            bar.appendChild(this.makeLine(t('scrollPlanner.barPrefillFailed', { quantity }), '#f87171'));
        } else if (document.querySelector('[class*="Item_actionMenu"]')) {
            bar.appendChild(this.makeLine(t('scrollPlanner.barMenuReadyHint'), '#ddd'));
        } else {
            bar.appendChild(this.makeLine(t('scrollPlanner.barOpenMenuHint'), '#ddd'));
        }

        if (this.shortfalls.length > 0) {
            const items = this.shortfalls
                .map((entry) => `${this.getScrollName(entry.itemHrid)} (${entry.planned} → ${entry.owned})`)
                .join(', ');
            bar.appendChild(this.makeLine(t('scrollPlanner.shortfallNote', { items }), '#f59e0b'));
        }

        const actions = document.createElement('div');
        actions.style.cssText = 'margin-top: 8px; display: flex; gap: 8px; justify-content: flex-end;';
        actions.appendChild(this.makeButton(t('scrollPlanner.showScroll'), () => this.autoOpenCurrentScroll(true)));
        actions.appendChild(this.makeButton(t('scrollPlanner.skip'), () => this.skipCurrentStep()));
        actions.appendChild(this.makeButton(t('scrollPlanner.stop'), () => this.stopRun()));
        bar.appendChild(actions);
    }

    // ---------------------------------------------------------------------
    // Plan modal
    // ---------------------------------------------------------------------

    openModal() {
        this.modal?.remove();
        this.modal = document.createElement('div');
        this.modal.className = 'toolasha-scroll-planner-modal';
        this.modal.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;
        this.modal.addEventListener('click', (event) => {
            if (event.target === this.modal) {
                this.closeModal();
            }
        });
        document.body.appendChild(this.modal);
        this.renderModal('');
    }

    closeModal() {
        this.modal?.remove();
        this.modal = null;
    }

    renderModal(message, messageColor = '#f87171') {
        if (!this.modal) {
            return;
        }
        this.modal.replaceChildren();

        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            min-width: 360px;
            max-width: 95vw;
            max-height: 90%;
            overflow: auto;
            color: #fff;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            ${CSS_FONT}
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
        const title = document.createElement('h3');
        title.textContent = t('scrollPlanner.modalTitle');
        title.style.cssText = 'margin: 0; color: #fff;';
        header.appendChild(title);
        header.appendChild(this.makeButton('✕', () => this.closeModal()));
        content.appendChild(header);

        const help = this.makeLine(t('scrollPlanner.modalHelp'), '#aaa');
        help.style.cssText += 'margin: 8px 0 12px;';
        content.appendChild(help);

        const totalLine = this.makeLine('', '#ddd');
        const updateTotal = () => {
            const total = Object.values(this.draft).reduce((sum, value) => sum + value, 0);
            totalLine.textContent = t('scrollPlanner.totalLabel', { count: total });
        };

        for (const itemHrid of this.getScrollHrids()) {
            content.appendChild(this.buildRow(itemHrid, updateTotal));
        }

        totalLine.style.cssText += 'margin-top: 10px;';
        updateTotal();
        content.appendChild(totalLine);

        const status = this.makeLine(message, messageColor);
        status.style.cssText += 'margin-top: 6px; min-height: 18px;';
        content.appendChild(status);

        const footer = document.createElement('div');
        footer.style.cssText = 'margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;';
        footer.appendChild(
            this.makeButton(t('scrollPlanner.clear'), () => {
                this.draft = {};
                this.renderModal('');
            })
        );
        footer.appendChild(this.makeButton(t('scrollPlanner.loadLast'), () => this.loadLastIntoDraft()));
        footer.appendChild(
            this.makeButton(
                t('scrollPlanner.start'),
                async () => {
                    const result = await this.startRun(this.draft);
                    if (result.error) {
                        this.renderModal(result.error);
                    }
                },
                true
            )
        );
        content.appendChild(footer);

        this.modal.appendChild(content);
    }

    buildRow(itemHrid, updateTotal) {
        const owned = getOwnedCount(this.getItems(), itemHrid);

        const row = document.createElement('div');
        row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 3px 0; opacity: ${owned > 0 ? 1 : 0.55};`;

        const name = document.createElement('span');
        name.textContent = this.getScrollName(itemHrid);
        name.style.cssText = 'flex: 1; min-width: 160px;';
        row.appendChild(name);

        const ownedLabel = document.createElement('span');
        ownedLabel.textContent = t('scrollPlanner.ownedLabel', { count: owned });
        ownedLabel.style.cssText = 'color: #aaa; min-width: 80px; text-align: right;';
        row.appendChild(ownedLabel);

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.value = this.draft[itemHrid] > 0 ? String(this.draft[itemHrid]) : '';
        input.style.cssText =
            'width: 64px; padding: 2px 4px; background: #1f1f1f; color: #fff; border: 1px solid #555; border-radius: 4px;';
        input.addEventListener('input', () => {
            const value = Math.floor(Number(input.value));
            if (value > 0) {
                this.draft[itemHrid] = value;
            } else {
                delete this.draft[itemHrid];
            }
            input.style.borderColor = value > owned ? '#f87171' : '#555';
            input.title = value > owned ? t('scrollPlanner.overOwned', { owned }) : '';
            updateTotal();
        });
        input.dispatchEvent(new Event('input'));
        row.appendChild(input);

        row.appendChild(
            this.makeButton(t('scrollPlanner.allButton'), () => {
                if (owned > 0) {
                    this.draft[itemHrid] = owned;
                    input.value = String(owned);
                    input.dispatchEvent(new Event('input'));
                }
            })
        );

        return row;
    }

    async loadLastIntoDraft() {
        const last = normalizePlan(await loadLastPlan(), this.getScrollHrids());
        if (Object.keys(last).length === 0) {
            this.renderModal(t('scrollPlanner.loadLastEmpty'));
            return;
        }
        this.draft = last;
        this.renderModal(t('scrollPlanner.loadedLast'), '#4ade80');
    }
}

const scrollPlanner = new ScrollPlanner();

export default {
    name: 'Scroll Planner',
    initialize: () => scrollPlanner.initialize(),
    cleanup: () => scrollPlanner.cleanup(),
};

export { ScrollPlanner };
