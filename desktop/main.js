/**
 * DeepSeek Harness Desktop（Electron 桌面版）
 *
 * 职责：
 *  1. 解析本机 dsh CLI（环境变量 → npx 缓存 → 全局 npm → ~/.dsh/profiles → npx 兜底）
 *  2. 以子进程方式启动 `dsh web --no-open --port <port>`，退出时连带杀掉整棵进程树；
 *     登录时经 HKCU Run 键无窗口预启一份服务（wscript + helper），启动时探活直接采纳，
 *     开机首次打开免等服务冷启动（runtime 2.5 万文件过杀软扫描曾是 18s 大头）；
 *     登录预热机制依赖 Run 键/wscript，仅 Windows，mac 跳过（更新预热仍可用）
 *  3. 主窗口先显示本地启动页（入场动画 + 实时耗时计时），服务就绪后整页淡出过渡到 Web UI
 *  4. 向 Web UI 注入 ZCode 风格深色调色与二次元挂件（随机动图，每次启动换一个）
 */

const { app, BrowserWindow, WebContentsView, Tray, Menu, dialog, ipcMain, nativeTheme, shell, screen } = require('electron')
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const net = require('net')
const os = require('os')
const path = require('path')

// GPU 服务并入主进程（实测生效）：Electron 进程组 4 → 3（主进程/渲染/网络服务）。
// CDP 抓图验证主题壁纸、挂件 GIF、萤火粒子渲染正常；代价是 GPU 驱动故障会连带
// 整个应用而非仅图形进程，本地工具可接受。网络服务进程无法合并
// （NetworkServiceInProcess 与 --network-service-in-process 在 Chromium 130 实测均无效）
// GPU 独立进程（曾短暂启用进程内合并后撤销）：实测 in-process-gpu 下
// 「带 y 偏移的双 BrowserView」布局会把整个窗口的真实鼠标输入吞掉——OS 层点击
// 点名本窗口，但三个 webContents（主窗/bar/内容页）全部收不到 mousedown，
// CDP 合成输入却正常（变体实验实锤，去掉该开关后真实输入恢复）。
// 代价：进程组 3 → 4；收益：输入正确 + GPU 故障不再连带整个应用。
// 若未来 Electron 修复，重开前必须用「真实鼠标点击内容区」回归验证。
// app.commandLine.appendSwitch('in-process-gpu')

// ---------------------------------------------------------------- 常量与工具

const PROCESS_START = Date.now()

const APP_ROOT = __dirname
const ASSET_DIR = path.join(APP_ROOT, 'assets')
const ANIME_DIR = path.join(ASSET_DIR, 'anime')
// 打包后 APP_ROOT 在只读 app.asar 内，日志必须写到用户数据目录
const LOG_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'logs')
  : path.join(APP_ROOT, 'logs')
const USER_DATA_DIR = app.isPackaged ? app.getPath('userData') : APP_ROOT
const SETTINGS_FILE = path.join(USER_DATA_DIR, 'desktop-settings.json')
const RUNTIME_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'dsh-runtime')
  : path.join(APP_ROOT, 'dsh-runtime')
// 登录预热（冷启动优化）：开机时隐藏预启一份 dsh web，应用启动时直接采纳
const PRESTART_STATE_FILE = path.join(USER_DATA_DIR, 'dsh-prestart-state.json')
const PRESTART_HELPER_JS = path.join(USER_DATA_DIR, 'dsh-prestart.js')
const PRESTART_VBS = path.join(USER_DATA_DIR, 'dsh-prestart.vbs')
const PRESTART_SERVER_LOG = path.join(LOG_DIR, 'prestart-server.log')
// 服务常驻化后应用自身 spawn 的服务也走分离模式，stdout/stderr 直写此文件
// （管道 stdio 在应用退出后断管，文件 stdio 让服务在应用会话外存活）
const SERVICE_STDOUT_LOG = path.join(LOG_DIR, 'service-stdout.log')
// 服务看门狗脚本（交接时写入 userData，应用自身 exe 以 node 模式拉起）
const SERVICE_WATCHDOG_JS = path.join(USER_DATA_DIR, 'dsh-service-watchdog.js')
const PRESTART_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const PRESTART_RUN_NAME = 'DeepSeekHarnessPrestart'
// 更新回退锚点：runInstall 前写入「更新前版本」，新版本启动失败时据此恢复到同版本线
// （避免倒退到更旧的 npx 缓存版本、读不了已前向迁移的会话数据）；正常启动后删除
const ROLLBACK_FILE = path.join(USER_DATA_DIR, 'dsh-update-rollback.json')
const NPM_REGISTRY = process.env.DSH_NPM_REGISTRY || 'https://registry.npmmirror.com'
// 平台分支：进程树回收、端口/进程探测、CLI 与 node 候选路径、登录预热注册
// 按平台走不同实现（win: taskkill/netstat/tasklist/Run 键；mac: kill/lsof/ps）
const IS_WIN = process.platform === 'win32'

// 自绘顶栏（shell bar）：窗口控制按钮 + 拖拽区 + 🎨 主题入口独占一行，
// dsh web 在下方内容区完全原生渲染（不再注入任何布局调整）
const BAR_HEIGHT = 30
const BAR_THEMES = {
  dark: { bg: '#181818', fg: '#9aa0a6' },
  light: { bg: '#f3f3f3', fg: '#55555a' },
}
// 顶栏强调色缓存：内容页全局主题（dsh-anime-theme）的 --dsh-anime-accent 镜像，
// ''=无全局主题色（bar 回退深浅配色）。theme-changed 推 bar-theme 时随载荷带上
// （不阻塞深浅切换），异步读到新值后再另推 bar-accent 事件刷新
let barAccentCache = ''

// ---------------------------------------------------------------- 桌面设置

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
  } catch (err) {
    log(`写入设置失败：${err.message}`)
  }
  return next
}
const PREFERRED_PORT = Number.parseInt(process.env.DSH_PORT || '3188', 10)
// 应用内更新完成后的新版预热端口：此时旧版服务仍在线（3188），预热必须用备用端口；
// 登录预热（Run 键）仍用 PREFERRED_PORT（那时 3188 空闲）
const PREWARM_PORT = PREFERRED_PORT + 1
const SERVER_READY_TIMEOUT_MS = 90_000

fs.mkdirSync(LOG_DIR, { recursive: true })
const logFile = path.join(LOG_DIR, `desktop-${stamp()}.log`)

function stamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
}

// 后台/分离启动（父进程已退出）时 stdout 管道关闭，写管道会以两种形态伤到主进程：
// ① console.log 同步抛 EPIPE（截获后停用控制台输出）；② process.stdout 异步 emit
// 'error'/EPIPE 打断未捕获异常链（会中断启动流程）。
// 三层防线：同步 try/catch + 停用；stdout/stderr error 监听吞掉；uncaughtException
// 仅吞 EPIPE（其余如实弹错退出，不掩盖真实 bug）。
let consoleOk = true
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  if (consoleOk) {
    try { console.log(line) } catch { consoleOk = false }
  }
  fs.appendFileSync(logFile, line + '\n')
}
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') {
    stream.on('error', (err) => {
      consoleOk = false
      if (err && err.code !== 'EPIPE') throw err
    })
  }
}
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
    consoleOk = false
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] 已忽略 stdout 管道断裂（EPIPE）\n`) } catch { /* 忽略 */ }
    return
  }
  // 非 EPIPE：复刻 Electron 默认行为（弹窗 + 退出），先落盘日志便于排查
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] 未捕获异常：${err.stack || err.message}\n`) } catch { /* 忽略 */ }
  dialog.showErrorBox('DeepSeek Harness 主进程异常', `${err.stack || err.message}\n\n日志目录：${LOG_DIR}`)
  app.exit(1)
})

