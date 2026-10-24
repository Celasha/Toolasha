/**
 * Labyrinth Grid Scale
 * Adds a size stepper to the Labyrinth header row that scales the room grid. The game renders
 * each tile at a fixed 2.875rem, which leaves most of the panel empty. The grid is scaled with
 * CSS `zoom` so tiles, icons, level text and the clear rate badges all grow together.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import { t } from '../../core/i18n.js';
import { addStyles, removeStyles } from '../../utils/dom.js';

const CONTROL_CLASS = 'mwi-labyrinth-grid-scale';
const STYLE_ID = 'mwi-labyrinth-grid-scale-style';
const SCALE_SETTING = 'labyrinthGridScale';
const CONTROL_SETTING = 'labyrinthGridScaleControl';

export const MIN_SCALE = 1;
export const MAX_SCALE = 2;
export const SCALE_STEP = 0.25;

let domObserverUnregister = null;
let settingHandler = null;

/**
 * Clamp a stored value to a supported scale step.
 * @param {*} value
 * @returns {number}
 */
export function normalizeScale(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return MIN_SCALE;
    const stepped = Math.round(parsed / SCALE_STEP) * SCALE_STEP;
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, stepped));
}

function getScale() {
    return normalizeScale(config.getSettingValue(SCALE_SETTING, MIN_SCALE));
}

function applyScale(scale) {
    removeStyles(STYLE_ID);
    if (scale === MIN_SCALE) return;
    addStyles(`[class*="LabyrinthPanel_roomGrid"] { zoom: ${scale}; }`, STYLE_ID);
}

function setScale(scale) {
    config.setSettingValue(SCALE_SETTING, normalizeScale(scale));
}

function updateControls() {
    const scale = getScale();
    applyScale(scale);

    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => {
        control.querySelector('[data-role="value"]').textContent = `${Math.round(scale * 100)}%`;
        control.querySelector('[data-role="smaller"]').disabled = scale <= MIN_SCALE;
        control.querySelector('[data-role="larger"]').disabled = scale >= MAX_SCALE;
    });
}

function createStepButton(role, text, title, nativeButtonClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.role = role;
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    if (nativeButtonClass) button.className = nativeButtonClass;
    button.style.cssText = 'min-width:1.6em; padding-left:6px; padding-right:6px;';
    return button;
}

/**
 * Inject the stepper into the header row, once per rendered panel instance.
 * @param {Element} chargeLeft - The LabyrinthPanel_chargeLeft element.
 */
export function injectControl(chargeLeft) {
    if (!chargeLeft || chargeLeft.querySelector(`.${CONTROL_CLASS}`)) return;

    // Reuse the native "Upgrade" button's classes so the stepper matches the game's buttons.
    const nativeButtonClass = chargeLeft.querySelector('button')?.className || '';

    const control = document.createElement('div');
    control.className = CONTROL_CLASS;
    control.style.cssText = 'display:flex; align-items:center; gap:4px;';

    const label = document.createElement('span');
    label.textContent = t('labyrinthGridScale.label');

    const smaller = createStepButton('smaller', '−', t('labyrinthGridScale.smaller'), nativeButtonClass);
    const value = document.createElement('span');
    value.dataset.role = 'value';
    value.style.cssText = 'min-width:3em; text-align:center;';
    const larger = createStepButton('larger', '+', t('labyrinthGridScale.larger'), nativeButtonClass);

    smaller.addEventListener('click', () => setScale(getScale() - SCALE_STEP));
    larger.addEventListener('click', () => setScale(getScale() + SCALE_STEP));

    control.append(label, smaller, value, larger);
    chargeLeft.appendChild(control);
    updateControls();
}

export function initialize() {
    if (!config.getSetting(CONTROL_SETTING)) {
        return;
    }

    applyScale(getScale());

    settingHandler = () => updateControls();
    config.onSettingChange(SCALE_SETTING, settingHandler);

    domObserverUnregister = domObserver.onClass('LabyrinthGridScale', 'LabyrinthPanel_chargeLeft', (el) =>
        injectControl(el)
    );

    document.querySelectorAll('[class*="LabyrinthPanel_chargeLeft"]').forEach((el) => injectControl(el));
}

export function cleanup() {
    if (domObserverUnregister) {
        domObserverUnregister();
        domObserverUnregister = null;
    }

    if (settingHandler) {
        config.offSettingChange(SCALE_SETTING, settingHandler);
        settingHandler = null;
    }

    removeStyles(STYLE_ID);
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((el) => el.remove());
}

export default {
    initialize,
    cleanup,
};
