# 更新影响评估与兼容性说明

> 核心结论：**本封装不修改上游 dsh 的任何文件**。dsh 以官方 npm 包（`@deepseek-ai/dsh`）原样运行，
> 桌面壳通过公开 CLI 契约（`dsh web` 命令）交互，主题插件通过官方插件机制接入用户 profile——
> 三层解耦，上游更新 = 换一个 npm 包版本，封装层完全旁路。
> 以下是对着 `deepseek-harness/`（0.1.1-rc.2 源码克隆）逐项验证过的依赖清单与失效预案。

## 一、改动清单

### 1. 桌面壳 `desktop/`（对上游：零修改，纯旁路）

| 文件 | 职责 |
|------|------|
| `main.js` | CLI 定位与版本读取、`dsh web` 子进程管理、标题栏药丸/拖拽条注入、主题联动、下载接管、托盘、更新检测 |
| `preload.js` | 页面 ↔ 主进程桥（主题上报、更新检测），contextIsolation + sandbox |
| `splash/index.html` | 启动页（深色 + 动图 + 版本号） |
| `assets/theme.css` | 壳自有样式（版本徽标深浅配色） |
| `assets/icon.*`、`assets/anime/*.gif` | 图标与启动页动图素材 |
| `package.json` / `.npmrc` | Electron 壳定义（npmmirror 镜像） |

### 2. 主题插件 `dsh-anime-theme/`（对上游：零修改，走官方插件机制）

| 文件 | 职责 |
|------|------|
| `package.json` | `dsh.client` 声明 + `dsh.bundle.patch` + `exports["./client"]` |
| `cordis.patch.yml` | bundle patch：把插件挂进 cordis 插件树 |
| `client-src.js` → `lib/client.js` | 浏览器端：壁纸/玻璃面板/调色/挂件/粒子/主题面板 |
| `lib/index.js` | 宿主侧占位插件（使包成为 loader entry） |
| `build.mjs` | 素材内嵌构建脚本 |
| `assets/wallpapers`、`assets/anime/*` | 壁纸与动图素材 |

### 3. 部署态（不入 git，更新 dsh 时需留意）

| 位置 | 内容 |
|------|------|
| `~/.dsh/profiles/web/package.json` | `dsh.profile.bundles` 追加了 `dsh-anime-theme` |
| `~/.dsh/profiles/node_modules/dsh-anime-theme/` | 插件部署副本 |
| `%APPDATA%\DeepSeek Harness\desktop-settings.json` | 壳设置（关闭行为等） |
| 桌面快捷方式 `DeepSeek Harness.lnk` | 指向 win-unpacked 或安装版 |

### 4. 已删除（被本方案取代）

`dsh-desktop.ps1`、`setup-shortcut.ps1`、旧 `package.json`（Chrome App Mode 方案）。

## 二、依赖锚点比对表（已对照 0.1.1-rc.2 源码逐一验证）

稳定性评级：**高** = 官方文档化机制/语义化命名；**中** = 内部实现细节，大版本重构才可能变。

