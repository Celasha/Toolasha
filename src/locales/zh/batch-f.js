/**
 * zh batch f — bv (Battle Verifier) namespace.
 * Dev tool (?toolasha_dev=1) for Issue #779 battleId data capture.
 */
export default {
    bv: {
        fabLabel: '⚔️ Battle Verifier',
        btnTitle: 'Battle Verifier（Issue #779 数据采集）',
        loaded: 'BattleVerifier v4.2 已加载（数据归属: {{name}}）',
        resumed: '检测到未完成的采集任务，已自动恢复',
        unknownCharacter: '未知角色',
        unknownVersion: '未知',

        // 迁移/兼容日志
        highVersionBackupFail: '高版本数据备份失败: {{msg}}',
        highVersionIsolated: '数据版本 v{{v}} 高于当前 v4，已隔离为全新数据（原始数据保留在备份键）',
        legacyBackupFail: '遗留数据备份失败: {{msg}}',
        legacyMigrated: '检测到 v{{v}} 遗留数据，已迁移到 v4（原始数据已备份，可用「恢复遗留备份」回滚）',
        migratedAway: '旧共享数据已归属其他角色（{{name}}），本角色使用全新数据',
        sharedOwnedByOther: '旧共享数据归属 {{latest}}，本角色（{{current}}）使用全新数据',
        claimed: '已认领旧共享数据并迁移到本角色（{{owner}}）；组队时误存的队友名已统一修正为 {{owner}}',
        migrateFail: '迁移旧共享数据失败: {{msg}}（原始数据仍在旧键中）',
        unknownStatus: '未知采集状态 "{{status}}"，已重置为未开始',
        degraded: '遗留状态 "{{status}}" 缺少必需快照，已降级为未开始',
        noBackup: '⚠️ 无遗留数据备份可恢复',
        restored: '已从遗留数据备份恢复（进度按备份时的状态还原）',
        saveFail: '数据保存失败: {{msg}}',
        nameAligned: 'ℹ️ 角色记录已对齐为当前角色 {{name}}（原记录 {{old}}）',
        postSampleDone: '离线后连续消息快照完成',

        // 状态机日志
        g1Before: '✅ 组1离线前快照已捕获 (battleId={{id}})',
        g1WaitHint: '👉 请直接关闭整个浏览器，等待至少 30 分钟后重开',
        g1Done: '✅ 组1离线测试完成！离线 {{dur}}，battleId {{from}} → {{to}} (+{{delta}})',
        g1NextHint: '👉 下一步（组2）：继续挂机，然后换到你打不过的地图',
        g1Invalid: '⚠️ 组1失效：离线期间战斗已重开。请点击「重置全部」换不会团灭的地图重试',
        g2Baseline: '✅ 组2基准已捕获 (battleId={{id}})',
        g2Hint: '👉 请前往你确定打不过的地图开始战斗，让角色自然团灭',
        g2Death: '☠️ 已进入死亡地图 (battleId={{id}})，等待团灭…',
        g2HowFromScratch: '战斗从头开始（场次未变，battleId 回落）',
        g2HowRestart: '战斗重开',
        g2Done: '✅ 组2团灭测试完成（{{how}}）！死亡图最高 battleId={{max}}，重开后={{to}}',
        g2NextHint: '👉 下一步（组3）：继续挂机，之后手动「停止」再「开始」同一张图',
        g3Baseline: '✅ 组3基准已捕获 (battleId={{id}})',
        g3Hint: '👉 请点击游戏「停止」，再立即点「开始」同一张图',
        allDone: '🎉 三组数据全部采集完成！',
        reportGenerated: '标准报告已自动生成',
        reportCopied: '✅ 报告已自动复制到剪贴板',
        reportCopyFail: '⚠️ 自动复制失败，请点击面板「复制报告」按钮',
        copyOk: '✅ 报告已复制到剪贴板',
        copyFail: '❌ 复制失败',
        exportedFile: '✅ 数据已导出为文件 {{file}}',
        exportFail: '导出文件失败: {{msg}}',
        exportedClipboard: '✅ 数据 JSON 已同时复制到剪贴板',
        exportClipboardFail: '⚠️ 复制剪贴板失败（文件下载不受影响）',
        dungeonNoMsg: '⚠️ 暂无足够消息，请先在地下城中战斗几波',
        dungeonReject: '⚠️ 当前消息均非地下城战斗（可能正在普通地图），样本未保存',
        dungeonSaved: '✅ 地下城连续消息快照已保存（{{n}} 条）',
        captureStarted: '采集已启动，等待第一条战斗消息…',
        captureStartHint: '👉 请确认已开始挂机战斗（屏幕上有伤害数字）',
        captureContinued: '采集已继续',
        capturePaused: '采集已暂停（进度保留）',
        resetDone: '数据已重置',
        selfTestDone: '自检完成: {{passed}}/{{total}} 通过',
        selfTestFail: '❌ 自检失败: {{name}}',

        // 自检断言名
        st: {
            g1Capture: '组1-离线前捕获',
            g1Online5s: '组1-在线5秒不误推进',
            g1InvalidOnRestart: '组1-离线但战斗重开→标记失效',
            g1Offline40m: '组1-同场战斗离线40分钟→完成',
            g2Baseline: '组2-基准捕获',
            g2DeathMap: '组2-进入死亡地图→等待团灭',
            g2MaxWave: '组2-死亡地图记录最高波次',
            g2WipeDone: '组2-团灭后新战斗→完成',
            g3Before: '组3-重开前捕获',
            g3NoAdvance: '组3-同场战斗不误推进',
            g3Done: '组3-重开后→全部完成并自动生成报告',
        },

        // 面板渲染
        itemG1: '组1 离线测试',
        itemG1InvalidSuffix: '（已失效，需重置）',
        itemG2: '组2 团灭测试',
        itemG3: '组3 重开测试',
        itemDungeon: '地下城样本（可选）',
        battleNow: '当前战斗: …',
        reportAreaTitle: '📋 自动生成报告',
        btnStart: '▶ 开始采集',
        btnContinue: '▶ 继续采集',
        btnPause: '⏸ 暂停',
        btnDungeon: '☠ 地下城样本',
        btnDungeonTitle: '在地下城战斗几波后点击',
        btnCopy: '📋 复制报告',
        btnExport: '⬇ 导出',
        btnExportTitle: '导出当前角色全部采集数据（JSON 文件下载 + 复制剪贴板）',
        btnReset: '重置',
        wsOk: 'WebSocket: <span style="color:#00ff99;">● 正常</span>（本次会话 {{n}} 条 · {{age}}s 前）',
        wsWaiting: 'WebSocket: <span style="color:#ffaa00;">○ 等待战斗消息…</span>',
        battleInfo: '当前战斗: battleId={{id}} · 已进行 {{dur}}',
        battleNone: '当前战斗: 未检测到（是否已开始挂机？）',
        g1CountdownWait: '组1等待中: <span style="color:#ffaa00;">还需 {{dur}}</span>（保持关闭浏览器即可）',
        g1CountdownReady: '组1等待中: <span style="color:#00ff99;">已满 30 分钟，重开游戏即自动完成</span>',

        // 步骤指引
        step: {
            idle: {
                title: '准备开始（共 3 组测试）',
                waiting: '正在等待第一条战斗消息… 请确认<strong>已开始挂机战斗</strong>（屏幕上有伤害数字）。',
                hint: '<strong>操作顺序：</strong>① 先开始挂机战斗（任意地图）② 点击「▶ 开始采集」③ 按指引依次操作即可，报告自动生成',
            },
            g1before: {
                title: '步骤 1/3 · 离线测试',
                invalid: '⚠️ 离线期间战斗已重开，本组失效。点击「重置」后换不会团灭的地图重试。',
                wait: '✅ 离线前已捕获（battleId={{id}}）。<br><strong>现在：直接关闭整个浏览器</strong>，等待至少 30 分钟。<br>重开后<strong>无需任何操作</strong>，自动继续。',
            },
            g1after: {
                title: '步骤 2/3 · 团灭测试（离线后快照采集中）',
                instruction:
                    '正在自动采集离线后连续消息…<br><strong>继续挂机即可</strong>，几秒后自动设为组2基准。<br>然后：换到你确定打不过的地图。',
            },
            g2base: {
                title: '步骤 2/3 · 团灭测试（基准已捕获）',
                instruction:
                    '基准 battleId={{id}}。<br><strong>前往你确定打不过的地图并开始战斗</strong>，不要手动停止，让角色自然团灭。',
            },
            g2wait: {
                title: '步骤 2/3 · 团灭测试（死亡地图战斗中）',
                instruction:
                    '☠️ 死亡地图最高已到 battleId={{id}}。<br><strong>等待团灭…</strong>团灭后重开自动完成本组。',
            },
            g2after: {
                title: '步骤 3/3 · 重开测试（基准已就绪）',
                instruction:
                    '下一条战斗消息自动设为组3基准。<br><strong>然后：手动点「停止」，再立即点「开始」同一张图。</strong>',
            },
            g3before: {
                title: '步骤 3/3 · 重开测试（基准已捕获）',
                instruction:
                    '基准 battleId={{id}}。<br><strong>现在：点「停止」，再立即点「开始」同一张图。</strong><br>完成后报告自动生成。',
            },
            done: {
                title: '🎉 全部完成 · 报告已生成',
                instruction:
                    '标准化报告已自动生成并尝试复制到剪贴板。<br>点击「📋 复制报告」可再次复制，直接粘贴到 Issue #779。',
            },
        },

        // 时长格式
        duration: {
            zero: '0分',
            h: '{{h}}时{{min}}分',
            m: '{{min}}分',
        },
    },
};
