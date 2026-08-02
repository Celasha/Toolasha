// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest';
import {
    compactActionPanelSection,
    getOrCreateProductionToolsBlock,
    normalizeProductionToolsBlock,
} from './production-tools-layout.js';

function makeProductionPanel() {
    const panel = document.createElement('section');
    panel.className = 'SkillActionDetail_skillActionDetail__test';
    panel.innerHTML = `
        <div class="SkillActionDetail_info__test">
            <div class="SkillActionDetail_label__test">Requires</div>
            <div class="SkillActionDetail_value__test">
                <div class="SkillActionDetail_itemRequirements__test">10 Cheese</div>
            </div>
            <div class="SkillActionDetail_label__test">Upgrades From</div>
            <div class="SkillActionDetail_value__test">Cheese Sword</div>
            <div class="SkillActionDetail_label__test">Outputs</div>
            <div class="SkillActionDetail_value__test">Verdant Sword</div>
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

function appendTool(panel, id) {
    const tool = document.createElement('div');
    tool.id = id;
    panel.appendChild(tool);
    return tool;
}

describe('production-tools-layout', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('creates one full-width row immediately after the Requires value cell', () => {
        const panel = makeProductionPanel();
        const valueCell = panel.querySelector('[class*="SkillActionDetail_value"]');
        const block = getOrCreateProductionToolsBlock(panel);

        expect(block).not.toBeNull();
        expect(block.parentElement).toBe(valueCell.parentElement);
        expect(block.previousElementSibling).toBe(valueCell);
        expect(block.style.gridColumn).toBe('1 / -1');
        expect(block.style.width).toBe('100%');
    });

    test('keeps the native label/value sequence intact', () => {
        const panel = makeProductionPanel();
        const info = panel.querySelector('[class*="SkillActionDetail_info"]');
        getOrCreateProductionToolsBlock(panel);

        const children = Array.from(info.children);
        expect(children[0].textContent.trim()).toBe('Requires');
        expect(children[1].textContent.trim()).toBe('10 Cheese');
        expect(children[2].id).toBe('mwi-production-tools-block');
        expect(children[3].textContent.trim()).toBe('Upgrades From');
        expect(children[4].textContent.trim()).toBe('Cheese Sword');
        expect(children[5].textContent.trim()).toBe('Outputs');
        expect(children[6].textContent.trim()).toBe('Verdant Sword');
    });

    test('moves Missing Mats, Cost Summary and Budget into deterministic vertical order', () => {
        const panel = makeProductionPanel();
        const budget = appendTool(panel, 'mwi-budget-calculator');
        const button = appendTool(panel, 'mwi-missing-mats-button');
        const summary = appendTool(panel, 'mwi-cost-summary');

        const block = normalizeProductionToolsBlock(panel);

        expect(Array.from(block.children)).toEqual([button, summary, budget]);
        for (const child of block.children) {
            expect(child.style.width).toBe('100%');
            expect(child.style.maxWidth).toBe('100%');
            expect(['0', '0px']).toContain(child.style.minWidth);
        }
    });

    test('normalization is idempotent across empty and populated quantity rerenders', () => {
        const panel = makeProductionPanel();
        const block = getOrCreateProductionToolsBlock(panel);
        expect(block.children).toHaveLength(0);

        const button = appendTool(panel, 'mwi-missing-mats-button');
        normalizeProductionToolsBlock(panel);
        expect(block.children).toHaveLength(1);
        expect(block.firstElementChild).toBe(button);

        // Model quantity reset: the feature removes its button but the shared
        // layout row remains stable for the other companion controls.
        button.remove();
        const summary = appendTool(panel, 'mwi-cost-summary');
        const budget = appendTool(panel, 'mwi-budget-calculator');
        normalizeProductionToolsBlock(panel);
        normalizeProductionToolsBlock(panel);

        expect(Array.from(block.children)).toEqual([summary, budget]);
        expect(panel.querySelectorAll('#mwi-production-tools-block')).toHaveLength(1);
    });

    test('compactActionPanelSection changes only the supplied section', () => {
        const section = document.createElement('div');
        section.innerHTML = '<div class="mwi-section-header">Level Progress</div>';
        const untouched = document.createElement('div');
        document.body.append(section, untouched);

        compactActionPanelSection(section);

        expect(section.style.marginTop).toBe('5px');
        expect(section.style.marginBottom).toBe('5px');
        expect(section.firstElementChild.style.padding).toBe('3px 0px');
        expect(untouched.getAttribute('style')).toBeNull();
    });
});
