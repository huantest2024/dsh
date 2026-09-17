/**
 * 自绘顶栏预加载：窗口控制与主题面板动作发主进程；接收主题/最大化状态推送。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshBar', {
  /** 按钮动作：min / max / close / theme。 */
  action: (a) => ipcRenderer.send('bar:action', a),
  /** 手动拖动窗口（app-region 已弃用）：begin 快照边界，move 按 screen 增量移窗。 */
  dragBegin: () => ipcRenderer.send('bar:drag-begin'),
  dragMove: (dx, dy) => ipcRenderer.send('bar:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('bar:drag-end'),
  /** 右键拖拽区：弹系统风格窗口菜单（还原/最小化/最大化/关闭）。 */
  showContextMenu: () => ipcRenderer.send('bar:context-menu'),
  /** 点击版本徽标：打开版本说明弹窗（含检查更新入口/进度回看）。 */
  openNotes: () => ipcRenderer.send('open-notes'),
  /** 内容页深浅主题变化（data-ds-dark-theme 上报转发）。 */
  onTheme: (cb) => ipcRenderer.on('bar-theme', (_e, p) => cb(p)),
  /** 窗口最大化/还原状态推送（切换按钮图标）。 */
  onMaximized: (cb) => ipcRenderer.on('bar-maximized', (_e, m) => cb(m)),
  /** 版本徽标状态推送（idle/available/installing/done/failed）。 */
  onBadgeState: (cb) => ipcRenderer.on('badge-state', (_e, p) => cb(p)),
})
