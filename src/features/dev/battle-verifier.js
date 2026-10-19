/**
 * Battle Verifier - battleId 验证数据采集工具 (v4.2)
 * 用于 Issue #779 的 battleId 行为验证
 *
 * v4 设计原则：
 * - 全按钮驱动：用户只按面板指引依次点击，零控制台操作
 * - 零控制台输出：所有状态、日志、结果都在面板内呈现
 * - 报告全自动：三组完成后自动生成标准化报告（含结论），自动复制剪贴板，常驻面板
 * - 连续消息自动快照：普通图（离线前后）自动采集，地下城提供一键按钮
 *
 * v4.1 数据兼容加固：
 * - 遗留数据（v2/v3）加载时先备份再迁移，规范化修复时间戳混用等缺陷
 * - 非法状态/快照降级，高版本数据隔离，支持 restoreLegacyBackup() 回滚
 *
 * v4.2 多角色隔离与导出：
 * - 存储键按角色分键（battleVerifier_data_c<characterId>），多标签多角色同时在线互不覆盖
 * - 旧共享键一次性认领迁移：按最新快照角色名归属，认领时统一修正组队误存的队友名
 * - 新增「⬇ 导出」：当前角色全部数据一键导出（JSON 文件下载 + 剪贴板）
 * - 地下城样本来源校验：仅采信 combatZoneInfo.isDungeon 的消息，普通图误点被拒绝
 * - 组2 团灭判定适配双逻辑：cs 变化或 battleId 回落均判定重开完成；
 *   单人死亡（150 秒复活后继续同一局，cs 与 battleId 连续）不会误触发
 * - 角色名以 dataManager（init_character_data）为权威来源，不再依赖组队时顺序随机的 players[0]
 *
 * 三组测试：
 * - 组1 离线测试: battleId 是否在离线期间累加
 * - 组2 团灭测试: 团灭波次是否计入 battleId（组队=从头开始 / 单人=复活续战，两种逻辑）
 * - 组3 重开测试: 手动停止/重开同图是否重置 battleId
 * - 附加: combatStartTime 语义（整段战斗开始 vs 每波开始）
 */

import webSocketHook from '../../core/websocket.js';
import dataManager from '../../core/data-manager.js';
import storage from '../../core/storage.js';
import { createTimerRegistry } from '../../utils/timer-registry.js';
import { registerFloatingPanel, unregisterFloatingPanel, bringPanelToFront } from '../../utils/panel-z-index.js';
import { t } from '../../core/i18n.js';

const STORAGE_KEY = 'battleVerifier_data';
const LEGACY_BACKUP_KEY = 'battleVerifier_data_legacy_backup';
const BUTTON_ID = 'toolasha-battle-verifier-btn';
const PANEL_ID = 'toolasha-battle-verifier-panel';

/**
 * dev 工具隐藏入口：仅在页面 URL 带 ?toolasha_dev=1 时启用
 * 普通用户零痕迹（不加载、不注册监听、不显示任何 UI）
 */
const DEV_URL_PARAM = 'toolasha_dev';

function isDevToolEnabled() {
    try {
        return new URLSearchParams(location.search).has(DEV_URL_PARAM);
    } catch {
        return false;
    }
}

/** 组1 视为"离线"的最小时间间隔 */
const OFFLINE_MS = 30 * 60 * 1000;

/** 连续消息快照的条数 */
const CONSECUTIVE_N = 4;

/** 面板事件日志最大条数 */
const EVENT_LOG_MAX = 40;

/** 采集状态机 */
const CaptureStatus = {
    IDLE: 'idle',
    G1_BEFORE: 'g1_before',
    G1_AFTER: 'g1_after',
    G2_BASELINE: 'g2_base',
    G2_WAITING: 'g2_wait',
    G2_AFTER: 'g2_after',
    G3_BEFORE: 'g3_before',
    G3_AFTER: 'g3_after',
};

class BattleVerifier {
    constructor() {
        this.data = null;
        this.button = null;
        this.panel = null;
        this.contentEl = null;
        this.isCapturing = false;
        this.timerRegistry = createTimerRegistry();
        this.battleHandler = null;
        this.eventLog = []; // 面板事件日志（仅内存）

        // 会话内统计
        this.totalSeen = 0;
        this.lastMessageAt = 0;
        this.lastBattleId = null;
        this.lastCombatStartTime = null;
        this.recentMessages = []; // 最近消息滚动缓冲
        this.pendingPostSamples = 0; // 组1完成后待采集的离线后连续消息数
    }

