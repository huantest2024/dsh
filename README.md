# DeepSeek Harness Desktop（Electron 桌面版 + 二次元主题插件）

<img width="1920" height="1032" alt="界面展示" src="https://github.com/user-attachments/assets/6cad80af-cafe-48cd-9da9-0fd521598aee" />

> 把 DeepSeek Harness Web 端打包成**真正的桌面应用**：独立 Electron 窗口（不再是浏览器 App Mode 网页），
> 启动时自动拉起 `dsh web` 服务、关闭窗口自动回收进程。
> **更新安全性**：不修改上游任何文件，dsh 更新不影响封装——依赖锚点比对与失效预案见
> [UPGRADE-NOTES.md](UPGRADE-NOTES.md)。

二次元视觉主题按 dsh「一切皆插件」的理念做成**标准 dsh 插件** `dsh-anime-theme`（见 `dsh-anime-theme/`），
桌面壳只负责窗口 chrome 与系统集成，两者解耦。

> 上游官方仓库 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，
> 最新源码已克隆到 `deepseek-harness/`（不入库），当前克隆版本 0.1.1-rc.2；
> 桌面壳优先调用本机已安装的同版本 CLI，与源码构建产物等价。

## 特性

### 桌面壳（desktop/）

- 🖥️ **真桌面窗口**：Electron 原生窗口 + 自有图标/任务栏标识
- 🌗 **一体化标题栏**：隐藏原生标题栏，深/浅主题自动切换标题栏与窗口按钮配色
- 🔢 **版本徽标 + 版本说明中心**：头部显示 `v0.1.1-rc.2`，**点击打开版本说明弹窗**——
  当前版本的官方更新说明（GitHub Releases，中文优先）+ 可展开的历史版本说明 + 检查更新入口；
  检测拉全渠道 packument（含 `latest` / `next` / `alpha` 标签——上游 alpha 线不进 latest，
  只查 `/latest` 会漏检）
- ⏳ **更新断点续传**：点「立即更新」后可随时关闭弹窗，安装自动转后台继续；
  再点版本徽标即回到实时进度（含已累积日志回放）；重启生效始终由用户确认
- 📝 **版本说明弹窗**（`notes.html`）：拉取官方 GitHub Releases 渲染当前版本说明
  （中文段优先、自动截断英文段），历史版本逐条折叠展开；结果落盘缓存，
  断网时用缓存兜底并标注
- 🛟 **坏更新自动回退**：启动时若「应用内更新运行时」起不来（如新版本与旧 profile
  数据不兼容），自动清除该运行时并回退原 CLI 重试一次，弹窗说明原因
- 📌 **托盘运行**：首次关闭询问「最小化到托盘 / 直接退出」可记住选择，托盘菜单可改
- ⚡ **服务自管理**：自动定位并启动 `dsh web`，退出时整棵进程树回收
- 🚀 **启动页**：ZCode 深色 + 随机动图卡片 + 版本号

### 二次元主题插件（dsh-anime-theme/）

- 🌸 **整套主题接管**（参考 Vencord / DSH-Transparent-UI 等高分主题插件的手法）：
  深浅两套配色全覆盖——壁纸全屏铺底，侧栏与输入框变成悬浮玻璃卡片
  （圆角 + 毛玻璃 blur + 描边 + 内高光），对话区透明透出壁纸
- 🎨 **主题面板**：标题栏椭圆形药丸按钮（`Session log` 胶囊 + 🎨 圆钮，玻璃底 + hover），面板从其正下方下拉展开
  - 预设一键切换（选中状态回显，单独调整后自动脱离预设）：阿尼亚 / 莉可丽丝 / **约尔** / **艾莉莎** / 极简 / 关闭主题（恢复原生）
  - 壁纸 12 款（≥2K 高清）：木屋 / **锦鲤 / 蔷薇 / 樱雪 / 草原 / 蕾丝 / 紫绫** / **幽梦 / 花眠 / 银姬 / 花信 / 浮光** + **📎 上传自定义壁纸**（可多选，自动压缩，多张管理）
  - 挂件 8 套 26 个动图：随机 / 阿尼亚 / 莉可丽丝 / **约尔 / 艾莉莎 / 百花 / 败犬 / 魔女 / 邻家** / **我的（📎 上传自定义 GIF）** / 无，大小三档
  - 自定义壁纸 / 挂件均为**缩略图管理**：点击选用（蓝框回显）、悬停 ✕ 单独删除；删除选中项自动回退默认
  - 浓度（深 / 中 / 浅）联动壁纸遮罩与药丸底色；**粒子动效**三样式（樱花 / 萤火 / 落雪）可开关可选
  - 面板配色跟随 dsh 原生深浅主题自动切换；✕ 或点击空白处关闭；设置存 localStorage，实时生效、刷新重启保留
