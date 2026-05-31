/**
 * Shared Sim Editor
 * Loadout editor used by both Combat Sim and Lab Sim.
 * Manages equipment, abilities, consumables, skill levels, and house rooms.
 */

import {
    buildGameDataPayload,
    buildAllPlayerDTOs,
    parseShykaiImport,
    applyLoadoutSnapshotToDTO,
} from './combat-sim-adapter.js';
import loadoutSnapshot from '../combat/loadout-snapshot.js';
import { getLoadoutSortOrder } from '../combat/loadout-sort.js';
import { t } from '../../core/i18n.js';

const ACCENT = '#4a9eff';
const ACCENT_BG = 'rgba(74, 158, 255, 0.12)';
const ACCENT_BORDER = 'rgba(74, 158, 255, 0.5)';
const ACCENT_BTN_BG = 'rgba(74, 158, 255, 0.2)';
const ACCENT_BTN_BORDER = 'rgba(74, 158, 255, 0.4)';

export class SimEditor {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.editorEl - Container element the editor renders into
     * @param {boolean} [options.labMode=false] - When true, filters coffees from consumable picker
     * @param {boolean} [options.skillingMode=false] - When true, shows skilling skills/loadouts/token upgrades
     */
    constructor({ editorEl, labMode = false, skillingMode = false }) {
        this._editorEl = editorEl;
        this.labMode = labMode;
        this.skillingMode = skillingMode;

        this._editedDTOs = null;
        this._editedPlayerInfo = null;
        this._originalDTOs = null;
        this._openSections = new Set();
        this._activeEditPlayer = null;
        this._selfHrid = null;
        this._missingMembers = [];
        this._editorInitialized = false;
        this._selectedLoadoutName = '';
        this._loadoutSortOrder = null;
    }

    getEditedDTOs() {
        return this._editedDTOs;
    }
    getPlayerInfo() {
        return this._editedPlayerInfo;
    }
    getSelfHrid() {
        return this._selfHrid;
    }
    getMissingMembers() {
        return this._missingMembers;
    }
    isInitialized() {
        return this._editorInitialized;
    }
    getSelectedLoadoutName() {
        return this._selectedLoadoutName;
    }

    /**
     * Load DTOs from live character data.
     */
    async initEditor() {
        const editorArea = this._editorEl;
        if (!editorArea) return;

        try {
            const { players, playerInfo, selfHrid, missingMembers } = await buildAllPlayerDTOs();
            if (!players.length) {
                editorArea.innerHTML =
                    '<div style="color:#555; font-size:12px; text-align:center; padding:20px 0;">' +
                    t('No character data available.') +
                    '</div>';
                return;
            }

            const dtoMap = {};
            for (const p of players) {
                dtoMap[p.hrid] = p;
            }

            this._originalDTOs = structuredClone(dtoMap);
            this._editedDTOs = structuredClone(dtoMap);
            this._editedPlayerInfo = playerInfo;
            this._selfHrid = selfHrid;
            this._activeEditPlayer = selfHrid;
            this._missingMembers = missingMembers;
            this._editorInitialized = true;
            this._loadoutSortOrder = await getLoadoutSortOrder();

            this.renderEditor();
        } catch (error) {
            console.error('[SimEditor] Failed to init editor:', error);
            editorArea.innerHTML =
                '<div style="color:#f66; font-size:12px; text-align:center; padding:20px 0;">' +
                t('Failed to load character data.') +
                '</div>';
        }
    }

    /**
     * Pre-load editor with an external DTO (e.g. from character card).
     * @param {Object} dto - Player DTO
     * @param {string} playerName - Display name
     */
    openWithExternalDTO(dto, playerName) {
        dto.hrid = 'player1';
        const dtoMap = { player1: structuredClone(dto) };
        this._originalDTOs = structuredClone(dtoMap);
        this._editedDTOs = structuredClone(dtoMap);
        this._editedPlayerInfo = [{ hrid: 'player1', name: playerName }];
        this._selfHrid = 'player1';
        this._activeEditPlayer = 'player1';
        this._missingMembers = [];
        this._editorInitialized = true;
        this.renderEditor();
    }

    /**
     * Import players from parsed export data.
     * @param {Array<Object>} players - Player DTOs
     * @param {Array<string>} names - Player names
     */
    importPlayers(players, names) {
        if (!this._editedDTOs) {
            this._editedDTOs = {};
            this._originalDTOs = {};
            this._editedPlayerInfo = [];
        }

        const existingSlots = this._editedPlayerInfo.map((p) => {
            const match = p.hrid.match(/player(\d+)/);
            return match ? parseInt(match[1]) : 0;
        });
        let nextSlot = existingSlots.length > 0 ? Math.max(...existingSlots) + 1 : 1;

        for (let i = 0; i < players.length; i++) {
            const dto = players[i];
            dto.hrid = `player${nextSlot}`;
            this._editedDTOs[dto.hrid] = dto;
            this._originalDTOs[dto.hrid] = structuredClone(dto);
            this._editedPlayerInfo.push({ hrid: dto.hrid, name: names[i] || `Player ${nextSlot}` });
            nextSlot++;
        }

        this._activeEditPlayer = this._editedPlayerInfo[this._editedPlayerInfo.length - 1]?.hrid;
        this._selfHrid = this._selfHrid || null;
        this._missingMembers = [];
        this._editorInitialized = true;
        this._selectedLoadoutName = '';

        this.renderEditor();
    }

    /**
     * Reset all editor state.
     */
    reset() {
        this._editorInitialized = false;
        this._editedDTOs = null;
        this._originalDTOs = null;
        this._editedPlayerInfo = null;
        this._selfHrid = null;
        this._missingMembers = [];
        this._selectedLoadoutName = '';
    }

