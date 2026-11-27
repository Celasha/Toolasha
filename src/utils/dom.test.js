/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fixTooltipOverflow } from './dom.js';

const VIEWPORT_HEIGHT = 800;

// A popper holding a tooltip, with the layout sizes jsdom cannot compute. `top` is the popper's
// current on-screen top; the transform's Y follows it like MUI's translate3d positioning does.
function makeTooltip({ top, contentHeight, popperHeight = contentHeight }) {
    const popper = document.createElement('div');
    popper.className = 'MuiTooltip-popper';
    popper.style.transform = `translate3d(100px, ${top}px, 0px)`;
    popper.getBoundingClientRect = () => {
        const y = parseFloat(popper.style.transform.match(/translate3d\([^,]+,\s*([^,]+),/)[1]);
        return { top: y, bottom: y + popperHeight, height: popperHeight, width: 300, left: 100, right: 400 };
    };

    const content = document.createElement('div');
    content.className = 'MuiTooltip-tooltip';
    Object.defineProperty(content, 'offsetHeight', { value: contentHeight, configurable: true });
    popper.appendChild(content);
    document.body.appendChild(popper);
    return { popper, content };
}

describe('fixTooltipOverflow', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT);
        vi.stubGlobal('innerWidth', 1200);
        vi.stubGlobal('requestAnimationFrame', (callback) => callback());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('leaves a tooltip that fits untouched', () => {
        const { popper, content } = makeTooltip({ top: 100, contentHeight: 300 });

        fixTooltipOverflow(popper);

        expect(popper.style.transform).toBe('translate3d(100px, 100px, 0px)');
        expect(content.style.transform).toBe('');
    });

    test('moves a tooltip that fits but hangs off the bottom back up, without scaling it', () => {
        const { popper, content } = makeTooltip({ top: 600, contentHeight: 300 });

        fixTooltipOverflow(popper);

        expect(content.style.transform).toBe('');
        expect(popper.style.transform).toBe('translate3d(100px, 490px, 0px)');
    });

    test('scales a tooltip taller than the viewport to fit instead of capping it for scrolling', () => {
        const { popper, content } = makeTooltip({ top: 50, contentHeight: 1000 });

        fixTooltipOverflow(popper);

        // (800 - 2 * 10) / 1000
        expect(content.style.transform).toBe('scale(0.78)');
        expect(content.style.transformOrigin).toBe('top left');
        expect(content.style.maxHeight).toBe('none');
        expect(content.style.overflowY).not.toBe('auto');
        // Scaled height is 780, so the popper is moved up until it ends inside the viewport
        const y = parseFloat(popper.style.transform.match(/translate3d\([^,]+,\s*([^,]+),/)[1]);
        expect(y + 1000 * 0.78).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
        expect(y).toBeGreaterThanOrEqual(0);
    });

    test('never shrinks below the minimum scale and pins a still-too-tall tooltip to the top', () => {
        const { popper, content } = makeTooltip({ top: 200, contentHeight: 3000 });

        fixTooltipOverflow(popper);

        expect(content.style.transform).toBe('scale(0.5)');
        expect(popper.style.transform).toBe('translate3d(100px, 0px, 0px)');
    });

    test('measures the layout height each time, so a second pass after the content shrinks restores full size', () => {
        const { popper, content } = makeTooltip({ top: 50, contentHeight: 1000 });
        fixTooltipOverflow(popper);
        expect(content.style.transform).toBe('scale(0.78)');

        Object.defineProperty(content, 'offsetHeight', { value: 400, configurable: true });
        fixTooltipOverflow(popper);

        expect(content.style.transform).toBe('');
    });

    test('forceTop pins the tooltip at the top centre and scales a tall one', () => {
        const { popper, content } = makeTooltip({ top: 300, contentHeight: 1000 });

        fixTooltipOverflow(popper, { forceTop: true });

        expect(popper.style.position).toBe('fixed');
        expect(popper.style.top).toBe('10px');
        expect(popper.style.left).toBe('450px');
        expect(content.style.transform).toBe('scale(0.78)');
        expect(content.style.transformOrigin).toBe('top center');
    });

    test('does nothing for a tooltip that has already been removed', () => {
        const { popper, content } = makeTooltip({ top: 50, contentHeight: 1000 });
        popper.remove();

        fixTooltipOverflow(popper);

        expect(content.style.transform).toBe('');
    });
});
