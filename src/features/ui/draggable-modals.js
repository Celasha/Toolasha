/**
 * Draggable Modals
 * Makes game modals draggable and remembers their last position per modal title.
 *
 * DOM structure (confirmed via console inspection):
 *   Modal_modalContainer  — position:fixed, top:0, left:0, full-viewport flex overlay
 *     Modal_background    — dark backdrop
 *     Modal_modal         — visible dialog (display:grid) ← transform applied here
 *       Modal_modalContent
 *         MarketplacePanel_modalContent (display:flex)
 *           MarketplacePanel_header  ← "Buy Now" title lives here
 *           ...fields...
 *       Modal_closeButton
 *
 * Selector: watch 'Modal_modalContent' (not 'Modal_modal') — otherwise the observer
 * also fires for 'Modal_modalContainer' since it contains the same substring.
 *
 * Positioning: transform:translate(dx,dy) on Modal_modal — moves the visual element
 * without touching layout, so backdrop and flex container are completely unaffected.
 */

import domObserver from '../../core/dom-observer.js';
import storage from '../../core/storage.js';
import config from '../../core/config.js';

const STORAGE_KEY = 'modalPositions3';
const STORE_NAME = 'settings';

class DraggableModals {
    constructor() {
        this.offsets = {}; // title → { dx, dy }
        this.unregisterObserver = null;
        this.initialized = false;
        this.dragListeners = []; // { onMouseMove, onMouseUp } pairs awaiting removal
    }

    async initialize() {
        if (this.initialized) return;
        if (!config.getSetting('draggableModals', true)) return;

        this.offsets = (await storage.get(STORAGE_KEY, STORE_NAME, {})) || {};

        // Watch Modal_modalContent — unique to the inner dialog content element.
        // Its parentElement is Modal_modal (the box we apply transform to).
        this.unregisterObserver = domObserver.onClass('DraggableModals', 'Modal_modalContent', (contentEl) => {
            const modalBox = contentEl.parentElement;
            if (!modalBox) return;
            // Guard against double-processing (e.g. if observer fires twice)
            if (modalBox.dataset.mwiDraggable) return;
            modalBox.dataset.mwiDraggable = '1';
            this._makeDraggable(modalBox, contentEl);
        });

        this.initialized = true;
    }

    _getTitle(contentEl) {
        // Title is inside the inner content element, not directly in Modal_modal
        const h = contentEl.querySelector('h1, h2, h3, h4, [class*="header"], [class*="Header"]');
        return h?.textContent?.trim().substring(0, 40) || 'modal';
    }

    _applyTransform(modalBox, dx, dy) {
        modalBox.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    /**
     * Clamp an offset so the modal box (at its natural, untransformed rect) stays
     * reachable on-screen - the drag bar sits at its top edge, so keeping the top
     * within the viewport and a horizontal margin visible is enough to always be
     * able to grab it again.
     * @param {{left: number, top: number, width: number}} naturalRect
     */
    _clampOffset(naturalRect, dx, dy) {
        const minVisible = 60;
        const barHeight = 30;

        const top = naturalRect.top + dy;
        const clampedTop = Math.max(0, Math.min(top, window.innerHeight - barHeight));

        const left = naturalRect.left + dx;
        const clampedLeft = Math.min(Math.max(left, minVisible - naturalRect.width), window.innerWidth - minVisible);

        return { dx: clampedLeft - naturalRect.left, dy: clampedTop - naturalRect.top };
    }

    _makeDraggable(modalBox, contentEl) {
        const title = this._getTitle(contentEl);

        // Inject drag bar into contentEl (Modal_modalContent), not the grid parent.
        // contentEl is a plain wrapper so prepending places the bar at the top visually.
        const bar = document.createElement('div');
        bar.className = 'mwi-drag-bar';
        bar.title = 'Drag to move';
        bar.style.cssText = [
            'width: 100%',
            'padding: 4px 0',
            'text-align: center',
            'cursor: grab',
            'font-size: 11px',
            'color: rgba(255,255,255,0.4)',
            'letter-spacing: 4px',
            'user-select: none',
            'border-bottom: 1px solid rgba(255,255,255,0.08)',
            'box-sizing: border-box',
        ].join(';');
        bar.textContent = '· · · · ·';
        contentEl.insertBefore(bar, contentEl.firstChild);

        // Apply saved offset, self-healing (and re-saving) it if it would place the
        // modal off-screen - fixes a modal type stuck off-screen from a past drag.
        if (this.offsets[title]) {
            requestAnimationFrame(() => {
                const naturalRect = modalBox.getBoundingClientRect();
                const { dx, dy } = this.offsets[title];
                const clamped = this._clampOffset(naturalRect, dx, dy);
                this._applyTransform(modalBox, clamped.dx, clamped.dy);
                if (clamped.dx !== dx || clamped.dy !== dy) {
                    this.offsets[title] = clamped;
                    storage.set(STORAGE_KEY, this.offsets, STORE_NAME);
                }
            });
        }

        let dragging = false;
        let startMouseX = 0;
        let startMouseY = 0;
        let startDx = 0;
        let startDy = 0;
        let naturalRect = null;

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            dragging = true;
            startMouseX = e.clientX;
            startMouseY = e.clientY;

            const t = new DOMMatrix(window.getComputedStyle(modalBox).transform);
            startDx = isNaN(t.m41) ? 0 : t.m41;
            startDy = isNaN(t.m42) ? 0 : t.m42;

            const rect = modalBox.getBoundingClientRect();
            naturalRect = { left: rect.left - startDx, top: rect.top - startDy, width: rect.width };

            bar.style.cursor = 'grabbing';
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!dragging) return;
            const rawDx = startDx + (e.clientX - startMouseX);
            const rawDy = startDy + (e.clientY - startMouseY);
            const { dx, dy } = this._clampOffset(naturalRect, rawDx, rawDy);
            this._applyTransform(modalBox, dx, dy);
        };

        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            bar.style.cursor = 'grab';

            const t = new DOMMatrix(window.getComputedStyle(modalBox).transform);
            const dx = isNaN(t.m41) ? 0 : t.m41;
            const dy = isNaN(t.m42) ? 0 : t.m42;
            this.offsets[title] = { dx, dy };
            storage.set(STORAGE_KEY, this.offsets, STORE_NAME);
        };

        bar.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Track listeners so disable() can remove them if the modal is still open
        const entry = { onMouseMove, onMouseUp };
        this.dragListeners.push(entry);

        // Remove document listeners as soon as the modal element is detached
        const observer = new MutationObserver(() => {
            if (!document.contains(modalBox)) {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                const idx = this.dragListeners.indexOf(entry);
                if (idx !== -1) this.dragListeners.splice(idx, 1);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    disable() {
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        for (const { onMouseMove, onMouseUp } of this.dragListeners) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        this.dragListeners = [];
        this.offsets = {};
        this.initialized = false;
    }
}

const draggableModals = new DraggableModals();

export { DraggableModals };

export default {
    name: 'Draggable Modals',
    initialize: () => draggableModals.initialize(),
    cleanup: () => draggableModals.disable(),
};
