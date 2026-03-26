/**
 * Floating Panel Z-Index Manager
 * Manages bring-to-front ordering for persistent floating panels.
 * All panels are capped below config.Z_FLOATING_PANEL + 99 (1199)
 * so they never cross the game's MUI modal layer (~1300).
 */

import config from '../core/config.js';

const panels = new Set();

/**
 * Register a floating panel element for z-index management
 * @param {HTMLElement} el - The panel element
 */
export function registerFloatingPanel(el) {
    panels.add(el);
}

/**
 * Unregister a floating panel element
 * @param {HTMLElement} el - The panel element
 */
export function unregisterFloatingPanel(el) {
    panels.delete(el);
}

/**
 * Bring a panel to the front among all registered panels,
 * without exceeding config.Z_FLOATING_PANEL + 99.
 * @param {HTMLElement} el - The panel to bring forward
 */
export function bringPanelToFront(el) {
    const base = config.Z_FLOATING_PANEL;
    const cap = base + 99;

    let maxZ = base;
    for (const p of panels) {
        const z = parseInt(p.style.zIndex) || base;
        if (z > maxZ) maxZ = z;
    }

    const next = maxZ + 1;
    if (next > cap) {
        // Overflow — reassign all from base upward, put el last
        let i = base;
        for (const p of panels) {
            if (p !== el) p.style.zIndex = String(i++);
        }
        el.style.zIndex = String(i);
    } else {
        el.style.zIndex = String(next);
    }
}