| # | 依赖锚点 | 使用方 | 上游源码位置 | 稳定性 | 失效表现 |
|---|---------|--------|-------------|--------|---------|
| 1 | `dsh web --no-open --port N` | 壳启动服务 | `apps/cli/src/args.ts`、`packages/bundle/web-app` | 高（文档化公开命令） | 壳报错弹窗，服务可手动起 |
| 2 | `lib/bin.js` 包入口 + npx 缓存/全局/profiles 定位 | 壳 CLI 解析 | `@deepseek-ai/dsh` package.json `bin` | 高 | 回退 npx 兜底 |
| 3 | `data-ds-dark-theme` 属性 | 壳深浅联动、插件 CSS 作用域 | `ui-theme/src/boot-theme.ts`、`theme-presenter.ts` | 高（官方主题机制） | 标题栏配色不切换、主题不跟深浅 |
| 4 | `__ModuleLoader__.load({id,factory})` | 插件加载 | `client-modules/src/index.ts` | 中高（0.1.x 稳定） | 主题整体失效，**dsh 本身正常** |
| 5 | `dsh.client` 声明 + `exports["./client"|"./package.json"]` | 插件打包契约 | `client-modules/src/index.ts` | 中高 | 插件被静默跳过（boot 图无记录） |
| 6 | `cordis.patch.yml` insert 语法 | bundle 注册 | `app-boot/src/profile.ts` | 中高 | 同 5 |
| 7 | `--dsw-static-*` / `--dsw-alias-*` token | 调色与玻璃色板 | `ui-theme/src/styles/design-platform.css` | 中 | 调色失效，壁纸/挂件/布局仍在 |
| 8 | `[class*="sidebarCol"|"frame"]` | 玻璃化 surface | `ui-layout/src/client/AppFrame.module.css`（源码语义名，哈希不影响 `class*=` 匹配） | 中 | 玻璃卡片失效 |
| 9 | `[data-composer-card]`、`[data-conversation-scroll]`、`[data-phase]` | 同上 | `ui-conversation`（语义化 data 属性） | 高 | 同 8 |
| 10 | `[class*="sessionLogButton"]` | 标题栏药丸化 | **独立官方插件** `dsh-session-log-export` 的 CSS module | 中 | 按钮回原生位置（会被系统按钮遮住，即原始问题） |
| 11 | `[data-slot="settings.trigger"]` | （已弃用的挂载点，现用标题栏） | `ui-settings-general` | 高 | 无影响 |
| 12 | `button[class*="brand"]` | 版本徽标锚点 | `ui-layout` 品牌区 | 中 | 徽标不出现，重试后静默放弃 |

## 三、更新场景与影响推演

### 场景 A：dsh 小版本更新（0.1.1-rc.x → 0.1.x / 0.1.2）

**预期影响：无。** 上表高稳定项不会变；壳与插件无需任何改动。
操作：点版本徽标更新，或 `npx -y @deepseek-ai/dsh@latest`，重启即可。

### 场景 B：dsh 大版本更新（0.2 / 1.0）

可能变动的按风险排序：#5/#4/#6（插件协议）> #7/#8（token 与类名）> #3。
**关键保底设计**：任何一项失效都只影响"主题外观"，dsh 本体与桌面壳完全正常；
面板里「关闭主题（恢复原生）」一键回到原生界面，不影响使用。

### 场景 C：壳自身更新

与 dsh 完全解耦。壳只依赖 Node.js 与 Electron。

## 四、dsh 更新操作手册

1. （可选备份）`copy ~/.dsh/profiles/node_modules/dsh-anime-theme %TEMP%\`
2. 更新 dsh：版本徽标点击更新，或手动 `npx -y @deepseek-ai/dsh@latest web`（会刷新 npx 缓存）
3. 重启桌面应用，按此清单检查：
   - [ ] 服务启动、窗口出现（锚点 1/2）
   - [ ] 壁纸/挂件/面板在（锚点 4/5/6 —— 若 boot 图无插件见下）
   - [ ] 深浅切换正常（锚点 3）
   - [ ] 设置抽屉、Session log 正常（锚点 8/10）
4. 主题失效时的定位顺序：
   - `curl http://127.0.0.1:3188/plugins/dsh-anime-theme/client.js` 非 200 → 协议/契约变了（锚点 4/5/6），按新协议改 `client-src.js` 重新 build
   - 200 但样式不对 → token 或选择器变了（锚点 7/8/9），改 `buildCss` 对应规则
5. 终极兜底：面板「关闭主题（恢复原生）」，dsh 回归原生界面，不影响任何使用

## 五、与上游的隔离边界（为什么这是"封装"而不是"魔改"）

- 不修改上游源码：上游以 npm 发布包原样运行（`deepseek-harness/` 克隆仅作只读参考）
- 不 fork 上游组件：所有界面增强（壁纸/玻璃/挂件/粒子）都是**旁路 CSS + 自有 DOM 节点**
- 不劫持上游数据流：下载、设置、会话全部走 dsh 原生机制，壳只做"保存位置 + 通知"
- 插件走官方 `dsh.client` + bundle 机制，与官方插件（如 `dsh-session-log-export`）同一接入方式
