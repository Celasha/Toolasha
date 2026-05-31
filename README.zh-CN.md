# Toolasha

![版本](https://img.shields.io/badge/version-2.58.3-orange?style=flat-square) ![状态](https://img.shields.io/badge/status-pre--release-yellow?style=flat-square) ![许可](https://img.shields.io/badge/license-CC--BY--NC--SA--4.0-blue?style=flat-square)

一款模块化用户脚本，为 [Milky Way Idle](https://www.milkywayidle.com/game) 增强生活质量功能，包括市场工具、战斗统计、炼金追踪和全面的游戏数据叠加显示。

**📚 [文档](DOCUMENTATION.md)** | **📝 [更新日志](CHANGELOG.md)** | **🤝 [贡献指南](CONTRIBUTING.md)**

---

## 关于

Toolasha 是对热门 MWITools 用户脚本的完全重写，采用现代 JavaScript 架构从零构建。所有功能均为模块化设计，可通过游戏内设置面板单独启用或禁用。

## 功能

### 🏪 市场与经济

- **市场价格** — 物品提示中显示 24 小时均价
- **利润计算** — 制作成本与利润率，支持保守/混合/乐观三种定价模式
- **净资产显示** — 实时资产估值
- **背包排序** — 按价值、类型或自定义条件排序背包
- **挂单时长** — 市场挂单的预估时长
- **队列长度预估** — 市场订单的预估等待时间
- **交易历史** — 查看近期交易活动
- **自动填充价格** — 根据市场数据自动填充买卖价格
- **订单总计** — 显示未完成订单的总价值
- **贤者赌博计算器** — 计算贤者之石赌博的预期利润

### ⚔️ 战斗与副本

- **装备评分** — 装备上显示装备评分
- **战斗统计** — 战斗面板中的详细统计标签页
- **战斗摘要** — 战斗返回后的完整属性分解
- **副本追踪器** — 通关时间、波次进度和队伍统计
- **迷宫追踪器** — 按怪物类型追踪最高击败等级
- **能力触发** — 显示能力触发条件
- **装备配置显示** — 装备配置中显示强化等级
- **战斗模拟器集成** — 将角色数据直接导入 Shykai 战斗模拟器

### ⚗️ 炼金

- **炼金利润显示** — 转化和铸币行动的利润计算器
- **转化历史** — 记录并显示转化会话历史
- **铸币历史** — 记录并显示铸币会话历史，含催化剂追踪

### 🔨 强化与制作

- **强化追踪器** — 每次会话的成功率和成本追踪
- **强化模拟器** — 最优策略计算器，含成本预估
- **强化里程碑** — 达到关键强化等级所需的预期成本和经验
- **生产利润** — 制作的材料成本和利润明细
- **最大可生产量** — 显示当前材料可制作的数量

### 📋 任务与行动

- **行动队列时间** — 已排队行动的总完成时间
- **任务利润显示** — 每个任务的奖励价值计算
- **任务效率评级** — 按每小时代币或金币对任务进行排名
- **任务重随追踪器** — 追踪累计重随成本
- **任务排序** — 按技能或时间自动排序任务
- **任务图标** — 任务卡片上的视觉图标，含副本指示器
- **任务背包高亮** — 灰显当前任务不需要的背包物品
- **任务统计** — 已完成任务的汇总统计
- **快速输入按钮** — 1 / 10 / 100 / 最大数量的预设按钮
- **技能书计算器** — 达到目标技能等级所需技能书

### 📊 技能与经验

- **经验速率显示** — 技能条上显示经验/小时速率
- **距下一级时间** — 技能提示中显示预估升级时间
- **剩余经验** — 技能条上显示到下一级所需剩余经验
- **经验百分比** — 到下一级的进度百分比

### 💬 聊天

- **弹出聊天窗口** — 可分离的聊天窗口，支持多频道分屏视图
- **提及追踪** — 被提及时显示徽章提示
- **聊天命令** — `/item`、`/wiki`、`/market` 快速导航命令
- **屏蔽列表** — 在弹出聊天中过滤已屏蔽玩家的消息

### 🏠 房屋

- **升级成本** — 显示房间升级成本及当前市场价格

### 🧭 导航

- **Alt+点击导航** — Alt+点击物品可跳转到其制作行动、采集区域或市场页面
- **收藏品导航** — 收藏品面板物品上的导航按钮
- **词典** — 物品词典，支持快速查找

### 🔔 通知

- **队列空闲提醒** — 行动队列为空时浏览器通知

### 🎨 界面增强

- **装备等级显示** — 物品图标上显示强化等级
- **背包徽章** — 背包物品上显示价格和数量徽章
- **炼金物品灰显** — 灰显低于你技能等级的炼金物品
- **图标关键信息** — 物品图标上叠加上下文信息
- **外部工具链接** — 从相关面板快速跳转到外部工具
- **颜色自定义** — 14 项可配置的界面颜色选项

## 安装

### 前置条件

- **浏览器**：Chrome、Firefox 或 Edge，需安装 [Tampermonkey](https://www.tampermonkey.net/)
- **Steam**：无需额外扩展——使用游戏内置扩展管理器从 [Greasy Fork](https://update.greasyfork.org/scripts/562662/Toolasha.user.js) 安装

### 从 Greasy Fork 安装（推荐）

1. 访问 [Toolasha on Greasy Fork](https://greasyfork.org/en/scripts/562662-toolasha)
2. 点击 **Install this script**
3. Tampermonkey 会提示确认安装
4. 访问 [Milky Way Idle](https://www.milkywayidle.com/game) — Toolasha 自动加载

### 从 GitHub Release 安装

1. **下载最新版本**
    - 访问 [Releases 页面](../../releases)
    - 下载最新版本的 `Toolasha.user.js`

2. **在 Tampermonkey 中安装**
    - 点击下载的文件，或
    - 打开 Tampermonkey 管理面板 → 实用工具 → 从文件导入

3. **打开游戏**
    - 前往 [Milky Way Idle](https://www.milkywayidle.com/game)
    - Toolasha 自动加载

> 入口文件会自动从 GitHub raw URL 加载所需的代码库。

### 从源码安装

```bash
git clone https://github.com/Celasha/Toolasha.git
cd Toolasha
npm install
npm run build:dev
# 在 Tampermonkey 中安装 dist/Toolasha-dev.user.js
```

## 使用

### 访问设置

1. 打开游戏 [milkywayidle.com/game](https://www.milkywayidle.com/game)
2. 点击你的**角色图标**（屏幕右上角）
3. 点击**设置**
4. 在设置菜单中点击 **Toolasha** 标签页
5. 按需启用/禁用功能——设置自动保存

### 故障排除

如果功能不工作：

1. **刷新页面**——部分功能启用后需要刷新页面
2. **检查浏览器控制台**——查找 `[Toolasha]` 错误信息（F12 → Console）
3. **确认扩展已启用**——检查扩展管理器图标
4. **报告问题**——[提交 issue](../../issues) 并提供详细信息

## 开发者指南

Toolasha 采用现代 JavaScript（ES6+）构建，使用模块化、功能驱动的架构。欢迎贡献！

### 快速开始

```bash
npm install           # 安装依赖
npm run build:dev     # 构建开发版独立用户脚本
npm run build         # 构建生产版代码库 + 入口文件
npm run dev           # 监听模式（自动重新构建）
npm test              # 运行测试套件（247 个测试）
```

### 文档

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 贡献指南与开发流程
- **[AGENTS.md](AGENTS.md)** — AI 编程助手开发者指南
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — 系统架构与设计模式
- **[DOCUMENTATION.md](DOCUMENTATION.md)** — 完整文档索引

### 核心技术

- **构建**：Rollup + ES6 模块
- **测试**：Vitest，247 个测试用例
- **存储**：IndexedDB，带防抖写入
- **代码质量**：ESLint + Prettier，提交前自动检查
- **CI/CD**：GitHub Actions，自动发布

## 项目结构

```
Toolasha/
├── src/
│   ├── core/                      # 核心系统（存储、配置、WebSocket、数据管理）
│   ├── features/                  # 功能模块
│   │   ├── actions/              # 行动面板增强
│   │   ├── alchemy/              # 炼金利润与历史追踪
│   │   ├── chat/                 # 聊天增强与弹出窗口
│   │   ├── combat/               # 战斗统计、副本追踪器、迷宫
│   │   ├── combat-sim-integration/ # Shykai 战斗模拟器集成
│   │   ├── combat-stats/         # 详细战斗统计
│   │   ├── enhancement/          # 强化优化器与追踪器
│   │   ├── house/                # 房屋升级成本
│   │   ├── inventory/            # 背包徽章与排序
│   │   ├── market/               # 市场工具与利润计算
│   │   ├── navigation/           # Alt+点击与快速导航
│   │   ├── notifications/        # 浏览器通知
│   │   ├── profile/              # 角色信息与装备评分
│   │   ├── skills/               # 经验速率与等级追踪
│   │   ├── tasks/                # 任务效率与排序
│   │   └── ui/                   # 界面增强与叠加层
│   ├── api/                       # 外部 API 集成
│   ├── libraries/                 # 模块打包入口
│   └── utils/                     # 共享工具函数
├── dist/                          # 构建输出（git 忽略）
└── docs/                          # 文档
```

## 测试

```bash
npm test                    # 运行所有测试
npm run test:watch          # 监听模式
npm test -- --coverage      # 覆盖率报告
```

247 个测试用例，14 个测试套件，每次提交均通过自动化 CI/CD 流水线验证。

## 许可与致谢

**许可协议**：[CC-BY-NC-SA-4.0](LICENSE)

**原作者**：bot7420（MWITools）
**重写与维护**：Celasha 和 Claude
