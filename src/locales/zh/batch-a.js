/**
 * zh batch a — settings namespaces.
 * Split from the former single zh.js; values here are Simplified Chinese UI strings.
 */
export default {
    settingsSchema: {
        groups: {
            ironCow: { title: '铁牛模式' },
            general: { title: '通用设置' },
            actionBar: { title: '动作栏' },
            skillPageTiles: { title: '专业页面与图块' },
            actionPanel: { title: '动作面板' },
            actionQueue: { title: '动作队列' },
            alchemy: { title: '炼金' },
            missingMaterials: { title: '缺失材料与制作方案' },
            lootLog: { title: '战利品记录' },
            tooltips: { title: '物品提示框增强' },
            enhancementSimulator: { title: '强化模拟器设置' },
            enhancementTracker: { title: '强化追踪器' },
            riskOfRuin: { title: '破产风险' },
            marketplace: { title: '市场' },
            pricingProfit: { title: '定价与利润' },
            inventoryNetWorth: { title: '物品栏与净资产' },
            inventoryTabs: { title: '自定义物品栏标签' },
            skills: { title: '专业' },
            combat: { title: '战斗功能' },
            tasks: { title: '任务' },
            ui: { title: '界面与外观' },
            guild: { title: '公会' },
            house: { title: '房屋' },
            leaderboard: { title: '排行榜' },
            notifications: { title: '通知' },
            colors: { title: '颜色自定义' },
            collectionFilters: { title: '收藏筛选' },
        },
        // 强化装备档位下拉的共享标签（值来自 settings-schema 的 tiers）
        tierLabels: {
            cheese: '奶酪',
            verdant: '翠绿',
            azure: '蔚蓝',
            burble: '深紫',
            crimson: '绛红',
            rainbow: '彩虹',
            holy: '神圣',
            celestial: '天堂',
            philo: '哲学',
            speed: '速度',
            rarefind: '稀有发现',
            normal: '普通',
            refined: '精制',
            trainee: '见习',
            basic: '基础',
            advanced: '高级',
            expert: '专家',
            master: '大师',
            grandmaster: '宗师',
        },
        // 下拉选项中不可用项的后缀
        selectUnavailableSuffix: '（不可用）',
        settings: {
            ironCow_enabled: { label: '铁牛模式', help: '禁用所有市场与利润相关功能，用于无市场玩法。' },
            chatCommands: {
                label: '启用聊天命令（/item、/wiki、/market）',
                help: '在聊天框输入 /item、/wiki 或 /market 并加上物品名称。例如：/item radiant fiber',
            },
            chat_mentionTracker: {
                label: '聊天中被提及时显示徽标',
                help: '当有人在聊天中 @提及你时，在聊天标签上显示红色徽标',
            },
            chat_popOut: {
                label: '启用聊天窗口弹出按钮',
                help: '在聊天面板添加按钮，可在独立浏览器窗口中打开聊天，支持多频道分屏显示',
            },
            chatHistoryExtender: {
                label: '聊天：扩展聊天历史记录',
                help: '保留游戏从实时缓冲区移除的消息，使其继续显示在实时聊天上方',
            },
            chatHistoryExtender_maxHistory: { label: '聊天：每个标签保留的最大消息数' },
            notificationLog: {
                label: '聊天：添加日志标签',
                help: '在聊天面板添加日志标签，记录物品交易、升级、公会事件及其他游戏内通知',
            },
            notificationLog_maxEntries: {
                label: '聊天：保留的最大通知数',
                help: '每个角色保留的通知历史数量。标签中的筛选只改变显示内容，不影响存储内容。',
            },
            chat_24hrTimestamps: {
                label: '聊天：重新格式化消息时间戳',
                help: '使用你的市场日期/时间格式设置来重新格式化聊天消息时间戳，而不是使用浏览器默认格式',
            },
            altClickNavigation: {
                label: '按住 Alt 点击物品，跳转制作/采集页面或物品词典',
                help: '按住 Alt/Option 点击任意物品，可跳转到其制作/采集页面；若该物品不可制作，则跳转到物品词典',
            },
            collectionNavigation: {
                label: '为收藏物品添加导航按钮',
                help: '点击收藏物品时，添加“查看动作”和“物品词典”按钮',
            },
            queueMonitor: { label: '跨角色队列监视器', help: '在悬浮窗中显示其他角色的预计队列剩余时间' },
            characterActivityStatus: {
                label: '角色选择：显示活动状态',
                help: '在角色选择界面显示每个角色预计正在进行的活动，以及最早可能需要关注的时间点（动作/队列结束、材料不足或离线上限）',
            },
            actionBar_enabled: { label: '动作栏：启用动作栏显示' },
            actionBar_compactWidth: {
                label: '动作栏：紧凑宽度（限制 800px）',
                help: '将动作栏宽度限制为 800px，适合宽屏显示器。',
            },
            actionBar_showQueueCount: { label: '动作栏：队列/剩余数量' },
            actionBar_showActionDuration: { label: '动作栏：单次动作耗时（例如 14.94s/action）' },
            actionBar_showActionsPerHour: { label: '动作栏：动作数/时与物品数/时' },
            actionBar_showTimeRemaining: {
                label: '动作栏：剩余时间显示',
                options: {
                    both: '剩余时间和预计完成时刻',
                    relative: '仅剩余时间',
                    absolute: '仅预计完成时刻',
                    none: '均不显示',
                },
            },
            actionBar_showRecycleTime: {
                label: '动作栏：转化循环时间估算',
                help: '显示计入转化动作中材料自我返还循环后的预计总耗时',
            },
            actionBar_showProfit: {
                label: '动作栏：显示当前动作利润',
                help: '显示当前动作（采集与生产）的利润/时和剩余利润',
            },
            actionPanel_liveCountdown: {
                label: '动作栏：实时倒计时',
                help: '将动作进度条上的静态时间替换为按秒跳动的实时倒计时',
            },
            actionPanel_showFilter: { label: '专业页面：动作筛选输入框' },
            actionPanel_showSort: { label: '专业页面：排序按钮' },
            actionPanel_showPricingMode: { label: '专业页面：定价模式按钮' },
            actionPanel_showCraftToggle: { label: '专业页面：制作切换按钮' },
            actionPanel_showSellTaxToggle: { label: '专业页面：出售税切换按钮' },
            actionPanel_showProfitPerHour_gathering: {
                label: '动作页面：在采集方块上显示利润/时',
                help: '在采集类动作方块上显示利润/时（采集、伐木等）',
            },
            actionPanel_showProfitPerHour_production: {
                label: '动作页面：在生产方块上显示利润/时',
                help: '在生产类动作方块上显示利润/时（制作、裁缝等）',
            },
            actionPanel_showExpPerHour_gathering: {
                label: '动作页面：在采集方块上显示经验/时',
                help: '在采集类动作方块上显示经验/时（采集、伐木等）',
            },
            actionPanel_showExpPerHour_production: {
                label: '动作页面：在生产方块上显示经验/时',
                help: '在生产类动作方块上显示经验/时（制作、裁缝等）',
            },
            actionPanel_hideNegativeProfit: {
                label: '动作面板：隐藏亏损动作',
                help: '隐藏利润/时为负、会造成亏损的动作',
            },
            inventoryCountDisplay: {
                label: '动作面板：显示产出物品的当前物品栏数量',
                help: '在动作方块和动作详情面板中显示当前拥有的产出物品数量',
            },
            actions_pinnedPage: {
                label: '固定动作：启用固定动作页面与图钉图标',
                help: '在左侧导航栏添加“固定”按钮，显示所有已固定的动作，并在动作方块上显示图钉图标。',
            },
            actionPanel_totalTime: { label: '动作面板：总时间、达到目标等级所需次数、经验/时' },
            actionPanel_totalTime_quickInputs: { label: '动作面板：快捷输入按钮（小时、数量预设、最大值）' },
            actionPanel_quickInputs_countPresets: {
                label: '动作面板：自定义数量预设（以逗号分隔，例如 100,1000,1000000）',
            },
            actionPanel_quickInputs_hourPresets: {
                label: '动作面板：自定义小时预设（以逗号分隔，例如 0.5,1,24,168,720）',
            },
            actionPanel_foragingTotal: { label: '动作面板：多产物采集的总利润' },
            actionPanel_outputTotals: {
                label: '动作面板：在单次产出下方显示预期总产出',
                help: '在动作输入框中输入数量后，显示计算得出的总量',
            },
            actionPanel_maxProduceable: {
                label: '动作面板：在制作动作上显示最大可制作数量',
                help: '根据当前物品栏显示可制作的物品数量',
            },
            actionPanel_showProfitDetail: {
                label: '动作面板：显示利润明细',
                help: '在采集、生产和炼金动作面板中显示利润明细区块',
            },
            actionPanel_showLevelProgress: {
                label: '动作面板：显示等级进度',
                help: '在动作面板中显示经验和等级进度估算',
            },
            actionPanel_showSpeedTime: {
                label: '动作面板：显示动作速度与时间',
                help: '在动作面板中显示速度明细、效率和总时间',
            },
            requiredMaterials: { label: '动作面板：显示所需材料总量与缺口', help: '输入数量后显示所需材料总量及缺口' },
            actionPanel_enhanceMatLimitProtections: {
                label: '强化材料上限：计入保护物品',
                help: '启用后，强化材料上限估算会将保护物品的可用数量计入考虑；关闭则仅根据强化材料本身估算上限。',
            },
            actionQueue: { label: '队列中的动作：显示总时间与完成时间' },
            actionQueue_showValue: { label: '队列中的动作：显示队列动作的利润/价值' },
            actionQueue_valueMode: {
                label: '队列中的动作：价值计算模式',
                help: '选择队列动作总价值的计算方式。“利润”显示扣除材料和饮品后的净收益；“预估价值”显示扣除市场税后的毛收入（始终为正）。',
                options: {
                    profit: '总利润（收入－全部成本）',
                    estimated_value: '预估价值（税后收入）',
                },
            },
            actionQueue_completionTimeStyle: {
                label: '队列中的动作：完成时间显示方式',
                help: '队列动作弹窗及悬浮提示中完成时间的显示方式',
                options: {
                    absolute: '仅时钟时间（14:32 完成）',
                    relative: '仅累计时长（3 小时 40 分后完成）',
                    both: '两者都显示',
                },
            },
            alchemy_profitDisplay: {
                label: '炼金面板：显示利润计算器',
                help: '根据成功率和市场价格，显示炼金动作的利润/时和利润/天',
            },
            alchemy_bestItems: {
                label: '炼金面板：显示最佳物品按钮',
                help: '添加按钮，可按每种炼金类型查看以利润或经验排序的物品。',
            },
            alchemy_transmuteHistory: {
                label: '炼金面板：追踪并查看转化会话历史',
                help: '记录转化会话，并在炼金面板的查看器标签页中显示历史记录',
            },
            alchemy_coinifyHistory: {
                label: '炼金面板：追踪并查看兑换金币会话历史',
                help: '记录兑换金币会话，并在炼金面板的查看器标签页中显示历史记录',
            },
            alchemy_decomposeHistory: {
                label: '炼金面板：追踪并查看分解会话历史',
                help: '记录分解会话，并在炼金面板的查看器标签页中显示历史记录',
            },
            alchemy_actionProtection: {
                label: '炼金面板：保护物品类别，防止误炼金',
                help: '当所选物品属于受保护类别时，炼金动作按钮将锁定 3 秒。炼金面板中会显示盾牌图标，用于配置受保护的类别。',
            },
            alchemyItemDimming: { label: '炼金面板：使需要更高等级的物品变暗' },
            actions_missingMaterialsButton: {
                label: '在生产面板显示“缺失材料市场”按钮',
                help: '在生产面板添加按钮，点击后打开市场并自动创建缺失材料的标签页',
            },
            actions_missingMaterialsButton_ignoreQueue: {
                label: '计算缺失材料时忽略队列中的动作',
                help: '启用后，缺失材料计算仅考虑当前动作请求，忽略队列中动作已预留的材料。默认关闭（会计入队列）。',
            },
            actions_budgetCalculator: {
                label: '动作面板：预算计算器',
                help: '在“缺失材料”按钮下方添加预算输入框。输入金币预算（例如 50m），即可计算按卖价买齐缺失的可交易材料后能生产的数量。',
            },
            actions_costSummary: {
                label: '动作面板：显示成本摘要',
                help: '针对所选生产数量，以 4 行精简对比显示成本：直接配方成本、缺失的直接材料、最佳制作方案与成品市场价格。',
            },
            actionPanel_bestCraftingPlan: {
                label: '动作面板：显示最佳制作方案',
                help: '逐层比较各材料的购买与制作成本，显示获得该制作物品的最便宜方式。',
            },
            actionPanel_craftingPlanBuyIntermediates: {
                label: '动作面板：制作方案仅购买原材料',
                help: '有配方的物品始终自行制作，仅从市场购买无法制作的原材料。',
            },
            actionPanel_craftingPlanNoProcessing: {
                label: '动作面板：制作方案不加工中间材料',
                help: '仅制作最终物品，所有子材料均从市场购买而不自行加工。',
            },
            actionPanel_craftingPlanTaskMode: {
                label: '动作面板：制作方案任务模式',
                help: '强制执行最后一步制作（以获得任务进度），但若直接购买中间材料更便宜则允许购买。',
            },
            actionPanel_craftingPlanTimeCost: {
                label: '动作面板：制作方案时间成本',
                help: '在决定购买还是制作时计入制作的时间成本，用你的金币/时价值判断制作是否值得。',
            },
            actionPanel_craftingPlanGoldPerHour: {
                label: '动作面板：制作方案金币/时估值',
                help: '你的时间价值（金币/时），用于判断自行制作中间材料是否划算。请设为你的典型每小时利润（例如 500000）。',
            },
            actionPanel_craftingPlanMatchQuantity: {
                label: '动作面板：制作方案匹配动作数量',
                help: '将最佳制作方案（购物清单、制作步骤、总量）按动作面板中输入的数量缩放，而不是始终按 1 份规划。',
            },
            actions_artisanMaterialMode: {
                label: '缺失材料：工匠需求模式',
                help: '选择建议购买材料时，如何计入工匠茶带来的材料减免。',
                options: {
                    expected: '期望值（平均）',
                    'worst-case': '单次动作最差情况（每次制作向上取整）',
                    hybrid: '混合（不足 100 次动作向上取整，100 次及以上取平均）',
                },
            },
            lootLogStats: { label: '战利品日志统计', help: '在战利品日志中显示总价值、平均用时和每日产出' },
            lootLogHistory: {
                label: '战利品日志：保存并显示历史条目',
                help: '保存战利品日志条目，并在战利品日志面板中将较旧条目显示在当前条目下方',
            },
            itemTooltip_prices: { label: '显示 24 小时平均市场价格' },
            itemTooltip_effectivePrices: {
                label: '显示实际到手价（税后）',
                help: '在物品提示框的卖价/买价旁，显示扣除 4% 市场税后实际到手的金币',
            },
            itemTooltip_decomposeValue: {
                label: '显示分解价值',
                help: '在价格行下方显示分解此物品可获得的市场价值（卖价/买价）。这只是组件的原始价值，未扣除催化剂/金币成本，也未计入 60% 的成功率，因此可直接与直接出售该物品的收益比较。',
            },
            itemTooltip_enhancingHourlyRate: {
                label: '强化目标时薪（例如 50m）',
                help: '在强化提示框中添加最低出售价：该价格可覆盖总成本，并让所花时间达到此时薪。留空则禁用。',
            },
            itemTooltip_enhancingHourlyRateTax: {
                label: '最低出售价计入市场税',
                help: '计入 4% 的市场卖家税，使按最低价挂单后税后仍能达到目标时薪',
            },
            itemTooltip_artisanPrices: {
                label: '提示框价格按工匠茶减免调整',
                help: '在动作面板查看配方时，调整总价以反映工匠茶减免后的实际材料成本',
            },
            itemTooltip_profit: { label: '显示生产成本与利润' },
            itemTooltip_detailedProfit: {
                label: '在利润显示中显示详细材料明细',
                help: '显示材料成本表格，包含卖价/买价、每小时动作次数和利润明细',
            },
            itemTooltip_multiActionProfit: {
                label: '显示该物品所有动作的利润对比',
                help: '高亮最佳利润/时，并在下方汇总其他可选动作（制作、兑换金币、分解、转化）',
            },
            itemTooltip_expectedValue: { label: '显示可开启容器的期望值' },
            expectedValue_showDrops: {
                label: '期望值掉落显示',
                options: {
                    'Top 5': '前 5',
                    'Top 10': '前 10',
                    All: '全部掉落',
                    None: '仅摘要',
                },
            },
            expectedValue_respectPricingMode: { label: '期望值计算使用定价模式' },
            expectedValue_includeCowbells: { label: '期望值计算包含牛铃价值' },
            showConsumTips: { label: 'HP/MP 消耗品：恢复速度、性价比' },
            dungeonTokenTooltips: { label: '货币提示框：显示代币、封印、牛铃的商店价值' },
            itemTooltip_gathering: {
                label: '显示采集来源与利润',
                help: '显示可产出此物品的采集类动作（采集、伐木、挤奶）',
            },
            itemTooltip_gatheringRareDrops: {
                label: '显示采集稀有掉落',
                help: '显示采集区域中的稀有发现掉落（例如 Asteroid Belt 掉落的 Thread of Expertise）',
            },
            itemTooltip_abilityStatus: {
                label: '显示技能书状态',
                help: '在技能书提示框中显示技能是否已学习，以及当前等级/进度',
            },
            abilityTooltip_effectiveTiming: {
                label: '显示实际冷却/施法时间（基于你的属性）',
                help: '根据当前的技能急速、施法速度和攻击等级计算实际冷却/施法时间，与基础值不同时显示在技能提示框中。',
            },
            itemTooltip_enhancementMilestones: {
                label: '显示强化里程碑（+5/+7/+10/+12）',
                help: '在未强化装备的提示框中显示达到 +5、+7、+10 和 +12 所需的预期花费与经验',
            },
            itemTooltip_enhancementPath: {
                label: '在已强化物品上显示强化路径',
                help: '鼠标悬停在已强化物品（+1 至 +20）上时，显示最优强化路径的费用明细',
            },
            itemTooltip_pinTop: {
                label: '将提示框固定在屏幕顶部中央',
                help: '强制物品提示框始终显示在屏幕顶部中央，而不是悬停物品附近',
            },
            itemTooltip_hideInEnhanceSelector: {
                label: '在强化物品选择器中隐藏提示框附加信息',
                help: '在强化选择器中浏览物品时，隐藏注入的提示框内容（价格、利润、里程碑）',
            },
            itemDictionary_transmuteRates: {
                label: '物品词典：显示转化成功率',
                help: '在“转化自（炼金）”部分显示成功率百分比',
            },
            itemDictionary_transmuteIncludeBaseRate: {
                label: '物品词典：转化百分比包含基础成功率',
                help: '启用时显示总概率（基础成功率 × 掉落率）；禁用时显示条件概率（仅掉落率，与“转化成（炼金）”部分一致）',
            },
            enhanceSim: { label: '显示强化模拟器计算结果' },
            enhanceSim_showConsumedItemsDetail: {
                label: '强化提示框：显示消耗物品的详细明细',
                help: '启用后，在贤者之镜计算中显示每个消耗物品的基础/材料/保护费用明细',
            },
            enhanceSim_baseItemCraftingCost: {
                label: '强化路径：制作成本更低时以其作为基础物品价格',
                help: '启用后，强化路径计算中基础物品价格取制作成本与市场价格中的较低者，对卖价和买价两列分别独立应用。',
            },
            enhanceSim_autoTargetLevel: {
                label: '强化：打开面板时自动填入目标等级（0 = 禁用）',
                help: '设为非零值后，每次打开物品的强化面板都会自动将目标等级输入框设为该值，切换物品时也会重新应用。',
            },
            enhanceSim_autoProtectFrom: {
                label: '强化：设置保护物品时自动填入最佳保护起点等级',
                help: '启用后，每当槽位中放入保护物品，都会自动将保护起点等级输入框填为最佳（最便宜）的值。',
            },
            enhanceSim_autoDetect: {
                label: '自动检测你的属性（关闭 = 使用下方设置）',
                help: '大多数玩家应保持关闭，以查看符合实际的专业强化师费用',
            },
            enhanceSim_protectionMarketplaceButton: {
                label: '保护物品选择器：显示“购买最便宜”市场按钮',
                help: '在强化面板的保护物品选择弹窗中添加按钮，点击后跳转到市场购买最便宜的可用保护物品',
            },
            enhanceSim_enhancingLevel: { label: '强化专业等级', help: '默认 140（专业强化师等级）' },
            enhanceSim_houseLevel: { label: '天文台房屋房间等级', help: '默认 8（最高等级）' },
            enhanceSim_achievement: { label: '成就加成（+0.2%）', help: '计入强化成就带来的成功率加成' },
            enhanceSim_gear_enhancer: { label: '强化器' },
            enhanceSim_gear_gloves: { label: '手套' },
            enhanceSim_gear_top: { label: '上衣' },
            enhanceSim_gear_bottoms: { label: '下装' },
            enhanceSim_gear_neck: { label: '项链' },
            enhanceSim_gear_ring: { label: '戒指' },
            enhanceSim_gear_earring: { label: '耳环' },
            enhanceSim_gear_cape: { label: '披风' },
            enhanceSim_gear_guzzling: { label: '暴饮' },
            enhanceSim_gear_charm: { label: '护符' },
            enhanceSim_tea: {
                label: '强化茶',
                help: '强化茶可提供专业等级加成',
                options: {
                    none: '无',
                    basic: '强化茶（+3）',
                    super: '超级强化茶（+6）',
                    ultra: '究极强化茶（+8）',
                },
            },
            enhanceSim_blessedTea: { label: '祝福茶已激活', help: '专业强化师用它来减少尝试次数' },
            enhanceSim_communityBuff: { label: '社区增益', help: '强化速度社区增益。勾选 = 从游戏自动检测。' },
            enhancementTracker: { label: '启用强化追踪器', help: '追踪强化尝试次数、花费与统计数据' },
            enhancementTracker_showOnlyOnEnhancingScreen: {
                label: '仅在强化界面显示追踪器',
                help: '不在强化界面时隐藏追踪器',
            },
            enhancementXPH: {
                label: '强化：经验/时计算器',
                help: '根据当前属性，按预期经验/时对所有可强化物品排名',
            },
            enhancementXPH_maxLevel: { label: '强化经验/时：默认最高强化等级（1–20）' },
            enhancementXPH_protectFrom: { label: '强化经验/时：默认保护起点等级（0 = 不保护）' },
            riskOfRuin: {
                label: '启用破产风险计算器',
                help: '新增独立计算器，估算在达到目标地下城宝箱数量、炼金转化次数或强化等级之前金币归零的概率。',
            },
            riskOfRuin_trials: {
                label: '破产风险：蒙特卡洛试验次数',
                help: '试验次数越多，概率估算越精确，但计算速度越慢。',
            },
            sellQueue: {
                label: '出售队列（Shift+右键点击物品栏物品）',
                help: '按住 Shift 右键点击物品栏物品，即可打开市场并为该物品创建标签页；物品售罄后标签页自动关闭。',
            },
            networkAlert: { label: '无法获取市场价格数据时显示提醒' },
            marketFilter: { label: '市场：按等级、职业、槽位筛选' },
            marketSort: {
                label: '市场：按利润对物品排序',
                help: '新增按钮，可按利润/时对市场物品排序；没有利润数据（仅掉落获得）的物品排在最后。',
            },
            fillMarketOrderPrice: { label: '自动以最优价格填入市场订单' },
            market_autoFillSellStrategy: {
                label: '自动填充出售价格策略',
                help: '创建卖单时，选择与当前最优卖价持平还是低其一档',
                options: {
                    match: '与最优卖价持平',
                    undercut: '低 1 金币（最优卖价 - 1）',
                },
            },
            market_autoFillBuyStrategy: {
                label: '自动填充购买价格策略',
                help: '创建买单时，选择高于、持平或低于当前最优买价',
                options: {
                    outbid: '高 1 金币（最优买价 + 1）',
                    match: '与最优买价持平',
                    undercut: '低 1 金币（最优买价 - 1）',
                },
            },
            market_autoClickMax: {
                label: '在卖单窗口自动点击最大按钮',
                help: '打开卖单窗口时，自动点击数量栏中的“最大”按钮',
            },
            market_quickInputButtons: {
                label: '市场：订单窗口中的快捷输入按钮',
                help: '在购买/出售窗口新增 10、100、1000 的预设数量按钮',
            },
            market_quickInputButtons_presets: {
                label: '市场：自定义快捷输入预设值',
                help: '以英文逗号分隔的预设值（例如 50,500,5000）。留空则使用默认值（10、100、1000），最多 8 个值。',
            },
            market_multiplierButtons: {
                label: '市场：订单窗口中的 ÷2 和 ×2 按钮',
                help: '在购买/出售窗口的价格与数量栏中新增 ÷2 和 ×2 按钮',
            },
            market_showOwnedInBuyModal: {
                label: '市场：在购买窗口显示持有数量',
                help: '在“立即购买”和“购买挂单”弹窗中显示当前持有该物品的数量',
            },
            market_marketplaceShortcuts: {
                label: '市场：在物品菜单显示“市场操作”按钮',
                help: '在物品菜单新增“市场操作”下拉菜单，包含立即出售、立即购买及挂单快捷方式',
            },
            market_visibleItemCount: {
                label: '市场：在物品上显示物品栏数量',
                help: '浏览市场时显示你拥有的每种物品的数量',
            },
            market_visibleItemCountOpacity: {
                label: '市场：未持有物品的不透明度',
                help: '当某物品持有数量为零时，物品方块的透明程度',
            },
            market_visibleItemCountIncludeEquipped: {
                label: '市场：计入已装备物品',
                help: '显示数量时计入当前已装备的物品',
            },
            market_showListingPrices: {
                label: '市场：在单条挂单上显示价格',
                help: '在“我的挂单”表格中为每条挂单显示最优订单价格与总价值',
            },
            market_collectableListingsToTop: {
                label: '市场：将可领取的挂单置顶于“我的挂单”',
                help: '有可领取内容的挂单会被移到顶部，无需滚动即可看到“全部领取”收取了什么；手动按列排序后会覆盖此行为，直到清除排序为止',
            },
            market_listingRefreshNavigator: {
                label: '市场：显示循环浏览“我的挂单”的刷新/下一个按钮',
                help: '在“我的挂单”新增“刷新”按钮，用于打开第一条挂单的订单簿；每条挂单页面再提供“下一个”按钮以切换到下一条，最后以“返回我的挂单”结束',
            },
            market_tradeHistory: {
                label: '市场：显示个人交易历史',
                help: '在市场中显示你各物品最近一次的购买/出售价格',
            },
            market_tradeHistoryComparisonMode: {
                label: '市场：交易历史对比模式',
                help: '即时：与即时购买/出售价格对比。挂单：与买单/卖单对比。',
                options: {
                    instant: '即时',
                    listing: '挂单',
                },
            },
            market_listingPricePrecision: { label: '市场：挂单价格小数精度', help: '挂单价格显示的小数位数' },
            market_showListingAge: {
                label: '市场：在“我的挂单”显示挂单时长',
                help: '在“我的挂单”标签页中显示每条挂单创建至今的时长（例如“3h 45m”）',
            },
            market_showTopOrderAge: {
                label: '市场：在“我的挂单”显示最优竞争订单时长',
                help: '显示你每条挂单对应的最优竞争订单的估算时长（需启用“估算挂单时长”功能）',
            },
            market_showEstimatedListingAge: {
                label: '市场：在订单簿中显示估算时长',
                help: '通过挂单 ID 插值估算所有市场挂单的创建时间',
            },
            market_listingAgeFormat: {
                label: '市场：挂单时长显示格式',
                help: '选择挂单创建时间的显示方式',
                options: {
                    elapsed: '已用时间（例如“3h 45m”）',
                    datetime: '日期/时间（例如“01-13 14:30”）',
                },
            },
            market_listingTimeFormat: {
                label: '时间显示格式',
                help: '用于市场挂单、动作完成时间和聊天时间戳的时间格式',
                options: {
                    '24hour': '24 小时制（14:30）',
                    '12hour': '12 小时制（2:30 PM）',
                },
            },
            market_listingDateFormat: {
                label: '日期显示格式',
                help: '用于市场挂单、动作完成时间和聊天时间戳的日期格式',
                options: {
                    'MM-DD': 'MM-DD（01-13）',
                    'DD-MM': 'DD-MM（13-01）',
                },
            },
            market_showOrderTotals: {
                label: '市场：在页眉显示订单总计',
                help: '在金币下方的页眉区域显示买单（BO）、卖单（SO）和未领取金币（💰）',
            },
            market_showHistoryViewer: {
                label: '市场：在设置中显示历史查看器按钮',
                help: '在设置面板新增“查看市场历史”按钮，用于查看和导出全部市场挂单历史',
            },
            market_showPhiloCalculator: {
                label: '市场：在设置中显示 Philo Gamba 计算器按钮',
                help: '在设置面板新增“Philo Gamba”按钮，用于计算转化为贤者之石的投资回报率',
            },
            market_showQueueLength: {
                label: '市场：显示队列长度估算',
                help: '在购买/出售按钮下方显示最优价格处的总数量；估算值（同价位 20 个以上订单）以不同颜色显示。',
            },
            market_depthCapEnabled: {
                label: '市场：显示出售深度上限（破产风险）',
                help: '根据上一次破产风险计算结果，显示订单簿能够有利润地吸纳当前查看物品的动作次数；此计算忽略市场可交易区间下限，因为该数据未在游戏数据中公开。',
            },
            marketData_outlierGuardEnabled: {
                label: '防护异常市场挂单',
                help: '适用于 Toolasha 读取市场价格的所有场景（利润计算器、净资产、升级顾问等）。当实时买价/卖价大幅偏离游戏官方参考市场价值的区间时，Toolasha 会改用参考价值，并在受影响的数值旁标注 ⚠ 以提示发生了替换。',
            },
            marketData_outlierBandMultiplier: {
                label: '异常值区间倍数',
                help: '当实时价格高于或低于参考价值超过该倍数时视为异常值（例如 3 表示超出参考价值的 1/3 至 3 倍区间）。仅适用于参考数据集中实际收录的物品。',
            },
            profitCalc_pricingMode: {
                label: '利润计算定价模式',
                options: {
                    conservative: '购买：卖价 / 出售：买价（即时购买 / 即时出售）',
                    hybrid: '购买：卖价 / 出售：卖价（即时购买 / 耐心出售）',
                    optimistic: '购买：买价 / 出售：卖价（耐心购买 / 耐心出售）',
                    patientBuy: '购买：买价 / 出售：买价（耐心购买 / 即时出售）',
                },
            },
            profitCalc_pricingNaming: {
                label: '定价模式命名方式',
                help: '以“即时购买 / 即时出售”的形式显示定价模式，而不是“购买：卖价 / 出售：买价”',
            },
            profitCalc_keyPricingMode: {
                label: '钥匙定价模式',
                help: '在提示框、净资产和战斗收入计算中如何为地下城钥匙估值：卖价（即时购买）、买价（耐心购买），或最低价（比较直接购买与自行制作的费用，制作时使用“最佳制作方案”引擎，并按你利润计算定价模式的购买基准计价）。',
                options: {
                    ask: '卖价（即时购买）',
                    bid: '买价（耐心购买）',
                    cheapest: '最低价（购买或制作）',
                },
            },
            profitCalc_customPriceOverrides: {
                label: '自定义价格覆盖',
                help: '为特定物品设置自定义购买/出售价格，在利润计算中覆盖市场价格。',
            },
            profitCalc_craftUpgradeItems: {
                label: '利润：升级材料在制作成本更低时使用制作成本',
                help: '启用后，若升级材料的制作成本更低，则使用制作成本代替市场价格，并将制作时间计入利润/时的计算。',
            },
            profitCalc_excludeSellTax: {
                label: '利润：排除出售税（自用生产）',
                help: '启用后，净利润/每小时利润将假设你保留生产的物品而不出售，因此不从产出价值中扣除市场出售税。适用于地下城钥匙、食物/饮品、迷宫消耗品，或任何你不打算出售的物品。这会使利润数值高于实际出售产出物所得，启用期间会显示警告标志。',
            },
            offlineProgressEconomics: {
                label: '离线进度：显示收入/成本/利润摘要',
                help: '在原生“欢迎回来”弹窗中加入收入/成本/利润摘要（含每日预测），使用你的“价格与利润”设置计算。',
            },
            networth: { label: '右上角：显示金币数量', help: '在页面顶部的总等级旁显示当前金币数量' },
            invWorth: {
                label: '物品栏下方：显示净资产明细',
                help: '在物品栏面板下方显示总净资产，并按类别（装备、物品栏、挂单、房屋、技能）列出明细',
            },
            invSort: { label: '按价值排序物品栏物品' },
            invSort_showBadges: { label: '按卖价/买价排序时显示堆叠价值徽标' },
            invSort_badgesOnNone: {
                label: '选择“无”排序时的徽标类型',
                options: {
                    None: '无',
                    Ask: '卖价',
                    Bid: '买价',
                },
            },
            invSort_netOfTax: { label: '徽标数值显示扣除市场税后的净值' },
            invSort_sortEquipment: { label: '启用装备类别的排序' },
            invBadgePrices: { label: '在物品图标上显示价格徽标', help: '在物品栏物品上显示单个物品的卖价和买价' },
            invCategoryTotals: { label: '在物品栏显示类别总计', help: '显示物品栏中每个类别内所有物品的市场总价值' },
            networth_pricingMode: {
                label: '净资产定价模式',
                help: '卖价显示耐心挂单可获得的金额，买价显示立即出售可获得的金额。',
                options: {
                    ask: '卖价（耐心出售价值）',
                    bid: '买价（即时清算价值）',
                },
            },
            networth_highEnhancementUseCost: {
                label: '高强化物品使用强化成本计价',
                help: '高强化物品（+13 及以上）的市场价格不可靠，改用计算得出的强化成本代替。',
            },
            networth_highEnhancementMinLevel: {
                label: '使用成本计价的最低强化等级',
                help: '从该强化等级开始不再信任市场价格',
                options: {
                    10: '+10 及以上',
                    11: '+11 及以上',
                    12: '+12 及以上',
                    13: '+13 及以上（推荐）',
                    15: '+15 及以上',
                },
            },
            networth_includeCowbells: {
                label: '净资产中包含牛铃',
                help: '牛铃不可交易，但其价值基于“10个牛铃袋”的市场价格计算',
            },
            networth_includeTaskTokens: {
                label: '净资产中包含任务代币',
                help: '根据任务商店宝箱的期望值估算任务代币价值，关闭则将其排除在净资产之外。',
            },
            networth_abilityBooksAsInventory: {
                label: '将技能书计入物品栏（流动资产）',
                help: '将技能书从固定资产移至流动资产的物品栏价值中，适合打算出售技能书时使用。',
            },
            networth_historyChart: {
                label: '启用净资产历史图表',
                help: '每小时记录一次净资产快照，并在“总净资产”旁显示图表图标。关闭后将停止记录并隐藏图表按钮。',
            },
            autoAllButton: {
                label: '开启战利品箱时自动点击“全部”按钮',
                help: '打开可开启容器（箱子、宝箱、密藏）时自动点击“全部”按钮',
            },
            autoAllButton_excludeSeals: {
                label: '自动点击“全部”：跳过“卷轴”类物品',
                help: '启用后，迷宫中的各类卷轴不会被自动开启',
            },
            openableAnalytics: {
                label: '开箱分析：追踪实际与期望价值对比及幸运值',
                help: '显示你开启的宝箱/箱子/密藏的实际价值、期望价值和幸运值，并提供按角色区分的分析视图，包含本次会话与历史记录',
            },
            openableAnalytics_sidePanel: {
                label: '开箱分析：显示当前/历史侧边面板',
                help: '在“已开启战利品”窗口左侧固定一个面板，显示本次开启及历史记录的已开启数量、收入、利润、幸运值、预期收入和与预期的对比',
            },
            inventoryTabs: {
                label: '自定义物品栏标签：启用',
                help: '在角色面板中添加 Toolasha 标签页，你可以在其中把物品栏物品整理到个人标签中。',
            },
            inventoryTabs_showUnorganized: {
                label: '自定义物品栏标签：显示“未整理”分区',
                help: '显示“未整理”区域，包含所有未分配到任何标签的物品。',
            },
            inventoryTabs_categoryAddAll: {
                label: '自定义物品栏标签：添加类别时加入全部物品',
                help: '将某个类别添加到标签时，加入该类别中的所有物品（包括物品栏中没有的物品）。关闭后仅添加当前物品栏中已有的物品。',
            },
            inventoryTabs_defaultTab: {
                label: '自定义物品栏标签：默认显示 Toolasha 标签页',
                help: '隐藏原生“物品栏”标签，并在每次打开角色面板时自动激活 Toolasha 标签页。',
            },
            inventoryTabs_tileGap: {
                label: '自定义物品栏标签：物品间距（像素）',
                help: 'Toolasha 标签页中物品格之间的像素间距。',
            },
            inventoryTabs_loadoutIncludeConsumables: {
                label: '自定义物品栏标签：从配装添加时包含食物和饮品',
                help: '从配装向标签添加物品时，同时包含食物和饮品物品。',
            },
            inventoryTabs_topTabPriority: {
                label: '自定义物品栏标签：物品仅在最上层标签中显示',
                help: '当一个物品出现在多个标签中时，仅在包含该物品的最上层标签中显示。关闭后，收起某个标签会将其物品释放给下层标签。',
            },
            simulateScrollEffects: {
                label: '专业：在计算中模拟缺失的卷轴效果',
                help: '启用后，利润/经验/速度计算会显示假设所选卷轴生效时的结果。可通过按钮配置默认卷轴，也可在“配装”面板中为单个配装单独设置覆盖。',
            },
            xpTracker: {
                label: '左侧栏：在专业条上显示经验/时速率',
                help: '在导航面板的每个专业条下方实时显示经验/时速率',
            },
            xpTracker_timeTillLevel: {
                label: '专业提示框：显示距下一等级的剩余时间',
                help: '在专业悬停提示框中显示距下一等级的预计剩余时间（基于当前经验/时）',
            },
            skillRemainingXP: {
                label: '左侧栏：显示距下一等级所需经验',
                help: '在专业进度条下方显示升到下一等级所需的经验值',
            },
            skillRemainingXP_blackBorder: {
                label: '剩余经验：添加黑色文字描边以提高可见度',
                help: '为经验文字添加黑色描边/阴影，使其在进度条上更清晰易读',
            },
            skillbook: { label: '技能书：显示达到目标等级所需的书籍数量（在技能书物品词典窗口中）' },
            drinkTimer: {
                label: '饮品计时器：在消耗品栏显示饮品剩余时间',
                help: '在采集/生产、炼金和强化动作面板的消耗品槽位下方，显示饮品剩余供应时间及队列覆盖情况。',
            },
            drinkTimer_warningThreshold: {
                label: '饮品计时器：警告阈值（小时）',
                help: '当剩余供应时间低于此小时数时，饮品时间显示黄色警告。',
            },
            skillingOptimizer: { label: '生活专业模拟器/优化器：在角色面板启用优化器标签页' },
            combatScore: { label: '资料面板：显示装备评分' },
            abilitiesTriggers: {
                label: '资料面板：显示技能与触发器',
                help: '在资料下方显示已装备的技能、消耗品及其战斗触发条件',
            },
            characterCard: { label: '资料面板：显示“查看卡片”按钮', help: '添加按钮，可在外部查看器中打开角色卡' },
            eliteAchievementReminder: {
                label: '资料面板：显示精英成就提醒图标',
                help: '若玩家尚未完成精英成就，则在其名字旁显示 ✉️ 图标；点击可预填一条私聊消息。',
            },
            eliteAchievementReminderMessage: {
                label: '精英成就提醒：私聊消息',
                help: '点击精英成就提醒图标时预填入聊天框的消息内容。',
            },
            dungeonTracker: {
                label: '地下城追踪器：实时进度追踪',
                help: '通过队伍消息中经服务器验证的时长追踪地下城记录',
            },
            dungeonTrackerUI: {
                label: '显示地下城追踪器界面面板',
                help: '显示地下城进度面板，包含波次计数、通关记录和统计数据',
            },
            dungeonTrackerChatAnnotations: {
                label: '在队伍聊天中显示通关时间',
                help: '为“钥匙数量”消息添加彩色计时标注（快则绿色，慢则红色）',
            },
            labyrinthTracker: {
                label: '迷宫最高等级追踪器',
                help: '追踪每种怪物类型已击败的最高推荐等级，并在自动化标签页中显示',
            },
            labyrinthShopPrices: {
                label: '迷宫商店：显示市场价格',
                help: '在迷宫商店标签页中为可交易物品显示卖价/买价市场价格',
            },
            labyrinthClearRate: { label: '迷宫通关率计算器', help: '在迷宫生产房间的方块上显示预计通关时间和成功率' },
            labyrinthMissingSuppliesButton: {
                label: '迷宫：显示“购买缺少的补给”按钮',
                help: '在补给区域旁添加一个按钮，打开市场并显示低于携带上限的火把/斗篷/探照灯标签',
            },
            labyrinthRecommendTargetRate: {
                label: '迷宫：建议目标通关率（%）',
                help: '迷宫跳过阈值建议所使用的默认目标通关率',
            },
            labyrinthRecommendSimHours: {
                label: '迷宫：每步建议的模拟小时数',
                help: '建议计算中二分查找每一步所使用的默认战斗模拟小时数',
            },
            labyrinthLiveProgress: {
                label: '迷宫：显示实时通关概率',
                help: '在进行中的迷宫生产/强化房间内显示实时通关概率',
            },
            combatBattleCounter: {
                label: '战斗时在当前动作面板显示战斗/波次计数',
                help: '在左上角动作面板中显示普通区域的“战斗 #N”或地下城的“第 N 波”',
            },
            combatSummary: {
                label: '战斗摘要：为战斗信息面板添加速率统计',
                help: '为当前查看单位的战斗信息面板添加遭遇数/时、收入和经验速率',
            },
            combatSim: { label: '战斗模拟器', help: '模拟战斗遭遇，估算经验/时、死亡次数和消耗品用量' },
            labSim: { label: '迷宫模拟器', help: '模拟迷宫通关，估算各专业及战斗的表现' },
            combatSim_defaultHours: { label: '战斗模拟器：默认小时数（单区域）', help: '单区域模拟的默认时长（小时）' },
            combatSim_allZonesDefaultHours: {
                label: '战斗模拟器：默认小时数（全部区域）',
                help: '全部区域模拟的默认时长（小时）',
            },
            combatSim_seekDefaultHours: {
                label: '战斗模拟器：默认小时数（探寻）',
                help: '“探寻最佳来源”模拟的默认时长（小时）',
            },
            combatSim_decimalMinutes: {
                label: '战斗模拟器：以小数分钟显示完成时间',
                help: '将平均完成时间显示为“X.XX min”而非“Xm Ys”',
            },
            combatSim_defaultLoadout: {
                label: '战斗模拟器：默认配装',
                help: '战斗估算默认使用的配装，而非当前已装备的装备',
                options: { _empty: '当前装备' },
            },
            combatSim_autoEstimate: {
                label: '战斗模拟器：在任务卡片上自动运行估算',
                help: '任务卡片出现时，使用默认配装自动运行战斗估算',
            },
            combatSim_maxThreads: {
                label: '战斗模拟器：最大线程数',
                help: '模拟使用的最大 Web Worker 线程数（0 = 自动，使用所有可用核心）',
            },
            combatSim_upgradeSkipSkillingRooms: {
                label: '战斗模拟器：升级顾问 - 跳过生产类房屋房间',
                help: '房屋房间升级模式：跳过模拟没有战斗属性加成的房间（酿造坊、花园等）以节省模拟时间。这些房间仍会像所有房间一样获得微小的智慧/稀有发现加成，因此关闭此选项也能查看它们（通常可忽略不计）的金币/经验和金币/利润数值。',
            },
            combatStats: {
                label: '战斗统计：在战斗面板显示统计标签页',
                help: '在战斗面板添加统计按钮，显示收入、利润、消耗品花费、经验和掉落详情',
            },
            combatStats_runwayWarningThreshold: {
                label: '战斗统计：消耗品可用时长警告阈值（小时）',
                help: '高亮预计在此小时数内耗尽的战斗消耗品。设为 0 可关闭警告。',
            },
            combatStats_showLootLuck: {
                label: '战斗统计：显示战利品幸运值对比',
                help: '在统计面板中显示实际与预期掉落率/利润的对比，以及战利品幸运值差值。',
            },
            combatConsumableTimer: {
                label: '战斗消耗品计时器：战斗中显示食物/饮品剩余时间',
                help: '战斗期间，在消耗品列表中每个生效中的战斗食物/饮品图标下方显示预计剩余可用时间。需启用“战斗统计”，该估算数据来自其消耗追踪器。',
            },
            combatStatsChatMessage: {
                label: '战斗统计：聊天消息格式',
                help: '在统计面板中按住 Ctrl 点击玩家卡片时使用的消息格式。点击“编辑模板”进行自定义。',
            },
            taskProfitCalculator: { label: '显示采集/生产任务的总利润' },
            taskSpeedBreakdown: {
                label: '在任务上显示可展开的速度与时间明细',
                help: '在任务卡片上显示可展开的动作速度、效率和用时明细。',
            },
            taskCombatEstimate: {
                label: '在战斗任务上显示战斗估算',
                help: '在战斗任务卡片上显示配装下拉菜单和估算按钮。',
            },
            taskEfficiencyRating: {
                label: '显示任务效率评分（每时代币/利润）',
                help: '根据预计完成时间显示颜色分级的效率评分。',
            },
            taskMaterialsIndicator: {
                label: '在生产任务上显示材料可用情况',
                help: '显示以当前物品栏可完成多少次任务动作。',
            },
            taskEfficiencyRatingMode: {
                label: '效率算法',
                help: '选择按任务代币产出还是按总利润评分。',
                options: {
                    tokens: '每小时任务代币',
                    gold: '每小时任务利润',
                },
            },
            taskEfficiencyGradient: { label: '使用相对渐变颜色', help: '根据当前可见任务的相对情况为效率评分着色。' },
            taskQueuedIndicator: {
                label: '在任务卡片上显示“已排队”标记',
                help: '当任务对应的动作在你的动作队列中时，在任务卡片上显示状态消息',
            },
            taskRerollTracker: {
                label: '追踪任务重掷花费',
                help: '追踪重掷每个任务所花费的金币/牛铃（实验性功能，可能导致界面卡顿）',
            },
            taskMapIndex: { label: '在任务上显示战斗区域索引号' },
            taskIcons: { label: '在任务卡片上显示视觉图标', help: '在任务卡片上显示半透明的物品/怪物图标' },
            taskIconsDungeons: {
                label: '在战斗任务上显示地下城图标',
                help: '显示该怪物出现在哪些地下城中（需启用任务图标）',
            },
            taskSorter_autoSort: { label: '打开任务面板时自动排序任务', help: '打开任务面板时按专业类型自动排序任务' },
            taskSorter_hideButton: { label: '隐藏任务排序按钮', help: '隐藏任务排序按钮，同时保留自动排序功能' },
            taskSorter_sortMode: {
                label: '任务排序模式',
                help: '点击任务排序时的排序方式。“完成所需时间”将最快完成的任务排在最前，战斗任务和已完成任务排在最后；“保护”将未受保护的任务排在最前。',
                options: {
                    skill: '专业 / 区域',
                    time: '完成所需时间',
                    protection: '保护（未受保护优先）',
                },
            },
            taskInventoryHighlighter: {
                label: '启用任务物品栏高亮按钮',
                help: '添加按钮，用于淡化当前非战斗任务不需要的物品栏物品',
            },
            taskStatistics: {
                label: '在任务面板显示任务统计按钮',
                help: '在任务面板添加统计按钮，显示溢出时间、预期奖励和完成时间估算',
            },
            taskClaimCollector: {
                label: '将领取奖励按钮移至任务列表顶部',
                help: '将所有领取奖励按钮集中堆叠到任务列表顶部，这样你可以反复点击同一位置领取所有已完成的任务',
            },
            taskGoMerge: {
                label: '点击前往时合并重复任务',
                help: '点击某个任务的前往按钮时，将同一动作所有进行中任务的所需数量合并为一个预填数值',
            },
            taskRerollProtection: {
                label: '任务重掷保护',
                help: '保护特定任务，防止意外重掷。受保护的任务显示绿色高亮，重掷前需再次点击确认。任务面板中会出现盾牌图标，用于配置受保护的区域。',
            },
            taskRerollProtection_hideHighlight: {
                label: '任务重掷保护：隐藏绿色高亮',
                help: '移除受保护任务的绿色描边/光效，同时保留重掷确认功能。',
            },
            taskAutoReroll: {
                label: '任务自动重掷提醒',
                help: '用红色边框和提醒徽标高亮你想要重掷的任务。可通过任务面板中的目标图标按角色配置。',
            },
            taskTokenThreshold: {
                label: '按任务代币奖励标记需要重掷的任务',
                help: '当任务的任务代币奖励超出可配置临界值（低于或高于）时，用与自动重掷相同的红色边框和提醒徽标高亮该任务。此功能不会自动点击或重掷任何内容。可通过任务面板中的图标按角色配置临界值和方向。',
            },
            draggableModals: {
                label: '可拖动的弹窗',
                help: '使游戏弹出窗口可拖动。每种弹窗类型的位置会跨会话保留。',
            },
            formatting_useKMBFormat: {
                label: '数字格式模式',
                help: '控制整个界面中大数字的显示方式',
                options: {
                    full: '完整（1,250,000）',
                    threshold: '超过 4 位后缩写（1,250K）',
                    compact: '始终缩写（1.25M）',
                },
            },
            formatting_precision: {
                label: '缩写精度（小数位数）',
                help: '数字使用 K/M/B 后缀缩写时显示的小数位数',
                options: {
                    1: '1 位（1.2M）',
                    2: '2 位（1.25M）',
                    3: '3 位（1.250M）',
                    4: '4 位（1.2500M）',
                },
            },
            ui_externalLinks: {
                label: '左侧栏：显示外部工具链接',
                help: '添加战斗模拟器、市场追踪器、强化计算器和 Milkonomy 的快捷链接',
            },
            hideLabyrinthBadge: { label: '左侧栏：隐藏迷宫提示徽标' },
            hideGuildBadge: { label: '左侧栏：隐藏公会通知徽标' },
            hideNavBarGlow: {
                label: '左侧栏：隐藏当前专业光效',
                help: '移除游戏左侧导航栏中当前激活专业图标上的橙色脉动光效动画。',
            },
            tabReorder: {
                label: '角色面板：拖放重排标签顺序',
                help: '拖动标签以重新排列物品栏、Toolasha、装备、房屋、技能和配装的顺序，刷新后仍会保留。',
            },
            expPercentage: { label: '左侧栏：显示专业经验百分比' },
            combatLevelProgress: {
                label: '左侧栏：显示小数战斗等级',
                help: '根据当前整数战斗技能等级显示未四舍五入的战斗等级公式值（例如 133.2）。游戏原生侧栏显示时会向下取整为整数。',
            },
            itemIconLevel: { label: '图标左下角：显示装备等级' },
            loadoutEnhancementDisplay: { label: '配装面板：在装备图标上显示拥有的最高强化等级' },
            loadoutSnapshot: {
                label: '配装：在利润/动作计算中使用已保存的配装',
                help: '当你把一个动作加入队列时，Toolasha 会使用该专业当前已保存的游戏配装（专业默认 → 全部专业默认 → 匹配的已保存配装 → 当前已装备）来预测其经验、时间和利润。“使用最高强化等级”会根据你当前拥有的物品解析。若已保存的装备不可用，预测会回退到当前已装备的配置；若已保存的食物/饮品不可用，配装不会失效，其缺失槽位会被省略。禁用此项将始终使用当前已装备的装备进行预测。',
            },
            showsKeyInfoInIcon: { label: '钥匙图标左下角：显示区域索引' },
            mapIndex: { label: '战斗区域：显示区域索引号' },
            guildXPTracker: {
                label: '随时间追踪公会与成员经验',
                help: '从 WebSocket 消息中记录公会和成员经验数据，用于公会面板的经验/时计算。',
            },
            guildXPDisplay: {
                label: '在公会面板显示经验/时统计',
                help: '在公会概览、成员和公会排行榜标签页上显示经验/时速率、排名和每周图表。若使用此功能，请禁用独立的 Guild XP/h 用户脚本。',
            },
            guildIdleDisplay: {
                label: '公会概览：显示空闲成员列表',
                help: '在公会概览标签页上显示当前处于空闲状态（未执行任何动作）的公会成员列表。',
            },
            guildTrialSignupDisplay: {
                label: '公会试炼：显示未报名成员列表',
                help: '显示哪些公会成员尚未报名本周的生活专业和战斗试炼。',
            },
            guildTrialWhisperTemplate: {
                label: '公会试炼：点击名字时的私聊消息',
                help: '点击未报名成员的名字时预填到聊天框中的消息。使用 {name} 代表该玩家的名字。',
            },
            guildMembersActivityTab: {
                label: '公会成员：活动列的显示位置',
                help: '控制活动列显示的位置。“仅贡献标签页”会隐藏状态标签页上的原生列，并改在贡献标签页上显示。',
                options: {
                    status: '仅状态标签页（原生）',
                    contributions: '仅贡献标签页',
                    both: '两个标签页都显示',
                },
            },
            guildMembersShowGameMode: {
                label: '公会成员：显示游戏模式列',
                help: '显示 MC/IC/LC 游戏模式列（状态标签页）。',
            },
            guildMembersShowJoined: {
                label: '公会成员：显示加入日期列',
                help: '显示每位成员加入公会的日期（状态标签页）。',
            },
            guildMembersShowLastXPH: {
                label: '公会成员：显示最近经验/时列',
                help: '显示由 Toolasha 追踪的最近经验/时（贡献标签页）。',
            },
            guildMembersShowLastDayXPH: {
                label: '公会成员：显示最近一天经验/时列',
                help: '显示由 Toolasha 追踪的 24 小时平均经验/时（贡献标签页）。',
            },
            guildCreditValue: {
                label: '公会商店：显示每信用点的金币成本表',
                help: '在每个公会信用点兑换弹窗中插入成本效率表，按你的利润定价模式从最便宜开始排序。',
            },
            guildTokenValueComparison: {
                label: '公会商店：显示公会代币金币价值对比',
                help: '在信用点兑换成本表中添加公会代币行，并在公会代币提示框中添加公会信用点价值表，通过通往每种信用点类型最便宜的可交易物品路线显示金币/代币价值。',
            },
            guildCreditExchangeAdvisor: {
                label: '公会商店：显示兑换顾问（出售 → 回购对比）',
                help: '当所选物品不是最便宜的选项时，显示出售该物品并回购最优物品能否获得更多信用点（计入 4% 卖家税）。',
            },
            guildShrineUpgradePlanner: {
                label: '公会商店：显示神殿升级规划器',
                help: '在公会信用点兑换面板添加神殿升级规划器，显示从当前等级升级到目标等级所需的信用点和代币总成本。',
            },
            houseUpgradeCosts: { label: '显示升级成本，并对比市场价格与物品栏' },
            leaderboardXPTracker: {
                label: '随时间从排行榜追踪玩家经验',
                help: '从排行榜 WebSocket 消息中记录玩家经验，用于排行榜面板的经验/时计算。',
            },
            leaderboardXPDisplay: {
                label: '在排行榜显示经验/时列',
                help: '在玩家排行榜面板添加最近经验/时和最近一天经验/时列。',
            },
            notifiEmptyAction: { label: '动作队列为空时发送浏览器通知', help: '仅在游戏页面保持打开时有效' },
            color_profit: { label: '利润/正值', help: '用于利润、收益和正值的颜色' },
            color_loss: { label: '亏损/负值', help: '用于亏损、成本和负值的颜色' },
            color_warning: { label: '警告', help: '用于警告和重要提示的颜色' },
            color_info: { label: '信息提示', help: '用于信息文本和高亮的颜色' },
            color_essence: { label: '精华', help: '用于精华掉落和精华相关文本的颜色' },
            color_tooltip_profit: { label: '提示框 利润/正值', help: '提示框中利润/正值的颜色（浅色背景）' },
            color_tooltip_loss: { label: '提示框 亏损/负值', help: '提示框中亏损/负值的颜色（浅色背景）' },
            color_tooltip_info: { label: '提示框 信息提示', help: '提示框中信息文本的颜色（浅色背景）' },
            color_tooltip_warning: { label: '提示框 警告', help: '提示框中警告的颜色（浅色背景）' },
            color_text_primary: { label: '主要文本', help: '主要文本颜色' },
            color_text_secondary: { label: '次要文本', help: '暗淡/次要文本颜色' },
            color_border: { label: '边框', help: '边框与分隔线颜色' },
            color_gold: { label: '金币/货币', help: '用于金币和货币显示的颜色' },
            color_mirror: { label: '贤者之镜', help: '强化提示框中贤者之镜用量行的颜色' },
            color_listing_price_1m: { label: '挂单总额：100 万以上', help: '市场挂单总价为 100 万或以上时的颜色' },
            color_listing_price_100k: { label: '挂单总额：10 万以上', help: '市场挂单总价为 10 万或以上时的颜色' },
            color_listing_price_10k: { label: '挂单总额：1 万以上', help: '市场挂单总价为 1 万或以上时的颜色' },
            color_listing_price_low: { label: '挂单总额：低于 1 万', help: '市场挂单总价低于 1 万时的颜色' },
            color_accent: {
                label: '脚本主题色',
                help: '脚本界面元素（按钮、标题、区域编号、经验百分比等）的主要主题色',
            },
            color_remaining_xp: { label: '剩余经验文本', help: '左侧导航栏中专业条下方剩余经验文本的颜色' },
            color_xp_rate: { label: '经验速率文本', help: '左侧导航栏专业条上经验/时速率文本的颜色' },
            color_hours_to_level: { label: '升级所需时间文本', help: '专业提示框中“距下一等级所需小时数”文本的颜色' },
            color_inv_count: { label: '物品栏数量文本', help: '动作方块和动作详情面板中显示的物品栏数量的颜色' },
            color_invBadge_ask: {
                label: '物品栏徽标：卖价',
                help: '物品栏物品上卖价徽标的颜色（卖家挂价，对应较好的出售价值）',
            },
            color_invBadge_bid: {
                label: '物品栏徽标：买价',
                help: '物品栏物品上买价徽标的颜色（买家出价，对应即时出售价值）',
            },
            color_transmute: { label: '转化成功率', help: '物品词典中转化成功率百分比所使用的颜色' },
            color_queueLength_known: {
                label: '队列长度：已知值',
                help: '已知队列长度（所有可见订单均已计数时）的颜色',
            },
            color_queueLength_estimated: {
                label: '队列长度：估算值',
                help: '估算队列长度（根据同一价格下 20 个以上订单推算）的颜色',
            },
            collectionFilters: { label: '收藏筛选：数量范围、地下城和生活专业套装筛选' },
            collectionFavorites: { label: '收藏夹：为物品加星（★）以标记和筛选收藏' },
            collectionFavoritesSection: { label: '收藏夹：在网格顶部显示收藏区' },
            collectionFilters_skillingBadges: {
                label: '在生活专业动作方块上显示收藏数量徽标',
                help: '在生活专业动作上显示你的收藏数量（请先打开一次收藏页面以填充数量）',
            },
        },
    },
    settings: {
        tabLabel: 'Toolasha',
        searchPlaceholder: '搜索设置…',
        clearButton: '清除',
        copySettingsToOthersButton: '复制设置到其他角色',
        fetchPricesButton: '🔄 获取最新价格',
        resetButton: '重置为默认值',
        exportButton: '导出设置',
        importButton: '导入设置',
        allOffButton: '全部关闭',
        restoreButton: '恢复',
        pformanceButton: 'PFormance',
        refreshNotice: '部分设置需刷新页面后生效',
        toolashaTabTitle: (p) => `⚙️ Toolasha ${p.version ? `v${p.version} ` : ''}设置（刷新后生效）`,
        nativeSettingsTabTitle: '设置',
        copySettingsToTitle: '复制设置至',
        cancelButton: '取消',
        copySettingsConfirmButton: '复制设置',
        characterFallbackName: (p) => `角色 ${p.id}`,
        fetchingStatus: '⏳ 获取中…',
        updatedStatus: '✅ 已更新！',
        failedStatus: '❌ 失败',
        errorStatus: '❌ 错误',
        onlyOneCharacterAlert: '你只有一个角色，该角色的设置已保存。',
        syncSuccessAlert: (p) => `设置已复制到 ${p.count} 个角色！`,
        syncFailureAlert: (p) => `复制设置失败：${p.error}`,
        unknownErrorFallback: '未知错误',
        resetConfirm: '将所有设置重置为默认值？此操作无法撤销。',
        resetDoneAlert: '设置已重置为默认值，请刷新页面。',
        messageTextLabel: '消息文本：',
        clickVariableHint: '点击变量以插入到光标位置：',
        saveButton: '保存',
        editTemplateButton: '编辑模板',
        addTextButton: '+ 添加文本',
        enterTextPrompt: '请输入文本：',
        restoreDefaultButton: '恢复默认',
        resetTemplateConfirm: '将模板重置为默认值？这会丢弃当前模板。',
        templateItemsHeader: '模板项目（拖动以重新排序）：',
        addVariableHeader: '添加变量：',
        removeTooltip: '移除',
        customPriceOverridesTitle: '自定义价格覆盖',
        customPriceOverridesHelp:
            '为物品设置自定义购买/出售价格。留空则使用市场价格。被覆盖的价格会在利润显示中标注 *。',
        itemSearchPlaceholder: '搜索物品…',
        itemLabel: '物品',
        enhLabel: '强化',
        buyPriceLabel: '购买价',
        sellPriceLabel: '出售价',
        noOverridesMessage: '暂无自定义价格覆盖，请使用上方搜索栏添加物品。',
        clearAllButton: '全部清除',
        manageOverridesButton: (p) => `管理覆盖项${p.count > 0 ? `（${p.count}）` : ''}`,
        configureButtonDefault: '配置…',
        unknownSettingType: (p) => `未知类型：${p.type}`,
        ironCowTitle: '铁牛模式',
        ironCowDescActive:
            '禁用所有市场与利润相关功能。<span style="color:#d4900a;font-weight:600;">已开启——市场功能已锁定。</span>',
        ironCowDescInactive: '禁用所有市场与利润相关功能，用于无市场玩法。',
        enhanceSimStatsHeader: '计算属性统计',
        enhanceSimEffectiveLevel: '有效等级：',
        enhanceSimToolSuccess: '工具成功率：',
        enhanceSimSpeed: '速度：',
        enhanceSimDrinkConc: '饮品浓度：',
        enhanceSimRareFind: '稀有发现：',
        enhanceSimExperience: '经验：',
        enhanceSimStatsUnavailable: '统计数据不可用（游戏数据未加载）',
        importSuccessAlert: (p) =>
            `设置导入成功（已导入 ${p.imported} 项${p.skipped > 0 ? `，跳过了其他角色的 ${p.skipped} 项` : ''}），请刷新页面。`,
        importFailedFormatAlert: '导入设置失败，请检查文件格式。',
        importFailedAlert: '导入设置失败。',
        clearAllOverridesConfirm: '移除所有自定义价格覆盖？',
    },
};
