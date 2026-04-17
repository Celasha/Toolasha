/**
 * Scroll Simulator UI
 * - Injects "Scroll Simulation" button into the LoadoutsPanel nav buttons row
 *   (between "View All Loadouts" and "Delete Loadout")
 * - Opens a popup for selecting which scrolls to simulate for the loadout
 * - Also exposes openDefaultsPopup() for the settings panel button
 */

import domObserver from '../../core/dom-observer.js';
import config from '../../core/config.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import scrollSimulator from './scroll-simulator.js';
import { SCROLL_BUFF_ITEMS, SCROLL_BUFF_LABELS } from '../../utils/scroll-buff-values.js';

const BUTTON_ID = 'toolasha-scroll-sim-btn';
const POPUP_ID = 'toolasha-scroll-sim-popup';

// Ordered list of scroll buff types to display in the popup
const SCROLL_BUFF_ORDER = [
    '/buff_types/efficiency',
    '/buff_types/gathering',
    '/buff_types/wisdom',
    '/buff_types/action_speed',
    '/buff_types/rare_find',
    '/buff_types/processing',
    '/buff_types/gourmet',
];

// ─── Loadout name lookup ────────────────────────────────────────

/**
 * Try to read the current loadout name from siblings/ancestors of the nav buttons row.
 * @param {HTMLElement} navButtons
 * @returns {string|null}
 */
function getLoadoutName(navButtons) {
    const panel = navButtons.parentElement;
    if (!panel) return null;
    const metadata = panel.querySelector('[class*="LoadoutsPanel_metadata"]');
    if (!metadata) return null;
    // Structure: "Name" [skill svg] "LoadoutName" [Edit button]
    // Find the text node after the SVG (skip the "Name" label)
    let seenSvg = false;
    for (const child of metadata.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'svg') {
            seenSvg = true;
        } else if (seenSvg && child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent.trim();
            if (text) return text;
        }
    }
    return null;
}

// ─── Sprite helper ──────────────────────────────────────────────

let _spriteUrl = null;

function getItemsSpriteUrl() {
    if (_spriteUrl === null) {
        const el = document.querySelector('use[href*="items_sprite"]');
        _spriteUrl = el ? el.getAttribute('href').split('#')[0] : '';
    }
    return _spriteUrl;
}

function createScrollIcon(buffTypeHrid, size = 16) {
    const spriteUrl = getItemsSpriteUrl();
    if (!spriteUrl) return null;
    const itemSuffix = SCROLL_BUFF_ITEMS[buffTypeHrid];
    if (!itemSuffix) return null;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.style.cssText = 'flex-shrink:0; vertical-align:middle;';

    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `${spriteUrl}#${itemSuffix}`);
    svg.appendChild(use);
    return svg;
}

// ─── Popup ──────────────────────────────────────────────────────

class ScrollSimPopup {
    constructor() {
        this.container = null;
        this.loadoutName = null; // null = global defaults
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.dragMoveHandler = null;
        this.dragUpHandler = null;
        this.clickOutsideHandler = null;
    }

    /**
     * Open or re-open the popup for the given loadout (null = global defaults).
     * @param {string|null} loadoutName
     */
    open(loadoutName) {
        this.loadoutName = loadoutName;

        if (this.container) {
            bringPanelToFront(this.container);
            this._refreshBody();
            return;
        }

        this._build();
    }

    close() {
        this._teardown();
    }

    _build() {
        this.container = document.createElement('div');
        this.container.id = POPUP_ID;
        this.container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: ${config.Z_FLOATING_PANEL};
            width: 320px;
            display: flex;
            flex-direction: column;
            background: rgba(10, 10, 20, 0.96);
            border: 2px solid ${config.COLOR_ACCENT};
            border-radius: 8px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            user-select: none;
            overflow: hidden;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            cursor: grab;
            background: rgba(255,255,255,0.04);
            flex-shrink: 0;
        `;

        const title = document.createElement('span');
        title.style.cssText = `font-size: 0.9rem; font-weight: 600; color: ${config.COLOR_ACCENT};`;
        const contextLabel = this.loadoutName ? this.loadoutName : 'Defaults';
        title.textContent = `Scroll Simulation — ${contextLabel}`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: none; border: none; color: #aaa;
            font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 0 2px;
        `;
        closeBtn.addEventListener('mouseenter', () => (closeBtn.style.color = '#fff'));
        closeBtn.addEventListener('mouseleave', () => (closeBtn.style.color = '#aaa'));
        closeBtn.addEventListener('click', () => this.close());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.id = 'toolasha-scroll-sim-body';
        body.style.cssText = `flex: 1; overflow-y: auto; padding: 12px 14px;`;

        this.container.appendChild(header);
        this.container.appendChild(body);
        document.body.appendChild(this.container);
        registerFloatingPanel(this.container);

        this._renderBody(body);
        this._setupDragging(header);
        this._setupClickOutside();
    }

    _refreshBody() {
        const body = this.container?.querySelector('#toolasha-scroll-sim-body');
        if (!body) return;
        body.innerHTML = '';
        this._renderBody(body);
    }

