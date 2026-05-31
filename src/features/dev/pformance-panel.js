/**
 * PFormance Panel
 * Floating panel displaying CPU performance metrics for Toolasha features
 * and DOM observer handlers.
 */

import config from '../../core/config.js';
import { t } from '../../core/i18n.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';

function getPerformanceMonitor() {
    return window.Toolasha?.Core?.performanceMonitor;
}

const COLORS = {
    background: 'rgba(5, 5, 15, 0.95)',
    headerBg: 'rgba(15, 5, 35, 0.7)',
    border: 'rgba(0, 255, 234, 0.4)',
    borderDim: 'rgba(0, 255, 234, 0.2)',
    text: '#e0f7ff',
    textDim: 'rgba(224, 247, 255, 0.6)',
    accent: '#00ffe7',
    danger: '#ff0055',
    warning: '#ffaa00',
    success: '#00ff99',
};

class PFormancePanel {
    constructor() {
        this.panel = null;
        this.timerRegistry = createTimerRegistry();
        this.updateIntervalId = null;
        this.isDragging = false;
        this.isCollapsed = false;
        this.featureSectionCollapsed = false;
        this.domSectionCollapsed = false;
    }

    initialize() {
        // No-op — panel is created on-demand via show()
    }

    show() {
        if (this.panel && document.body.contains(this.panel)) {
            bringPanelToFront(this.panel);
            return;
        }
        getPerformanceMonitor().enabled = true;
        this._createPanel();
        this._startUpdating();
    }

    disable() {
        this._removePanel();
    }

    _createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'toolasha-pformance-panel';
        Object.assign(this.panel.style, {
            position: 'fixed',
            top: '80px',
            right: '80px',
            zIndex: String(config.Z_FLOATING_PANEL),
            width: '380px',
            background: COLORS.background,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(12px)',
            color: COLORS.text,
            fontSize: '13px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        });

        this.panel.appendChild(this._createHeader());

        this.contentEl = document.createElement('div');
        this.contentEl.style.padding = '10px';
        this.contentEl.style.overflow = 'auto';
        this.contentEl.style.maxHeight = '500px';
        this.panel.appendChild(this.contentEl);

        this._makeDraggable();

        document.body.appendChild(this.panel);
        registerFloatingPanel(this.panel);
        this._updateContent();
    }

    _createHeader() {
        const header = document.createElement('div');
        header.className = 'pformance-header';
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move',
            padding: '8px 12px',
            background: COLORS.headerBg,
            borderBottom: `1px solid ${COLORS.border}`,
            userSelect: 'none',
        });
        this.headerEl = header;

        const title = document.createElement('span');
        title.textContent = t('PFormance');
        title.style.fontWeight = 'bold';
        title.style.color = COLORS.accent;

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '4px';

        const collapseBtn = this._headerButton(this.isCollapsed ? '▶' : '▼', () => {
            this.isCollapsed = !this.isCollapsed;
            collapseBtn.textContent = this.isCollapsed ? '▶' : '▼';
            this.contentEl.style.display = this.isCollapsed ? 'none' : '';
        });

        const closeBtn = this._headerButton('✕', () => this._removePanel());
        closeBtn.title = t('Close');