function listAnimeGifs() {
  try {
    return fs.readdirSync(ANIME_DIR).filter(f => f.toLowerCase().endsWith('.gif'))
  } catch {
    return []
  }
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------- dsh CLI 定位

/** 按优先级定位 @deepseek-ai/dsh 的 bin.js；返回 { entry, version }，找不到则 null（走 npx 兜底）。 */
function resolveDshInstall() {
  // 0. 显式环境变量
  if (process.env.DSH_CLI_PATH && fs.existsSync(process.env.DSH_CLI_PATH)) {
    return { entry: process.env.DSH_CLI_PATH, version: cliVersionOf(process.env.DSH_CLI_PATH) }
  }

  const candidates = []

  // dev 模式：desktop/dsh-runtime 常年落后于打包版平时应用内更新到的版本，
  // 且更老的运行时对被上游 0.2.x 对齐过的 profile 会直接抛错无法启动——
  // 优先复用打包版 userData 里已装好的运行时
  if (!app.isPackaged) {
    const appData = process.env.APPDATA || ''
    candidates.push(
      path.join(appData, 'DSH Desktop', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      // 旧 productName 时期的 userData 目录，改名前的存量运行时兜底
      path.join(appData, 'DeepSeek Harness', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    )
  }

  // 1. 应用内更新运行时（点版本号更新后的安装目录，优先级最高）
  candidates.push(
    path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  )

  // 2. npx 缓存（win: %LOCALAPPDATA%\npm-cache\_npx；mac: ~/.npm/_npx）
  const npxDir = IS_WIN
    ? path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
    : path.join(os.homedir(), '.npm', '_npx')
  for (const dir of safeReaddir(npxDir)) {
    candidates.push(path.join(npxDir, dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  }

  // 3. 全局 npm（win: %APPDATA%\npm；mac: 官方 pkg 与 homebrew 两种常见前缀）
  if (IS_WIN) {
    candidates.push(
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    )
  } else {
    candidates.push(
      '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
    )
  }

  // 4. DSH_HOME profiles（web profile 的运行时安装）
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  candidates.push(path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))

  for (const c of candidates) {
    if (fs.existsSync(c)) return { entry: c, version: cliVersionOf(c) }
  }
  return null
}

/** 从 bin.js 同级的 package.json 读版本号（lib/bin.js → 包根）。 */
function cliVersionOf(binPath) {
  try {
    const pkg = path.resolve(path.dirname(binPath), '..', 'package.json')
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version || null
  } catch {
    return null
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

/** 找真正的 node 可执行文件（Electron 内 process.execPath 是 electron 自身，不能拿来跑 CLI）。 */
function resolveNodeExe() {
  if (process.env.DSH_NODE_PATH && fs.existsSync(process.env.DSH_NODE_PATH)) {
    return process.env.DSH_NODE_PATH
  }
  const candidates = IS_WIN
    ? [
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\Program Files (x86)\\nodejs\\node.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      ]
    : [
        '/opt/homebrew/bin/node', // Apple Silicon homebrew
        '/usr/local/bin/node',    // Intel homebrew / 官方 pkg
        '/usr/bin/node',
      ]
  if (!IS_WIN) {
    // nvm 用户：~/.nvm/versions/node/vX.Y.Z/bin/node，按版本号倒序补进候选
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
    const dirs = safeReaddir(nvmDir)
      .filter(d => /^v\d+\.\d+\.\d+/.test(d))
      .sort((a, b) => semverCompare(a.slice(1), b.slice(1)))
      .reverse()
    for (const d of dirs) {
      candidates.push(path.join(nvmDir, d, 'bin', 'node'))
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

/** 跨平台回收进程树（win: taskkill /T /F；mac: 先 pkill 直属子进程再杀本进程——
 *  npx 兜底路径下服务是 npx 的子进程，直接 spawn 的本地 CLI 则是单进程）。 */
function killPidTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve()
    if (IS_WIN) {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => resolve())
    } else {
      execFile('pkill', ['-P', String(pid)], () => {
        try { process.kill(pid, 'SIGKILL') } catch { /* 已退出 */ }
        resolve()
      })
    }
  })
}

// ---------------------------------------------------------------- 服务管理

let serverProc = null
let serverPort = null
let serverUrl = null
// 服务常驻化：正常退出时保留服务（写接管状态+看门狗），下次启动直接采纳（~1.7s 完整界面）；
// 更新重启/启动失败等场景置 false 走原有「杀服务」路径
let keepServiceOnExit = true
// 最近一次 bringUpService 使用的 CLI 入口，交接状态文件按它做采纳校验
let lastInstallEntry = null
// 采纳的登录预热服务进程（非本应用 spawn，退出时同样要回收）
let adoptedServerPid = null

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function pickServerPort() {
  if (await isPortFree(PREFERRED_PORT)) return PREFERRED_PORT
  log(`端口 ${PREFERRED_PORT} 被占用，交给系统分配`)
  return 0
}

function startServer(cliEntry, nodeExe, port) {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  // ELECTRON_RUN_AS_NODE 必须去掉，否则 node.exe 会以 Electron 模块模式启动
  const { ELECTRON_RUN_AS_NODE: _drop, ...restEnv } = process.env
  const env = { ...restEnv, DSH_HOME: dshHome }

  let cmd
  let args
  if (cliEntry) {
    log(`使用本地 dsh CLI：${cliEntry}`)
    cmd = nodeExe
    args = [cliEntry, 'web', '--no-open', '--port', String(port)]
  } else {
    log('未找到本地 dsh CLI，回退到 npx -y @deepseek-ai/dsh@latest')
    if (IS_WIN) {
      cmd = process.env.comspec || 'cmd.exe'
      args = ['/c', 'npx', '-y', '@deepseek-ai/dsh@latest', 'web', '--no-open', '--port', String(port)]
    } else {
      // mac 的 npx 是带 shebang 的脚本，可直接 spawn（无需 cmd /c 包装）
      cmd = 'npx'
      args = ['-y', '@deepseek-ai/dsh@latest', 'web', '--no-open', '--port', String(port)]
    }
  }

  // 分离 + 文件 stdio：服务独立于应用会话存活（常驻化前提）——应用退出不牵连服务，
  // 也不会因 stdout 管道断裂产生 EPIPE 类问题（预热 helper 同款手法）
  const outFd = fs.openSync(SERVICE_STDOUT_LOG, 'w')
  serverProc = spawn(cmd, args, {
    env,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', outFd, outFd],
  })
  serverProc.unref()

  // 服务输出已直写 SERVICE_STDOUT_LOG（URL 带 ?token=，由 waitForServer 轮询该文件捕获）
  serverProc.on('exit', (code) => {
    log(`dsh web 进程退出（code=${code}）`)
    serverProc = null
  })

  return serverProc
}

function stopServer() {
  const spawnedAlive = serverProc && serverProc.exitCode === null
  const pid = spawnedAlive ? serverProc.pid : adoptedServerPid
  if (!pid) return Promise.resolve()
  log(`停止 dsh web 服务进程树（pid=${pid}${spawnedAlive ? '' : '，登录预热'}）`)
  return killPidTree(pid).then(() => {
    if (!spawnedAlive) adoptedServerPid = null
  })
}

// ---------------------------------------------------------------- 服务常驻（退出不杀，下次秒开）

/** 正常退出时保留服务：写接管状态文件（与登录预热同格式，tryAdoptPrestarted 的
    全部护栏——entry 比对/pid 存活/URL 探活——原样生效）+ 挂 4h 看门狗。
    没有活服务或还没拿到 URL（启动中途退出）时退回原有「杀服务」路径。 */
function handoffServer() {
  const spawnedAlive = serverProc && serverProc.exitCode === null
  const pid = spawnedAlive ? serverProc.pid : adoptedServerPid
  if (!pid || !serverUrl || !lastInstallEntry) return stopServer()
  try {
    fs.writeFileSync(PRESTART_STATE_FILE, JSON.stringify({
      entry: lastInstallEntry,
      pid,
      url: serverUrl,
      port: serverPort,
      startedAt: Date.now(),
      exitCode: null,
    }))
    spawnServiceWatchdog(pid)
    log(`服务常驻交接（pid=${pid}，${serverUrl}），下次启动直接采纳`)
  } catch (err) {
    log(`服务交接失败，退回停止路径：${err.message}`)
    return stopServer()
  }
}

/** 4 小时看门狗：到点若应用进程已不存在则回收常驻服务（防「退出后再也不开」
    导致 node 常驻吃内存）；应用还活着（服务在用）则安静退出，之后应用再退出时
    会挂新的看门狗。脚本写进 userData 再拉起（预热 helper 同款手法，避免内联转义）；
    以应用自身 exe 的 node 模式运行（ELECTRON_RUN_AS_NODE，官方壳同款）。 */
const SERVICE_WATCHDOG_SRC = [
  "const cp = require('child_process')",
  'const pid = Number(process.argv[2] || 0)',
  'const exeName = process.argv[3]',
  '// 看门狗自身也是 exeName 进程（node 模式跑在应用 exe 里），按名查活必须排除自己',
  'setTimeout(() => {',
  '  try {',
  "    const out = cp.execSync('tasklist /FI \"IMAGENAME eq ' + exeName + '\" /FO CSV /NH', { encoding: 'utf8' })",
  "    const alive = out.split('\\n')",
  `      .filter(l => l.includes(exeName))`,
  '      .filter(l => {',
  '        const m = l.match(/"(\\d+)"/)',
  '        return !(m && m[1] === String(process.pid))',
  '      })',
  '    if (alive.length) process.exit(0)',
  '  } catch {}',
  "  try { cp.execSync('taskkill /T /F /PID ' + pid) } catch {}",
  '}, 4 * 60 * 60 * 1000)',
  '',
].join('\n')

function spawnServiceWatchdog(pid) {
  const exeName = path.basename(process.execPath)
  try {
    fs.writeFileSync(SERVICE_WATCHDOG_JS, SERVICE_WATCHDOG_SRC)
    const child = spawn(process.execPath, [SERVICE_WATCHDOG_JS, String(pid), exeName], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.unref()
    log(`已挂服务看门狗（pid=${pid}，watchdog=${child.pid}，4h）`)
  } catch (err) {
    log(`看门狗挂载失败（服务将驻留至系统重启）：${err.message}`)
  }
}

function waitForServer(timeoutMs) {
  const startedAt = Date.now()
  // 服务地址（含 token）从分离服务的输出文件捕获——spawn 已无 stdout 管道
  const captureUrlFromLog = () => {
    if (serverUrl) return
    try {
      const text = fs.readFileSync(SERVICE_STDOUT_LOG, 'utf8')
      const m = text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)/)
      if (m) {
        serverUrl = m[1]
        serverPort = Number(serverUrl.match(/:(\d+)/)[1])
        log(`从服务输出捕获地址：${serverUrl}`)
      }
    } catch { /* 文件尚未创建等情况，下一轮再试 */ }
  }
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        if (!serverUrl) captureUrlFromLog()
        if (serverUrl && serverPort && (await probeHttp(serverPort))) return resolve(serverUrl)
        if (!serverProc || serverProc.exitCode !== null) {
          return reject(new Error('dsh web 进程已退出，详见 logs/service-stdout.log'))
        }
        if (Date.now() - startedAt > timeoutMs) {
          return reject(new Error(`等待服务超时（${timeoutMs / 1000}s），详见 logs/server.log`))
        }
      } catch (err) {
        log(`探活异常（继续等待）：${err.message}`)
      }
      setTimeout(tick, 100)
    }
    tick()
  })
}

function probeHttp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume()
      resolve(res.statusCode && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

// ---------------------------------------------------------------- 登录预热服务（冷启动优化）
//
// 冷启动 ~18s 的大头是 dsh web 进程 spawn→监听：runtime 目录 267MB/约 2.5 万个文件，
// 开机后首次打开要逐个过杀软实时扫描 + 冷磁盘 IO（温启动实测仅 ~2.8s，
// NODE_COMPILE_CACHE 实测无收益）。方案：登录时经 HKCU Run 键 + wscript 无窗口
// 预启一份 dsh web（helper 把 pid/url 写入 state 文件），应用启动时探活直接采纳，
// 把服务启动成本移出用户感知路径。

function readPrestartState() {
  try {
    return JSON.parse(fs.readFileSync(PRESTART_STATE_FILE, 'utf8'))
  } catch {
    return null
  }
}

function isPidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * 采纳登录预热的服务。就绪返回其 URL；仍在预热则轮询等待（用户开机后立刻打开应用的场景）；
 * 不可用（未注册/已退出/版本不匹配/探活失败超时）返回 null，走原自启动路径。
 */
async function tryAdoptPrestarted(cliEntry) {
  if (!cliEntry) return null
  const entryNorm = path.resolve(cliEntry)
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS
  let urlSeenAt = 0
  while (Date.now() < deadline) {
    const st = readPrestartState()
    if (!st || path.resolve(st.entry) !== entryNorm) return null
    if (st.exitCode !== null || !isPidAlive(st.pid)) return null
    // 更新预热（备用端口）只作暖机、不采纳为显示服务：3188/3189 是两个 origin，
    // localStorage（主题插件设置等）按 origin 各存一份，采纳预热服务会让页面
    // 在两套配置间漂移。回收预热进程后照常在 PREFERRED_PORT 自启动（安装产物
    // 已被预热扫热，启动不慢）。
    if (st.port === PREWARM_PORT) {
      if (await isNodePid(st.pid)) {
        log(`更新预热服务仅作暖机不采纳（pid=${st.pid}），回收后走 ${PREFERRED_PORT} 自启动`)
        await killPidTree(st.pid)
      }
      return null
    }
    // helper 启动很久仍无 url（僵死）→ 不再等，直接走自启动
    if (!st.url && Date.now() - st.startedAt > 120_000) return null
    if (st.url) {
      const pm = st.url.match(/:(\d+)/)
      if (!pm) return null
      const port = Number(pm[1])
      if (await probeHttp(port)) {
        adoptedServerPid = st.pid
        return st.url
      }
      // URL 已打出但探活持续失败（服务打印地址后僵死/被外部拦截），短宽限后放弃
      if (!urlSeenAt) urlSeenAt = Date.now()
      else if (Date.now() - urlSeenAt > 5000) return null
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

/** 找占用端口 LISTENING 的进程 pid（仅认 127.0.0.1 绑定）。 */
function findListenerPid(port) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('netstat', ['-ano', '-p', 'tcp'], (err, stdout) => {
        if (err) return resolve(null)
        for (const line of stdout.split('\n')) {
          const cols = line.trim().split(/\s+/)
          if (cols.length >= 5 && cols[0] === 'TCP' && cols[1].endsWith(`:${port}`) && cols[3] === 'LISTENING') {
            return resolve(Number(cols[4]))
          }
        }
        resolve(null)
      })
    } else {
      // mac: lsof 机器可读模式（-Fp 只输出 "p<pid>" 行）
      execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], (err, stdout) => {
        if (err) return resolve(null)
        const m = stdout.match(/^p(\d+)$/m)
        resolve(m ? Number(m[1]) : null)
      })
    }
  })
}

/** 判断 pid 是否为 node 进程（回收残留服务前的护栏，避免误杀占用端口的无关进程）。 */
function isNodePid(pid) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], (err, stdout) => {
        if (err) return resolve(false)
        resolve(/^"node\.exe",/i.test(stdout.trim()))
      })
    } else {
      // mac: ps comm 输出可执行路径（如 /opt/homebrew/bin/node），认结尾为 node 的
      execFile('ps', ['-p', String(pid), '-o', 'comm='], (err, stdout) => {
        if (err) return resolve(false)
        resolve(/(^|\/)node$/.test(stdout.trim()))
      })
    }
  })
}

/** 回收端口上残留的 dsh 服务（上个会话强杀 Electron 的遗留 / 版本已不匹配的预热服务）。 */
async function sweepOrphanServer(port) {
  const pid = await findListenerPid(port)
  if (!pid || !(await isNodePid(pid))) return
  log(`端口 ${port} 上有残留服务进程（pid=${pid}），先回收再自启动`)
  await killPidTree(pid)
}

// ---------------------------------------------------------------- 窗口

let mainWindow = null
// 内容视图（启动页 → dsh web）与自绘顶栏视图：窗口自身 webContents 不承载内容
let contentView = null
let barView = null

/** 内容视图铺满整窗、顶栏覆盖顶部 30px。内容视图不能带 y 偏移（实测）：
 *  y>0 的视图其真实鼠标输入坐标会整体下移一个偏移量（合成输入正常）；y=0 时窗口
 *  坐标与视图坐标重合才准确。页面顶部让位由 injectIntoPage 注入的 30px padding 负责。 */
function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed() || !barView || !contentView) return
  const [w, h] = mainWindow.getContentSize()
  contentView.setBounds({ x: 0, y: 0, width: w, height: h })
  barView.setBounds({ x: 0, y: 0, width: w, height: BAR_HEIGHT })
}

/** 顶栏最大化/还原图标随窗口状态切换。 */
function syncBarMaximized(maximized) {
  layoutViews()
  if (barView && !barView.webContents.isDestroyed()) {
    barView.webContents.send('bar-maximized', maximized)
  }
}

const versionRef = { value: null }