    /**
     * Render the loadout editor for the active player.
     */
    renderEditor() {
        const editorArea = this._editorEl;
        if (!editorArea || !this._editedDTOs) return;

        const playerInfo = this._editedPlayerInfo || [];
        const activePlayer = this._activeEditPlayer;
        const dto = this._editedDTOs[activePlayer];

        if (!dto && playerInfo.length === 0) {
            editorArea.innerHTML = `
                <div style="text-align:center; padding:20px 0;">
                    <div style="color:#888; font-size:12px; margin-bottom:10px;">${t('No players loaded.')}</div>
                    <button id="mwi-csim-import-btn" style="
                        background:${ACCENT_BTN_BG}; border:1px solid ${ACCENT_BTN_BORDER}; color:${ACCENT};
                        padding:5px 14px; border-radius:5px; font-size:12px; cursor:pointer;
                        font-family:inherit; font-weight:600;">${t('+ Import Player')}</button>
                    <div id="mwi-csim-import-area" style="display:none; margin-top:10px; text-align:left;">
                        <textarea id="mwi-csim-import-text" placeholder="${t('Paste Combat Sim Export JSON here...')}" style="
                            width:100%; height:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                            border-radius:4px; padding:6px; font-size:11px; font-family:monospace; resize:vertical;
                            box-sizing:border-box;"></textarea>
                        <div style="display:flex; gap:6px; margin-top:4px;">
                            <button id="mwi-csim-import-go" style="
                                background:${ACCENT_BTN_BG}; border:1px solid ${ACCENT_BTN_BORDER}; color:${ACCENT};
                                padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;
                                font-weight:600;">${t('Import')}</button>
                            <button id="mwi-csim-import-cancel" style="
                                background:rgba(255,255,255,0.04); border:1px solid #333; color:#888;
                                padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;">${t('Cancel')}</button>
                            <span id="mwi-csim-import-error" style="color:#f44; font-size:11px; align-self:center;"></span>
                        </div>
                    </div>
                </div>
            `;

            const importBtn = editorArea.querySelector('#mwi-csim-import-btn');
            if (importBtn) {
                importBtn.addEventListener('click', () => {
                    const area = editorArea.querySelector('#mwi-csim-import-area');
                    if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
                });
            }
            const importGo = editorArea.querySelector('#mwi-csim-import-go');
            if (importGo) {
                importGo.addEventListener('click', () => {
                    const text = editorArea.querySelector('#mwi-csim-import-text')?.value?.trim();
                    const errorEl = editorArea.querySelector('#mwi-csim-import-error');
                    if (!text) {
                        if (errorEl) errorEl.textContent = t('Paste export data first.');
                        return;
                    }
                    const result = parseShykaiImport(text);
                    if (!result || !result.players.length) {
                        if (errorEl) errorEl.textContent = t('Invalid format. Paste a Combat Sim Export JSON.');
                        return;
                    }
                    this.importPlayers(result.players, result.names);
                });
            }
            const importCancel = editorArea.querySelector('#mwi-csim-import-cancel');
            if (importCancel) {
                importCancel.addEventListener('click', () => {
                    const area = editorArea.querySelector('#mwi-csim-import-area');
                    if (area) area.style.display = 'none';
                });
            }
            return;
        }

        if (!dto) return;

        const gameData = buildGameDataPayload();
        if (!gameData) return;

        let html = '';

        // Player tabs + import/remove controls
        html += `<div style="display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap; align-items:center;">`;
        if (playerInfo.length > 1) {
            for (const { hrid, name } of playerInfo) {
                const isActive = hrid === activePlayer;
                const tabStyle = isActive
                    ? `background:${ACCENT_BG}; border:1px solid ${ACCENT_BORDER}; color:${ACCENT}; font-weight:700;`
                    : 'background:rgba(255,255,255,0.04); border:1px solid #333; color:#aaa;';
                html += `<button data-edit-tab="${hrid}" style="
                    ${tabStyle}
                    padding:3px 8px; border-radius:5px; font-size:12px; cursor:pointer;
                    font-family:inherit; transition:all 0.1s; position:relative;
                ">${name}<span data-remove-player="${hrid}" style="margin-left:4px; color:#f44; cursor:pointer; font-size:14px;" title="${t('Remove player')}">\u00d7</span></button>`;
            }
        } else if (playerInfo.length === 1) {
            const { hrid, name } = playerInfo[0];
            html += `<button data-edit-tab="${hrid}" style="
                background:${ACCENT_BG}; border:1px solid ${ACCENT_BORDER}; color:${ACCENT}; font-weight:700;
                padding:3px 8px; border-radius:5px; font-size:12px; cursor:pointer;
                font-family:inherit; transition:all 0.1s; position:relative;
            ">${name}<span data-remove-player="${hrid}" style="margin-left:4px; color:#f44; cursor:pointer; font-size:14px;" title="${t('Remove player')}">\u00d7</span></button>`;
        }
        html += `<button id="mwi-csim-import-btn" style="
            background:rgba(255,255,255,0.04); border:1px solid #333; color:#888;
            padding:3px 8px; border-radius:5px; font-size:11px; cursor:pointer;
            font-family:inherit;" title="Import players from Shykai export string">${t('+ Import')}</button>`;
        html += '</div>';

        // Import paste area (hidden by default)
        html += `<div id="mwi-csim-import-area" style="display:none; margin-bottom:10px;">
            <textarea id="mwi-csim-import-text" placeholder="${t('Paste Shykai export JSON here...')}" style="
                width:100%; height:60px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:4px; padding:6px; font-size:11px; font-family:monospace; resize:vertical;
                box-sizing:border-box;"></textarea>
            <div style="display:flex; gap:6px; margin-top:4px;">
                <button id="mwi-csim-import-go" style="
                    background:${ACCENT_BTN_BG}; border:1px solid ${ACCENT_BTN_BORDER}; color:${ACCENT};
                    padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;
                    font-weight:600;">${t('Import')}</button>
                <button id="mwi-csim-import-cancel" style="
                    background:rgba(255,255,255,0.04); border:1px solid #333; color:#888;
                    padding:3px 12px; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit;">${t('Cancel')}</button>
                <span id="mwi-csim-import-error" style="color:#f44; font-size:11px; align-self:center;"></span>
            </div>
        </div>`;

        // Loadout dropdown + Reset button (skip in skillingMode — loadouts assigned per-skill)
        if (!this.skillingMode) {
            const allSnapshots = loadoutSnapshot.getAllSnapshots();
            const filteredSnapshots = allSnapshots.filter(
                (s) => !s.actionTypeHrid || s.actionTypeHrid === '/action_types/combat'
            );

            if (this._loadoutSortOrder?.length) {
                filteredSnapshots.sort((a, b) => {
                    const aIdx = this._loadoutSortOrder.findIndex((o) => o.name === a.name);
                    const bIdx = this._loadoutSortOrder.findIndex((o) => o.name === b.name);
                    const aPos = aIdx === -1 ? Infinity : aIdx;
                    const bPos = bIdx === -1 ? Infinity : bIdx;
                    return aPos - bPos;
                });
            }
            html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">`;
            if (filteredSnapshots.length > 0) {
                html += `<label style="color:#888; font-size:11px; flex-shrink:0;">${t('Loadout')}</label>`;
                html += `<select id="mwi-csim-loadout-select" style="
                    flex:1; min-width:0; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                    border-radius:4px; padding:2px 6px; font-size:12px; font-family:inherit;">`;
                html += `<option value=""${!this._selectedLoadoutName ? ' selected' : ''}>${t('— Current Gear —')}</option>`;
                for (const snap of filteredSnapshots) {
                    const label = snap.name + (snap.actionTypeHrid ? '' : ' (All Skills)');
                    const selected = this._selectedLoadoutName === snap.name ? ' selected' : '';
                    html += `<option value="${snap.name}"${selected}>${label}</option>`;
                }
                html += `</select>`;
            }
            html += `<button id="mwi-csim-reset" style="
                margin-left:auto; background:rgba(255,255,255,0.04); border:1px solid #333; color:#aaa;
                padding:2px 8px; border-radius:4px; font-size:11px; cursor:pointer;
                font-family:inherit; flex-shrink:0;">${t('Reset to Current')}</button>`;
            html += '</div>';
        }

        if (!this.skillingMode) {
            html += this._renderEquipmentSection(dto, gameData);
            html += this._renderAbilitiesSection(dto, gameData);
            html += this._renderConsumablesSection(dto, gameData);
        }
        html += this._renderSkillLevelsSection(dto);
        html += this._renderHouseRoomsSection(dto, gameData);
        if (this.skillingMode) {
            html += this._renderTokenUpgradesSection(dto);
            html += this._renderCommunityBuffsSection(dto);
        }

        editorArea.innerHTML = html;
        this._wireEditorEvents(editorArea, dto);
    }