        buttons.appendChild(collapseBtn);
        buttons.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(buttons);
        return header;
    }

    _headerButton(text, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
            background: 'none',
            border: 'none',
            color: COLORS.text,
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 6px',
            borderRadius: '3px',
        });
        btn.addEventListener('mouseover', () => {
            btn.style.background = 'rgba(0, 255, 234, 0.15)';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.background = 'none';
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    _makeDraggable() {
        let offsetX = 0;
        let offsetY = 0;

        const onMouseMove = (e) => {
            if (!this.isDragging) return;
            this.panel.style.left = `${e.clientX - offsetX}px`;
            this.panel.style.right = 'auto';
            this.panel.style.top = `${e.clientY - offsetY}px`;
        };

        const onMouseUp = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        this.headerEl.addEventListener('mousedown', (e) => {
            bringPanelToFront(this.panel);
            this.isDragging = true;
            const rect = this.panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    _startUpdating() {
        if (this.updateIntervalId) return;
        this.updateIntervalId = setInterval(() => this._updateContent(), 1000);
        this.timerRegistry.registerInterval(this.updateIntervalId);
    }

    _stopUpdating() {
        if (this.updateIntervalId) {
            clearInterval(this.updateIntervalId);
            this.updateIntervalId = null;
        }
    }

    _removePanel() {
        this._stopUpdating();
        getPerformanceMonitor().enabled = false;
        if (this.panel) {
            unregisterFloatingPanel(this.panel);
            this.panel.remove();
            this.panel = null;
            this.contentEl = null;
            this.headerEl = null;
        }
    }

    _updateContent() {
        if (!this.contentEl) return;
        const pm = getPerformanceMonitor();
        if (!pm) return;
        const allStats = pm.getAllStats();
        const snapshots = pm.getSnapshots();

        const initEntries = [];
        const domEntries = [];

        for (const [name, snap] of snapshots) {
            if (name.startsWith('init:')) {
                initEntries.push({ name: name.slice(5), totalMs: snap.duration });
            }
        }

        for (const [name, stats] of allStats) {
            if (name.startsWith('dom:')) {
                domEntries.push({ name: name.slice(4), ...stats });
            }
        }

        initEntries.sort((a, b) => b.totalMs - a.totalMs);
        domEntries.sort((a, b) => b.cpuPercent - a.cpuPercent);

        this.contentEl.innerHTML = '';
        this.contentEl.appendChild(
            this._createSection(t('Feature Init'), initEntries, this.featureSectionCollapsed, (v) => {
                this.featureSectionCollapsed = v;
            })
        );
        this.contentEl.appendChild(
            this._createSection(t('DOM Observers'), domEntries, this.domSectionCollapsed, (v) => {
                this.domSectionCollapsed = v;
            })
        );
    }

    _createSection(title, entries, collapsed, setCollapsed) {
        const section = document.createElement('div');
        section.style.marginBottom = '8px';

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            padding: '4px 6px',
            background: COLORS.headerBg,
            borderRadius: '4px',
            marginBottom: collapsed ? '0' : '4px',
            userSelect: 'none',
        });

        const label = document.createElement('span');
        label.textContent = `${collapsed ? '▶' : '▼'} ${title}`;
        label.style.fontWeight = 'bold';
        label.style.fontSize = '12px';
        label.style.color = COLORS.accent;

        const count = document.createElement('span');
        count.textContent = `${entries.length}`;
        count.style.fontSize = '11px';
        count.style.color = COLORS.textDim;

        header.appendChild(label);
        header.appendChild(count);
        header.addEventListener('click', () => {
            setCollapsed(!collapsed);
            this._updateContent();
        });

        section.appendChild(header);

        if (collapsed) return section;

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = t('No data');
            empty.style.padding = '4px 6px';
            empty.style.color = COLORS.textDim;
            empty.style.fontSize = '11px';
            section.appendChild(empty);
            return section;
        }

        const table = document.createElement('table');
        Object.assign(table.style, {
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '11px',
        });

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const columns =
            title === t('Feature Init')
                ? [t('Name'), t('Time (ms)')]
                : [t('Name'), t('Calls/s'), t('Total ms'), t('CPU %')];

        for (const col of columns) {
            const th = document.createElement('th');
            th.textContent = col;
            Object.assign(th.style, {
                padding: '3px 5px',
                textAlign: col === 'Name' ? 'left' : 'right',
                borderBottom: `1px solid ${COLORS.borderDim}`,
                color: COLORS.textDim,
                fontWeight: 'normal',
            });
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const entry of entries) {
            const row = document.createElement('tr');

            if (title === 'Feature Init') {
                row.appendChild(this._cell(entry.name, 'left'));
                row.appendChild(this._cell(entry.totalMs.toFixed(1), 'right'));
            } else {
                const callsPerSec = (entry.calls / ((getPerformanceMonitor()?.windowMs || 5000) / 1000)).toFixed(1);
                row.appendChild(this._cell(entry.name, 'left'));
                row.appendChild(this._cell(callsPerSec, 'right'));
                row.appendChild(this._cell(entry.totalMs.toFixed(1), 'right'));
                row.appendChild(this._cpuCell(entry.cpuPercent));
            }

            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        section.appendChild(table);

        return section;
    }

    _cell(text, align) {
        const td = document.createElement('td');
        td.textContent = text;
        Object.assign(td.style, {
            padding: '2px 5px',
            textAlign: align,
            borderBottom: `1px solid ${COLORS.borderDim}`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: align === 'left' ? '160px' : 'auto',
        });
        return td;
    }

    _cpuCell(percent) {
        const td = document.createElement('td');
        td.textContent = percent.toFixed(2) + '%';
        Object.assign(td.style, {
            padding: '2px 5px',
            textAlign: 'right',
            borderBottom: `1px solid ${COLORS.borderDim}`,
            fontWeight: 'bold',
        });

        if (percent > 5) {
            td.style.color = COLORS.danger;
        } else if (percent > 1) {
            td.style.color = COLORS.warning;
        } else {
            td.style.color = COLORS.success;
        }

        return td;
    }
}

const pformancePanel = new PFormancePanel();

export default pformancePanel;