/** 注入内容页的脚本：主题上报（驱动顶栏配色）+ 顶栏命令桥 + 窗口标题。
 *  页面不做任何布局调整（版本徽标等壳元素全部在顶栏视图）。 */
function injectionScript(version) {
  return `(function () {
    /* 主题由 ~/.dsh/settings.yaml 驱动（dark/light/system）；
       变化时通过 preload 上报给主进程（联动自绘顶栏配色）。 */
    if (window.dshDesktop && !window.__dshThemeObs) {
      window.__dshThemeObs = true;
      var send = function () {
        window.dshDesktop.reportTheme(document.body.hasAttribute('data-ds-dark-theme'));
      };
      new MutationObserver(send).observe(document.body, {
        attributes: true, attributeFilter: ['data-ds-dark-theme'],
      });
      send();
    }

    /* 顶栏（shell bar）命令桥：bar 上的 🎨 等按钮经主进程转发到本页，
       由 dsh-anime-theme 插件注册的 window.__dshShellCommand 接收 */
    if (window.dshDesktop && window.dshDesktop.onShellCommand && !window.__dshShellHook) {
      window.__dshShellHook = true;
      window.dshDesktop.onShellCommand(function (cmd) {
        if (window.__dshShellCommand) window.__dshShellCommand(cmd);
      });
    }

    /* 顶栏占位：内容视图铺满整窗（输入坐标才准确），页面顶部 30px 会被覆盖的
       顶栏视图遮住，注入顶部让位（幂等；SPA 自行 reload 时经 did-finish-load 重放）。
       dsh 给 html 设了 height:100%，单加 padding（content-box）会让文档多出 30px
       滚动余量：dsh rc.2+ 的滚动锚定把整个文档上推 30px 后，会话头工具条和右侧栏
       标签条就滑进顶栏下方（被盖住且真实点击被顶栏视图拦截）。因此必须 border-box
       + height:100% + overflow:hidden，让 30px 让位内含在视口高度里、文档不可滚动 */
    if (!document.getElementById('dsh-bar-clearance')) {
      var st = document.createElement('style');
      st.id = 'dsh-bar-clearance';
      st.textContent =
        'html{padding-top:30px !important;box-sizing:border-box !important;' +
        'height:100% !important;overflow:hidden !important;}' +
        /* 右侧面板「全屏」是 fixed inset:0（fixed 不吃文档级 padding，会顶进顶栏
           30px 让位区）；面板 class 名是构建哈希，属性选择器才是稳定锚点 */
        '[data-sidebar-right-panel="fullscreen"]{top:30px !important;}';
      document.head.appendChild(st);
    }

    /* 账号登录自动打开：dsh 纯浏览器部署的登录流程只有「等待登录」弹窗 +「复制登录
       链接」手动路径（原生桌面版靠 desktopPlatform 内置页自动开）。壳里把体验补回来：
       ① 拦截剪贴板写入——复制的内容是 DeepSeek 授权链接时同步 window.open，主进程
          setWindowOpenHandler 对 deepseek.com 域放行壳内弹窗（登录页可见、置前，
          完成后回调 /oauth/callback 自动关闭）；
       ② 「等待登录」对话框出现且链接按钮可用时自动触发一次点击（每个对话框实例一次），
          对齐原生「自动打开登录页」的体验；节流避免 MutationObserver 高频全量扫描。 */
    if (navigator.clipboard && navigator.clipboard.writeText && !window.__dshAuthLinkHook) {
      window.__dshAuthLinkHook = true;
      var __origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function (text) {
        try {
          if (/^https:\\/\\/[a-z0-9.-]*deepseek\\.com\\//i.test(String(text))) {
            window.open(String(text), '_blank', 'noopener');
          }
        } catch (e) { /* 弹窗失败不挡复制 */ }
        return __origWriteText(text);
      };
      var __authTimer = null;
      var __authAutoOpen = function () {
        if (!document.body || !document.body.innerText.includes('等待登录')) return;
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          var b = btns[i];
          if ((b.textContent || '').trim() === '复制登录链接' && !b.disabled && !b.__dshAutoOpened) {
            b.__dshAutoOpened = true;
            b.click();
            return;
          }
        }
      };
      new MutationObserver(function () {
        if (__authTimer) return;
        __authTimer = setTimeout(function () { __authTimer = null; __authAutoOpen(); }, 250);
      }).observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(__authAutoOpen, 800);
    }

    /* 窗口标题带版本号 */
    document.title = 'DeepSeek Harness' + (${JSON.stringify(version)} ? ' v' + ${JSON.stringify(version)} : '');
  })();`
}

/**
 * 幂等注入（主题上报 + 顶栏命令桥）。dsh SPA 启动后可能自行 reload 一次，
 * 挂到每次 did-finish-load 重放。
 */
function injectIntoPage(win) {
  win.webContents.executeJavaScript(injectionScript(versionRef.value))
    .catch(err => log(`注入失败：${err.message}`))
}

function createWindow(splashGifPath) {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920 + BAR_HEIGHT,
    minWidth: 960,
    minHeight: 620 + BAR_HEIGHT,
    show: false,
    backgroundColor: '#181818',
    autoHideMenuBar: true,
    title: 'DeepSeek Harness',
    icon: path.join(ASSET_DIR, 'icon.png'),
    // 无边框窗口、无系统 overlay 按钮：窗口控制由自绘顶栏（barView）承担，
    // dsh web 在下方内容视图（contentView）完全原生渲染，壳不再调整页面布局
    titleBarStyle: 'hidden',
  })

  // 用 WebContentsView（Electron 30+ 的官方替代，33 里 BrowserView 已废弃）：
  // 实测废弃的 BrowserView 在无边框窗口 + 内容视图 y 偏移布局下会把真实鼠标输入
  // 整体吞掉（OS 点名本窗口但三个 webContents 收不到任何 mousedown，合成输入正常）
  contentView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(APP_ROOT, 'preload.js'),
    },
  })
  barView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(APP_ROOT, 'bar-preload.js'),
    },
  })
  // 后添加的视图在上层：内容在下、顶栏盖顶
  mainWindow.contentView.addChildView(contentView)
  mainWindow.contentView.addChildView(barView)
  layoutViews()
  // 窗口自身 webContents 不承载内容，但必须提交一次真实导航（about:blank）：
  // 从不导航的目标在 CDP 上 Runtime 无响应，会让 playwright connectOverCDP 等自动化
  // 工具 attach 时整体卡死（实测）
  mainWindow.webContents.loadURL('about:blank')
  mainWindow.on('resize', layoutViews)
  mainWindow.on('maximize', () => syncBarMaximized(true))
  mainWindow.on('unmaximize', () => syncBarMaximized(false))
  barView.webContents.loadFile(path.join(APP_ROOT, 'bar.html'))
  // 顶栏加载完成即推一次版本徽标状态（初始渲染）
  barView.webContents.once('did-finish-load', () => {
    pushBadgeState()
    // 片头期间顶栏强制深色：启动页是深海暗底（皮肤「鲸鱼娘·未至之境」的视频背景），
    // 浅色顶栏会和它割裂；主界面加载后由 theme-changed 按页面实际深浅接管
    if (barView && !barView.webContents.isDestroyed()) {
      barView.webContents.send('bar-theme', { dark: true, accent: barAccentCache })
    }
  })

  contentView.webContents.loadFile(path.join(APP_ROOT, 'splash', 'index.html'), {
    search: `gif=${encodeURIComponent(splashGifPath || '')}&ver=${encodeURIComponent(versionRef.value || '')}`,
  })

  // 启动页是本地文件，加载完成即显示窗口：服务启动期间用户就有画面可看，
  // 而不是对着空桌面等服务就绪（启动观感慢的大头）
  contentView.webContents.once('did-finish-load', () => {
    log(`启动页可见（进程启动后 ${((Date.now() - PROCESS_START) / 1000).toFixed(2)}s）`)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })

  // SPA 自行 reload 时也要重新注入
  contentView.webContents.on('did-finish-load', () => {
    if (contentView && !contentView.webContents.isDestroyed()) {
      injectIntoPage(contentView)
    }
  })

  // 只把 http(s) 链接交给系统打开；其余（畸形路径、UNC、自定义协议等）
  // 一律拦截，避免把垃圾字符串丢给 ShellExecute 弹「Windows 找不到」错误框
  const openExternalIfHttp = (url) => {
    if (/^https?:\/\//i.test(url)) {
      log(`外部打开：${url.slice(0, 120)}`)
      shell.openExternal(url)
    } else {
      log(`已拦截外部打开请求（非 http/https）：${url.slice(0, 200)}`)
    }
  }
  /* 登录/平台授权页在壳内弹窗打开：原生浏览器里 target=_blank 是可见的新标签页，
     壳里若丢给系统默认浏览器，窗口可能开在应用后面，用户看着像「没跳转」；
     且 deny 会让页面 window.open 拿到 null，依赖返回值的流程会误判打开失败。
     只放行应用自身 origin 与 DeepSeek 平台域，其余外链照旧走系统浏览器。 */
  const inShellPopup = (url) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
      const host = u.hostname.toLowerCase()
      if (host === '127.0.0.1' || host === 'localhost') return true
      if (/(^|\.)deepseek\.com$/i.test(host)) return true
      return serverUrl ? u.origin === new URL(serverUrl).origin : false
    } catch { return false }
  }

  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (inShellPopup(url)) {
      openShellPopup(url)
      return { action: 'deny' }
    }
    openExternalIfHttp(url)
    return { action: 'deny' }
  })

  /* 壳内弹窗 = 主进程自建窗口（deny 掉 window.open）：与主窗口同款双视图架构，
     barView 固定顶部 34px、pageView 整体下移，几何完全自管。
     前两版教训：①给 window.open 弹窗的 contentView addChildView 顶栏只能「叠」在
     页面上（遮挡）；②换 View 组合容器后 Electron 内部仍把页面视图挂回全尺寸渲染
     （bounds 日志正确但渲染器视口=全窗高，遮挡依旧）——不再借用 window.open 生成的窗口。 */
  const POPUP_BAR_H = 34
  /** 弹窗顶栏视图 webContents.id → { wc, win, toggleFullscreen }（动作路由） */
  const popupBarOwners = new Map()
  const pushPopupNav = (pageWc, barWc) => {
    if (barWc.isDestroyed() || pageWc.isDestroyed()) return
    barWc.send('popup:nav', {
      canBack: pageWc.canGoBack(),
      canForward: pageWc.canGoForward(),
      title: pageWc.getTitle() || '',
    })
  }
  const openShellPopup = (url) => {
    log(`壳内弹窗（自建窗口）：${url.slice(0, 120)}`)
    const win = new BrowserWindow({
      width: 1000, height: 700, minWidth: 480, minHeight: 360,
      show: false, backgroundColor: '#1b1b1f', autoHideMenuBar: true,
      title: 'DeepSeek',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1b1b1f', symbolColor: '#d4d4d4', height: POPUP_BAR_H },
    })
    win.setMenuBarVisibility(false)
    const barView = new WebContentsView({
      webPreferences: { preload: path.join(APP_ROOT, 'popup-preload.js') },
    })
    const pageView = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const wc = pageView.webContents
    let popupFullscreen = false
    const toggleFullscreen = () => { popupFullscreen = !popupFullscreen; win.setFullScreen(popupFullscreen) }
    popupBarOwners.set(barView.webContents.id, { wc, win, toggleFullscreen })
    /* 布局随全屏态切换：全屏=页面占满整窗，顶栏默认隐藏、由悬浮监听管理（浏览器
       沉浸式全屏同款：鼠标到屏幕顶缘浮现、移开后延时隐藏）；退出=顶栏常驻+页面下移。 */
    const applyLayout = () => {
      try {
        const [w, h] = win.getContentSize()
        if (popupFullscreen) {
          pageView.setBounds({ x: 0, y: 0, width: w, height: h })
        } else {
          barView.setVisible(true)
          barView.setBounds({ x: 0, y: 0, width: w, height: POPUP_BAR_H })
          pageView.setBounds({ x: 0, y: POPUP_BAR_H, width: w, height: Math.max(0, h - POPUP_BAR_H) })
        }
        log(`弹窗布局(fs=${popupFullscreen} ${w}x${h})：page=${JSON.stringify(pageView.getBounds())}`)
      } catch (e) { log(`弹窗布局失败：${e.message}`) }
    }
    const relayout = applyLayout
    win.on('resize', relayout)
    /* 全屏顶栏悬浮：轮询系统光标（仅全屏期间，150ms）——顶缘 2px 内浮现（覆盖在
       页面上方，页面保持全高）；光标离开顶栏区（含 6px 容差）立即隐藏 */
    let barRevealed = false
    let hoverPollTimer = null
    const HOVER_EDGE_PX = 2
    const HOVER_TOLERANCE_PX = 6
    const hoverShowBar = (w) => {
      if (!barRevealed) {
        barRevealed = true
        barView.setVisible(true)
        barView.setBounds({ x: 0, y: 0, width: w, height: POPUP_BAR_H })
        log('全屏顶栏悬浮显示')
      }
    }
    const hoverHideBar = () => {
      if (!barRevealed) return
      barRevealed = false
      try { barView.setVisible(false) } catch { /* 已销毁 */ }
      log('全屏顶栏悬浮隐藏')
    }
    const startHoverWatch = () => {
      stopHoverWatch()
      hoverPollTimer = setInterval(() => {
        try {
          if (win.isDestroyed()) return stopHoverWatch()
          if (!popupFullscreen) return stopHoverWatch()
          const cursor = screen.getCursorScreenPoint()
          const b = win.getBounds()
          const withinX = cursor.x >= b.x && cursor.x <= b.x + b.width
          if (cursor.y <= b.y + HOVER_EDGE_PX && withinX) {
            hoverShowBar(b.width)
          } else if (barRevealed) {
            const onBar = withinX && cursor.y <= b.y + POPUP_BAR_H + HOVER_TOLERANCE_PX
            if (!onBar) hoverHideBar()
          }
        } catch { /* 窗口销毁竞态 */ }
      }, 150)
    }
    const stopHoverWatch = () => {
      if (hoverPollTimer) { clearInterval(hoverPollTimer); hoverPollTimer = null }
    }
    // F11 / Esc：自维护状态切换（titleBarOverlay 下 isFullScreen() 偶发失真会卡全屏）。
    // 全屏过渡期同步 setBounds 会打断 Windows 的全屏切换（实测进不去全屏）——延迟应用。
    win.on('enter-full-screen', () => {
      popupFullscreen = true
      log('弹窗 enter-full-screen')
      barRevealed = false
      try { barView.setVisible(false) } catch { /* 已销毁 */ }
      setTimeout(() => { applyLayout(); startHoverWatch() }, 80)
    })
    win.on('leave-full-screen', () => {
      popupFullscreen = false
      log('弹窗 leave-full-screen')
      stopHoverWatch()
      barRevealed = false
      setTimeout(applyLayout, 80)
      setTimeout(applyLayout, 400)
    })
    const onKey = (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F11') {
        event.preventDefault()
        toggleFullscreen()
      } else if (input.key === 'Escape' && popupFullscreen) {
        event.preventDefault()
        win.setFullScreen(false)
      }
    }
    wc.on('before-input-event', onKey)
    barView.webContents.on('before-input-event', onKey)
    const pushNav = () => pushPopupNav(wc, barView.webContents)
    wc.on('did-finish-load', pushNav)
    wc.on('did-navigate', pushNav)
    wc.on('did-navigate-in-page', pushNav)
    wc.on('page-title-updated', pushNav)
    barView.webContents.on('did-finish-load', pushNav)
    // 平台「返回 DeepSeek Harness」按钮走 dsh:// 深链（原生桌面协议），本机未注册协议
    // 会弹 Windows「找不到应用」框——拦截所有非 http(s) 导航，语义即「回到应用」
    wc.on('will-navigate', (event, u) => {
      if (/^https?:/i.test(u)) return
      event.preventDefault()
      log(`已拦截弹窗深链导航并回主界面：${u.slice(0, 120)}`)
      showMainWindow()
    })
    // 弹窗页面里的二级 window.open：同策略（自建新弹窗 / 外链走系统浏览器）
    wc.setWindowOpenHandler(({ url: u }) => {
      if (inShellPopup(u)) { openShellPopup(u); return { action: 'deny' } }
      openExternalIfHttp(u)
      return { action: 'deny' }
    })
    win.on('closed', () => {
      popupBarOwners.delete(barView.webContents.id)
      try { barView.webContents.destroy() } catch { /* 已销毁 */ }
      try { pageView.webContents.destroy() } catch { /* 已销毁 */ }
    })
    win.contentView.addChildView(pageView)
    win.contentView.addChildView(barView)
    relayout()
    barView.webContents.loadFile(path.join(APP_ROOT, 'popup-bar.html'))
    wc.loadURL(url)
    win.show()
  }
  ipcMain.on('popup:action', (event, action) => {
    const owner = popupBarOwners.get(event.sender.id)
    if (!owner || owner.wc.isDestroyed()) return
    const { wc } = owner
    if (action === 'back') { if (wc.canGoBack()) wc.goBack() }
    else if (action === 'forward') { if (wc.canGoForward()) wc.goForward() }
    else if (action === 'reload') wc.reload()
    else if (action === 'external') openExternalIfHttp(wc.getURL())
    else if (action === 'fullscreen') owner.toggleFullscreen()
  })

  // 下载接管：会话导出等下载静默存入系统下载目录，完成后气泡提示
  contentView.webContents.session.on('will-download', (event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename())
    item.setSavePath(savePath)
    item.once('done', (_e, state) => {
      log(`下载${state === 'completed' ? '完成' : '失败（' + state + '）'}：${savePath}`)
      if (state === 'completed' && tray) {
        try {
          tray.displayBalloon({
            icon: path.join(ASSET_DIR, 'icon.png'),
            title: '下载完成',
            content: item.getFilename() + '\n已保存到下载目录',
          })
        } catch { /* 忽略 */ }
      }
    })
  })

  // 窗口内导航限制：只允许本机服务与启动页，外链一律交给系统浏览器
  contentView.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('file://')) return
    event.preventDefault()
    openExternalIfHttp(url)
  })

  // 缩放快捷键（借鉴 dsh-desktop 的 shell generation 职责：Ctrl+= / Ctrl+- / Ctrl+0）
  contentView.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.type !== 'keyDown') return
    const zoom = { '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', _: 'zoomOut', '0': 'zoomReset' }[input.key]
    if (zoom) {
      event.preventDefault()
      contentView.webContents[zoom]()
    }
  })

  // 关闭行为：ask（首次询问并记住）/ tray（最小化到托盘）/ exit（直接退出）
  mainWindow.on('close', (event) => {
    if (isQuitting || allowClose) return
    const settings = readSettings()
    if (settings.closeAction === 'tray') {
      event.preventDefault()
      hideToTray()
      return
    }
    if (settings.closeAction === 'exit') return
    event.preventDefault()
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '关闭 DeepSeek Harness',
      message: '关闭窗口时希望执行什么操作？',
      detail: '最小化到托盘会保持服务运行，可随时从托盘恢复；直接退出后服务将在后台保留约 4 小时以便下次秒开（到期自动结束）。',
      checkboxLabel: '记住我的选择（之后可在托盘右键菜单中修改）',
      buttons: ['最小化到托盘', '直接退出'],
      defaultId: 0,
      // 关闭/取消弹窗 = 取消本次关闭，窗口保持打开（cancelId 指向不存在的按钮）
      cancelId: 2,
    }).then(({ response, checkboxChecked }) => {
      if (response !== 0 && response !== 1) return // 用户取消，不关闭
      const action = response === 0 ? 'tray' : 'exit'
      if (checkboxChecked) {
        writeSettings({ closeAction: action })
        rebuildTrayMenu()
      }
      if (action === 'tray') {
        hideToTray()
      } else {
        allowClose = true
        mainWindow.close()
      }
    })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    barView = null
    contentView = null
  })
  return mainWindow
}

