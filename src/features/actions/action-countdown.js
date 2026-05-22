/**
 * Action Countdown
 * Replaces the static time text on the action progress bar with a live countdown.
 * Syncs to the game's progress bar fill via scaleX transform.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';

class ActionCountdown {
    constructor() {
        this.initialized = false;
        this.rafId = null;
        this.textEl = null;
        this.fillBar = null;
        this.totalTime = null;
        this.unregisterObserver = null;
        this.actionCompletedHandler = null;
        this.lastCompletedAt = null;
        this.settingChangeHandler = null;
    }

    initialize() {
        if (this.initialized) return;

        if (!this.settingChangeHandler) {
            this.settingChangeHandler = (enabled) => {
                if (enabled) {
                    this.initialized = false;
                    this.initialize();
                } else {
                    this.disable();
                }
            };
            config.onSettingChange('actionPanel_liveCountdown', this.settingChangeHandler);
        }

        if (!config.getSetting('actionPanel_liveCountdown')) return;

        this.actionCompletedHandler = () => this._onActionCompleted();
        dataManager.on('action_completed', this.actionCompletedHandler);

        this.unregisterObserver = domObserver.onClass('ActionCountdown', 'ProgressBar_text', (el) => {
            this._onProgressBarText(el);
        });

        const existing = document.querySelector('[class*="ProgressBar_text"]');
        if (existing) {
            this._onProgressBarText(existing);
        }

        this.initialized = true;
    }

    _onProgressBarText(textEl) {
        this.textEl = textEl;
        this.fillBar = null;
        this._parseTotalTime();
        this._startLoop();
    }

    _parseTotalTime() {
        if (!this.textEl) return;
        const span = this.textEl.querySelector('span');
        if (!span) return;
        const val = parseFloat(span.textContent);
        if (!isNaN(val) && val > 0) {
            this.totalTime = val;
        }
    }

    _onActionCompleted() {
        this.lastCompletedAt = Date.now();
        setTimeout(() => this._parseTotalTime(), 50);
    }

    /**
     * Find the animated inner bar element.
     * DOM: progressBar > innerBarContainer > innerBar (scaleX animated)
     */
    _findFillBar() {
        if (!this.textEl) return null;
        const parent = this.textEl.parentElement;
        if (!parent) return null;

        for (const child of parent.children) {
            if (child === this.textEl) continue;
            if (child.children.length > 0) {
                for (const grandchild of child.children) {
                    if (grandchild.className?.includes('innerBar')) {
                        return grandchild;
                    }
                }
            }
        }
        return null;
    }

    _startLoop() {
        if (this.rafId) return;
        this._tick();
    }

    _stopLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _tick() {
        this.rafId = requestAnimationFrame(() => this._tick());

        if (!this.textEl || !this.textEl.isConnected || !this.totalTime) return;

        const span = this.textEl.querySelector('span');
        if (!span) return;

        if (!this.fillBar || !this.fillBar.isConnected) {
            this.fillBar = this._findFillBar();
        }

        let remaining;
        if (this.fillBar) {
            const transform = getComputedStyle(this.fillBar).transform;
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix\(([^)]+)\)/);
                if (match) {
                    const scaleX = parseFloat(match[1]);
                    const progressBar = this.fillBar.parentElement?.parentElement;
                    const duration = progressBar
                        ? parseFloat(getComputedStyle(progressBar).getPropertyValue('--duration'))
                        : this.totalTime;
                    if (duration > 0) {
                        this.totalTime = duration;
                        remaining = duration * (1 - scaleX);
                    }
                }
            }
        }

        if (remaining === undefined && this.lastCompletedAt) {
            const elapsed = (Date.now() - this.lastCompletedAt) / 1000;
            remaining = Math.max(0, this.totalTime - elapsed);
        }

        if (remaining !== undefined) {
            remaining = Math.max(0, remaining);
            span.textContent = remaining.toFixed(1) + 's';
        }
    }

    disable() {
        this._stopLoop();
        if (this.textEl && this.totalTime) {
            const span = this.textEl.querySelector('span');
            if (span) {
                span.textContent = this.totalTime.toFixed(1) + 's';
            }
        }
        if (this.actionCompletedHandler) {
            dataManager.off('action_completed', this.actionCompletedHandler);
            this.actionCompletedHandler = null;
        }
        if (this.unregisterObserver) {
            this.unregisterObserver();
            this.unregisterObserver = null;
        }
        this.textEl = null;
        this.fillBar = null;
        this.totalTime = null;
        this.lastCompletedAt = null;
        this.initialized = false;
    }
}

const actionCountdown = new ActionCountdown();

export default actionCountdown;
