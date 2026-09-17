/**
 * 预加载脚本：向页面暴露受控的桌面能力。
 * 页面（含注入脚本）通过 window.dshDesktop 调用，主进程负责实际逻辑。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  /** 页面主题变化时上报（data-ds-dark-theme 有无）。 */
  reportTheme: (isDark) => ipcRenderer.send('theme-changed', Boolean(isDark)),
  /** 点击版本徽标：打开版本说明弹窗（更新说明 + 检查更新/进度入口）。 */
  openNotes: () => ipcRenderer.send('open-notes'),
  /** 订阅版本徽标更新态推送（idle/available/installing/done/failed）。 */
  onBadgeState: (cb) => ipcRenderer.on('badge-state', (_e, payload) => cb(payload)),
  /** 订阅顶栏（shell bar）转发来的命令（如 theme-button），由主题插件注册 __dshShellCommand 接收。 */
  onShellCommand: (cb) => ipcRenderer.on('shell-command', (_e, cmd) => cb(cmd)),
  /** 读取桌面设置（关闭行为等）。 */
  getSettings: () => ipcRenderer.invoke('get-settings'),
})