function splashStatus(text) {
  if (!contentView) return
  contentView.webContents.executeJavaScript(
    `window.__setStatus && window.__setStatus(${JSON.stringify(text)})`,
  ).catch(() => {})
}

/** 启动页淡出过渡：服务就绪后先播整页退场动画再换页，避免内容生硬跳变。 */
function splashOut() {
  if (!contentView) return Promise.resolve()
  return contentView.webContents.executeJavaScript(
    'window.__splashOut ? window.__splashOut() : Promise.resolve()',
  ).catch(() => {})
}

/** 自启动服务路径：回收残留占用 → 选端口 → spawn → 等就绪（捕获地址写入 serverUrl/serverPort）。 */
async function spawnServicePhase(cliEntry, nodeExe) {
  if (!(await isPortFree(PREFERRED_PORT))) {
    await sweepOrphanServer(PREFERRED_PORT)
  }
  const port = await pickServerPort()
  startServer(cliEntry, nodeExe, port)

  splashStatus('等待服务就绪 …')
  const url = await waitForServer(SERVER_READY_TIMEOUT_MS)
  log(`服务就绪：${url}`)
}

/** 给 promise 加兜底超时：导航竞态下 loadURL / executeJavaScript 可能既不 resolve 也不
 *  reject（实测服务刚就绪 + 启动页动画并行时偶发，伴随 SharedImageManager GPU 报错），
 *  超时按失败处理交由上层重试，避免启动链路永久卡死。 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      log(`${label} 超时（${ms}ms），按失败处理`)
      reject(new Error(`${label} 超时`))
    }, ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/** 加载主界面。探活通过与 HTTP 完全就绪之间存在窄竞态，偶发 ERR_CONNECTION_REFUSED：
 *  短间隔重试几次，避免把「再等 300ms 就好」的情况当致命失败。 */
async function loadMainUi(url) {
  let lastErr = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await withTimeout(contentView.webContents.loadURL(url), 10_000, `loadURL 第 ${attempt} 次`)
      return
    } catch (err) {
      lastErr = err
      log(`loadURL 第 ${attempt} 次失败：${err.message}`)
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  throw lastErr
}

/** 启动 dsh web 服务并让主窗口加载界面（可重试；重试前会先回收旧服务进程）。 */
async function bringUpService(install) {
  const cliEntry = install ? install.entry : null
  lastInstallEntry = cliEntry // 服务常驻交接状态文件的采纳校验入口
  const nodeExe = cliEntry ? resolveNodeExe() : null
  if (cliEntry && !nodeExe) {
    throw new Error('找到 dsh CLI 但找不到 node 可执行文件（可设置 DSH_NODE_PATH 指定）')
  }
  await stopServer()
  serverPort = null
  serverUrl = null
  ensureClientPlatformHeader() // 平台 422 修复：必须在服务 spawn 前落盘（每次启动幂等）

  splashStatus('正在启动服务 …')
  let viaAdopt = false
  const adoptedUrl = await tryAdoptPrestarted(cliEntry)
  if (adoptedUrl) {
    viaAdopt = true
    serverUrl = adoptedUrl
    serverPort = Number(adoptedUrl.match(/:(\d+)/)[1])
    log(`采纳登录预热的服务（跳过服务启动等待）：${adoptedUrl}`)
  } else {
    await spawnServicePhase(cliEntry, nodeExe)
  }

  splashStatus('服务就绪，正在进入界面 …')
  // 先播启动页淡出，再加载主界面。淡出与加载并行会在导航竞态下随机吞掉
  // executeJavaScript 的回执（服务刚就绪时首屏提交快于 430ms 动画，页面上下文
  // 先被销毁，主进程 Promise 永不落定——实测复现），保持串行 + 超时兜底
  try {
    await withTimeout(splashOut(), 1200, '启动页淡出')
  } catch { /* 动画卡住不阻塞进入界面 */ }
  try {
    await loadMainUi(serverUrl)
  } catch (err) {
    // 采纳的服务失联（打印地址后即僵死等）→ 恢复启动页回退自启动一次；
    // 自启动路径的失败标记为展示阶段问题，按原逻辑上抛（不触发运行时清除）
    if (!viaAdopt) {
      err.phase = 'present'
      throw err
    }
    log(`预热服务加载失败（${err.message}），回退自启动服务`)
    await stopServer()
    serverPort = null
    serverUrl = null
    splashStatus('正在重启服务 …')
    contentView.webContents.executeJavaScript('window.__splashIn && window.__splashIn()').catch(() => {})
    await spawnServicePhase(cliEntry, nodeExe)
    splashStatus('服务就绪，正在进入界面 …')
    try {
      await withTimeout(splashOut(), 1200, '启动页淡出')
    } catch { /* 同上 */ }
    try {
      await loadMainUi(serverUrl)
    } catch (err2) {
      err2.phase = 'present'
      throw err2
    }
  }
  injectIntoPage(mainWindow)
  if (versionRef.value) mainWindow.setTitle(`DeepSeek Harness v${versionRef.value}`)
  mainWindow.show()
  createTray() // 托盘常驻：下载气泡提示、关闭行为入口随时可用
  log('桌面窗口已展示')
}

