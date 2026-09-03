/**
 * Task Card Visual State
 * Shared repaint for the reroll-related border/badge on a task card. Task Reroll Protection,
 * Task Auto-Reroll Reminder, and Task Token Threshold each write their own signal to a dataset
 * flag on the card and then call repaintTaskCard — so whichever of the three DOM-mutation hooks
 * fires last still produces the correct, order-independent result: a reroll-worthy signal
 * (manual auto-reroll list match, or token threshold qualifying) always wins the red
 * border/badge, even over manual protection's green border.
 */

const OUTLINE_RED = '2px solid rgba(239, 68, 68, 0.7)';
const SHADOW_RED = '0 0 8px 2px rgba(239, 68, 68, 0.3)';
const OUTLINE_GREEN = '2px solid rgba(76, 175, 80, 0.7)';
const SHADOW_GREEN = '0 0 8px 2px rgba(76, 175, 80, 0.3)';
const OUTLINE_ORANGE = '2px solid rgba(251, 146, 60, 0.7)';
const SHADOW_ORANGE = '0 0 8px 2px rgba(251, 146, 60, 0.3)';

/**
 * Recompute and apply a task card's border/badge from its current dataset signal flags.
 * @param {HTMLElement} taskCard
 */
export function repaintTaskCard(taskCard) {
    const isAutoReroll = taskCard.dataset.mwiAutoReroll === '1';
    const isTokenFlagged = taskCard.dataset.mwiTokenFlag === '1';
    const isProtected = taskCard.dataset.mwiProtected === '1';
    const isAtCap = taskCard.dataset.mwiAtCap === '1';

    _clearBadge(taskCard, 'mwi-autoreroll-badge');
    _clearBadge(taskCard, 'mwi-token-badge');

    if (isAutoReroll || isTokenFlagged) {
        _setOutline(taskCard, OUTLINE_RED, SHADOW_RED);
        if (isAutoReroll) {
            _showBadge(taskCard, 'mwi-autoreroll-badge', 'Reroll!');
        } else {
            _showBadge(taskCard, 'mwi-token-badge', taskCard.dataset.mwiTokenFlagText || 'Low tokens!');
        }
        return;
    }

    if (isProtected) {
        _setOutline(taskCard, OUTLINE_GREEN, SHADOW_GREEN);
        return;
    }

    if (isAtCap) {
        _setOutline(taskCard, OUTLINE_ORANGE, SHADOW_ORANGE);
        return;
    }

    taskCard.style.removeProperty('outline');
    taskCard.style.removeProperty('outline-offset');
    taskCard.style.removeProperty('box-shadow');
}

function _setOutline(taskCard, outline, boxShadow) {
    taskCard.style.setProperty('outline', outline, 'important');
    taskCard.style.setProperty('outline-offset', '-2px');
    taskCard.style.setProperty('box-shadow', boxShadow, 'important');
}

function _showBadge(taskCard, className, text) {
    let badge = taskCard.querySelector(`.${className}`);
    if (!badge) {
        badge = document.createElement('div');
        badge.className = className;
        badge.style.cssText = `
            position: absolute;
            top: 4px;
            right: 4px;
            font-size: 10px;
            font-weight: 700;
            color: #fff;
            background: rgba(239, 68, 68, 0.85);
            padding: 2px 6px;
            border-radius: 3px;
            z-index: 10;
            pointer-events: none;
        `;

        const currentPos = getComputedStyle(taskCard).position;
        if (currentPos === 'static') {
            taskCard.style.position = 'relative';
        }

        taskCard.appendChild(badge);
    }
    badge.textContent = text;
}

function _clearBadge(taskCard, className) {
    const badge = taskCard.querySelector(`.${className}`);
    if (badge) badge.remove();
}
