/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { observerCallbacks, mockOnClass, storageGet, storageSet } = vi.hoisted(() => {
    const observerCallbacks = new Map();
    const mockOnClass = vi.fn((id, _className, callback) => {
        observerCallbacks.set(id, callback);
        return vi.fn(() => observerCallbacks.delete(id));
    });
    return {
        observerCallbacks,
        mockOnClass,
        storageGet: vi.fn(),
        storageSet: vi.fn(),
    };
});

vi.mock('../../core/dom-observer.js', () => ({
    default: { onClass: mockOnClass },
}));

vi.mock('../../core/storage.js', () => ({
    default: { get: storageGet, set: storageSet },
}));

vi.mock('../../core/config.js', () => ({
    default: { getSetting: vi.fn(() => true) },
}));

const { DraggableModals } = await import('./draggable-modals.js');

function makeModalContent(title = 'Sell Listing') {
    const modalBox = document.createElement('div');
    modalBox.className = 'Modal_modal';
    const contentEl = document.createElement('div');
    contentEl.className = 'Modal_modalContent';
    contentEl.innerHTML = `<h2>${title}</h2>`;
    modalBox.appendChild(contentEl);
    document.body.appendChild(modalBox);
    return { modalBox, contentEl };
}

describe('DraggableModals off-screen clamping', () => {
    let createdFeatures;

    beforeEach(() => {
        vi.stubGlobal('innerWidth', 1000);
        vi.stubGlobal('innerHeight', 800);
        vi.stubGlobal('requestAnimationFrame', (cb) => cb());
        observerCallbacks.clear();
        mockOnClass.mockClear();
        storageGet.mockReset().mockResolvedValue({});
        storageSet.mockReset();
        document.body.innerHTML = '';
        createdFeatures = [];
    });

    afterEach(() => {
        createdFeatures.forEach((feature) => feature.disable());
        vi.unstubAllGlobals();
    });

    function makeFeature() {
        const feature = new DraggableModals();
        createdFeatures.push(feature);
        return feature;
    }

    async function initAndEmit(feature, content) {
        await feature.initialize();
        const callback = observerCallbacks.get('DraggableModals');
        expect(callback).toBeTypeOf('function');
        callback(content);
    }

    test('_clampOffset keeps the top edge from going above the viewport', () => {
        const feature = makeFeature();
        const naturalRect = { left: 100, top: 100, width: 300 };
        const clamped = feature._clampOffset(naturalRect, 0, -500);
        expect(naturalRect.top + clamped.dy).toBe(0);
    });

    test('_clampOffset keeps the bottom edge reachable when dragged far down', () => {
        const feature = makeFeature();
        const naturalRect = { left: 100, top: 100, width: 300 };
        const clamped = feature._clampOffset(naturalRect, 0, 5000);
        expect(naturalRect.top + clamped.dy).toBe(800 - 30);
    });

    test('_clampOffset keeps a horizontal margin reachable on both sides', () => {
        const feature = makeFeature();
        const naturalRect = { left: 400, top: 100, width: 300 };
        const draggedFarRight = feature._clampOffset(naturalRect, 5000, 0);
        expect(naturalRect.left + draggedFarRight.dx).toBe(1000 - 60);

        const draggedFarLeft = feature._clampOffset(naturalRect, -5000, 0);
        expect(naturalRect.left + draggedFarLeft.dx).toBe(60 - 300);
    });

    test('_clampOffset leaves an already on-screen offset untouched', () => {
        const feature = makeFeature();
        const naturalRect = { left: 100, top: 100, width: 300 };
        const clamped = feature._clampOffset(naturalRect, 20, 20);
        expect(clamped).toEqual({ dx: 20, dy: 20 });
    });

    test('self-heals a saved offset that would place the modal off-screen, and re-saves it', async () => {
        storageGet.mockResolvedValue({ 'Sell Listing': { dx: 0, dy: -9000 } });
        const feature = makeFeature();
        const { modalBox, contentEl } = makeModalContent('Sell Listing');
        modalBox.getBoundingClientRect = () => ({ left: 100, top: 100, width: 300 });

        await initAndEmit(feature, contentEl);

        expect(modalBox.style.transform).toBe('translate(0px, -100px)');
        expect(storageSet).toHaveBeenCalledWith('modalPositions3', { 'Sell Listing': { dx: 0, dy: -100 } }, 'settings');
    });

    test('does not re-save an already on-screen saved offset', async () => {
        storageGet.mockResolvedValue({ 'Sell Listing': { dx: 10, dy: 10 } });
        const feature = makeFeature();
        const { modalBox, contentEl } = makeModalContent('Sell Listing');
        modalBox.getBoundingClientRect = () => ({ left: 100, top: 100, width: 300 });

        await initAndEmit(feature, contentEl);

        expect(modalBox.style.transform).toBe('translate(10px, 10px)');
        expect(storageSet).not.toHaveBeenCalled();
    });
});
