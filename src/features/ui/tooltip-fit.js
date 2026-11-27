/**
 * Tooltip Fit
 * Keeps every tooltip on screen. Item tooltips are the long ones, but any tooltip can end up taller
 * than the window or hanging off an edge once Toolasha (or another script) adds to it. The game's
 * tooltips ignore the mouse, so they cannot be scrolled; instead a too-tall tooltip is shrunk to fit
 * and moved back into view (see fixTooltipOverflow).
 *
 * Features that fill in a tooltip call fixTooltipOverflow themselves, but only for the tooltips they
 * handle and only once, so a tooltip filled in later, or by something that never calls it, was left
 * overflowing. This watches every tooltip popup and re-fits it whenever its size changes.
 */

import domObserver from '../../core/dom-observer.js';
import { fixTooltipOverflow } from '../../utils/dom.js';

const tooltipFit = {
    unregister: null,
    observers: new Map(),

    initialize() {
        if (this.unregister) return;
        this.unregister = domObserver.onClass('TooltipFit', 'MuiTooltip-popper', (popper) => this.watch(popper));
    },

    /**
     * Fit a tooltip now and again whenever its content changes size
     * @param {Element} popper - The MuiTooltip-popper element
     */
    watch(popper) {
        if (this.observers.has(popper)) return;
        fixTooltipOverflow(popper);

        const inner = popper.querySelector('.MuiTooltip-tooltip');
        if (!inner || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            if (!popper.isConnected) {
                this.forget(popper);
                return;
            }
            fixTooltipOverflow(popper);
        });
        observer.observe(inner);
        this.observers.set(popper, observer);
    },

    forget(popper) {
        this.observers.get(popper)?.disconnect();
        this.observers.delete(popper);
    },

    disable() {
        this.unregister?.();
        this.unregister = null;
        for (const observer of this.observers.values()) observer.disconnect();
        this.observers.clear();
    },
};

export default tooltipFit;
