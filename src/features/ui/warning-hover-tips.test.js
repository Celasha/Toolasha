/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../core/i18n.js', () => ({ t: (key) => key }));

const { default: warningHoverTips, warningTitleKey, explainWarningAt } = await import('./warning-hover-tips.js');

function hover(el) {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

describe('warningTitleKey', () => {
    test.each([
        ['-- ⚠', 'warningHover.missingPrice'],
        ['Profit/hr: -- ⚠', 'warningHover.missingPrice'],
        ['123K ⚠', 'warningHover.estimatedPrice'],
        ['123K/hr ⚠', 'warningHover.estimatedPrice'],
        ['Net: 4.5M⚠', 'warningHover.estimatedPrice'],
        ['123K ⚠ (456K/day ⚠)', 'warningHover.estimatedPrice'],
    ])('%s -> %s', (text, expected) => {
        expect(warningTitleKey(text)).toBe(expected);
    });

    test.each([
        ['no warning here'],
        ['⚠ Partial - could not value 2 item(s)'],
        ['⚠ Disconnected from game tab'],
        ['  ⚠ Tax: Off'],
        ['Equipped ⚠ (saved Gathering unavailable)'],
        ['Equipped ⚠ saved loadout unavailable'],
        ['123K ⚠ 催化剂'],
    ])('%s needs no extra explanation', (text) => {
        expect(warningTitleKey(text)).toBeNull();
    });
});

describe('warning hover tips', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        warningHoverTips.initialize();
    });

    afterEach(() => {
        warningHoverTips.disable();
    });

    test('explains a missing price on hover', () => {
        document.body.innerHTML = '<div id="a">Revenue: -- ⚠</div>';
        const el = document.getElementById('a');

        hover(el);

        expect(el.title).toBe('warningHover.missingPrice');
    });

    test('explains an estimated or substituted price on hover', () => {
        document.body.innerHTML = '<div id="a">Revenue: 123K/hr ⚠</div>';
        const el = document.getElementById('a');

        hover(el);

        expect(el.title).toBe('warningHover.estimatedPrice');
    });

    test('puts the title on the element that holds the ⚠ when a child is hovered', () => {
        document.body.innerHTML = '<div id="line">Revenue: 123K ⚠<span id="child">detail</span></div>';

        hover(document.getElementById('child'));

        expect(document.getElementById('line').title).toBe('warningHover.estimatedPrice');
        expect(document.getElementById('child').title).toBe('');
    });

    test('leaves an element that already has a title alone, and one whose child has its own title', () => {
        document.body.innerHTML = `
            <div id="mine" title="custom">Price 1 ⚠</div>
            <div id="line">Price 2 ⚠<span id="icon" title="icon title">i</span></div>`;

        hover(document.getElementById('mine'));
        hover(document.getElementById('icon'));

        expect(document.getElementById('mine').title).toBe('custom');
        expect(document.getElementById('line').title).toBe('');
    });

    test('does not touch a ⚠ that opens a message or is followed by its own explanation', () => {
        document.body.innerHTML = `
            <div id="a">⚠ Disconnected from game tab</div>
            <div id="b">Equipped ⚠ (saved loadout unavailable)</div>`;

        hover(document.getElementById('a'));
        hover(document.getElementById('b'));

        expect(document.getElementById('a').title).toBe('');
        expect(document.getElementById('b').title).toBe('');
    });

    test('leaves chat, inputs and unrelated elements alone', () => {
        document.body.innerHTML = `
            <div class="Chat_message__x" id="chat">hello 5 ⚠</div>
            <textarea id="box">draft 5 ⚠</textarea>
            <div id="plain">nothing to see</div>`;

        hover(document.getElementById('chat'));
        hover(document.getElementById('box'));
        hover(document.getElementById('plain'));

        expect(document.getElementById('chat').title).toBe('');
        expect(document.getElementById('box').title).toBe('');
        expect(document.getElementById('plain').title).toBe('');
    });

    test('a ⚠ nested more than three levels above the pointer is not reached', () => {
        document.body.innerHTML =
            '<div id="top">Price 1 ⚠<div><div><div><div><span id="deep">x</span></div></div></div></div></div>';

        hover(document.getElementById('deep'));

        expect(document.getElementById('top').title).toBe('');
    });

    test('removes a title it set once the ⚠ is gone, and does not strip anyone elses', () => {
        document.body.innerHTML = '<div id="a">Price 1 ⚠</div><div id="b" title="mine">fine</div>';
        const a = document.getElementById('a');
        hover(a);
        expect(a.title).toBe('warningHover.estimatedPrice');

        a.textContent = 'Price 1';
        hover(a);

        expect(a.hasAttribute('title')).toBe(false);
        expect(a.hasAttribute('data-mwi-warning-title')).toBe(false);
        hover(document.getElementById('b'));
        expect(document.getElementById('b').title).toBe('mine');
    });

    test('updates the explanation when the kind of warning changes', () => {
        document.body.innerHTML = '<div id="a">Price 1 ⚠</div>';
        const a = document.getElementById('a');
        hover(a);

        a.textContent = '-- ⚠';
        hover(a);

        expect(a.title).toBe('warningHover.missingPrice');
    });

    test('explainWarningAt can be called directly', () => {
        document.body.innerHTML = '<div id="a">-- ⚠</div>';

        explainWarningAt(document.getElementById('a'));

        expect(document.getElementById('a').title).toBe('warningHover.missingPrice');
    });

    test('disable stops listening and removes the titles it set', () => {
        document.body.innerHTML = '<div id="a">Price 1 ⚠</div><div id="b">Price 2 ⚠</div>';
        hover(document.getElementById('a'));
        expect(document.getElementById('a').title).not.toBe('');

        warningHoverTips.disable();
        hover(document.getElementById('b'));

        expect(document.getElementById('a').hasAttribute('title')).toBe(false);
        expect(document.getElementById('b').title).toBe('');
    });

    test('initialize is idempotent', () => {
        warningHoverTips.initialize();
        warningHoverTips.initialize();
        document.body.innerHTML = '<div id="a">-- ⚠</div>';

        hover(document.getElementById('a'));

        expect(document.getElementById('a').title).toBe('warningHover.missingPrice');
    });
});