// ---------------------------------------------------------------- 登录预热注册

const PRESTART_HELPER_SRC = String.raw`// DSH Desktop 登录预热 helper：由 wscript 无窗口拉起，后台预启 dsh web 并把 pid/url 写入 state 文件。
// 服务以 detached + stdio 直写日志文件的方式启动，helper 拿到服务地址后即退出，
// 不残留第二个 node 进程（运行期进程数与无预热时完全一致）。
// 用法：node dsh-prestart.js <cliEntry> <port> <stateFile> <logFile>
const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const cliEntry = process.argv[2]
const port = Number(process.argv[3])
const stateFile = process.argv[4]
const logFile = process.argv[5]

const state = { pid: null, entry: cliEntry, port: port, url: null, startedAt: Date.now(), exitCode: null }

function writeState(patch) {
  Object.assign(state, patch)
  try {
    const tmp = stateFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, stateFile)
  } catch (e) { process.exit(1) }
}
function log(text) {
  try { fs.appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + text) } catch (e) {}
}

// 重复触发保护：端口上已有服务（Run 键重复执行/上个会话遗留）就不再拉起
const probe = net.connect({ host: '127.0.0.1', port: port })
probe.on('connect', function () {
  probe.destroy()
  log('端口 ' + port + ' 已有服务，跳过预热\n')
  process.exit(0)
})
probe.on('error', function () {
  probe.destroy()
  main()
})

function main() {
  writeState({})
  const logFd = fs.openSync(logFile, 'a')
  const env = Object.assign({}, process.env, {
    DSH_HOME: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
  })
  const child = spawn(process.execPath, [cliEntry, 'web', '--no-open', '--port', String(port)], {
    env, detached: true, stdio: ['ignore', logFd, logFd],
  })
  writeState({ pid: child.pid })
  log('预热服务启动 pid=' + child.pid + '\n')
  child.unref()

  // 轮询读日志增量等「dsh web: http://…」地址行（服务地址只打印一次）
  let pos = fs.fstatSync(logFd).size
  const poll = setInterval(function () {
    let chunk = ''
    try {
      const st = fs.fstatSync(logFd)
      if (st.size > pos) {
        const fd = fs.openSync(logFile, 'r')
        chunk = fs.readFileSync(fd).slice(pos).toString()
        fs.closeSync(fd)
        pos = st.size
      }
    } catch (e) { return }
    const m = chunk.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)/)
    if (m) {
      clearInterval(poll)
      writeState({ url: m[1] })
      log('预热服务就绪 ' + m[1] + '，helper 退出\n')
      fs.closeSync(logFd)
      process.exit(0)
    }
  }, 100)

  child.on('exit', function (code) {
    clearInterval(poll)
    writeState({ exitCode: code === null ? -1 : code })
    log('预热服务退出 code=' + state.exitCode + '\n')
    process.exit(0)
  })
}
`

/**
 * 写入登录预热脚本（js + vbs，幂等）。登录预热（Run 键）与应用内更新预热共用 helper：
 * vbs 固定用 PREFERRED_PORT 供登录场景；更新预热直接调 js 并传备用端口。
 */
function writePrestartHelper(nodeExe, entry) {
  fs.writeFileSync(PRESTART_HELPER_JS, PRESTART_HELPER_SRC)
  // vbs/wscript/Run 键仅 Windows 登录预热使用；mac 只用 js helper（应用内更新预热）
  if (!IS_WIN) return
  // Run 键直接跑 node.exe 会闪控制台黑框，用 wscript 无窗口启动；
  // 多段引号参数的命令必须包一层 cmd /c "..."，否则 WScript.Shell.Run 会静默失败（实测）
  const cmd = [
    `"${nodeExe}"`, `"${PRESTART_HELPER_JS}"`, `"${entry}"`,
    String(PREFERRED_PORT), `"${PRESTART_STATE_FILE}"`, `"${PRESTART_SERVER_LOG}"`,
  ].join(' ')
  const wrapped = `cmd /c "${cmd}"`
  fs.writeFileSync(PRESTART_VBS,
    `' DSH Desktop 登录预热：开机时后台预启 dsh web，首次打开应用免等服务冷启动\n` +
    `' 同步等待（True）：宿主（explorer/任务计划）退出时可能连带清理异步子进程树，等 helper 拿到服务地址再退（通常 <30s，冷启动 <60s），保证链路完整\n` +
    `CreateObject("WScript.Shell").Run "${wrapped.replace(/"/g, '""')}", 0, True\n`)
}

/**
 * 写入登录预热脚本并注册 HKCU Run 键（幂等，每次启动对账以跟随 runtime 更新换路径）。
 * 仅打包版，dev 不注册；用户在任务管理器「启动应用」里禁用过则尊重选择，不再注册。
 */
function ensurePrestart(install) {
  // 登录预热依赖 HKCU Run 键 + wscript，仅 Windows；mac 无此机制（应用内更新预热仍可用）
  if (!IS_WIN) return
  if (!app.isPackaged) return
  if (!install || !install.entry || !install.entry.startsWith(RUNTIME_DIR + path.sep)) return
  const nodeExe = resolveNodeExe()
  if (!nodeExe) return
  try {
    writePrestartHelper(nodeExe, install.entry)
  } catch (err) {
    log(`写入登录预热脚本失败：${err.message}`)
    return
  }
  // StartupApproved 首字节为奇数（如 03）= 用户在任务管理器禁用了该自启项
  execFile('reg', ['query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
    '/v', PRESTART_RUN_NAME], (err, stdout) => {
    const m = !err && stdout.match(/REG_BINARY\s+([0-9a-f]{2})/i)
    if (m && (parseInt(m[1], 16) & 1)) {
      log('登录预热已被用户禁用（任务管理器-启动应用），跳过注册')
      return
    }
    execFile('reg', ['add', PRESTART_RUN_KEY, '/v', PRESTART_RUN_NAME, '/t', 'REG_SZ',
      '/d', `wscript.exe "${PRESTART_VBS}"`, '/f'], (err2) => {
      log(err2 ? `注册登录预热失败：${err2.message}` : `登录预热已注册（下次登录生效）：${PRESTART_VBS}`)
    })
  })
}

// ---------------------------------------------------------------- 应用内更新预热
//
// 更新装完后 npm 换掉的 200+ 包全是新文件，新版服务首次启动要整体过杀软实时扫描
// （实测 34s+），「立即重启」会把这段等待原样搬进启动路径——用户感知「更新完启动巨慢」。
// 装完后立刻在备用端口预启一份新版服务（helper 与服务均 detached），重启或下次启动时
// tryAdoptPrestarted 直接采纳，回到 ~1.5s；等待期间弹窗如实显示预热进度。

let prewarmWatchTimer = null

/** 更新弹窗 done 阶段显示的预热状态文案（warming / ready / failed / none）。 */
function setPrewarmState(state) {
  if (updateState) {
    updateState.prewarm = state
    sendUpdateEvent({ type: 'prewarm', state })
  }
}

/** 回收空闲的预热服务（pid 记录在 state 文件）——npm 换运行时文件前先解除占用。
 *  正在服务本应用的进程（自启/采纳）不能杀：用户还在用，其文件占用由 npm 容忍（EPERM 警告）。 */
function stopPrewarmService() {
  const st = readPrestartState()
  if (!st || !st.pid || st.exitCode !== null || !isPidAlive(st.pid)) return Promise.resolve()
  if (serverProc && serverProc.exitCode === null && st.pid === serverProc.pid) return Promise.resolve()
  if (st.pid === adoptedServerPid) return Promise.resolve()
  log(`回收空闲预热服务（pid=${st.pid}，避免占用运行时文件）`)
  return new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(st.pid), '/T', '/F'], () => resolve())
  })
}

/** 更新安装完成后，在备用端口预启新版服务（仅打包版 + 应用内运行时）。 */
function prewarmNewRuntime(entry) {
  if (!app.isPackaged || !entry || !entry.startsWith(RUNTIME_DIR + path.sep)) {
    setPrewarmState('none')
    return
  }
  const nodeExe = resolveNodeExe()
  if (!nodeExe) {
    setPrewarmState('none')
    return
  }
  try {
    writePrestartHelper(nodeExe, entry)
  } catch (err) {
    log(`预热：写 helper 失败：${err.message}`)
    setPrewarmState('failed')
    return
  }
  try {
    // helper 也 detached：应用在预热就绪前退出，state（pid/url）仍会被完整写完
    const child = spawn(nodeExe, [PRESTART_HELPER_JS, entry, String(PREWARM_PORT), PRESTART_STATE_FILE, PRESTART_SERVER_LOG],
      { detached: true, windowsHide: true, stdio: 'ignore' })
    child.unref()
    log(`更新完成，后台预热新版服务（端口 ${PREWARM_PORT}，helper pid=${child.pid}）`)
    watchPrewarm(entry)
  } catch (err) {
    log(`预热启动失败：${err.message}`)
    setPrewarmState('failed')
  }
}

/** 轮询预热进度并推给更新弹窗（done 阶段显示「预热完成，重启即刻生效」）。 */
function watchPrewarm(entry) {
  if (prewarmWatchTimer) clearInterval(prewarmWatchTimer)
  const entryNorm = path.resolve(entry)
  const startedAt = Date.now()
  prewarmWatchTimer = setInterval(() => {
    const st = readPrestartState()
    const mine = st && st.port === PREWARM_PORT && path.resolve(st.entry) === entryNorm
    if (mine && st.url && st.exitCode === null && isPidAlive(st.pid)) {
      clearInterval(prewarmWatchTimer)
      prewarmWatchTimer = null
      setPrewarmState('ready')
      log('新版服务预热完成（暖机），重启后走 3188 正常启动路径')
    } else if ((mine && st.exitCode !== null) || Date.now() - startedAt > 120_000) {
      clearInterval(prewarmWatchTimer)
      prewarmWatchTimer = null
      setPrewarmState('failed')
      log('新版服务预热未就绪（超时/退出），重启后走正常启动路径')
    }
  }, 1000)
}

// ---------------------------------------------------------------- 更新检测

const DSH_PACKUMENT_PATH = '/@deepseek-ai%2Fdsh'

function parseSemver(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] }
}

/** 完整 semver 比较（核心三段 + 预发布标识符逐段，数字段按数值比）。 */
function semverCompare(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return a > b ? 1 : a < b ? -1 : 0
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1
  }
  if (!pa.pre.length && !pb.pre.length) return 0
  if (!pa.pre.length) return 1 // 正式版 > 预发布
  if (!pb.pre.length) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1 // 标识符少的一侧更小
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (+x !== +y) return +x > +y ? 1 : -1
    } else if (nx !== ny) {
      return nx ? -1 : 1 // 数字标识符 < 字符串标识符
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }
  return 0
}

/** 拉取完整 packument（含全部版本与 dist-tags）。/latest 端点只反映 latest 标签，
 *  而上游把 alpha 线挂在 alpha 标签下，只查 /latest 会漏检新版本。 */
function fetchPackument() {
  const url = `${NPM_REGISTRY}${DSH_PACKUMENT_PATH}`
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const info = JSON.parse(data)
          if (!info || !info.versions) throw new Error('响应结构异常（无 versions 字段）')
          resolve(info)
        } catch (err) {
          reject(new Error(`响应解析失败：${err.message}`))
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('查询超时（10s）'))
    })
    req.on('error', (err) => reject(new Error(`网络错误：${err.message}（registry: ${NPM_REGISTRY}）`)))
  })
}

const TAG_LABELS = { latest: '正式', next: '预览', alpha: '内测 Alpha' }

function channelLabel(pick) {
  if (!pick.tag) return '未设标签'
  return TAG_LABELS[pick.tag] || `标签 ${pick.tag}`
}

/** 从 packument 里挑出全渠道最新的可更新版本（所有 dist-tags 与全部已发布版本中 semver 最大者）。 */
function pickNewest(info) {
  let best = null // { version, tag, publishedAt }
  const consider = (version, tag) => {
    if (!parseSemver(version)) return
    const cmp = best ? semverCompare(version, best.version) : 1
    if (cmp > 0 || (cmp === 0 && tag && !best.tag)) {
      best = { version, tag: tag || null, publishedAt: (info.time || {})[version] || null }
    }
  }
  for (const [tag, version] of Object.entries(info['dist-tags'] || {})) consider(version, tag)
  for (const version of Object.keys(info.versions || {})) consider(version, null)
  return best
}