    _renderBody(body) {
        const currentScrolls = scrollSimulator.getScrollsForLoadout(this.loadoutName);

        // Note
        const note = document.createElement('div');
        note.style.cssText = `
            font-size: 0.72rem;
            color: rgba(255,255,255,0.45);
            margin-bottom: 12px;
            font-style: italic;
            line-height: 1.4;
        `;
        note.textContent = this.loadoutName
            ? 'These scrolls override the defaults when this loadout is active for a skill.'
            : 'Applied when no loadout matches the current skill (or loadout snapshots are disabled).';
        body.appendChild(note);

        // Scroll rows
        for (const buffTypeHrid of SCROLL_BUFF_ORDER) {
            const row = document.createElement('label');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 0;
                cursor: pointer;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            `;
            row.addEventListener('mouseenter', () => (row.style.background = 'rgba(255,255,255,0.04)'));
            row.addEventListener('mouseleave', () => (row.style.background = ''));

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = currentScrolls.has(buffTypeHrid);
            checkbox.style.cssText = 'width:16px; height:16px; flex-shrink:0; cursor:pointer;';
            checkbox.addEventListener('change', () => this._onToggle());

            const icon = createScrollIcon(buffTypeHrid, 18);

            const label = document.createElement('span');
            label.style.cssText = `font-size: 0.82rem; color: rgba(255,255,255,0.85);`;
            label.textContent = SCROLL_BUFF_LABELS[buffTypeHrid];

            row.appendChild(checkbox);
            if (icon) row.appendChild(icon);
            row.appendChild(label);
            body.appendChild(row);
        }
    }

    async _onToggle() {
        const body = this.container?.querySelector('#toolasha-scroll-sim-body');
        if (!body) return;
        const checkboxes = body.querySelectorAll('input[type="checkbox"]');
        const selected = [];
        checkboxes.forEach((cb, i) => {
            if (cb.checked) selected.push(SCROLL_BUFF_ORDER[i]);
        });
        await scrollSimulator.saveScrollsForLoadout(this.loadoutName, selected);
    }

    _setupDragging(header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            bringPanelToFront(this.container);
            this.isDragging = true;
            const rect = this.container.getBoundingClientRect();
            this.container.style.transform = 'none';
            this.container.style.top = `${rect.top}px`;
            this.container.style.left = `${rect.left}px`;
            this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        this.dragMoveHandler = (e) => {
            if (!this.isDragging) return;
            let x = e.clientX - this.dragOffset.x;
            let y = e.clientY - this.dragOffset.y;
            const minVisible = 80;
            y = Math.max(0, Math.min(y, window.innerHeight - minVisible));
            x = Math.max(-this.container.offsetWidth + minVisible, Math.min(x, window.innerWidth - minVisible));
            this.container.style.top = `${y}px`;
            this.container.style.left = `${x}px`;
        };

        this.dragUpHandler = () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            header.style.cursor = 'grab';
        };

        document.addEventListener('mousemove', this.dragMoveHandler);
        document.addEventListener('mouseup', this.dragUpHandler);
    }

    _setupClickOutside() {
        this.clickOutsideHandler = (e) => {
            if (this.container && !this.container.contains(e.target)) {
                this.close();
            }
        };
        document.addEventListener('mousedown', this.clickOutsideHandler);
    }

    _teardown() {
        if (this.dragMoveHandler) {
            document.removeEventListener('mousemove', this.dragMoveHandler);
            this.dragMoveHandler = null;
        }
        if (this.dragUpHandler) {
            document.removeEventListener('mouseup', this.dragUpHandler);
            this.dragUpHandler = null;
        }
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
        if (this.container) {
            unregisterFloatingPanel(this.container);
            this.container.remove();
            this.container = null;
        }
        this.isDragging = false;
    }
}

const popup = new ScrollSimPopup();

// ─── Loadout panel button ───────────────────────────────────────

function injectButton(navButtons) {
    if (document.getElementById(BUTTON_ID)) return;

    const loadoutName = getLoadoutName(navButtons);

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.textContent = 'Scroll Simulation';
    button.className = 'Button_button__1Fe9z';
    button.style.cssText = `white-space: nowrap;`;
    button.addEventListener('click', () => popup.open(loadoutName));

    // Insert before the Delete Loadout button (Button_warning class)
    const deleteBtn = navButtons.querySelector('[class*="Button_warning"]');
    if (deleteBtn) {
        navButtons.insertBefore(button, deleteBtn);
    } else {
        navButtons.appendChild(button);
    }
}

// ─── Public API ─────────────────────────────────────────────────

function initialize() {
    domObserver.onClass('ScrollSimulatorUI', 'LoadoutsPanel_buttonsContainer', (node) => {
        const panel = node.closest('[class*="LoadoutsPanel_selectedLoadout"]') || node.parentElement;
        const navButtons = panel?.querySelector('[class*="LoadoutsPanel_navButtons"]');
        if (navButtons) injectButton(navButtons);
    });
}

/**
 * Open the defaults popup — called from the settings panel button.
 */
function openDefaultsPopup() {
    popup.open(null);
}

function disable() {
    document.getElementById(BUTTON_ID)?.remove();
    popup.close();
}

export default {
    name: 'Scroll Simulator UI',
    initialize,
    openDefaultsPopup,
    disable,
};
