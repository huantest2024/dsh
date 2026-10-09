/**
 * 版本说明与更新窗口（单窗口）共用预加载。
 * dshUpdate：更新阶段事件订阅 + 安装/重启/关闭/重检 + 版本说明拉取与状态。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshUpdate', {
  /** 订阅主进程推送的更新事件（type: phase | log）。 */
  onEvent: (cb) => ipcRenderer.on('update:event', (_e, payload) => cb(payload)),
  /** 开始安装新版本。 */
  start: () => ipcRenderer.send('update:start'),
  /** 更新完成，重启应用生效。 */
  restart: () => ipcRenderer.send('update:restart'),
  /** 放弃当前结果，重新检查更新。 */
  recheck: () => ipcRenderer.send('update:recheck'),
  /** 关闭弹窗（后台安装继续）。 */
  close: () => ipcRenderer.send('update:close'),
  /** 检查更新（有进行中的更新时主进程会改为打开进度窗）。 */
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  /** 拉取官方 GitHub Releases 更新说明（失败走本地缓存）。 */
  fetchNotes: () => ipcRenderer.invoke('fetch-notes'),
  /** 读取当前更新相关状态（当前版本/更新进度/可用新版本）。 */
  notesState: () => ipcRenderer.invoke('notes-state'),
  /** 打开更新进度弹窗。 */
  openProgress: () => ipcRenderer.send('update:open-progress'),
  /** 订阅应用主题（data: { dark: boolean }），主进程在加载完成与主题变化时推送。 */
  onNotesTheme: (cb) => ipcRenderer.on('notes-theme', (event, data) => cb(data)),
  /** 壳自身更新（与 dsh 运行时更新独立）：读壳版本。 */
  shellInfo: () => ipcRenderer.invoke('shell-info'),
  /** 检查壳更新（GitHub Releases 最新版）。 */
  shellCheck: () => ipcRenderer.invoke('shell-update:check'),
  /** 开始下载壳更新安装包（进度经 onShellUpdateEvent 推送）。 */
  shellDownload: () => ipcRenderer.invoke('shell-update:download'),
  /** 下载完成后静默安装并退出（安装器负责拉起新版）。 */
  shellInstall: () => ipcRenderer.invoke('shell-update:install'),
  /** 订阅壳更新事件（type: download-start | download-progress | download-done | download-failed）。 */
  onShellUpdateEvent: (cb) => ipcRenderer.on('shell-update-event', (_e, payload) => cb(payload)),
})