// ---------------------------------------------------------------- 更新流程状态

// 单窗口原则：版本说明与全部更新阶段（发现/安装/完成/失败）都在 notesWin 一站完成，
// 不再有独立更新弹窗；事件统一推给 notesWin，窗口未打开时由打开动作重放当前状态。

let pendingUpdate = null // found 阶段确认前的候选版本
let foundCtx = null // found 阶段展示文案
// 安装启动后的持久状态（关窗不影响安装）：phase = installing | done | failed
let updateState = null

function sendUpdateEvent(payload) {
  if (notesWin && !notesWin.isDestroyed()) {
    notesWin.webContents.send('update:event', payload)
  }
}

/** 把更新状态推给顶栏，版本徽标随之变化（idle/available/installing/done/failed）。 */
function pushBadgeState() {
  if (!barView || barView.webContents.isDestroyed()) return
  let payload
  if (updateState) {
    payload = { state: updateState.phase, current: versionRef.value || '', version: updateState.version, detail: updateState.detail || '' }
  } else if (foundCtx) {
    payload = { state: 'available', current: versionRef.value || '', version: foundCtxLabel(foundCtx) }
  } else {
    payload = { state: 'idle', current: versionRef.value || '' }
  }
  barView.webContents.send('badge-state', payload)
}

/** 把当前更新状态（含已累积日志）完整推给 notesWin，用于关窗后重开时回放进度。
 *  日志必须先于 phase 事件回放：failed 分支渲染时要从 $('log') 拷贝已回放的日志，
 *  phase 在前会把 x-log 抄成空（弹窗里只见「（无安装输出）」而真实 npm 报错丢失）。 */
function pushUpdateState() {
  if (!updateState) {
    if (foundCtx) sendUpdateEvent({ type: 'phase', phase: 'found', ...foundCtx })
    return
  }
  const { log, startedAt, ...rest } = updateState
  for (const line of log) sendUpdateEvent({ type: 'log', text: line })
  sendUpdateEvent({ type: 'phase', ...rest, elapsedSec: Math.round((Date.now() - startedAt) / 1000) })
}

/** foundCtx 的对外版本标签：优先运行时目标，否则壳目标（徽标/状态行显示用）。 */
function foundCtxLabel(ctx) {
  if (!ctx || !Array.isArray(ctx.targets) || ctx.targets.length === 0) return null
  const rt = ctx.targets.find(t => t.kind === 'runtime')
  return (rt || ctx.targets[0]).latest
}

// ---------------------------------------------------------------- 版本说明与更新窗口（单窗口）

let notesWin = null

/** 打开（或聚焦）版本说明窗口；有进行中/已完成的更新时重放其状态，同窗衔接全部阶段。 */
function openNotesWindow() {
  if (notesWin && !notesWin.isDestroyed()) {
    notesWin.focus()
    pushUpdateState()
    return
  }
  notesWin = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 520,
    minHeight: 420,
    parent: mainWindow,
    show: false,
    title: '版本说明与更新 — DeepSeek Harness',
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(APP_ROOT, 'update-preload.js'),
    },
  })
  notesWin.setMenuBarVisibility(false)
  notesWin.once('ready-to-show', () => {
    notesWin.show()
    pushUpdateState()
  })
  notesWin.on('closed', () => {
    // 关窗不中断安装：只记录日志，后台继续装（点版本徽标可回到进度）
    if (updateState && updateState.phase === 'installing') {
      log(`更新窗口已关闭，后台继续安装 v${updateState.version}`)
    }
    notesWin = null
  })
  // notes.html 默认深色：加载完成后按当前系统主题补设 data-theme；
  // 之后的主题变化由 notes-theme 推送（theme-changed 与 nativeTheme updated 兜底）
  notesWin.webContents.on('did-finish-load', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    notesWin.webContents.executeJavaScript(`document.body.dataset.theme = '${theme}'`)
      .catch((err) => log(`notes 弹窗主题注入失败：${err.message}`))
  })
  notesWin.loadFile(path.join(APP_ROOT, 'notes.html'))
}

function appendUpdateLog(line) {
  if (!updateState) return
  updateState.log.push(line)
  if (updateState.log.length > 600) updateState.log.shift()
  sendUpdateEvent({ type: 'log', text: line })
}

/** 读取更新回退锚点（更新前版本）。 */
function readRollback() {
  try {
    return JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'))
  } catch {
    return null
  }
}

/** 把指定版本重新装回应用内运行时（启动自愈用；如实验证安装目录版本号）。 */
function reinstallRuntime(version) {
  return new Promise((resolve) => {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
    const baseArgs = ['install', '--prefix', RUNTIME_DIR,
      `@deepseek-ai/dsh@${version}`, '--registry', NPM_REGISTRY, '--no-audit', '--no-fund']
    log(`恢复运行时：npm install @deepseek-ai/dsh@${version}`)
    const proc = IS_WIN
      ? spawn(process.env.comspec || 'cmd.exe', ['/c', 'npm', ...baseArgs], { windowsHide: true })
      : spawn('npm', baseArgs)
    let output = ''
    proc.stdout.on('data', (b) => { output += b.toString() })
    proc.stderr.on('data', (b) => { output += b.toString() })
    proc.on('exit', (code) => {
      fs.writeFileSync(path.join(LOG_DIR, 'rollback-reinstall.log'), output)
      const installed = cliVersionOf(path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      const ok = code === 0 && installed === version
      log(`恢复收尾：npm exit=${code}，安装目录版本=${installed || '未知'}，目标=${version} → ${ok ? '成功' : '失败'}`)
      resolve(ok)
    })
    proc.on('error', (err) => {
      log(`恢复进程错误：${err.message}`)
      resolve(false)
    })
  })
}

/** 主题插件位置迁移（幂等）：新版 dsh 的插件解析器只从 profile 自身的
 *  node_modules 解析插件（不再向上查 profiles/node_modules），旧位置的插件
 *  会导致服务以「plugin tree failed to load」退出，迁移后新旧位置均可工作。 */
/** 0.1.7-alpha.2 平台 API 要求 auth_exchange 携带 x-client-platform: desktop-win，
 *  而纯 web 部署默认发 "web"，平台 422 拒绝（登录永远失败）。运行时包内强制改为
 *  win32；npm 更新会还原该文件，故每次启动幂等重打（无锚点=已打过或上游已修，跳过）。 */
function ensureClientPlatformHeader() {
  const lib = path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh-deepseek-account-platform', 'lib', 'index.js')
  try {
    if (!fs.existsSync(lib)) return
    const src = fs.readFileSync(lib, 'utf8')
    const needle = 'desktopClientHeaders(resolved.desktopPlatform)'
    if (!src.includes(needle)) return
    fs.writeFileSync(lib, src.replace(needle, 'desktopClientHeaders("win32")'))
    log(`已补齐 dsh 运行时 x-client-platform 头（desktop-win，平台 422 修复）`)
  } catch (err) {
    log(`x-client-platform 补丁失败（登录可能受影响）：${err.message}`)
  }
}

function ensureProfilePlugin() {
  try {
    const profiles = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const dest = path.join(profiles, 'web', 'node_modules', 'dsh-anime-theme')
    const clientJs = path.join(dest, 'lib', 'client.js')
    // 完整性判定：client.js 存在且含当前版本的功能标记。
    // npm 对齐（应用启动/更新时）会把 registry 装不到的本地插件整个清掉——此时从这里自愈。
    const intact = fs.existsSync(clientJs)
      && fs.readFileSync(clientJs, 'utf8').includes('syncSidebarGlass')
    if (intact) return
    // 壳内置母本（assets/plugin，随打包更新）优先；缺母本时退回旧位置迁移（老版本升级路径）
    const bundled = path.join(ASSET_DIR, 'plugin', 'lib', 'client.js')
    let src = null
    if (fs.existsSync(bundled) && fs.readFileSync(bundled, 'utf8').includes('syncSidebarGlass')) {
      src = path.join(ASSET_DIR, 'plugin')
    } else {
      const legacy = path.join(profiles, 'node_modules', 'dsh-anime-theme')
      if (fs.existsSync(legacy)) src = legacy
    }
    if (!src) {
      log('主题插件缺失且无可用母本，跳过恢复')
      return
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
    log(`主题插件已恢复：${dest}（来源：${src === bundled ? '壳内置母本' : '旧位置迁移'}）`)
  } catch (err) {
    log(`主题插件恢复失败：${err.message}`)
  }
}

function installUpdate(latest, onLine) {
  return new Promise((resolve) => {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
    const baseArgs = ['install', '--prefix', RUNTIME_DIR,
      `@deepseek-ai/dsh@${latest}`, '--registry', NPM_REGISTRY, '--no-audit', '--no-fund']
    log(`开始更新：npm install --prefix ${RUNTIME_DIR} @deepseek-ai/dsh@${latest}`)
    // win 的 npm 是 cmd 批处理需经 cmd /c；mac 的 npm 带 shebang 可直接 spawn
    const proc = IS_WIN
      ? spawn(process.env.comspec || 'cmd.exe', ['/c', 'npm', ...baseArgs], { windowsHide: true })
      : spawn('npm', baseArgs)
    let output = ''
    let buf = ''
    const handleChunk = (b) => {
      const text = b.toString()
      output += text
      buf += text.replace(/\r/g, '\n')
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (line.trim()) onLine(line)
      }
    }
    proc.stdout.on('data', handleChunk)
    proc.stderr.on('data', handleChunk)
    proc.on('exit', (code) => {
      if (buf.trim()) onLine(buf)
      fs.writeFileSync(path.join(LOG_DIR, 'update.log'), output)
      resolve(code === 0)
    })
    proc.on('error', (err) => {
      log(`更新进程错误：${err.message}`)
      onLine(`[错误] ${err.message}`)
      resolve(false)
    })
  })
}

async function runInstall(pick) {
  await stopPrewarmService() // 预热服务占着运行时文件会让 npm 换包 EPERM
  // Windows：dsh web 会在服务进程下再拉一个「端口 worker」（cwd 在运行时 lib 内、与
  // 父进程脱链），taskkill /T 杀不到它；它占着 lib 目录会让 npm 换包 rename 必然
  // EBUSY（实测：worker 在跑时包内文件均可改名、唯独 lib 目录 rename 失败，清掉
  // worker 后立即可）。所以先停服务，再按端口把残留 worker 一并清扫；收尾无论
  // 成败都把服务拉回，保证界面始终可用。
  await stopServer()
  for (const port of [...new Set([serverPort, PREFERRED_PORT, PREWARM_PORT].filter(Boolean))]) {
    await sweepOrphanServer(port)
  }
  // 回退锚点：记下「更新前版本」——新版本起不来时恢复同版本线，避免倒退到更旧的
  // 缓存版本（旧版本可能读不了已前向迁移的会话数据）
  const prev = cliVersionOf(path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  if (prev) {
    try {
      fs.writeFileSync(ROLLBACK_FILE, JSON.stringify({ version: prev, replacedBy: pick.version, at: new Date().toISOString() }))
    } catch { /* 锚点写失败不阻塞更新 */ }
  }
  updateState = { phase: 'installing', version: pick.version, startedAt: Date.now(), log: [], prewarm: 'none' }
  pushBadgeState()
  sendUpdateEvent({ type: 'phase', phase: 'installing', version: pick.version, elapsedSec: 0 })
  const ok = await installUpdate(pick.version, appendUpdateLog)
  // 如实验证：npm 退出码之外再确认安装目录里的版本号确实是目标版本
  const installed = cliVersionOf(path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  const seconds = Math.round((Date.now() - updateState.startedAt) / 1000)
  log(`更新收尾：npm exit=${ok ? 0 : 1}，安装目录版本=${installed || '未知'}，目标=${pick.version}`)
  const stateLog = updateState.log
  if (!ok || installed !== pick.version) {
    const detail = !ok
      ? 'npm install 退出码非 0，详见 update.log'
      : `安装目录版本为 ${installed || '未知'}，与目标 ${pick.version} 不符`
    updateState = { phase: 'failed', version: pick.version, detail, log: stateLog, prewarm: 'none' }
    pushBadgeState()
    sendUpdateEvent({ type: 'phase', phase: 'failed', version: pick.version, detail })
    bringBackService('更新失败，恢复原服务')
    return
  }
  updateState = { phase: 'done', version: pick.version, seconds, log: stateLog, prewarm: 'none' }
  pushBadgeState()
  sendUpdateEvent({ type: 'phase', phase: 'done', version: pick.version, seconds, prewarm: 'none' })
  // 直接拉回新版服务：界面原地切到新版本，不再依赖「重启后生效」
  bringBackService('更新完成，切换到新版本服务')
}

/** 更新收尾后把 dsh 服务拉回并刷新界面：装上了新版本就切过去，失败则回旧版本。
 *  起不来时按回退锚点恢复（与启动自愈同一逻辑），最终失败才提示用户重启应用。 */
async function bringBackService(reason) {
  log(`${reason}`)
  try {
    const install = resolveDshInstall()
    versionRef.value = install ? install.version : null
    await bringUpService(install)
    pushBadgeState()
    log(`服务已拉回：${versionRef.value || '未知'} 版本`)
    return
  } catch (err) {
    if (err.phase === 'present') {
      // 展示阶段失败（服务其实起来了，界面没加载好）：不动运行时，提示重启
      log(`更新后界面加载失败（${err.message}），服务本身已就绪`)
      dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'DeepSeek Harness',
        message: '服务已启动，但界面加载失败，请重启应用',
        detail: `${err.message}\n日志目录：${LOG_DIR}`,
      }).catch(() => {})
      return
    }
    log(`更新后服务拉起失败（${err.message}），尝试按回退锚点恢复`)
    const rb = readRollback()
    if (rb && rb.version) {
      const recovered = await reinstallRuntime(rb.version)
      if (recovered) {
        try {
          const install = resolveDshInstall()
          versionRef.value = install ? install.version : null
          updateState = null
          foundCtx = null
          await bringUpService(install)
          pushBadgeState()
          dialog.showMessageBox(mainWindow, {
            type: 'warning', title: 'DeepSeek Harness',
            message: `新版本服务启动失败，已恢复到更新前的 v${versionRef.value || '未知'}`,
            detail: '会话数据不受影响。可稍后点版本徽标重新检查更新。',
          }).catch(() => {})
          return
        } catch (err2) {
          log(`回退版本也拉不起来（${err2.message}）`)
        }
      }
    }
    dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'DeepSeek Harness',
      message: '更新后服务未能启动，请重启应用',
      detail: `若重启仍失败，应用会自动按回退锚点恢复。\n日志目录：${LOG_DIR}`,
    }).catch(() => {})
  }
}

