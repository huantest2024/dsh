/**
 * 壳内弹窗（登录/平台页）顶栏桥：按钮动作转发主进程 + 接收导航状态（标题/可退可进）。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshPopup', {
  action: (a) => ipcRenderer.send('popup:action', a),
  onNav: (cb) => ipcRenderer.on('popup:nav', (_e, state) => cb(state)),
})