- 📤 **原生功能保全**：Session log 导出按钮收进标题栏一行式布局
  （`Session log | 🎨 | 最小化 | 最大化 | 关闭`），下载静默存入系统下载目录并托盘气泡提示；
  窗口内导航限制、缩放快捷键齐备
- 🐱 **右下角随机动图挂件**，每次启动换一个
- 🧩 **自动扩展**：往 `assets/wallpapers/` 丢 jpg、往 `assets/anime/<套装名>/` 丢 gif，
  `node build.mjs` 后新壁纸/新套装自动出现在面板里

## 下载安装（GitHub Releases）

安装包与便携版发布在本仓库 GitHub [Releases](https://github.com/huantest2024/dsh/releases) 页：

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `DSH-Desktop-Setup-<v>.exe` | NSIS 安装包（可选安装目录，卸载保留数据） |
| Windows | `DSH-Desktop-Portable-<v>.exe` | 单文件便携版 |
| Windows | `DSH-Desktop-Windows-<v>-x64.zip` | 便携 ZIP（解压即用） |
| macOS | `DSH-Desktop-macOS-<v>-<arch>.dmg` | 安装包（x64 / arm64） |
| macOS | `DSH-Desktop-macOS-<v>-<arch>.zip` | 便携 ZIP |

- 两平台都**需要本机已装 Node.js**（跑 dsh 服务本身）
- mac 版未做开发者签名：首次打开用访达右键 →「打开」，或
  `xattr -cr "/Applications/DeepSeek Harness.app"` 清除隔离属性
- 新版本发布方式：合并代码后打 `v*` 标签推送，GitHub Actions 自动双平台构建并更新 Release

## 快速开始

### 1. 桌面壳

```powershell
cd desktop
npm install        # 首次；走 .npmrc 里的 npmmirror 镜像
npm start          # 开发模式
npm run dist       # 打包：release\DSH-Desktop-Setup-*.exe / Portable-*.exe，
                   #      并自动把 CHANGELOG.md 复制为 release\版本更新说明.md
```

### 2. 二次元主题插件（安装到 web profile）

本机没有 pnpm 也能装（插件源码在 `dsh-anime-theme/`，产物已构建），手动安装：

```powershell
# 1) 拷贝插件包到 profile 的 node_modules
Copy-Item -Recurse -Force dsh-anime-theme "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-anime-theme"

# 2) 在 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 数组里追加 "dsh-anime-theme"
```

重启桌面应用即生效（插件集变更需重启 dsh 服务）。验证：
`http://127.0.0.1:3188/plugins/dsh-anime-theme/client.js` 返回 200。

改过插件素材后重新构建：`cd dsh-anime-theme && node build.mjs`，再拷贝 `lib/client.js` 到 profile 并重启。

## 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_PORT` | `3188` | Web 服务端口 |
| `DSH_HOME` | `~/.dsh` | DeepSeek Harness 数据目录 |
| `DSH_CLI_PATH` | 自动检测 | 直接指定 dsh CLI 的 `bin.js` 路径 |
| `DSH_NODE_PATH` | 自动检测 | 直接指定 node 可执行文件路径（win: node.exe；mac: node） |
| `DSH_NPM_REGISTRY` | `https://registry.npmmirror.com` | 更新检测/安装使用的 npm registry |

CLI 定位顺序：应用更新运行时（`userData\dsh-runtime`）→ `DSH_CLI_PATH` → npx 缓存
→ 全局 npm → `~/.dsh/profiles` → 兜底 `npx -y @deepseek-ai/dsh@latest`。

桌面设置（关闭行为等）：开发模式在 `desktop/desktop-settings.json`，
打包后在 `%APPDATA%\DeepSeek Harness\desktop-settings.json`。

## 目录结构

```
DSH/
├── deepseek-harness/    # 上游源码克隆（不入库）
├── dsh-anime-theme/     # 二次元主题 dsh 插件（标准 dsh.client + dsh.bundle 结构）
│   ├── build.mjs        # 生成 lib/client.js（内嵌壁纸/动图 base64）
│   ├── assets/          # 壁纸 + 动图素材（可自行增删 GIF 后重新 build）
│   ├── lib/index.js     # 宿主侧插件（无逻辑，仅为 loader entry）
│   ├── lib/client.js    # 浏览器端：壁纸/玻璃面板/挂件（__ModuleLoader__ 工厂格式）
│   └── cordis.patch.yml # bundle patch：把插件挂进 cordis 插件树
└── desktop/             # Electron 桌面壳
    ├── main.js          # 主进程：CLI 定位 / 服务管理 / 主题上报 / 更新 / 托盘
    ├── preload.js       # 页面 ↔ 主进程桥（主题上报、更新检测）
    ├── update.html      # 可视化更新弹窗（发现 / 进度+实时日志 / 完成 / 失败）
    ├── update-preload.js# 更新弹窗 ↔ 主进程桥（事件订阅 + 安装/重启/关闭）
    ├── notes.html       # 版本说明弹窗（当前版本官方说明 + 历史版本折叠）
    ├── CHANGELOG.md     # 桌面壳版本迭代更新说明（打包时复制进 release）
    ├── scripts/         # 打包收尾脚本（复制版本说明进产物目录）
    ├── splash/          # 启动页
    ├── assets/theme.css # 壳自有样式（版本徽标深浅配色）
    └── release/         # 打包产物（gitignore）
```

## 插件机制备忘（踩坑记录）

- 包必须声明 `dsh.client`（package.json）+ `exports["./client"]` 指向浏览器产物；
  **exports 里必须包含 `"./package.json"`**，否则 host 解析包清单时
  `ERR_PACKAGE_PATH_NOT_EXPORTED`，插件被静默跳过（boot 图无此插件、/plugins/ 404）
- 浏览器产物必须是 `window.__ModuleLoader__.load({ id, factory })` 工厂注册格式
- 插件集变更需重启 `dsh web`；样式插入顺序早于官方样式表时用 `html body[...]` 提特异性
- 深浅色由 dsh 原生主题驱动（`~/.dsh/settings.yaml` 的 `ui-theme.preference`），
  主题 CSS 全部限定在 `body[data-ds-dark-theme]` 作用域下

## 与上游官方仓库的关系

上游官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
（npm 包 `@deepseek-ai/dsh` 即由此发布）。官方只提供 CLI / Web UI，没有官方桌面端；
本仓库的桌面壳（Electron 封装、更新机制、主题插件）均为自研薄封装，不修改上游任何文件。

上游源码运行方式（见官方 README）：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`deepseek-harness/` 目录为上游仓库的克隆（不入库，作依赖锚点比对参考），
当前克隆版本 0.1.1-rc.2；日常运行走官方 npm 版，两者等价。

## 桌面壳设计说明与路线图

已落地的壳层设计要点：

- **窗口内导航限制**：`will-navigate` 只放行本机服务与启动页；弹新窗口/外链仅转发
  `http(s)` 给系统浏览器，其余（UNC 路径、自定义协议等畸形地址）拦截并落日志，
  避免把垃圾字符串交给 ShellExecute 弹「Windows 找不到」错误框
- **缩放快捷键**：`Ctrl+=` / `Ctrl+-` / `Ctrl+0`
- **backdrop-filter 兼容坑**：含 fixed 弹层（如设置抽屉）的容器必须摘除 blur，
  否则 fixed 包含块被劫持、抽屉被压进侧栏宽度（同 Aqua 插件的 `:has` 兼容做法）

更重的工程化设计（当前单机自用暂不引入，作为路线图）：

| 方向 | 做法 | 引入条件 |
|------|-----------|---------|
| 免 Node 运行时 | 内置 node/pnpm 运行时 + `app.asar.unpacked` 物理依赖 | 需要分发给无 Node 环境的同事时 |
| generation 生命周期 | 窗口/托盘/监听/子进程按代持有，切换 profile 整代 dispose | 引入多 profile 切换时 |
| 插件市场 | 内置 dsh-community-market，开放插件数据源 Schema | 想在应用内发现/安装插件时 |
| 恢复诊断页 | 渲染进程健康检查 + 独立沙箱恢复窗口 | 追求开箱即用健壮性时 |
| 固定上游 + patches | 上游子模块固定版本原样运行，升级=换 pin | 当前用官方 npm 版已等价 |

## 注意事项

- 需要本机已装 Node.js（跑 dsh 服务本身；mac 推荐 `brew install node`）
- mac 版登录预热（开机预启服务）不可用（依赖 Windows Run 键），首开需等服务冷启动
- 深/浅色偏好：改 `~/.dsh/settings.yaml` 的 `ui-theme.preference`（dark/light/system）
- 多实例：默认单实例锁，重复启动只会聚焦已有窗口