// ---------------------------------------------------------------- 版本说明（GitHub Releases）

const RELEASES_API = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=20'
const RELEASES_CACHE = path.join(USER_DATA_DIR, 'releases-cache.json')

/** 拉取官方仓库的 GitHub Releases（含各版本更新说明），成功后落盘缓存供离线兜底。 */
function fetchReleases() {
  return new Promise((resolve, reject) => {
    const req = https.get(RELEASES_API, {
      timeout: 15_000,
      headers: { 'User-Agent': 'dsh-desktop', Accept: 'application/vnd.github+json' },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const arr = JSON.parse(data)
          if (!Array.isArray(arr)) throw new Error(arr.message || '响应结构异常')
          const releases = arr
            .filter(r => r.draft !== true)
            .map(r => ({
              tag: r.tag_name || '',
              name: r.name || r.tag_name || '',
              publishedAt: r.published_at || '',
              body: r.body || '',
            }))
          fs.mkdirSync(USER_DATA_DIR, { recursive: true })
          fs.writeFileSync(RELEASES_CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), releases }))
          resolve(releases)
        } catch (err) {
          reject(new Error(`响应解析失败：${err.message}`))
        }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('查询超时（15s）')) })
    req.on('error', (err) => reject(new Error(`网络错误：${err.message}`)))
  })
}

async function handleFetchNotes() {
  try {
    return { ok: true, fromCache: false, releases: await fetchReleases() }
  } catch (err) {
    try {
      const cache = JSON.parse(fs.readFileSync(RELEASES_CACHE, 'utf8'))
      log(`版本说明走缓存（${err.message}）`)
      return { ok: true, fromCache: true, fetchedAt: cache.fetchedAt, releases: cache.releases || [] }
    } catch {
      return { ok: false, error: err.message }
    }
  }
}

/** 取指定版本的 GitHub Releases 更新说明正文（优先网络，失败走本地缓存；找不到返回空串）。 */
async function fetchReleaseBody(version) {
  const match = (releases) => (releases || []).find(r =>
    String(r.tag || '').replace(/^dsh-v/, '') === version ||
    String(r.name || '').replace(/^dsh-v/, '').replace(/^v/, '') === version)
  try {
    const rel = match(await fetchReleases())
    return rel ? (rel.body || '') : ''
  } catch (err) {
    try {
      const cache = JSON.parse(fs.readFileSync(RELEASES_CACHE, 'utf8'))
      log(`新版本说明走缓存（${err.message}）`)
      const rel = match(cache.releases)
      return rel ? (rel.body || '') : ''
    } catch {
      return ''
    }
  }
}

/* ================= 壳自身更新（GitHub Releases → NSIS 静默安装） =================
 * 与 dsh 运行时更新（npm 换包）相互独立：壳更新下载最新 Release 的 Windows 安装包，
 * 下载完成后经安装器 /S 静默安装（customInit 会 taskkill 旧实例），事件推给 notes 弹窗展示。 */
const SHELL_REPO_API = 'https://api.github.com/repos/huantest2024/dsh/releases/latest'
let shellUpdateCtx = null // { current, latest, notes, url, size, path, percent, downloading }

async function fetchJsonWithRetry(url, tries = 3) {
  let lastErr = null
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'dsh-desktop-updater' } })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
      if (i < tries - 1) await new Promise(r => setTimeout(r, 1500))
    }
  }
  throw lastErr
}

function sendShellEvent(payload) {
  if (notesWin && !notesWin.isDestroyed()) notesWin.webContents.send('shell-update-event', payload)
}

async function handleShellCheckUpdate() {
  const current = app.getVersion()
  try {
    const rel = await fetchJsonWithRetry(SHELL_REPO_API)
    const latest = String(rel.tag_name || '').replace(/^v/, '')
    if (!latest || semverCompare(latest, current) <= 0) {
      return { ok: true, uptodate: true, current }
    }
    const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name || '') && /setup/i.test(a.name))
    if (!asset) return { ok: false, error: '最新 Release 未找到 Windows 安装包（Setup.exe）资产' }
    shellUpdateCtx = {
      current, latest, notes: rel.body || '',
      url: asset.browser_download_url, size: asset.size || 0,
      path: null, percent: 0, downloading: false,
    }
    log(`壳更新检测：当前 ${current} → 最新 ${latest}（${Math.round(asset.size / 1048576)}MB）`)
    return { ok: true, found: true, current, latest, size: asset.size, notes: rel.body || '' }
  } catch (err) {
    log(`壳更新检测失败：${err.message}`)
    return { ok: false, error: err.message }
  }
}

function handleShellDownload() {
  if (!shellUpdateCtx || !shellUpdateCtx.url) return { ok: false, error: '尚未检查到壳更新' }
  if (shellUpdateCtx.downloading) return { ok: true }
  shellUpdateCtx.downloading = true
  const dest = path.join(os.tmpdir(), `dsh-desktop-setup-${shellUpdateCtx.latest}.exe`)
  sendShellEvent({ type: 'download-start', latest: shellUpdateCtx.latest, total: shellUpdateCtx.size })
  fetch(shellUpdateCtx.url, { headers: { 'User-Agent': 'dsh-desktop-updater' } }).then(res => {
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const total = parseInt(res.headers.get('content-length') || '0', 10) || shellUpdateCtx.size || 0
    const out = fs.createWriteStream(dest)
    let got = 0
    res.body.on('data', chunk => {
      got += chunk.length
      if (total) {
        const pct = Math.floor((got / total) * 100)
        if (pct !== shellUpdateCtx.percent) {
          shellUpdateCtx.percent = pct
          sendShellEvent({ type: 'download-progress', percent: pct, got, total })
        }
      }
    })
    res.body.pipe(out)
    out.on('finish', () => {
      shellUpdateCtx.path = dest
      shellUpdateCtx.downloading = false
      log(`壳更新安装包下载完成：${dest}`)
      sendShellEvent({ type: 'download-done', path: dest })
    })
    out.on('error', err => {
      shellUpdateCtx.downloading = false
      sendShellEvent({ type: 'download-failed', error: err.message })
    })
  }).catch(err => {
    shellUpdateCtx.downloading = false
    sendShellEvent({ type: 'download-failed', error: err.message })
  })
  return { ok: true }
}

function handleShellInstall() {
  if (!shellUpdateCtx || !shellUpdateCtx.path) return { ok: false, error: '安装包未就绪' }
  const installer = shellUpdateCtx.path
  log(`启动壳更新安装器：${installer}`)
  // 安装器 customInit 负责 taskkill 旧实例；这里延迟退出避免安装器 exe 本身被占用
  spawn(installer, ['/S'], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.exit(0), 1200)
  return { ok: true }
}

/** 检查更新（结果回给渲染层在窗口内就地展示，不再弹任何系统/独立窗口）：
 *  同一次检查并行覆盖两个目标——dsh 运行时（npm registry）与壳自身（GitHub Releases）。
 *  任一发现新版本即进 found 视图；foundCtx.targets 描述每个可更新目标（kind: runtime | shell），
 *  渲染层按 targets 渲染并路由安装动作。返回 { ok, uptodate, current } 或 { ok:false, error }。 */
async function handleCheckUpdate() {
  const current = versionRef.value || ''
  const [runtimePick, shellInfo] = await Promise.all([
    (async () => { try { return pickNewest(await fetchPackument()) } catch { return null } })(),
    handleShellCheckUpdate().catch(() => null),
  ])
  const runtimeNew = runtimePick && current && semverCompare(runtimePick.version, current) > 0
  const shellNew = shellInfo && shellInfo.ok && shellInfo.found
  if (!runtimePick && (!shellInfo || !shellInfo.ok)) {
    // 双源都拉不到才算失败（单源失败不影响另一源的检查结果）
    return { ok: false, error: '运行时与壳的更新源都无法访问（GitHub/registry 连接不稳定，可稍后重试）' }
  }
  log(`更新检测：运行时 ${current || '未知'}→${runtimePick ? runtimePick.version : '?'}${runtimeNew ? '（有更新）' : ''}；壳 ${app.getVersion()}→${shellNew ? shellInfo.latest : '最新'}${shellNew ? '（有更新）' : ''}`)

  if (!runtimeNew && !shellNew) {
    return { ok: true, uptodate: true, current }
  }

  foundCtx = { current: current || '未知', shellCurrent: app.getVersion(), targets: [], notes: '' }
  if (runtimeNew) {
    pendingUpdate = runtimePick
    foundCtx.targets.push({
      kind: 'runtime', latest: runtimePick.version, channel: channelLabel(runtimePick),
      publishedAt: runtimePick.publishedAt ? runtimePick.publishedAt.slice(0, 10) : '',
    })
  }
  if (shellNew) {
    foundCtx.targets.push({
      kind: 'shell', latest: shellInfo.latest, size: shellInfo.size, notes: shellInfo.notes,
    })
  }
  pushBadgeState()
  openNotesWindow()
  // 运行时发布说明走 GitHub（15s 超时才兜缓存）不能挡在跳转前面——先带占位跳转，说明拉到后补发。
  if (runtimeNew) {
    fetchReleaseBody(runtimePick.version).then((body) => {
      if (!foundCtx) return
      const t = foundCtx.targets.find(x => x.kind === 'runtime')
      if (t) t.notes = body
      sendUpdateEvent({ type: 'phase', phase: 'found', ...foundCtx })
    }).catch(() => { /* 说明拿不到就保持占位文案 */ })
  }
  return { ok: true, found: true }
}

// ---------------------------------------------------------------- 托盘与关闭行为

let tray = null
let isQuitting = false
let allowClose = false

/** 托盘图标按任务栏深浅取色：黑色鲸鱼在深色任务栏不可见，深色时用白色版。 */
function trayIconPath() {
  return path.join(ASSET_DIR, nativeTheme.shouldUseDarkColors ? 'icon-light.png' : 'icon.png')
}