    /**
     * 初始化：加载数据、创建按钮、注册 WebSocket 监听、自动恢复采集
     */
    async initialize() {
        // 隐藏入口：URL 未带 ?toolasha_dev=1 时不启用（不加载、不注册、不显示 UI）
        if (!isDevToolEnabled()) {
            return;
        }
        this._migrationNotes = [];
        // 存储键按角色隔离：多标签多角色同时在线时互不覆盖
        const charId = dataManager.getCurrentCharacterId();
        this.storageKey = charId ? `${STORAGE_KEY}_c${charId}` : STORAGE_KEY;
        this.characterId = charId ?? null;
        this.data = await this._loadData();
        this._migrationNotes.forEach((n) => this._pushLog('ℹ️ ' + n));
        this._ensureReport();
        this._createButton();

        this.battleHandler = (data) => this._handleNewBattle(data);
        webSocketHook.on('new_battle', this.battleHandler);

        // 采集状态持久化：刷新/重开浏览器后自动继续
        if (this.data.captureActive && this.data.status !== CaptureStatus.IDLE) {
            this.isCapturing = true;
            this._pushLog(t('bv.resumed'));
        }

        // 暴露到页面 window（沙箱内 window 控制台不可见；此处仅供调试，正常流程无需使用）
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        targetWindow.battleVerifier = this;

        this.timerRegistry.registerInterval(setInterval(() => this._tick(), 1000));
        this._pushLog(t('bv.loaded', { name: dataManager.getCurrentCharacterName() ?? t('bv.unknownCharacter') }));
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.battleHandler) {
            webSocketHook.off('new_battle', this.battleHandler);
        }
        this.timerRegistry.clearAll();
        this._removeButton();
        this._removePanel();
    }

    // ------------------------------------------------------------------
    // 数据持久化
    // ------------------------------------------------------------------

    /**
     * 创建空数据结构
     */
    _createEmptyData() {
        return {
            version: 4,
            status: CaptureStatus.IDLE,
            captureActive: false,
            group1: { before: null, after: null, invalid: false },
            group2: { baseline: null, deathRun: null, deathRunMaxBattleId: 0, afterWipe: null },
            group3: { before: null, after: null },
            consecutive: { regularPre: [], regularPost: [], dungeon: [] },
            report: null,
            errors: [],
            messageCount: 0,
            playerName: null,
            startTime: null,
        };
    }

    /**
     * 加载持久化数据
     *
     * 数据边界规则：
     * - 仅读取本功能的 storage key，不触碰其他功能数据
     * - version === 4：规范化后直接使用
     * - version <= 3（v2/v3 遗留）：先将原始数据备份到独立 key，再迁移到 v4 结构
     * - version > 4（更新版本写入）：隔离不读，原始数据保留在备份 key
     * - v1 控制台脚本数据在 localStorage，与本 IndexedDB 存储天然隔离，永不读取
     */
    async _loadData() {
        this._migrationNotes = [];
        const saved = await storage.get(this.storageKey, 'settings', null);
        if (!saved) {
            return this._migrateSharedLegacyData();
        }
        if (saved.version === 4) {
            return this._normalizeData(saved);
        }
        if (typeof saved.version === 'number' && saved.version > 4) {
            try {
                await storage.set(LEGACY_BACKUP_KEY, saved, 'settings');
            } catch (error) {
                this._migrationNotes.push(t('bv.highVersionBackupFail', { msg: error?.message || error }));
            }
            this._migrationNotes.push(t('bv.highVersionIsolated', { v: saved.version }));
            return this._createEmptyData();
        }
        // v2/v3 遗留数据：备份 → 迁移
        try {
            await storage.set(LEGACY_BACKUP_KEY, saved, 'settings');
        } catch (error) {
            this._migrationNotes.push(t('bv.legacyBackupFail', { msg: error?.message || error }));
        }
        const migrated = this._normalizeData({ ...saved, version: 4 });
        this._migrationNotes.unshift(t('bv.legacyMigrated', { v: saved.version ?? t('bv.unknownVersion') }));
        return migrated;
    }

    /**
     * 一次性迁移旧版共享主键数据（v4.1 及之前所有角色共用一个键，多标签互相覆盖）：
     * - 解析旧数据中最新非空快照的角色名，仅当其等于当前角色时才迁移到本角色键
     * - 迁移时统一修正快照 playerName（旧版组队时 players[0] 顺序不定，可能误存队友名）
     * - 旧键打上 migratedTo 标记，防止其他角色标签重复迁移
     */
    async _migrateSharedLegacyData() {
        const shared = await storage.get(STORAGE_KEY, 'settings', null);
        if (!shared || typeof shared !== 'object') {
            return this._createEmptyData();
        }
        if (shared.migratedTo) {
            this._migrationNotes.push(t('bv.migratedAway', { name: shared.migratedTo }));
            return this._createEmptyData();
        }
        const currentName = dataManager.getCurrentCharacterName();
        // 收集快照中最新非空 playerName 作为归属判定
        const snaps = [
            shared.group1?.before,
            shared.group1?.after,
            shared.group2?.baseline,
            shared.group2?.deathRun,
            shared.group2?.afterWipe,
            shared.group3?.before,
            shared.group3?.after,
        ].filter((s) => s && typeof s === 'object');
        const named = snaps
            .filter((s) => typeof s.playerName === 'string' && s.playerName)
            .sort((a, b) => (Number(b.capturedAt) || 0) - (Number(a.capturedAt) || 0));
        const latestName = named[0]?.playerName ?? null;

        if (latestName && currentName && latestName !== currentName) {
            // 旧数据属于其他角色：不迁移，等对应角色的标签页启动时认领
            this._migrationNotes.push(t('bv.sharedOwnedByOther', { latest: latestName, current: currentName }));
            return this._createEmptyData();
        }

        const ownerName = currentName ?? latestName ?? t('bv.unknownCharacter');
        const migrated = this._normalizeData({ ...shared, version: 4 });
        // 修正旧版 players[0] 污染：归属确定后统一快照角色名
        for (const s of snaps) {
            if (s.playerName && s.playerName !== ownerName) {
                s.playerName = ownerName;
            }
        }
        migrated.playerName = ownerName;
        try {
            await storage.set(this.storageKey, migrated, 'settings');
            await storage.set(STORAGE_KEY, { ...shared, migratedTo: ownerName }, 'settings');
            this._migrationNotes.push(t('bv.claimed', { owner: ownerName }));
        } catch (error) {
            this._migrationNotes.push(t('bv.migrateFail', { msg: error?.message || error }));
            return this._createEmptyData();
        }
        return migrated;
    }

    /**
     * 规范化数据结构：补齐缺失字段、修正类型、剔除非法值（幂等）
     */
    _normalizeData(raw) {
        const fresh = this._createEmptyData();
        if (!raw || typeof raw !== 'object') {
            return fresh;
        }
        const d = { ...fresh, ...raw };
        d.version = 4;

        const validStatuses = new Set(Object.values(CaptureStatus));
        if (!validStatuses.has(d.status)) {
            if (raw.status !== undefined && raw.status !== CaptureStatus.IDLE) {
                this._migrationNotes.push(t('bv.unknownStatus', { status: raw.status }));
            }
            d.status = CaptureStatus.IDLE;
        }
        d.captureActive = d.captureActive === true && d.status !== CaptureStatus.IDLE;

        for (const key of ['group1', 'group2', 'group3']) {
            const src = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
            d[key] = { ...fresh[key], ...src };
        }
        d.group1.before = this._normalizeSnapshot(d.group1.before);
        d.group1.after = this._normalizeSnapshot(d.group1.after);
        d.group1.invalid = d.group1.invalid === true;
        d.group2.baseline = this._normalizeSnapshot(d.group2.baseline);
        d.group2.deathRun = this._normalizeSnapshot(d.group2.deathRun);
        d.group2.afterWipe = this._normalizeSnapshot(d.group2.afterWipe);
        d.group2.deathRunMaxBattleId = Number.isFinite(Number(d.group2.deathRunMaxBattleId))
            ? Number(d.group2.deathRunMaxBattleId)
            : 0;
        d.group3.before = this._normalizeSnapshot(d.group3.before);
        d.group3.after = this._normalizeSnapshot(d.group3.after);

        const cs = raw.consecutive && typeof raw.consecutive === 'object' ? raw.consecutive : {};
        d.consecutive = {
            regularPre: Array.isArray(cs.regularPre) ? cs.regularPre : [],
            regularPost: Array.isArray(cs.regularPost) ? cs.regularPost : [],
            dungeon: Array.isArray(cs.dungeon) ? cs.dungeon : [],
        };
        d.errors = Array.isArray(raw.errors) ? raw.errors.slice(-10) : [];
        d.messageCount = Number.isFinite(Number(raw.messageCount)) ? Number(raw.messageCount) : 0;
        d.playerName = typeof raw.playerName === 'string' ? raw.playerName : null;

        this._demoteInvalidStates(d);
        return d;
    }

    /**
     * 规范化单条快照：battleId 必须可转数字，capturedAt 必须是数字或可解析的日期字符串（v2 混用修复），否则返回 null
     */
    _normalizeSnapshot(snap) {
        if (!snap || typeof snap !== 'object') {
            return null;
        }
        const battleId = Number(snap.battleId);
        if (!Number.isFinite(battleId)) {
            return null;
        }
        let capturedAt = snap.capturedAt;
        if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) {
            const parsed = typeof capturedAt === 'string' ? Date.parse(capturedAt) : NaN;
            if (!Number.isFinite(parsed)) {
                return null;
            }
            capturedAt = parsed;
        }
        return { ...snap, battleId, capturedAt };
    }

    /**
     * 状态降级：当前状态所必需的快照缺失/非法时，降级为未开始，避免流程卡死
     */
    _demoteInvalidStates(d) {
        const required = {
            [CaptureStatus.G1_BEFORE]: [d.group1.before],
            [CaptureStatus.G1_AFTER]: [d.group1.before, d.group1.after],
            [CaptureStatus.G2_BASELINE]: [d.group2.baseline],
            [CaptureStatus.G2_WAITING]: [d.group2.deathRun],
            [CaptureStatus.G2_AFTER]: [d.group2.deathRun, d.group2.afterWipe],
            [CaptureStatus.G3_BEFORE]: [d.group3.before],
            [CaptureStatus.G3_AFTER]: [d.group3.before, d.group3.after],
        }[d.status];
        if (required && required.some((s) => s === null)) {
            this._migrationNotes.push(t('bv.degraded', { status: d.status }));
            d.status = CaptureStatus.IDLE;
            d.captureActive = false;
        }
    }

    /**
     * 完成态但无报告（如迁移自 v3 的 g3_after）：按当前数据重新生成
     */
    _ensureReport() {
        if (this.data.status === CaptureStatus.G3_AFTER && !this.data.report) {
            this.data.report = this._buildReport();
        }
    }

    /**
     * 回滚预案：从遗留数据备份恢复原始 v2/v3 数据（规范化到 v4 结构，新增字段重建）
     */
    async restoreLegacyBackup() {
        const backup = await storage.get(LEGACY_BACKUP_KEY, 'settings', null);
        if (!backup) {
            this._pushLog(t('bv.noBackup'));
            this._renderLog();
            return false;
        }
        this.data = this._normalizeData({ ...backup, version: 4 });
        this.isCapturing = this.data.captureActive;
        await this._saveData();
        this._updateButtonState();
        this._render();
        this._pushLog(t('bv.restored'));
        return true;
    }

    /**
     * 保存数据到 IndexedDB（按角色分键，多标签多角色互不覆盖）
     */
    async _saveData() {
        try {
            await storage.set(this.storageKey, this.data, 'settings');
        } catch (error) {
            this._pushError(t('bv.saveFail', { msg: error?.message || error }));
        }
    }

    // ------------------------------------------------------------------
    // WebSocket 数据处理
    // ------------------------------------------------------------------

    /**
     * 处理 new_battle 消息（由 webSocketHook 分发）
     */
    async _handleNewBattle(data) {
        this.totalSeen++;
        this.lastMessageAt = Date.now();
        this.lastBattleId = data.battleId ?? null;
        this.lastCombatStartTime = data.combatStartTime ?? null;

        // 始终记录最近消息（供连续消息快照）
        this.recentMessages.push({
            battleId: data.battleId ?? null,
            wave: data.wave ?? null,
            combatStartTime: data.combatStartTime ?? null,
            actionHrid: data.actionHrid ?? null,
            capturedAtISO: new Date().toISOString(),
        });
        if (this.recentMessages.length > 20) {
            this.recentMessages.shift();
        }

        if (!this.isCapturing) {
            this._tick();
            return;
        }

        // 角色名以 dataManager（init_character_data，服务器仅返回当前角色自身）为权威来源；
        // 组队时 new_battle 的 players 数组包含全部队员且顺序不保证自己在前，不可作为依据
        const selfName =
            dataManager.getCurrentCharacterName() ||
            data.players?.[0]?.name ||
            data.players?.[0]?.characterName ||
            null;
        const snapshot = {
            battleId: data.battleId ?? 0,
            combatStartTime: data.combatStartTime,
            actionHrid: data.actionHrid || null,
            playerName: selfName,
            capturedAt: Date.now(),
            capturedAtISO: new Date().toISOString(),
        };

        if (!this.data.playerName) {
            this.data.playerName = snapshot.playerName;
        } else if (snapshot.playerName && snapshot.playerName !== this.data.playerName) {
            // 历史记录可能来自旧版 players[0] 误取队友名（组队时首条消息不一定排自己在前），
            // 以权威名对齐；各组快照内 playerName 同步修正，保证报告角色一致
            const oldName = this.data.playerName;
            this._pushLog(t('bv.nameAligned', { name: snapshot.playerName, old: oldName }));
            this.data.playerName = snapshot.playerName;
            const snaps = [
                this.data.group1.before,
                this.data.group1.after,
                this.data.group2.baseline,
                this.data.group2.deathRun,
                this.data.group2.afterWipe,
                this.data.group3.before,
                this.data.group3.after,
            ];
            for (const s of snaps) {
                if (s && s.playerName === oldName) {
                    s.playerName = snapshot.playerName;
                }
            }
        }

        this.data.messageCount++;
        await this._autoAdvance(snapshot);

        // 组1完成后自动采集离线后连续消息
        if (this.pendingPostSamples > 0) {
            this.data.consecutive.regularPost.push(...this.recentMessages.slice(-1));
            this.pendingPostSamples--;
            if (this.pendingPostSamples === 0) {
                this.data.consecutive.regularPost = this.data.consecutive.regularPost.slice(-CONSECUTIVE_N);
                this._pushLog(t('bv.postSampleDone'));
                await this._saveData();
            }
        }

        this._render();
    }

    /**
     * 状态机自动推进
     */
    async _autoAdvance(b) {
        const d = this.data;

        switch (d.status) {
            case CaptureStatus.IDLE: {
                d.group1.before = b;
                d.status = CaptureStatus.G1_BEFORE;
                // 自动快照当前普通图连续消息（离线前样本）
                d.consecutive.regularPre = this.recentMessages.slice(-CONSECUTIVE_N);
                this._pushLog(t('bv.g1Before', { id: b.battleId }));
                this._pushLog(t('bv.g1WaitHint'));
                break;
            }

            case CaptureStatus.G1_BEFORE: {
                const before = d.group1.before;
                const gap = b.capturedAt - before.capturedAt;
                const sameRun = b.combatStartTime === before.combatStartTime;

                if (gap >= OFFLINE_MS && sameRun) {
                    d.group1.after = b;
                    d.status = CaptureStatus.G1_AFTER;
                    this.pendingPostSamples = CONSECUTIVE_N;
                    this._pushLog(
                        t('bv.g1Done', {
                            dur: this._fmtDuration(gap),
                            from: before.battleId,
                            to: b.battleId,
                            delta: b.battleId - before.battleId,
                        })
                    );
                    this._pushLog(t('bv.g1NextHint'));
                } else if (gap >= OFFLINE_MS && !sameRun) {
                    d.group1.invalid = true;
                    this._pushLog(t('bv.g1Invalid'));
                }
                break;
            }

            case CaptureStatus.G1_AFTER: {
                d.group2.baseline = b;
                d.status = CaptureStatus.G2_BASELINE;
                this._pushLog(t('bv.g2Baseline', { id: b.battleId }));
                this._pushLog(t('bv.g2Hint'));
                break;
            }

            case CaptureStatus.G2_BASELINE: {
                if (b.combatStartTime !== d.group2.baseline.combatStartTime) {
                    d.group2.deathRun = b;
                    d.group2.deathRunMaxBattleId = b.battleId;
                    d.status = CaptureStatus.G2_WAITING;
                    this._pushLog(t('bv.g2Death', { id: b.battleId }));
                }
                break;
            }

            case CaptureStatus.G2_WAITING: {
                const sameRun = b.combatStartTime === d.group2.deathRun.combatStartTime;
                // 两种团灭重开形态都判定完成：
                // - cs 变化：换图/重开产生新战斗场次
                // - cs 不变但 battleId 回落：组队团灭从头开始时场次可能不变，仅波次归位
                // 单人死亡（150秒复活后继续同一局）表现为 cs 不变且 battleId 递增，不会误触发
                if (!sameRun || b.battleId < d.group2.deathRunMaxBattleId) {
                    d.group2.afterWipe = b;
                    d.status = CaptureStatus.G2_AFTER;
                    const how = t(sameRun ? 'bv.g2HowFromScratch' : 'bv.g2HowRestart');
                    this._pushLog(t('bv.g2Done', { how, max: d.group2.deathRunMaxBattleId, to: b.battleId }));
                    this._pushLog(t('bv.g2NextHint'));
                } else if (b.battleId > d.group2.deathRunMaxBattleId) {
                    d.group2.deathRunMaxBattleId = b.battleId;
                }
                break;
            }

            case CaptureStatus.G2_AFTER: {
                d.group3.before = b;
                d.status = CaptureStatus.G3_BEFORE;
                this._pushLog(t('bv.g3Baseline', { id: b.battleId }));
                this._pushLog(t('bv.g3Hint'));
                break;
            }

            case CaptureStatus.G3_BEFORE: {
                if (b.combatStartTime !== d.group3.before.combatStartTime) {
                    d.group3.after = b;
                    d.status = CaptureStatus.G3_AFTER;
                    d.captureActive = false;
                    this.isCapturing = false;
                    this._pushLog(t('bv.allDone'));
                    await this._finalize();
                }
                break;
            }
        }

        await this._saveData();
    }

    // ------------------------------------------------------------------
    // 报告生成
    // ------------------------------------------------------------------

    /**
     * 流程结束后自动生成报告并复制
     */
    async _finalize() {
        this.data.report = this._buildReport();
        this._pushLog(t('bv.reportGenerated'));
        const copied = await this._copyToClipboard(this.data.report);
        this._pushLog(copied ? t('bv.reportCopied') : t('bv.reportCopyFail'));
    }

    /**
     * 构建标准化完整报告
     */
    _buildReport() {
        const d = this.data;
        const g1 = this._analyzeGroup1();
        const g2 = this._analyzeGroup2();
        const g3 = this._analyzeGroup3();
        const lines = [];

        lines.push('## battleId Verification Report (Issue #779)');
        lines.push('');
        lines.push(`- Captured: ${new Date().toISOString()}`);
        lines.push(`- Player: ${d.playerName || 'N/A'}`);
        lines.push('- Toolasha BattleVerifier v4');
        lines.push('');

        // 组1
        lines.push('### Group 1 — Offline progress');
        if (g1) {
            lines.push(`- Before: battleId=${g1.beforeId} @ ${g1.beforeISO} (combatStartTime=${g1.beforeCS})`);
            lines.push(`- After: battleId=${g1.afterId} @ ${g1.afterISO} (combatStartTime=${g1.afterCS})`);
            lines.push(`- Offline gap: ${g1.gapHours}h`);
            lines.push(`- battleId delta: +${g1.delta} waves`);
            lines.push(`- combatStartTime unchanged across offline: ${g1.csUnchanged}`);
            lines.push(
                `- **Conclusion: battleId ${g1.delta > 0 ? 'ADVANCED' : 'did NOT advance'} during offline simulation**`
            );
        } else if (d.group1.invalid) {
            lines.push('- Invalid run: combat restarted during offline (wipe/food ran out). Needs retry.');
        } else {
            lines.push('- (incomplete)');
        }
        lines.push('');

        // 组2
        lines.push('### Group 2 — Wipe behavior');
        if (g2) {
            lines.push(`- Death map max battleId reached: ${g2.maxBattleId} (combatStartTime=${g2.deathCS})`);
            lines.push(`- After restart: battleId=${g2.restartId} (combatStartTime=${g2.restartCS})`);
            lines.push(`- battleId reset after wipe: ${g2.reset}`);
            lines.push(`- Wipe waves carried over: ${g2.carried}`);
            lines.push(
                `- **Conclusion: ${g2.carried ? 'wipe waves appear COUNTED in battleId' : 'battleId appears RESET after wipe'}**`
            );
        } else {
            lines.push('- (incomplete)');
        }
        lines.push('');

        // 组3
        lines.push('### Group 3 — Manual restart');
        if (g3) {
            lines.push(`- Before: battleId=${g3.beforeId} (combatStartTime=${g3.beforeCS})`);
            lines.push(`- After: battleId=${g3.afterId} (combatStartTime=${g3.afterCS})`);
            lines.push(`- New combat session: ${g3.newSession}`);
            lines.push(`- battleId reset: ${g3.reset}`);
            lines.push(`- **Conclusion: battleId ${g3.reset ? 'RESETS' : 'does NOT reset'} on manual stop/restart**`);
        } else {
            lines.push('- (incomplete)');
        }
        lines.push('');

        // combatStartTime 语义
        lines.push('### combatStartTime semantics (consecutive messages)');
        const sample = (label, arr) => {
            lines.push(`${label} (${arr.length} messages):`);
            lines.push('```json');
            lines.push(
                JSON.stringify(
                    arr.map((m, i) => ({
                        battleId: m.battleId,
                        wave: m.wave,
                        combatStartTime: m.combatStartTime,
                        actionHrid: m.actionHrid,
                        csSameAsPrev: i > 0 ? m.combatStartTime === arr[i - 1].combatStartTime : null,
                        battleIdDelta:
                            i > 0 && typeof m.battleId === 'number' && typeof arr[i - 1].battleId === 'number'
                                ? m.battleId - arr[i - 1].battleId
                                : null,
                    })),
                    null,
                    0
                )
            );
            lines.push('```');
        };
        if (d.consecutive.regularPre.length > 0) {
            sample('Regular zone (pre-offline)', d.consecutive.regularPre);
        }
        if (d.consecutive.regularPost.length > 0) {
            sample('Regular zone (post-offline)', d.consecutive.regularPost);
        }
        // 只采信可证实来自地下城的消息（过滤旧版误点保存的普通图脏数据）
        const dungeonSamples = d.consecutive.dungeon.filter((m) => this._isDungeonAction(m.actionHrid));
        if (dungeonSamples.length > 0) {
            sample('Dungeon', dungeonSamples);
        }
        if (
            d.consecutive.regularPre.length === 0 &&
            d.consecutive.regularPost.length === 0 &&
            dungeonSamples.length === 0
        ) {
            lines.push('- (no consecutive samples captured)');
        }
        lines.push('');

        // 汇总结论
        lines.push('### Summary');
        lines.push(
            `1. Offline: ${g1 ? `battleId ${g1.delta > 0 ? 'advances' : 'does not advance'} during offline (${g1.gapHours}h, +${g1.delta} waves)` : 'pending/incomplete'}`
        );
        lines.push(
            `2. Wipe: ${g2 ? (g2.carried ? 'wipe waves counted in battleId' : 'battleId resets after wipe') : 'pending/incomplete'}`
        );
        lines.push(
            `3. Manual restart: ${g3 ? (g3.reset ? 'battleId resets' : 'battleId continues') : 'pending/incomplete'}`
        );

        if (d.errors.length > 0) {
            lines.push('', '### Errors during capture');
            d.errors.forEach((e) => lines.push(`- ${e}`));
        }

        return lines.join('\n');
    }

    /**
     * 手动复制报告（面板按钮）
     */
    async copyReport() {
        if (!this.data.report) {
            this.data.report = this._buildReport();
        }
        const copied = await this._copyToClipboard(this.data.report);
        this._pushLog(copied ? t('bv.copyOk') : t('bv.copyFail'));
        this._renderLog();
    }

    /**
     * 导出当前角色全部采集数据（JSON 文件下载 + 复制剪贴板），用于单独提取与持久化保存
     */
    async exportData() {
        const charName = dataManager.getCurrentCharacterName() || this.data.playerName || 'unknown';
        const payload = {
            exportedAt: new Date().toISOString(),
            characterId: this.characterId,
            characterName: charName,
            storageKey: this.storageKey,
            data: this.data,
        };
        const json = JSON.stringify(payload, null, 2);
        const fileName = `battle-verifier-${charName}-${new Date().toISOString().slice(0, 10)}.json`;
        try {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            this._pushLog(t('bv.exportedFile', { file: fileName }));
        } catch (error) {
            this._pushError(t('bv.exportFail', { msg: error?.message || error }));
        }
        const copied = await this._copyToClipboard(json);
        this._pushLog(copied ? t('bv.exportedClipboard') : t('bv.exportClipboardFail'));
        this._renderLog();
    }

    /**
     * 判断 actionHrid 是否为地下城战斗（依据游戏数据 combatZoneInfo.isDungeon）
     */
    _isDungeonAction(actionHrid) {
        if (!actionHrid || typeof actionHrid !== 'string') {
            return false;
        }
        const details = dataManager.getActionDetails(actionHrid);
        return details?.combatZoneInfo?.isDungeon === true;
    }

    /**
     * 一键捕获地下城连续消息快照（在地下城战斗中点击）
     */
    async captureDungeonSample() {
        if (this.recentMessages.length < 2) {
            this._pushLog(t('bv.dungeonNoMsg'));
            this._renderLog();
            return;
        }
        // 校验消息确实来自地下城战斗，防止在普通地图误点导致样本污染
        const dungeonMsgs = this.recentMessages.filter((m) => this._isDungeonAction(m.actionHrid));
        if (dungeonMsgs.length === 0) {
            this._pushLog(t('bv.dungeonReject'));
            this._renderLog();
            return;
        }
        this.data.consecutive.dungeon = dungeonMsgs.slice(-CONSECUTIVE_N);
        await this._saveData();
        this._pushLog(t('bv.dungeonSaved', { n: this.data.consecutive.dungeon.length }));
        this._renderLog();
    }

    /**
     * 组1 分析
     */
    _analyzeGroup1() {
        const { before, after } = this.data.group1;
        if (!before || !after) {
            return null;
        }
        return {
            beforeId: before.battleId,
            afterId: after.battleId,
            delta: after.battleId - before.battleId,
            gapHours: ((after.capturedAt - before.capturedAt) / 3600000).toFixed(2),
            beforeISO: before.capturedAtISO,
            afterISO: after.capturedAtISO,
            beforeCS: before.combatStartTime,
            afterCS: after.combatStartTime,
            csUnchanged: before.combatStartTime === after.combatStartTime,
        };
    }

    /**
     * 组2 分析
     */
    _analyzeGroup2() {
        const g = this.data.group2;
        if (!g.deathRun || !g.afterWipe) {
            return null;
        }
        return {
            maxBattleId: g.deathRunMaxBattleId,
            deathCS: g.deathRun.combatStartTime,
            restartId: g.afterWipe.battleId,
            restartCS: g.afterWipe.combatStartTime,
            reset: g.afterWipe.battleId <= g.deathRunMaxBattleId,
            carried: g.afterWipe.battleId > g.deathRunMaxBattleId,
        };
    }

    /**
     * 组3 分析
     */
    _analyzeGroup3() {
        const { before, after } = this.data.group3;
        if (!before || !after) {
            return null;
        }
        return {
            beforeId: before.battleId,
            afterId: after.battleId,
            beforeCS: before.combatStartTime,
            afterCS: after.combatStartTime,
            reset: after.battleId < before.battleId,
            newSession: after.combatStartTime !== before.combatStartTime,
        };
    }

    // ------------------------------------------------------------------
    // 采集控制
    // ------------------------------------------------------------------

    /**
     * 开始采集
     */
    async startCapture() {
        if (this.isCapturing) {
            return;
        }
        this.isCapturing = true;
        this.data.captureActive = true;
        if (this.data.status === CaptureStatus.IDLE) {
            this.data.startTime = new Date().toISOString();
            this._pushLog(t('bv.captureStarted'));
            this._pushLog(t('bv.captureStartHint'));
        } else {
            this._pushLog(t('bv.captureContinued'));
        }
        await this._saveData();
        this._updateButtonState();
        this._render();
    }

    /**
     * 暂停采集（进度保留）
     */
    async pauseCapture() {
        this.isCapturing = false;
        this.data.captureActive = false;
        await this._saveData();
        this._updateButtonState();
        this._pushLog(t('bv.capturePaused'));
        this._render();
    }

    /**
     * 重置全部数据
     */
    async reset() {
        this.data = this._createEmptyData();
        this.isCapturing = false;
        this.pendingPostSamples = 0;
        await this._saveData();
        this._updateButtonState();
        this._pushLog(t('bv.resetDone'));
        this._render();
    }

    /**
     * 状态机自检（模拟全流程，不触碰真实数据；返回断言结果）
     */
    async selfTest() {
        const savedData = JSON.parse(JSON.stringify(this.data));
        const savedLast = this.lastBattleId;
        const savedCount = this.data.messageCount;
        const results = [];
        const assert = (name, cond) => results.push({ name, pass: !!cond });

        const T0 = Date.now();
        const inject = async (battleId, combatStartTime, capturedAt) => {
            await this._autoAdvance({
                battleId,
                combatStartTime,
                capturedAt,
                capturedAtISO: new Date(capturedAt).toISOString(),
                actionHrid: '/actions/test',
                playerName: 'Test',
                totalLootMap: null,
            });
        };
        // 屏蔽自动快照对真实缓冲的依赖
        this.recentMessages = [];

        this.data = this._createEmptyData();
        const CS = T0 - 3600_000;
        await inject(100, CS, T0);
        assert(t('bv.st.g1Capture'), this.data.status === CaptureStatus.G1_BEFORE);
        await inject(101, CS, T0 + 5_000);
        assert(t('bv.st.g1Online5s'), this.data.status === CaptureStatus.G1_BEFORE);
        await inject(150, CS + 1, T0 + 31 * 60_000);
        assert(
            t('bv.st.g1InvalidOnRestart'),
            this.data.group1.invalid === true && this.data.status === CaptureStatus.G1_BEFORE
        );

        this.data = this._createEmptyData();
        await inject(100, CS, T0);
        await inject(700, CS, T0 + 40 * 60_000);
        assert(t('bv.st.g1Offline40m'), this.data.status === CaptureStatus.G1_AFTER);

        await inject(701, CS, T0 + 40 * 60_000 + 4_000);
        assert(t('bv.st.g2Baseline'), this.data.status === CaptureStatus.G2_BASELINE);
        const CS_DEATH = T0 + 41 * 60_000;
        await inject(1, CS_DEATH, T0 + 41 * 60_000 + 3_000);
        assert(t('bv.st.g2DeathMap'), this.data.status === CaptureStatus.G2_WAITING);
        await inject(9, CS_DEATH, T0 + 42 * 60_000);
        assert(
            t('bv.st.g2MaxWave'),
            this.data.status === CaptureStatus.G2_WAITING && this.data.group2.deathRunMaxBattleId === 9
        );
        await inject(1, T0 + 43 * 60_000, T0 + 43 * 60_000 + 2_000);
        assert(t('bv.st.g2WipeDone'), this.data.status === CaptureStatus.G2_AFTER);

        await inject(50, T0 + 43 * 60_000, T0 + 44 * 60_000);
        assert(t('bv.st.g3Before'), this.data.status === CaptureStatus.G3_BEFORE);
        await inject(51, T0 + 43 * 60_000, T0 + 44 * 60_000 + 3_000);
        assert(t('bv.st.g3NoAdvance'), this.data.status === CaptureStatus.G3_BEFORE);
        await inject(1, T0 + 45 * 60_000, T0 + 45 * 60_000 + 1_000);
        assert(
            t('bv.st.g3Done'),
            this.data.status === CaptureStatus.G3_AFTER &&
                typeof this.data.report === 'string' &&
                this.data.report.includes('Summary')
        );

        // 恢复现场
        this.data = savedData;
        this.lastBattleId = savedLast;
        this.data.messageCount = savedCount;
        await this._saveData();
        this._render();

        const passed = results.filter((r) => r.pass).length;
        this._pushLog(t('bv.selfTestDone', { passed, total: results.length }));
        results.filter((r) => !r.pass).forEach((r) => this._pushLog(t('bv.selfTestFail', { name: r.name })));
        this._renderLog();
        return results;
    }

    // ------------------------------------------------------------------
    // UI: 浮动按钮
    // ------------------------------------------------------------------

    /**
     * 创建浮动按钮
     */
    _createButton() {
        if (document.getElementById(BUTTON_ID)) {
            this.button = document.getElementById(BUTTON_ID);
            return;
        }
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.textContent = '⚔️';
        btn.title = t('bv.btnTitle');
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '2px solid #00ffe7',
            background: 'rgba(5,5,15,0.92)',
            color: '#00ffe7',
            fontSize: '22px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,255,231,0.3)',
            zIndex: '9000',
        });
        btn.addEventListener('click', () => this._togglePanel());
        document.body.appendChild(btn);
        this.button = btn;
        this._updateButtonState();
    }

    /**
     * 更新按钮外观（采集状态高亮）
     */
    _updateButtonState() {
        if (!this.button) {
            return;
        }
        const accent = this.isCapturing ? '#ff5577' : '#00ffe7';
        this.button.style.borderColor = accent;
        this.button.style.boxShadow = `0 4px 12px ${accent}55`;
    }

    /**
     * 移除按钮
     */
    _removeButton() {
        if (this.button?.parentNode) {
            this.button.parentNode.removeChild(this.button);
            this.button = null;
        }
    }

    // ------------------------------------------------------------------
    // UI: 控制面板
    // ------------------------------------------------------------------

    /**
     * 显示/隐藏面板
     */
    _togglePanel() {
        if (this.panel?.parentNode) {
            this._removePanel();
        } else {
            this._showPanel();
        }
    }

    /**
     * 创建面板
     */
    _showPanel() {
        if (this.panel?.parentNode) {
            bringPanelToFront(this.panel);
            return;
        }

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        Object.assign(panel.style, {
            position: 'fixed',
            bottom: '80px',
            right: '20px',
            zIndex: '9000',
            width: '360px',
            background: 'rgba(5,5,15,0.96)',
            border: '1px solid rgba(0,255,234,0.4)',
            borderRadius: '10px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(12px)',
            color: '#e0f7ff',
            fontSize: '13px',
            fontFamily: 'system-ui,-apple-system,sans-serif',
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            background: 'rgba(15,5,35,0.7)',
            borderBottom: '1px solid rgba(0,255,234,0.2)',
            cursor: 'move',
            borderRadius: '10px 10px 0 0',
        });
        const title = document.createElement('span');
        title.textContent = t('bv.fabLabel');
        title.style.cssText = 'font-weight:bold;color:#00ffe7;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:none;border:none;color:#e0f7ff;cursor:pointer;font-size:14px;';
        closeBtn.addEventListener('click', () => this._removePanel());
        header.append(title, closeBtn);

        this.contentEl = document.createElement('div');
        this.contentEl.style.padding = '12px';

        panel.append(header, this.contentEl);
        document.body.appendChild(panel);
        this.panel = panel;
        registerFloatingPanel(panel);
        bringPanelToFront(panel);
        this._makeDraggable(header);
        this._render();
    }

    /**
     * 移除面板
     */
    _removePanel() {
        if (this.panel?.parentNode) {
            unregisterFloatingPanel(this.panel);
            this.panel.parentNode.removeChild(this.panel);
            this.panel = null;
            this.contentEl = null;
        }
    }

    /**
     * 面板拖拽
     */
    _makeDraggable(handle) {
        let dragging = false;
        let ox = 0;
        let oy = 0;
        handle.addEventListener('mousedown', (e) => {
            dragging = true;
            ox = e.clientX - this.panel.offsetLeft;
            oy = e.clientY - this.panel.offsetTop;
        });
        const move = (e) => {
            if (!dragging) {
                return;
            }
            this.panel.style.left = `${e.clientX - ox}px`;
            this.panel.style.top = `${e.clientY - oy}px`;
            this.panel.style.bottom = 'auto';
            this.panel.style.right = 'auto';
        };
        const up = () => {
            dragging = false;
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    /**
     * 面板全量渲染
     */
    _render() {
        if (!this.contentEl) {
            return;
        }
        const d = this.data;
        const stepInfo = this._stepInfo();
        const done = d.status === CaptureStatus.G3_AFTER;

        const html = [];
        html.push(`<div style="font-weight:bold;color:#00ffe7;margin-bottom:8px;">${stepInfo.title}</div>`);
        html.push(
            `<div style="background:rgba(0,255,231,0.06);border-left:3px solid #00ffe7;padding:8px 10px;border-radius:4px;line-height:1.5;margin-bottom:10px;">${stepInfo.instruction}</div>`
        );

        // 进度清单
        const item = (ok, label) =>
            `<div style="margin:3px 0;color:${ok ? '#00ff99' : 'rgba(224,247,255,0.55)'};">${ok ? '✅' : '○'} ${label}</div>`;
        html.push('<div style="margin-bottom:10px;">');
        html.push(
            item(
                !!(d.group1.before && d.group1.after && !d.group1.invalid),
                t('bv.itemG1') + (d.group1.invalid ? t('bv.itemG1InvalidSuffix') : '')
            )
        );
        html.push(item(!!(d.group2.deathRun && d.group2.afterWipe), t('bv.itemG2')));
        html.push(item(!!(d.group3.before && d.group3.after), t('bv.itemG3')));
        html.push(
            item(
                d.consecutive.dungeon.filter((m) => this._isDungeonAction(m.actionHrid)).length >= 2,
                t('bv.itemDungeon')
            )
        );
        html.push('</div>');

        // 实时状态
        html.push(
            '<div style="font-size:12px;color:rgba(224,247,255,0.75);border-top:1px solid rgba(0,255,234,0.15);padding-top:8px;">'
        );
        html.push('<div id="bv-ws">WebSocket: …</div>');
        html.push(`<div id="bv-battle">${t('bv.battleNow')}</div>`);
        html.push('<div id="bv-countdown"></div>');
        html.push('</div>');

        // 报告区（完成后显示）
        if (done && d.report) {
            html.push(
                `<div style="margin-top:10px;"><div style="font-weight:bold;color:#00ff99;margin-bottom:4px;">${t('bv.reportAreaTitle')}</div>`
            );
            html.push(
                `<pre id="bv-report" style="max-height:180px;overflow:auto;background:rgba(0,0,0,0.4);border:1px solid rgba(0,255,234,0.2);border-radius:5px;padding:8px;font-size:11px;white-space:pre-wrap;word-break:break-all;">${d.report.replace(/</g, '&lt;')}</pre></div>`
            );
        }

        // 事件日志
        html.push(
            '<div id="bv-log" style="margin-top:10px;max-height:120px;overflow-y:auto;font-size:11px;line-height:1.6;color:rgba(224,247,255,0.8);border-top:1px solid rgba(0,255,234,0.15);padding-top:6px;"></div>'
        );

        // 按钮区
        html.push('<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">');
        const bs =
            'flex:1;padding:7px;border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:12px;white-space:nowrap;';
        if (!this.isCapturing && !done) {
            html.push(
                `<button id="bv-start" style="${bs}background:#00ffe7;color:#000;">${d.status === CaptureStatus.IDLE ? t('bv.btnStart') : t('bv.btnContinue')}</button>`
            );
        } else if (!done) {
            html.push(`<button id="bv-pause" style="${bs}background:#ffaa00;color:#000;">${t('bv.btnPause')}</button>`);
        }
        if (!done && this.isCapturing) {
            html.push(
                `<button id="bv-dungeon" style="${bs}background:rgba(170,0,255,0.85);color:#fff;" title="${t('bv.btnDungeonTitle')}">${t('bv.btnDungeon')}</button>`
            );
        }
        if (done) {
            html.push(`<button id="bv-copy" style="${bs}background:#00ff99;color:#000;">${t('bv.btnCopy')}</button>`);
        }
        html.push(
            `<button id="bv-export" style="${bs}background:rgba(0,110,255,0.85);color:#fff;" title="${t('bv.btnExportTitle')}">${t('bv.btnExport')}</button>`
        );
        html.push(
            `<button id="bv-reset" style="${bs}background:rgba(255,0,85,0.85);color:#fff;">${t('bv.btnReset')}</button>`
        );
        html.push('</div>');

        this.contentEl.innerHTML = html.join('');

        const bind = (id, fn) => {
            const el = this.contentEl.querySelector(id);
            if (el) {
                el.addEventListener('click', fn);
            }
        };
        bind('#bv-start', () => this.startCapture());
        bind('#bv-pause', () => this.pauseCapture());
        bind('#bv-dungeon', () => this.captureDungeonSample());
        bind('#bv-copy', () => this.copyReport());
        bind('#bv-export', () => this.exportData());
        bind('#bv-reset', () => this.reset());

        this._renderLog();
        this._tick();
    }

    /**
     * 渲染事件日志区
     */
    _renderLog() {
        const logEl = this.contentEl?.querySelector('#bv-log');
        if (!logEl) {
            return;
        }
        logEl.innerHTML = this.eventLog
            .map((e) => `<div><span style="color:rgba(0,255,231,0.5);">${e.time}</span> ${e.text}</div>`)
            .reverse()
            .join('');
    }

    /**
     * 每秒更新动态字段
     */
    _tick() {
        if (!this.contentEl) {
            return;
        }
        const wsEl = this.contentEl.querySelector('#bv-ws');
        const battleEl = this.contentEl.querySelector('#bv-battle');
        const cdEl = this.contentEl.querySelector('#bv-countdown');
        if (!wsEl || !battleEl) {
            return;
        }

        if (this.lastMessageAt > 0) {
            const age = Math.round((Date.now() - this.lastMessageAt) / 1000);
            wsEl.innerHTML = t('bv.wsOk', { n: this.totalSeen, age });
        } else {
            wsEl.innerHTML = t('bv.wsWaiting');
        }

        if (this.lastCombatStartTime) {
            const dur = Date.now() - this._csMs(this.lastCombatStartTime);
            battleEl.textContent = t('bv.battleInfo', { id: this.lastBattleId ?? '-', dur: this._fmtDuration(dur) });
        } else {
            battleEl.textContent = t('bv.battleNone');
        }

        // 组1 等待倒计时
        if (cdEl) {
            if (this.data?.status === CaptureStatus.G1_BEFORE && this.data.group1.before) {
                const elapsed = Date.now() - this.data.group1.before.capturedAt;
                const remain = Math.max(0, OFFLINE_MS - elapsed);
                cdEl.innerHTML =
                    remain > 0 ? t('bv.g1CountdownWait', { dur: this._fmtDuration(remain) }) : t('bv.g1CountdownReady');
            } else {
                cdEl.textContent = '';
            }
        }
    }

    /**
     * 当前状态的步骤标题与操作指引
     */
    _stepInfo() {
        const d = this.data;
        const map = {
            [CaptureStatus.IDLE]: {
                title: t('bv.step.idle.title'),
                instruction: d.captureActive ? t('bv.step.idle.waiting') : t('bv.step.idle.hint'),
            },
            [CaptureStatus.G1_BEFORE]: {
                title: t('bv.step.g1before.title'),
                instruction: d.group1.invalid
                    ? t('bv.step.g1before.invalid')
                    : t('bv.step.g1before.wait', { id: d.group1.before?.battleId ?? '-' }),
            },
            [CaptureStatus.G1_AFTER]: {
                title: t('bv.step.g1after.title'),
                instruction: t('bv.step.g1after.instruction'),
            },
            [CaptureStatus.G2_BASELINE]: {
                title: t('bv.step.g2base.title'),
                instruction: t('bv.step.g2base.instruction', { id: d.group2.baseline?.battleId ?? '-' }),
            },
            [CaptureStatus.G2_WAITING]: {
                title: t('bv.step.g2wait.title'),
                instruction: t('bv.step.g2wait.instruction', { id: d.group2.deathRunMaxBattleId }),
            },
            [CaptureStatus.G2_AFTER]: {
                title: t('bv.step.g2after.title'),
                instruction: t('bv.step.g2after.instruction'),
            },
            [CaptureStatus.G3_BEFORE]: {
                title: t('bv.step.g3before.title'),
                instruction: t('bv.step.g3before.instruction', { id: d.group3.before?.battleId ?? '-' }),
            },
            [CaptureStatus.G3_AFTER]: {
                title: t('bv.step.done.title'),
                instruction: t('bv.step.done.instruction'),
            },
        };
        return map[d.status] || map[CaptureStatus.IDLE];
    }

    // ------------------------------------------------------------------
    // 事件日志与错误
    // ------------------------------------------------------------------

    /**
     * 记录面板事件日志
     */
    _pushLog(text) {
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        this.eventLog.push({ time, text });
        if (this.eventLog.length > EVENT_LOG_MAX) {
            this.eventLog.shift();
        }
        this._renderLog();
    }

    /**
     * 记录错误（进入面板日志 + 持久化 + 报告附录）
     */
    _pushError(text) {
        this._pushLog(`❌ ${text}`);
        if (this.data) {
            this.data.errors.push(`${new Date().toISOString()} ${text}`);
            if (this.data.errors.length > 10) {
                this.data.errors.shift();
            }
        }
    }

    // ------------------------------------------------------------------
    // 工具函数
    // ------------------------------------------------------------------

    /**
     * combatStartTime 转毫秒时间戳
     */
    _csMs(cs) {
        if (typeof cs === 'number') {
            return cs;
        }
        const parsed = Date.parse(cs);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    /**
     * 毫秒时长格式化
     */
    _fmtDuration(ms) {
        if (!ms || ms < 0) {
            return t('bv.duration.zero');
        }
        const min = Math.floor(ms / 60000);
        const h = Math.floor(min / 60);
        if (h > 0) {
            return t('bv.duration.h', { h, min: min % 60 });
        }
        return t('bv.duration.m', { min });
    }

    /**
     * 复制文本到剪贴板（带回退），返回是否成功
     */
    async _copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                return true;
            } catch {
                return false;
            }
        }
    }
}

const battleVerifier = new BattleVerifier();
export default battleVerifier;