    /** @private */
    _renderEquipmentSection(dto, gameData) {
        const itemDetailMap = gameData.itemDetailMap || {};
        const slotOrder = [
            '/equipment_types/head',
            '/equipment_types/body',
            '/equipment_types/legs',
            '/equipment_types/feet',
            '/equipment_types/hands',
            '/equipment_types/main_hand',
            '/equipment_types/two_hand',
            '/equipment_types/off_hand',
            '/equipment_types/pouch',
            '/equipment_types/back',
            '/equipment_types/neck',
            '/equipment_types/earrings',
            '/equipment_types/ring',
            '/equipment_types/charm',
        ];
        const slotLabels = {
            '/equipment_types/head': t('Head'),
            '/equipment_types/body': t('Body'),
            '/equipment_types/legs': t('Legs'),
            '/equipment_types/feet': t('Feet'),
            '/equipment_types/hands': t('Hands'),
            '/equipment_types/main_hand': t('Main Hand'),
            '/equipment_types/two_hand': t('Two Hand'),
            '/equipment_types/off_hand': t('Off Hand'),
            '/equipment_types/pouch': t('Pouch'),
            '/equipment_types/back': t('Back'),
            '/equipment_types/neck': t('Neck'),
            '/equipment_types/earrings': t('Earrings'),
            '/equipment_types/ring': t('Ring'),
            '/equipment_types/charm': t('Charm'),
        };

        const equippedCount = slotOrder.filter((s) => dto.equipment[s]).length;
        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="equip-section">`;
        html += `<span data-arrow="equip-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ${t('Equipment')} (${equippedCount} ${t('items')})`;
        html += '</div>';
        html += `<div id="mwi-csim-equip-section" style="display:none;">`;

        for (const slotType of slotOrder) {
            const equip = dto.equipment[slotType];
            const label = slotLabels[slotType] || slotType.split('/').pop();

            if (!equip) {
                html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
                html += `<span style="color:#888; width:70px; flex-shrink:0;">${label}</span>`;
                html += `<span style="color:#555; flex:1; font-style:italic;">${t('Empty')}</span>`;
                html += `<button data-equipment-slot="${slotType}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">${t('add')}</button>`;
                html += '</div>';
                continue;
            }

            const item = itemDetailMap[equip.hrid];
            const name = item?.name || equip.hrid.split('/').pop();

            html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
            html += `<span style="color:#888; width:70px; flex-shrink:0;">${label}</span>`;
            html += `<span style="color:#e0e0e0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
            html += `<span style="color:#666; font-size:11px;">+</span>`;
            html += `<input type="number" min="0" max="20" value="${equip.enhancementLevel}"
                data-enhance-slot="${slotType}"
                style="width:36px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += `<button data-equipment-slot="${slotType}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">${t('change')}</button>`;
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /** @private */
    _renderAbilitiesSection(dto, gameData) {
        const abilityDetailMap = gameData.abilityDetailMap || {};
        const abilityCount = dto.abilities.filter((a) => a).length;

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="ability-section">`;
        html += `<span data-arrow="ability-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ${t('Abilities')} (${abilityCount} ${t('equipped')})`;
        html += '</div>';
        html += `<div id="mwi-csim-ability-section" style="display:none;">`;

        const maxSlots = 5;
        const slotCount = Math.max(dto.abilities.length, maxSlots);

        for (let i = 0; i < slotCount; i++) {
            const ability = dto.abilities[i];
            const slotLabel = i === 0 ? t('Special') : `${t('Slot')} ${i}`;

            if (!ability) {
                html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
                html += `<span style="color:#888; width:50px; flex-shrink:0;">${slotLabel}</span>`;
                html += `<span style="color:#555; flex:1; font-style:italic;">${t('Empty')}</span>`;
                html += `<button data-ability-slot="${i}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">${t('add')}</button>`;
                html += '</div>';
                continue;
            }

            const detail = abilityDetailMap[ability.hrid];
            const name = detail?.name || ability.hrid.split('/').pop();

            html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">`;
            html += `<span style="color:#888; width:50px; flex-shrink:0;">${slotLabel}</span>`;
            html += `<span style="color:#e0e0e0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
            html += `<span style="color:#666; font-size:11px;">Lv</span>`;
            html += `<input type="number" min="1" max="200" value="${ability.level}"
                data-ability-idx="${i}"
                style="width:42px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += `<button data-ability-slot="${i}" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">${t('change')}</button>`;
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /** @private */
    _renderConsumablesSection(dto, gameData) {
        const itemDetailMap = gameData?.itemDetailMap || {};
        const foodCount = dto.food.filter((f) => f).length;
        const drinkCount = dto.drinks.filter((d) => d).length;

        let html = '<div style="margin-bottom:10px;">';
        html +=
            '<div style="color:' +
            ACCENT +
            '; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="consumable-section">';
        html +=
            '<span data-arrow="consumable-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ' +
            t('Consumables') +
            ' (' +
            foodCount +
            ' ' +
            t('food') +
            ', ' +
            drinkCount +
            ' ' +
            t('drinks') +
            ')';
        html += '</div>';
        html += '<div id="mwi-csim-consumable-section" style="display:none;">';

        html += '<div style="color:#888; font-size:11px; margin-bottom:3px;">' + t('Food') + '</div>';
        for (let i = 0; i < 3; i++) {
            const item = dto.food[i];
            const name = item ? itemDetailMap[item.hrid]?.name || item.hrid.split('/').pop() : t('Empty');
            const nameColor = item ? '#e0e0e0' : '#555';
            html += '<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">';
            html += '<span style="color:#666; width:16px; flex-shrink:0;">' + (i + 1) + '</span>';
            html +=
                '<span style="color:' +
                nameColor +
                '; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                name +
                '</span>';
            html +=
                '<button data-consumable-slot="food-' +
                i +
                '" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">' +
                t('change') +
                '</button>';
            html += '</div>';
        }

        html += '<div style="color:#888; font-size:11px; margin-bottom:3px; margin-top:6px;">' + t('Drinks') + '</div>';
        for (let i = 0; i < 3; i++) {
            const item = dto.drinks[i];
            const name = item ? itemDetailMap[item.hrid]?.name || item.hrid.split('/').pop() : t('Empty');
            const nameColor = item ? '#e0e0e0' : '#555';
            html += '<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:12px;">';
            html += '<span style="color:#666; width:16px; flex-shrink:0;">' + (i + 1) + '</span>';
            html +=
                '<span style="color:' +
                nameColor +
                '; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                name +
                '</span>';
            html +=
                '<button data-consumable-slot="drinks-' +
                i +
                '" style="background:rgba(255,255,255,0.06); border:1px solid #444; color:#aaa; padding:1px 6px; border-radius:3px; font-size:11px; cursor:pointer; font-family:inherit;">' +
                t('change') +
                '</button>';
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    /** @private */
    _openConsumablePicker(slotType, slotIndex, dto, gameData) {
        document.getElementById('mwi-csim-consumable-picker')?.remove();
        document.getElementById('mwi-csim-consumable-backdrop')?.remove();

        const itemDetailMap = gameData?.itemDetailMap || {};
        const isFood = slotType === 'food';

        const getConsumableType = (hrid) => {
            const detail = itemDetailMap[hrid]?.consumableDetail;
            if (!detail) return null;
            const hp = detail.hitpointRestore || 0;
            const mp = detail.manapointRestore || 0;
            const dur = detail.recoveryDuration || 0;
            if (hp > 0) return dur > 0 ? 'hp_over_time' : 'hp_instant';
            if (mp > 0) return dur > 0 ? 'mp_over_time' : 'mp_instant';
            const buffs = detail.buffs || [];
            if (buffs.length > 0) return 'buff:' + (buffs[0].uniqueHrid || 'unknown');
            return null;
        };

        const usedTypes = new Set();
        const slots = dto[slotType] || [];
        for (let i = 0; i < slots.length; i++) {
            if (i === slotIndex || !slots[i]) continue;
            const t = getConsumableType(slots[i].hrid);
            if (t) usedTypes.add(t);
        }

        const items = [];
        for (const [hrid, item] of Object.entries(itemDetailMap)) {
            if (!item.consumableDetail) continue;
            const cat = item.categoryHrid || '';
            const isFoodItem = cat.includes('food');
            const isDrinkItem =
                (cat.includes('drink') || hrid.includes('coffee')) && item.consumableDetail.cooldownDuration > 0;

            // In lab mode, filter out coffees from drink picker (they come from crate selectors)
            if (this.labMode && !isFood && (hrid.includes('coffee') || cat.includes('coffee'))) continue;

            if (isFood ? isFoodItem : isDrinkItem) {
                const cType = getConsumableType(hrid);
                const conflict = cType && usedTypes.has(cType);
                const itemLevel = item.itemLevel || 0;

                let categoryLabel;
                if (isFood) {
                    const hp = item.consumableDetail.hitpointRestore || 0;
                    const mp = item.consumableDetail.manapointRestore || 0;
                    const dur = item.consumableDetail.recoveryDuration || 0;
                    if (hp > 0 && dur > 0) categoryLabel = t('HP Over Time');
                    else if (hp > 0) categoryLabel = t('HP Instant');
                    else if (mp > 0 && dur > 0) categoryLabel = t('MP Over Time');
                    else if (mp > 0) categoryLabel = t('MP Instant');
                    else categoryLabel = t('Other');
                } else {
                    const buffs = item.consumableDetail.buffs || [];
                    if (buffs.length > 0) {
                        const buffName = buffs[0].uniqueHrid?.split('/').pop()?.replace(/_/g, ' ') || 'buff';
                        categoryLabel = buffName.charAt(0).toUpperCase() + buffName.slice(1);
                    } else categoryLabel = t('Other');
                }

                items.push({ hrid, name: item.name || hrid.split('/').pop(), conflict, itemLevel, categoryLabel });
            }
        }

        items.sort((a, b) => {
            const catCmp = a.categoryLabel.localeCompare(b.categoryLabel);
            if (catCmp !== 0) return catCmp;
            return b.itemLevel - a.itemLevel;
        });

        const popup = document.createElement('div');
        popup.id = 'mwi-csim-consumable-picker';
        popup.style.cssText =
            'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:100000;' +
            'background:rgba(10,10,20,0.97); border:2px solid rgba(74,158,255,0.5); border-radius:10px;' +
            'width:350px; max-height:400px; display:flex; flex-direction:column;' +
            "font-family:'Segoe UI',sans-serif; color:#e0e0e0; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.6);";

        const header = document.createElement('div');
        header.style.cssText =
            'display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid rgba(74,158,255,0.3); flex-shrink:0;';
        header.innerHTML =
            '<span style="font-weight:700; font-size:13px; color:#4a9eff;">' +
            t('Select') +
            ' ' +
            (isFood ? t('Food') : t('Drink')) +
            '</span>' +
            '<button id="mwi-csim-picker-close" style="background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1;">\u00d7</button>';
        popup.appendChild(header);

        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding:6px 14px; flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = t('Search...');
        searchInput.style.cssText =
            'width:100%; padding:5px 8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:6px; color:#e0e0e0; font-size:12px; font-family:inherit; outline:none;';
        searchDiv.appendChild(searchInput);
        popup.appendChild(searchDiv);

        const listEl = document.createElement('div');
        listEl.style.cssText = 'flex:1; overflow-y:auto; padding:4px 14px;';
        popup.appendChild(listEl);

        const currentHrid = dto[slotType][slotIndex]?.hrid || '';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query
                ? items.filter(
                      (i) => i.name.toLowerCase().includes(lower) || i.categoryLabel.toLowerCase().includes(lower)
                  )
                : items;

            let html =
                '<div data-pick-hrid="" style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:#888; font-style:italic;"' +
                ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                t('Empty (clear slot)') +
                '</div>';

            let lastCategory = '';
            for (const item of filtered.slice(0, 80)) {
                if (item.categoryLabel !== lastCategory) {
                    lastCategory = item.categoryLabel;
                    html +=
                        '<div style="padding:6px 0 2px; font-size:10px; font-weight:700; color:' +
                        ACCENT +
                        '; border-bottom:1px solid #2a2a4e; margin-top:4px;">' +
                        item.categoryLabel +
                        '</div>';
                }

                const isCurrent = item.hrid === currentHrid;
                const lvlTag =
                    '<span style="color:#666; font-size:10px; margin-left:auto; flex-shrink:0;">Lv ' +
                    item.itemLevel +
                    '</span>';
                if (item.conflict) {
                    html +=
                        '<div style="display:flex; align-items:center; gap:8px; padding:3px 4px; border-bottom:1px solid #1a1a2e; color:#555; cursor:default;">' +
                        item.name +
                        ' <span style="font-size:10px; color:#664;">(' +
                        t('in use') +
                        ')</span>' +
                        lvlTag +
                        '</div>';
                } else {
                    const color = isCurrent ? '#4a9eff' : '#ccc';
                    const indicator = isCurrent ? ' <span style="color:#4a9eff;">\u25cf</span>' : '';
                    html +=
                        '<div data-pick-hrid="' +
                        item.hrid +
                        '" style="display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:' +
                        color +
                        ';"' +
                        ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                        item.name +
                        indicator +
                        lvlTag +
                        '</div>';
                }
            }
            if (filtered.length > 80) {
                html +=
                    '<div style="color:#666; text-align:center; padding:6px;">...' +
                    (filtered.length - 80) +
                    ' more</div>';
            }
            listEl.innerHTML = html;

            listEl.querySelectorAll('[data-pick-hrid]').forEach((row) => {
                row.addEventListener('click', () => {
                    const hrid = row.dataset.pickHrid;
                    if (hrid) {
                        dto[slotType][slotIndex] = { hrid, triggers: null };
                    } else {
                        dto[slotType][slotIndex] = null;
                    }
                    closePicker();
                    this.renderEditor();
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        const closePicker = () => {
            popup.remove();
            document.getElementById('mwi-csim-consumable-backdrop')?.remove();
        };

        popup.querySelector('#mwi-csim-picker-close').addEventListener('click', closePicker);

        const backdrop = document.createElement('div');
        backdrop.id = 'mwi-csim-consumable-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999;';
        backdrop.addEventListener('click', closePicker);

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        renderList('');
        searchInput.focus();
    }

    /** @private */
    _openEquipmentPicker(slotType, dto, gameData) {
        document.getElementById('mwi-csim-equipment-picker')?.remove();
        document.getElementById('mwi-csim-equipment-backdrop')?.remove();

        const itemDetailMap = gameData?.itemDetailMap || {};
        const slotName = slotType.split('/').pop().replace(/_/g, ' ');

        const items = [];
        for (const [hrid, item] of Object.entries(itemDetailMap)) {
            if (item.equipmentDetail?.type !== slotType) continue;
            const levelReqs = item.equipmentDetail.levelRequirements || [];
            const primaryReq = levelReqs[0];
            const reqLevel = primaryReq?.level || 0;
            const reqSkill = primaryReq?.skillHrid?.split('/').pop() || '';

            let categoryLabel;
            if (reqSkill === 'attack') categoryLabel = t('Attack');
            else if (reqSkill === 'defense') categoryLabel = t('Defense');
            else if (reqSkill === 'ranged') categoryLabel = t('Ranged');
            else if (reqSkill === 'magic') categoryLabel = t('Magic');
            else categoryLabel = t('General');

            items.push({
                hrid,
                name: item.name || hrid.split('/').pop(),
                itemLevel: item.itemLevel || 0,
                reqLevel,
                categoryLabel,
            });
        }

        items.sort((a, b) => {
            const catCmp = a.categoryLabel.localeCompare(b.categoryLabel);
            if (catCmp !== 0) return catCmp;
            return b.itemLevel - a.itemLevel;
        });

        const popup = document.createElement('div');
        popup.id = 'mwi-csim-equipment-picker';
        popup.style.cssText =
            'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:100000;' +
            'background:rgba(10,10,20,0.97); border:2px solid rgba(74,158,255,0.5); border-radius:10px;' +
            'width:350px; max-height:400px; display:flex; flex-direction:column;' +
            "font-family:'Segoe UI',sans-serif; color:#e0e0e0; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.6);";

        const header = document.createElement('div');
        header.style.cssText =
            'display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid rgba(74,158,255,0.3); flex-shrink:0;';
        header.innerHTML =
            `<span style="font-weight:700; font-size:13px; color:${ACCENT};">${t('Select')} ${slotName}</span>` +
            '<button id="mwi-csim-equip-picker-close" style="background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1;">\u00d7</button>';
        popup.appendChild(header);

        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding:6px 14px; flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = t('Search...');
        searchInput.style.cssText =
            'width:100%; padding:5px 8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:6px; color:#e0e0e0; font-size:12px; font-family:inherit; outline:none;';
        searchDiv.appendChild(searchInput);
        popup.appendChild(searchDiv);

        const listEl = document.createElement('div');
        listEl.style.cssText = 'flex:1; overflow-y:auto; padding:4px 14px;';
        popup.appendChild(listEl);

        const currentHrid = dto.equipment[slotType]?.hrid || '';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query ? items.filter((i) => i.name.toLowerCase().includes(lower)) : items;

            let html =
                '<div data-pick-hrid="" style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:#888; font-style:italic;"' +
                ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                t('Empty (remove slot)') +
                '</div>';

            let lastCategory = '';
            for (const item of filtered.slice(0, 100)) {
                if (item.categoryLabel !== lastCategory) {
                    lastCategory = item.categoryLabel;
                    html += `<div style="padding:6px 0 2px; font-size:10px; font-weight:700; color:${ACCENT}; border-bottom:1px solid #2a2a4e; margin-top:4px;">${item.categoryLabel}</div>`;
                }

                const isCurrent = item.hrid === currentHrid;
                const color = isCurrent ? ACCENT : '#ccc';
                const indicator = isCurrent ? ` <span style="color:${ACCENT};">\u25cf</span>` : '';
                const lvlTag = `<span style="color:#666; font-size:10px; margin-left:auto; flex-shrink:0;">Lv ${item.reqLevel}</span>`;

                html +=
                    `<div data-pick-hrid="${item.hrid}" style="display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:${color};"` +
                    ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                    item.name +
                    indicator +
                    lvlTag +
                    '</div>';
            }
            if (filtered.length > 100) {
                html += `<div style="color:#666; text-align:center; padding:6px;">...${filtered.length - 100} more</div>`;
            }
            listEl.innerHTML = html;

            listEl.querySelectorAll('[data-pick-hrid]').forEach((row) => {
                row.addEventListener('click', () => {
                    const hrid = row.dataset.pickHrid;
                    if (hrid) {
                        dto.equipment[slotType] = { hrid, enhancementLevel: 0 };
                    } else {
                        delete dto.equipment[slotType];
                    }
                    closePicker();
                    this.renderEditor();
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        const closePicker = () => {
            popup.remove();
            document.getElementById('mwi-csim-equipment-backdrop')?.remove();
        };

        popup.querySelector('#mwi-csim-equip-picker-close').addEventListener('click', closePicker);

        const backdrop = document.createElement('div');
        backdrop.id = 'mwi-csim-equipment-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999;';
        backdrop.addEventListener('click', closePicker);

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        renderList('');
        searchInput.focus();
    }

    /** @private */
    _openAbilityPicker(slotIndex, dto, gameData) {
        document.getElementById('mwi-csim-ability-picker')?.remove();
        document.getElementById('mwi-csim-ability-backdrop')?.remove();

        const abilityDetailMap = gameData?.abilityDetailMap || {};
        const isSpecialSlot = slotIndex === 0;

        const usedHrids = new Set();
        for (let i = 0; i < dto.abilities.length; i++) {
            if (i === slotIndex || !dto.abilities[i]) continue;
            usedHrids.add(dto.abilities[i].hrid);
        }

        const items = [];
        for (const [hrid, ability] of Object.entries(abilityDetailMap)) {
            if (isSpecialSlot && !ability.isSpecialAbility) continue;
            if (!isSpecialSlot && ability.isSpecialAbility) continue;

            const effects = ability.abilityEffects || [];
            const combatStyle = effects[0]?.combatStyleHrid?.split('/').pop() || '';
            let categoryLabel;
            if (combatStyle === 'stab' || combatStyle === 'slash' || combatStyle === 'smash')
                categoryLabel = t('Melee');
            else if (combatStyle === 'ranged') categoryLabel = t('Ranged');
            else if (combatStyle === 'magic') categoryLabel = t('Magic');
            else categoryLabel = t('Other');

            items.push({
                hrid,
                name: ability.name || hrid.split('/').pop(),
                categoryLabel,
                conflict: usedHrids.has(hrid),
            });
        }

        items.sort((a, b) => {
            const catCmp = a.categoryLabel.localeCompare(b.categoryLabel);
            if (catCmp !== 0) return catCmp;
            return a.name.localeCompare(b.name);
        });

        const popup = document.createElement('div');
        popup.id = 'mwi-csim-ability-picker';
        popup.style.cssText =
            'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:100000;' +
            'background:rgba(10,10,20,0.97); border:2px solid rgba(74,158,255,0.5); border-radius:10px;' +
            'width:350px; max-height:400px; display:flex; flex-direction:column;' +
            "font-family:'Segoe UI',sans-serif; color:#e0e0e0; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.6);";

        const slotLabel = isSpecialSlot ? t('Special Ability') : `${t('Ability Slot')} ${slotIndex}`;
        const header = document.createElement('div');
        header.style.cssText =
            'display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid rgba(74,158,255,0.3); flex-shrink:0;';
        header.innerHTML =
            `<span style="font-weight:700; font-size:13px; color:${ACCENT};">${t('Select')} ${slotLabel}</span>` +
            '<button id="mwi-csim-ability-picker-close" style="background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0; line-height:1;">\u00d7</button>';
        popup.appendChild(header);

        const searchDiv = document.createElement('div');
        searchDiv.style.cssText = 'padding:6px 14px; flex-shrink:0;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = t('Search...');
        searchInput.style.cssText =
            'width:100%; padding:5px 8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:6px; color:#e0e0e0; font-size:12px; font-family:inherit; outline:none;';
        searchDiv.appendChild(searchInput);
        popup.appendChild(searchDiv);

        const listEl = document.createElement('div');
        listEl.style.cssText = 'flex:1; overflow-y:auto; padding:4px 14px;';
        popup.appendChild(listEl);

        const currentHrid = dto.abilities[slotIndex]?.hrid || '';

        const renderList = (query) => {
            const lower = query.toLowerCase();
            const filtered = query ? items.filter((i) => i.name.toLowerCase().includes(lower)) : items;

            let html =
                '<div data-pick-hrid="" style="display:flex; align-items:center; gap:8px; padding:4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:#888; font-style:italic;"' +
                ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                t('Empty (clear slot)') +
                '</div>';

            let lastCategory = '';
            for (const item of filtered) {
                if (item.categoryLabel !== lastCategory) {
                    lastCategory = item.categoryLabel;
                    html += `<div style="padding:6px 0 2px; font-size:10px; font-weight:700; color:${ACCENT}; border-bottom:1px solid #2a2a4e; margin-top:4px;">${item.categoryLabel}</div>`;
                }

                if (item.conflict) {
                    html +=
                        '<div style="display:flex; align-items:center; gap:8px; padding:3px 4px; border-bottom:1px solid #1a1a2e; color:#555; cursor:default;">' +
                        item.name +
                        ' <span style="font-size:10px; color:#664;">(' +
                        t('in use') +
                        ')</span></div>';
                } else {
                    const isCurrent = item.hrid === currentHrid;
                    const color = isCurrent ? ACCENT : '#ccc';
                    const indicator = isCurrent ? ` <span style="color:${ACCENT};">\u25cf</span>` : '';
                    html +=
                        `<div data-pick-hrid="${item.hrid}" style="display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer; border-bottom:1px solid #1a1a2e; color:${color};"` +
                        ' onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'\'">' +
                        item.name +
                        indicator +
                        '</div>';
                }
            }
            listEl.innerHTML = html;

            listEl.querySelectorAll('[data-pick-hrid]').forEach((row) => {
                row.addEventListener('click', () => {
                    const hrid = row.dataset.pickHrid;
                    const existingLevel = dto.abilities[slotIndex]?.level || 1;
                    if (hrid) {
                        while (dto.abilities.length <= slotIndex) dto.abilities.push(null);
                        dto.abilities[slotIndex] = { hrid, level: existingLevel, triggers: null };
                    } else if (slotIndex < dto.abilities.length) {
                        dto.abilities[slotIndex] = null;
                    }
                    closePicker();
                    this.renderEditor();
                });
            });
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderList(searchInput.value.trim()), 150);
        });

        const closePicker = () => {
            popup.remove();
            document.getElementById('mwi-csim-ability-backdrop')?.remove();
        };

        popup.querySelector('#mwi-csim-ability-picker-close').addEventListener('click', closePicker);

        const backdrop = document.createElement('div');
        backdrop.id = 'mwi-csim-ability-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999;';
        backdrop.addEventListener('click', closePicker);

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        renderList('');
        searchInput.focus();
    }

    /** @private */
    _renderSkillLevelsSection(dto) {
        const combatSkills = [
            { key: 'staminaLevel', label: t('Stamina') },
            { key: 'intelligenceLevel', label: t('Intelligence') },
            { key: 'attackLevel', label: t('Attack') },
            { key: 'meleeLevel', label: t('Melee') },
            { key: 'defenseLevel', label: t('Defense') },
            { key: 'rangedLevel', label: t('Ranged') },
            { key: 'magicLevel', label: t('Magic') },
        ];
        const skillingSkills = [
            { key: 'woodcuttingLevel', label: t('Woodcutting') },
            { key: 'foragingLevel', label: t('Foraging') },
            { key: 'milkingLevel', label: t('Milking') },
            { key: 'cookingLevel', label: t('Cooking') },
            { key: 'brewingLevel', label: t('Brewing') },
            { key: 'cheesesmithingLevel', label: t('Cheesesmithing') },
            { key: 'craftingLevel', label: t('Crafting') },
            { key: 'tailoringLevel', label: t('Tailoring') },
            { key: 'alchemyLevel', label: t('Alchemy') },
            { key: 'enhancingLevel', label: t('Enhancing') },
        ];
        const skills = this.skillingMode ? skillingSkills : combatSkills;

        const summary = skills.map((s) => `${s.label.slice(0, 3)} ${dto[s.key]}`).join(' / ');

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="skill-section">`;
        html += `<span data-arrow="skill-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ${t('Skill Levels')}`;
        html += `<span style="color:#888; font-weight:400; font-size:11px; margin-left:6px;">${summary}</span>`;
        html += '</div>';
        html += `<div id="mwi-csim-skill-section" style="display:none;">`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">`;

        for (const skill of skills) {
            html += `<div style="display:flex; align-items:center; gap:6px; font-size:12px;">`;
            html += `<span style="color:#888; width:70px;">${skill.label}</span>`;
            html += `<input type="number" min="1" max="200" value="${dto[skill.key]}"
                data-skill="${skill.key}"
                style="width:48px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += '</div>';
        }

        html += '</div></div></div>';
        return html;
    }

    /** @private */
    _renderHouseRoomsSection(dto, gameData) {
        const houseRoomDetailMap = gameData.houseRoomDetailMap || {};
        const roomHrids = Object.keys(houseRoomDetailMap).sort();
        const activeCount = roomHrids.filter((hrid) => (dto.houseRooms[hrid] || 0) > 0).length;

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="house-section">`;
        html += `<span data-arrow="house-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ${t('House Rooms')}`;
        html += `<span style="color:#888; font-weight:400; font-size:11px; margin-left:6px;">${activeCount} ${t('active')}</span>`;
        html += '</div>';
        html += `<div id="mwi-csim-house-section" style="display:none;">`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">`;

        for (const hrid of roomHrids) {
            const room = houseRoomDetailMap[hrid];
            const name = room.name || hrid.split('/').pop();
            const level = dto.houseRooms[hrid] || 0;
            html += `<div style="display:flex; align-items:center; gap:6px; font-size:12px;">`;
            html += `<span style="color:#888; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}">${name}</span>`;
            html += `<input type="number" min="0" max="8" value="${level}"
                data-house-hrid="${hrid}"
                style="width:40px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += '</div>';
        }

        html += '</div></div></div>';
        return html;
    }

    /** @private */
    _renderTokenUpgradesSection(dto) {
        const upgrades = [
            { key: 'speed', label: t('Speed') },
            { key: 'efficiency', label: t('Efficiency') },
            { key: 'success', label: t('Success Rate') },
            { key: 'doubleProgress', label: t('Double Progress') },
        ];
        const tokens = dto.tokenUpgrades || {};
        const activeCount = upgrades.filter((u) => (tokens[u.key] || 0) > 0).length;

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="token-section">`;
        html += `<span data-arrow="token-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ${t('Token Upgrades')}`;
        html += `<span style="color:#888; font-weight:400; font-size:11px; margin-left:6px;">${activeCount} ${t('active')}</span>`;
        html += '</div>';
        html += `<div id="mwi-csim-token-section" style="display:none;">`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">`;

        for (const upgrade of upgrades) {
            const val = tokens[upgrade.key] || 0;
            html += `<div style="display:flex; align-items:center; gap:6px; font-size:12px;">`;
            html += `<span style="color:#888; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${upgrade.label}</span>`;
            html += `<input type="number" min="0" max="12" value="${val}"
                data-token-upgrade="${upgrade.key}"
                style="width:40px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += '</div>';
        }

        html += '</div></div></div>';
        return html;
    }

    /** @private */
    _renderCommunityBuffsSection(dto) {
        const buffs = [
            { key: 'productionEfficiency', label: t('Prod. Efficiency') },
            { key: 'enhancingSpeed', label: t('Enhancing Speed') },
            { key: 'gatheringQuantity', label: t('Gathering Qty') },
            { key: 'experience', label: t('Experience') },
        ];
        const levels = dto.communityBuffLevels || {};
        const activeCount = buffs.filter((b) => (levels[b.key] || 0) > 0).length;

        let html = `<div style="margin-bottom:10px;">`;
        html += `<div style="color:${ACCENT}; font-weight:700; font-size:12px; margin-bottom:6px; cursor:pointer; user-select:none;" data-toggle="community-section">`;
        html += `<span data-arrow="community-section" style="display:inline-block; width:14px; font-size:10px;">&#9654;</span> ${t('Community Buffs')}`;
        html += `<span style="color:#888; font-weight:400; font-size:11px; margin-left:6px;">${activeCount} ${t('active')}</span>`;
        html += '</div>';
        html += `<div id="mwi-csim-community-section" style="display:none;">`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px;">`;

        for (const buff of buffs) {
            const val = levels[buff.key] || 0;
            html += `<div style="display:flex; align-items:center; gap:6px; font-size:12px;">`;
            html += `<span style="color:#888; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${buff.label}">${buff.label}</span>`;
            html += `<input type="number" min="0" max="30" value="${val}"
                data-community-buff="${buff.key}"
                style="width:40px; background:#1a1a2e; color:#e0e0e0; border:1px solid #444;
                border-radius:3px; padding:1px 3px; font-size:12px; text-align:center;">`;
            html += '</div>';
        }

        html += '</div></div></div>';
        return html;
    }

    /** @private */
    _wireEditorEvents(editorArea, dto) {
        editorArea.querySelectorAll('[data-toggle]').forEach((el) => {
            el.addEventListener('click', () => {
                const sectionId = el.dataset.toggle;
                const section = editorArea.querySelector('#mwi-csim-' + sectionId);
                const arrow = editorArea.querySelector('[data-arrow="' + sectionId + '"]');
                if (section) {
                    const isOpen = section.style.display !== 'none';
                    section.style.display = isOpen ? 'none' : 'block';
                    if (arrow) arrow.innerHTML = isOpen ? '&#9654;' : '&#9660;';
                    if (isOpen) {
                        this._openSections.delete(sectionId);
                    } else {
                        this._openSections.add(sectionId);
                    }
                }
            });

            const sectionId = el.dataset.toggle;
            if (this._openSections.has(sectionId)) {
                const section = editorArea.querySelector('#mwi-csim-' + sectionId);
                const arrow = editorArea.querySelector('[data-arrow="' + sectionId + '"]');
                if (section) {
                    section.style.display = 'block';
                    if (arrow) arrow.innerHTML = '&#9660;';
                }
            }
        });

        editorArea.querySelectorAll('[data-enhance-slot]').forEach((input) => {
            input.addEventListener('change', () => {
                const slotType = input.dataset.enhanceSlot;
                const val = Math.min(20, Math.max(0, parseInt(input.value) || 0));
                input.value = val;
                if (dto.equipment[slotType]) {
                    dto.equipment[slotType].enhancementLevel = val;
                }
            });
        });

        editorArea.querySelectorAll('[data-ability-idx]').forEach((input) => {
            input.addEventListener('change', () => {
                const idx = parseInt(input.dataset.abilityIdx);
                const val = Math.max(1, parseInt(input.value) || 1);
                input.value = val;
                if (dto.abilities[idx]) {
                    dto.abilities[idx].level = val;
                }
            });
        });

        editorArea.querySelectorAll('[data-skill]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = input.dataset.skill;
                const val = Math.max(1, parseInt(input.value) || 1);
                input.value = val;
                dto[key] = val;
            });
        });

        editorArea.querySelectorAll('[data-house-hrid]').forEach((input) => {
            input.addEventListener('change', () => {
                const hrid = input.dataset.houseHrid;
                const val = Math.max(0, Math.min(8, parseInt(input.value) || 0));
                input.value = val;
                if (val === 0) {
                    delete dto.houseRooms[hrid];
                } else {
                    dto.houseRooms[hrid] = val;
                }
            });
        });

        editorArea.querySelectorAll('[data-token-upgrade]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = input.dataset.tokenUpgrade;
                const val = Math.max(0, Math.min(12, parseInt(input.value) || 0));
                input.value = val;
                if (!dto.tokenUpgrades) dto.tokenUpgrades = {};
                dto.tokenUpgrades[key] = val;
            });
        });

        editorArea.querySelectorAll('[data-community-buff]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = input.dataset.communityBuff;
                const val = Math.max(0, Math.min(30, parseInt(input.value) || 0));
                input.value = val;
                if (!dto.communityBuffLevels) dto.communityBuffLevels = {};
                dto.communityBuffLevels[key] = val;
            });
        });

        editorArea.querySelectorAll('[data-consumable-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const [slotType, idx] = btn.dataset.consumableSlot.split('-');
                const gameData = buildGameDataPayload();
                if (gameData) this._openConsumablePicker(slotType, parseInt(idx), dto, gameData);
            });
        });

        editorArea.querySelectorAll('[data-equipment-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const slotType = btn.dataset.equipmentSlot;
                const gameData = buildGameDataPayload();
                if (gameData) this._openEquipmentPicker(slotType, dto, gameData);
            });
        });

        editorArea.querySelectorAll('[data-ability-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const slotIndex = parseInt(btn.dataset.abilitySlot);
                const gameData = buildGameDataPayload();
                if (gameData) this._openAbilityPicker(slotIndex, dto, gameData);
            });
        });

        const resetBtn = editorArea.querySelector('#mwi-csim-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this._editedDTOs = structuredClone(this._originalDTOs);
                this._selectedLoadoutName = '';
                this.renderEditor();
            });
        }

        editorArea.querySelectorAll('[data-edit-tab]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                if (e.target.dataset.removePlayer) return;
                this._activeEditPlayer = btn.dataset.editTab;
                this.renderEditor();
            });
        });

        editorArea.querySelectorAll('[data-remove-player]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hrid = btn.dataset.removePlayer;
                if (!this._editedDTOs) return;
                delete this._editedDTOs[hrid];
                if (this._originalDTOs) delete this._originalDTOs[hrid];
                this._editedPlayerInfo = this._editedPlayerInfo.filter((p) => p.hrid !== hrid);
                if (this._activeEditPlayer === hrid) {
                    this._activeEditPlayer = this._editedPlayerInfo[0]?.hrid || null;
                }
                if (Object.keys(this._editedDTOs).length === 0) {
                    this._editedDTOs = {};
                    this._originalDTOs = {};
                    this._editedPlayerInfo = [];
                    this._editorInitialized = true;
                    this._activeEditPlayer = null;
                    this._selfHrid = null;
                    this.renderEditor();
                    return;
                }
                this.renderEditor();
            });
        });

        const importBtn = editorArea.querySelector('#mwi-csim-import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const area = editorArea.querySelector('#mwi-csim-import-area');
                if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
            });
        }

        const importGo = editorArea.querySelector('#mwi-csim-import-go');
        if (importGo) {
            importGo.addEventListener('click', () => {
                const text = editorArea.querySelector('#mwi-csim-import-text')?.value?.trim();
                const errorEl = editorArea.querySelector('#mwi-csim-import-error');
                if (!text) {
                    if (errorEl) errorEl.textContent = t('Paste export data first.');
                    return;
                }
                const result = parseShykaiImport(text);
                if (!result || !result.players.length) {
                    if (errorEl) errorEl.textContent = t('Invalid format. Paste a Shykai export JSON.');
                    return;
                }
                this.importPlayers(result.players, result.names);
                const area = editorArea.querySelector('#mwi-csim-import-area');
                if (area) area.style.display = 'none';
            });
        }

        const importCancel = editorArea.querySelector('#mwi-csim-import-cancel');
        if (importCancel) {
            importCancel.addEventListener('click', () => {
                const area = editorArea.querySelector('#mwi-csim-import-area');
                if (area) area.style.display = 'none';
            });
        }

        const loadoutSelect = editorArea.querySelector('#mwi-csim-loadout-select');
        if (loadoutSelect) {
            loadoutSelect.addEventListener('change', () => {
                const selectedName = loadoutSelect.value;
                this._selectedLoadoutName = selectedName;
                if (!selectedName) {
                    const activePlayer = this._activeEditPlayer;
                    if (this._originalDTOs?.[activePlayer]) {
                        this._editedDTOs[activePlayer] = structuredClone(this._originalDTOs[activePlayer]);
                    }
                } else {
                    this._applyLoadoutToDTO(selectedName);
                }
                this.renderEditor();
            });
        }
    }

    /**
     * Generate a descriptive label by diffing edited DTOs against original.
     * @returns {string}
     */
    generateSimLabel() {
        const selfHrid = this._selfHrid || this._activeEditPlayer;
        const original = this._originalDTOs?.[selfHrid];
        const edited = this._editedDTOs?.[selfHrid];
        if (!original || !edited) return this._selectedLoadoutName || t('Current Gear');

        const gameData = buildGameDataPayload();
        const itemDetailMap = gameData?.itemDetailMap || {};
        const abilityDetailMap = gameData?.abilityDetailMap || {};

        const changes = [];

        const slotNames = {
            '/equipment_types/head': t('Head'),
            '/equipment_types/body': t('Body'),
            '/equipment_types/legs': t('Legs'),
            '/equipment_types/feet': t('Feet'),
            '/equipment_types/hands': t('Hands'),
            '/equipment_types/main_hand': t('Main Hand'),
            '/equipment_types/two_hand': t('Two Hand'),
            '/equipment_types/off_hand': t('Off Hand'),
            '/equipment_types/pouch': t('Pouch'),
            '/equipment_types/back': t('Back'),
            '/equipment_types/neck': t('Neck'),
            '/equipment_types/earrings': t('Earrings'),
            '/equipment_types/ring': t('Ring'),
            '/equipment_types/charm': t('Charm'),
        };

        for (const slot of Object.keys(slotNames)) {
            const origEquip = original.equipment?.[slot];
            const editEquip = edited.equipment?.[slot];
            if (!origEquip && !editEquip) continue;

            if (origEquip?.hrid !== editEquip?.hrid) {
                const origName =
                    itemDetailMap[origEquip?.hrid]?.name || origEquip?.hrid?.split('/').pop() || t('Empty');
                const editName =
                    itemDetailMap[editEquip?.hrid]?.name || editEquip?.hrid?.split('/').pop() || t('Empty');
                changes.push(`${origName} \u2192 ${editName}`);
            } else if (origEquip?.enhancementLevel !== editEquip?.enhancementLevel) {
                const label = slotNames[slot];
                changes.push(`${label} +${origEquip.enhancementLevel}\u2192+${editEquip.enhancementLevel}`);
            }
        }

        for (let i = 0; i < 5; i++) {
            const origAb = original.abilities?.[i];
            const editAb = edited.abilities?.[i];
            if (!origAb && !editAb) continue;

            if (origAb?.hrid !== editAb?.hrid) {
                const origName = abilityDetailMap[origAb?.hrid]?.name || origAb?.hrid?.split('/').pop() || t('None');
                const editName = abilityDetailMap[editAb?.hrid]?.name || editAb?.hrid?.split('/').pop() || t('None');
                changes.push(`${origName} \u2192 ${editName}`);
            } else if (origAb && editAb && origAb.level !== editAb.level) {
                const name = abilityDetailMap[editAb.hrid]?.name || editAb.hrid.split('/').pop();
                changes.push(`${name} Lv ${origAb.level}\u2192${editAb.level}`);
            }
        }

        const skillLabels = {
            staminaLevel: t('Stamina'),
            intelligenceLevel: t('Intelligence'),
            attackLevel: t('Attack'),
            meleeLevel: t('Melee'),
            defenseLevel: t('Defense'),
            rangedLevel: t('Ranged'),
            magicLevel: t('Magic'),
            woodcuttingLevel: t('Woodcutting'),
            foragingLevel: t('Foraging'),
            milkingLevel: t('Milking'),
            cookingLevel: t('Cooking'),
            brewingLevel: t('Brewing'),
            cheesesmithingLevel: t('Cheesesmithing'),
            craftingLevel: t('Crafting'),
            tailoringLevel: t('Tailoring'),
            alchemyLevel: t('Alchemy'),
            enhancingLevel: t('Enhancing'),
        };
        for (const [key, label] of Object.entries(skillLabels)) {
            if (original[key] !== edited[key]) {
                changes.push(`${label} ${original[key]}\u2192${edited[key]}`);
            }
        }

        const slotLabels = { food: t('Food'), drinks: t('Drink') };
        for (const [slotType, prefix] of Object.entries(slotLabels)) {
            for (let i = 0; i < 3; i++) {
                const origHrid = original[slotType]?.[i]?.hrid;
                const editHrid = edited[slotType]?.[i]?.hrid;
                if (origHrid !== editHrid) {
                    const origName = origHrid ? itemDetailMap[origHrid]?.name || origHrid.split('/').pop() : t('Empty');
                    const editName = editHrid ? itemDetailMap[editHrid]?.name || editHrid.split('/').pop() : t('Empty');
                    changes.push(`${prefix} ${i + 1}: ${origName}\u2192${editName}`);
                }
            }
        }

        const tokenLabels = {
            speed: t('Speed'),
            efficiency: t('Efficiency'),
            success: t('Success'),
            doubleProgress: t('DblProg'),
        };
        for (const [key, label] of Object.entries(tokenLabels)) {
            const origVal = original.tokenUpgrades?.[key] || 0;
            const editVal = edited.tokenUpgrades?.[key] || 0;
            if (origVal !== editVal) {
                changes.push(`${t('Token')} ${label} ${origVal}\u2192${editVal}`);
            }
        }

        const cbLabels = {
            productionEfficiency: t('ProdEff'),
            enhancingSpeed: t('EnhSpd'),
            gatheringQuantity: t('GathQty'),
            experience: t('Exp'),
        };
        for (const [key, label] of Object.entries(cbLabels)) {
            const origVal = original.communityBuffLevels?.[key] || 0;
            const editVal = edited.communityBuffLevels?.[key] || 0;
            if (origVal !== editVal) {
                changes.push(`CB ${label} ${origVal}\u2192${editVal}`);
            }
        }

        const loadoutPrefix = this._selectedLoadoutName || '';
        if (changes.length === 0) return loadoutPrefix || t('Current Gear');
        const changesStr = changes.join(', ');
        return loadoutPrefix ? loadoutPrefix + ': ' + changesStr : changesStr;
    }

    /** @private */
    _applyLoadoutToDTO(loadoutName) {
        const gameData = buildGameDataPayload();
        if (!gameData) return;
        const dto = this._editedDTOs[this._activeEditPlayer];
        if (!dto) return;
        applyLoadoutSnapshotToDTO(dto, loadoutName, gameData);
    }
}
