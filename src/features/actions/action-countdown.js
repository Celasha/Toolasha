/**
 * Action Countdown
 * Replaces the static time text on the action progress bar with a live countdown.
 * Syncs to the game's progress bar fill via scaleX transform.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';

const UPDATE_INTERVAL_MS = 100; // Display precision is 0.1s; faster updates only add style/DOM work.

class ActionCountdown {
    constructor() {
        this.initialized = false;
        this.rafId = null;
        this.textEl = null;
        this.spanEl = null;
        this.fillBar = null;
        this.totalTime = null;
        this.unregisterObserver = null;
        this.actionCompletedHandler = null;
        this.lastCompletedAt = null;
        this.settingChangeHandler = null;
        this.lastFrameUpdate = 0;
        this.parseTimeout = null;
        this.tickHandler = (timestamp) => this._tick(timestamp);
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
        this.spanEl = textEl.querySelector('span');
        this.fillBar = null;
        this._parseTotalTime();
        this._startLoop();
    }

    _parseTotalTime() {
        if (!this.textEl) return;
        const span = this.spanEl?.isConnected ? this.spanEl : this.textEl.querySelector('span');
        if (!span) return;
        this.spanEl = span;

        const values = span.textContent.match(/\d+(?:\.\d+)?/g);
        if (!values?.length) return;

        // When the span already contains our own "remaining / total" rendering,
        // the final value is the duration. Parsing the first value would gradually
        // shrink totalTime after every action completion.
        const val = Number(values.length > 1 ? values[values.length - 1] : values[0]);
        if (!isNaN(val) && val > 0) {
            this.totalTime = val;
        }
    }

    _onActionCompleted() {
        this.lastCompletedAt = Date.now();
        if (this.parseTimeout) clearTimeout(this.parseTimeout);
        this.parseTimeout = setTimeout(() => {
            this.parseTimeout = null;
            this._parseTotalTime();
        }, 50);
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
        if (this.rafId !== null) return;
        this.lastFrameUpdate = 0;
        this.rafId = requestAnimationFrame(this.tickHandler);
    }

    _stopLoop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.lastFrameUpdate = 0;
    }

    _tick(timestamp) {
        this.rafId = null;

        // A removed progress bar cannot become useful again. Stop completely and
        // let the central DOM observer restart the loop for the replacement element.
        if (!this.textEl || !this.textEl.isConnected) return;

        this.rafId = requestAnimationFrame(this.tickHandler);

        if (timestamp - this.lastFrameUpdate < UPDATE_INTERVAL_MS) return;
        this.lastFrameUpdate = timestamp;

        if (!this.totalTime) {
            this._parseTotalTime();
            if (!this.totalTime) return;
        }

        const span = this.spanEl?.isConnected ? this.spanEl : this.textEl.querySelector('span');
        if (!span) return;
        this.spanEl = span;

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
            span.textContent = remaining.toFixed(1) + 's / ' + this.totalTime.toFixed(1) + 's';
        }
    }

    disable() {
        this._stopLoop();
        if (this.parseTimeout) {
            clearTimeout(this.parseTimeout);
            this.parseTimeout = null;
        }
        if (this.textEl && this.totalTime) {
            const span = this.spanEl?.isConnected ? this.spanEl : this.textEl.querySelector('span');
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
        this.spanEl = null;
        this.fillBar = null;
        this.totalTime = null;
        this.lastCompletedAt = null;
        this.initialized = false;
    }
}

const actionCountdown = new ActionCountdown();

export default actionCountdown;