function createTray() {
  if (tray) return
  tray = new Tray(trayIconPath())
  tray.setToolTip('DeepSeek Harness')
  tray.on('click', () => showMainWindow())
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  if (!tray) return
  const settings = readSettings()
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '关闭时最小化到托盘',
      type: 'checkbox',
      checked: settings.closeAction === 'tray',
      click: (item) => {
        writeSettings({ closeAction: item.checked ? 'tray' : 'exit' })
        log(`关闭行为设置：${item.checked ? 'tray' : 'exit'}`)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        allowClose = true
        // 服务交接到 before-quit 统一处理（常驻保留，下次启动秒开）
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideToTray() {
  createTray()
  mainWindow.hide()
  const settings = readSettings()
  if (!settings.trayTipShown) {
    writeSettings({ trayTipShown: true })
    try {
      tray.displayBalloon({
        icon: path.join(ASSET_DIR, 'icon.png'),
        title: 'DeepSeek Harness 仍在运行',
        content: '应用已最小化到托盘，点击托盘图标可重新打开；右键菜单可退出或修改关闭行为。',
      })
    } catch { /* 忽略气泡失败 */ }
  }
}

// ---------------------------------------------------------------- 生命周期

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // preload 脚本加载失败会静默失效（桥丢失），必须落日志
  app.on('web-contents-created', (_e, wc) => {
    wc.on('preload-error', (_ev, preloadPath, err) => {
      log(`preload 加载失败：${preloadPath} — ${err.message}`)
    })
  })

  app.on('second-instance', () => {
    // 托盘隐藏态下点桌面快捷方式也要能唤回窗口：必须 show，不能只 focus
    if (mainWindow) showMainWindow()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.huantest2024.dsh')

    const gifs = listAnimeGifs()
    const splashGifPath = gifs.length ? path.join(ANIME_DIR, pickRandom(gifs)) : null

    // 先解析 CLI/版本号，启动页才能显示版本
    splashStatus('正在定位 dsh CLI …')
    ensureProfilePlugin() // 旧位置的主题插件迁移（新版插件解析要求，幂等）
    let install = resolveDshInstall()
    versionRef.value = install ? install.version : null
    log(`dsh CLI：${install ? install.entry : '（npx 兜底）'}，版本：${versionRef.value || '未知'}`)

    // 主题联动：内容页 data-ds-dark-theme 变化 → 自绘顶栏换配色（托盘图标跟随深浅换色）
    ipcMain.on('theme-changed', (event, isDark) => {
      const mode = isDark ? 'dark' : 'light'
      nativeTheme.themeSource = mode
      if (barView && !barView.webContents.isDestroyed()) {
        barView.webContents.send('bar-theme', { dark: !!isDark, accent: barAccentCache, ...BAR_THEMES[mode] })
      }
      // 全局主题强调色联动：sender 就是内容页 webContents，用它异步读 documentElement
      // 上的 --dsh-anime-accent（读取不阻塞上面的深浅切换）。读到后推 bar-accent 给顶栏，
      // 空串=无全局主题色（bar 回退深浅配色）；读失败/页面已销毁则静默跳过
      try {
        const sender = event.sender
        if (sender && !sender.isDestroyed()) {
          sender.executeJavaScript(
            "(function(){try{return getComputedStyle(document.documentElement)" +
            ".getPropertyValue('--dsh-anime-accent').trim()}catch(e){return ''}})()",
          ).then((accent) => {
            barAccentCache = String(accent || '')
            if (barView && !barView.webContents.isDestroyed()) {
              barView.webContents.send('bar-accent', { accent: barAccentCache })
            }
          }).catch(() => { /* 读失败跳过：顶栏保持现有配色 */ })
        }
      } catch { /* 读失败跳过 */ }
      // notes 弹窗可能未打开，推送前必须判空
      if (notesWin && !notesWin.isDestroyed()) {
        notesWin.webContents.send('notes-theme', { dark: !!isDark })
      }
      if (tray && !tray.isDestroyed()) tray.setImage(trayIconPath())
    })

    // 兜底：系统层主题变化（theme-changed 只覆盖内容页主动上报的链路）也同步推给 notes 弹窗；
    // notes 未打开时静默跳过。全文件仅此一处注册，不会重复。
    nativeTheme.on('updated', () => {
      if (notesWin && !notesWin.isDestroyed()) {
        notesWin.webContents.send('notes-theme', { dark: nativeTheme.shouldUseDarkColors })
      }
    })

    // 自绘顶栏按钮动作：窗口控制走窗口本体（close 走询问/托盘逻辑），
    // theme 转发到内容页由 dsh-anime-theme 插件（__dshShellCommand）处理
    ipcMain.on('bar:action', (_event, action) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (action === 'min') mainWindow.minimize()
      else if (action === 'max') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
      else if (action === 'close') mainWindow.close()
      else if (action === 'theme' && contentView && !contentView.webContents.isDestroyed()) {
        contentView.webContents.send('shell-command', 'theme-button')
      }
    })
    // 手动拖动窗口（替代 app-region：其判定区域在 WebContentsView 下
    // 会被错误放大盖住徽章/主题按钮）。begin 快照还原后边界，move 用 screen 增量平移。
    let dragSnap = null
    ipcMain.on('bar:drag-begin', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      const b = mainWindow.getBounds()
      dragSnap = { x: b.x, y: b.y }
    })
    ipcMain.on('bar:drag-move', (_event, dx, dy) => {
      if (!dragSnap || !mainWindow || mainWindow.isDestroyed()) return
      mainWindow.setPosition(dragSnap.x + dx, dragSnap.y + dy)
    })
    ipcMain.on('bar:drag-end', () => { dragSnap = null })
    // 右键拖拽区：系统风格窗口菜单（对齐原生标题栏右键；移动/大小两项对无边框
    // 自绘窗口无实际功能——移动靠拖拽条、大小靠边缘拉伸，故不展示；关闭走 close
    // 事件即原有的询问/托盘逻辑）
    ipcMain.on('bar:context-menu', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const maxed = mainWindow.isMaximized()
      Menu.buildFromTemplate([
        { label: '还原(R)', enabled: maxed, click: () => mainWindow.unmaximize() },
        { label: '最小化(N)', click: () => mainWindow.minimize() },
        { label: '最大化(X)', enabled: !maxed, click: () => mainWindow.maximize() },
        { type: 'separator' },
        { label: '关闭(C)', accelerator: 'Alt+F4', click: () => mainWindow.close() },
      ]).popup({ window: mainWindow })
    })
    ipcMain.handle('check-update', () => {
      // 有进行中/已完成的后台更新时，检查 = 同窗回看进度，不重复检测
      if (updateState) {
        openNotesWindow()
        return { ok: true, inProgress: true, phase: updateState.phase, version: updateState.version }
      }
      return handleCheckUpdate()
    })
    ipcMain.handle('fetch-notes', () => handleFetchNotes())
    ipcMain.handle('notes-state', () => ({
      current: versionRef.value || '',
      update: updateState
        ? { phase: updateState.phase, version: updateState.version, detail: updateState.detail || '' }
        : null,
      available: foundCtx ? foundCtxLabel(foundCtx) : null,
    }))
    ipcMain.on('open-notes', () => openNotesWindow())
    ipcMain.on('update:open-progress', () => openNotesWindow())
    ipcMain.on('update:start', () => {
      if (updateState || !pendingUpdate) return
      runInstall(pendingUpdate).catch((err) => log(`更新流程异常：${err.stack || err.message}`))
    })
    ipcMain.on('update:recheck', () => {
      updateState = null
      pendingUpdate = null
      foundCtx = null
      pushBadgeState()
      handleCheckUpdate()
    })
    ipcMain.on('update:restart', async () => {
      isQuitting = true
      keepServiceOnExit = false // 运行时已更新：旧服务不能被下次启动采纳，必须重启
      if (notesWin && !notesWin.isDestroyed()) notesWin.destroy()
      await stopServer()
      app.relaunch()
      app.exit(0)
    })
    ipcMain.on('update:close', () => {
      if (notesWin && !notesWin.isDestroyed()) notesWin.close()
    })
    // 壳自身更新（与上面的 dsh 运行时更新独立）
    ipcMain.handle('shell-info', () => ({ version: app.getVersion() }))
    ipcMain.handle('shell-update:check', () => handleShellCheckUpdate())
    ipcMain.handle('shell-update:download', () => handleShellDownload())
    ipcMain.handle('shell-update:install', () => handleShellInstall())
    ipcMain.handle('get-settings', () => readSettings())

    createWindow(splashGifPath)

    const failDialog = (err) => {
      log(`启动失败：${err.message}`)
      // 先销毁窗口并置退出标志：避免启动页滞留屏幕、错误框点确定后
      // 又被"关闭行为询问"拦成最小化到托盘，导致进程永远退不出去
      isQuitting = true
      allowClose = true
      keepServiceOnExit = false // 启动失败路径不保留可能不健康的服务
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
      dialog.showErrorBox('DeepSeek Harness 启动失败', `${err.message}\n\n日志目录：${LOG_DIR}`)
      app.exit(0)
    }

    try {
    await bringUpService(install)
    // 新版本正常运行：清掉回退锚点（下次更新时再写）
    try { fs.rmSync(ROLLBACK_FILE, { force: true }) } catch { /* 忽略 */ }
    } catch (err) {
      // 应用内更新运行时若起不来，按序自愈：① 恢复「更新前版本」（同版本线，会话
      // 数据兼容性最稳）；② 恢复失败才清除运行时回退本机其它 CLI。展示阶段的失败
      // （err.phase='present'）不算运行时损坏，不动运行时
      if (err.phase !== 'present' && install && install.entry.startsWith(RUNTIME_DIR)) {
        const rb = readRollback()
        let recovered = false
        if (rb && rb.version) {
          log(`更新运行时启动失败（${err.message}），恢复更新前版本 v${rb.version}`)
          splashStatus(`新版本启动失败，正在恢复 v${rb.version} …`)
          recovered = await reinstallRuntime(rb.version)
        }
        if (recovered) {
          install = resolveDshInstall()
          versionRef.value = install ? install.version : null
          log(`恢复后 CLI：${install ? install.entry : '（npx 兜底）'}，版本：${versionRef.value || '未知'}`)
          try {
            await bringUpService(install)
            try { fs.rmSync(ROLLBACK_FILE, { force: true }) } catch { /* 忽略 */ }
            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'DeepSeek Harness',
              message: `v${rb.replacedBy || '新版本'} 启动失败，已恢复到更新前的 v${versionRef.value || '未知'}`,
              detail: '会话数据不受影响。可稍后点版本徽标重新检查更新（新版本可能已修复问题）。',
            }).catch(() => {})
          } catch (err2) {
            failDialog(err2)
          }
        } else {
          log(`恢复更新前版本失败，清除运行时并回退本机 CLI`)
          try { fs.rmSync(RUNTIME_DIR, { recursive: true, force: true }) } catch (e) {
            log(`清除更新运行时失败：${e.message}`)
          }
          try { fs.rmSync(ROLLBACK_FILE, { force: true }) } catch { /* 忽略 */ }
          install = resolveDshInstall()
          versionRef.value = install ? install.version : null
          log(`回退后 CLI：${install ? install.entry : '（npx 兜底）'}，版本：${versionRef.value || '未知'}`)
          try {
            await bringUpService(install)
            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'DeepSeek Harness',
              message: `上次更新的版本无法启动，已回退到 v${versionRef.value || '未知'}`,
              detail: '若左侧会话列表为空，多为旧版本读不了新版本的会话数据格式，重新检查更新到最新版即可恢复。',
            }).catch(() => {})
          } catch (err2) {
            failDialog(err2)
          }
        }
      } else {
        failDialog(err)
      }
    }

    // 服务已可用后注册登录预热（幂等）：下次开机由 Run 键预启服务，首开免等冷启动
    ensurePrestart(install)
  }).catch((err) => {
    // 启动链早期（建窗/视图阶段）异常：不再静默僵尸挂起，如实弹错退出
    try {
      dialog.showErrorBox('DeepSeek Harness 启动异常', `${err.stack || err.message}\n\n日志目录：${LOG_DIR}`)
    } catch { /* 连对话框都失败时只能退 */ }
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    // 服务常驻化：正常退出保留服务并交接（tryAdoptPrestarted 下次启动直接采纳）；
    // keepServiceOnExit=false（更新重启/启动失败）时维持原有「杀服务」行为
    if (keepServiceOnExit) handoffServer()
    else stopServer()
  })

  process.on('exit', () => {
    if (keepServiceOnExit) return // 常驻服务由交接状态 + 看门狗管理，不随应用退出而死
    const pid = serverProc && serverProc.exitCode === null ? serverProc.pid : adoptedServerPid
    if (pid) {
      try { process.kill(pid) } catch { /* 忽略 */ }
    }
  })
}
