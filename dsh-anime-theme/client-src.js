/**
 * dsh-anime-theme — 浏览器端源码（由 build.mjs 注入素材 JSON 后生成 lib/client.js）
 *
 * 二次元主题 + 主题面板：
 *  - 主题入口双通道：桌面壳顶栏 🎨 按钮（经主进程转发到 window.__dshShellCommand）；无壳桥的环境
 *    （如官方桌面版、纯浏览器）自动在页面右缘挂浮动 🎨 按钮，点击同样开面板
 *  - 面板可切换全局配色主题 / 背景 / 浓度 / 挂件套装 / 挂件大小 / 总开关
 *  - 自定义壁纸支持多张（可新增、可单独删除）；自定义挂件以缩略图管理（可新增、可单独删除）
 *  - 动态壁纸：mp4/webm 存 IndexedDB（可上传/删除），视频层铺满 + 浓度遮罩盖其上
 *  - 侧栏折叠态呈椭圆胶囊悬浮（dsh 原生折叠栏为直角贴边，胶囊效果由插件自造）
 *  - 设置存 localStorage（key: dsh-anime-theme.settings），实时生效、刷新与重启后保留
 *  - 配色主题深色模式全量 token 覆盖、浅色模式仅覆盖强调色与选区；壁纸/玻璃效果仍深浅两套
 *  - 不再调整 dsh 原生控件布局：Session log 等按钮回归原生位置（壳已是独立顶栏，无遮挡）
 *
 * 自定义：assets 里加壁纸/动图套装后重新 build，面板自动出现新选项。
 */
window.__ModuleLoader__.load({
  id: 'dsh-anime-theme',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var ASSETS = __ASSETS_JSON__
    var STORE_KEY = 'dsh-anime-theme.settings'

    var DEFAULTS = { enabled: true, wallpaper: 'anya', density: 'mid', mascotSet: 'random', mascotSize: 'mid', particles: true, particleStyle: 'sakura', theme: 'anya' }
    var LS_WALL = 'dsh-anime-theme.customWallpaper'
    var LS_WALLS = 'dsh-anime-theme.customWallpapers'
    var LS_MASCOTS = 'dsh-anime-theme.customMascots'

    /* 自定义壁纸：多张管理 { id: { name, uri } }。旧版单张（LS_WALL 字符串）首次读取时迁移。 */
    function loadCustomWalls() {
      var walls = {}
      try { walls = JSON.parse(localStorage.getItem(LS_WALLS) || '{}') } catch (e) { walls = {} }
      try {
        var legacy = localStorage.getItem(LS_WALL)
        if (legacy) {
          walls['w' + Date.now()] = { name: '旧壁纸', uri: legacy }
          localStorage.setItem(LS_WALLS, JSON.stringify(walls))
          localStorage.removeItem(LS_WALL)
        }
      } catch (e) { /* 迁移失败不影响读取 */ }
      return walls
    }
    function saveCustomWalls(map) {
      try { localStorage.setItem(LS_WALLS, JSON.stringify(map)); return true } catch (e) { return false }
    }
    function addCustomWall(name, uri) {
      var walls = loadCustomWalls()
      var id = 'w' + Date.now() + Math.floor(Math.random() * 1000)
      walls[id] = { name: name, uri: uri }
      return saveCustomWalls(walls) ? id : null
    }
    function removeCustomWall(id) {
      var walls = loadCustomWalls()
      delete walls[id]
      return saveCustomWalls(walls)
    }
    function loadCustomMascots() {
      try { return JSON.parse(localStorage.getItem(LS_MASCOTS) || '[]') } catch (e) { return [] }
    }
    function saveCustomMascots(arr) {
      try { localStorage.setItem(LS_MASCOTS, JSON.stringify(arr)); return true } catch (e) { return false }
    }

    /* ---------------- 动态壁纸：IndexedDB 封装（视频 Blob 大，localStorage 装不下）----------------
       库 dsh-anime-theme / store videos（keyPath 'id'），记录 { id, name, mime, size, blob, thumb } */

    var VIDEO_MAX = 30 * 1024 * 1024
    var videoMeta = {}   // id → 名称（同步内存缓存，供 wallpaperName 与面板网格直接取用）
    var videoThumbs = {} // id → 缩略图 dataURL（面板网格预览）

    function openVideoDb() {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('dsh-anime-theme', 1)
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains('videos')) req.result.createObjectStore('videos', { keyPath: 'id' })
        }
        req.onsuccess = function () { resolve(req.result) }
        req.onerror = function () { reject(req.error) }
      })
    }
    function idbRun(mode, fn) {
      return openVideoDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var req = fn(db.transaction('videos', mode).objectStore('videos'))
          req.onsuccess = function () { resolve(req.result) }
          req.onerror = function () { reject(req.error) }
        }).then(function (v) { db.close(); return v }, function (e) { db.close(); throw e })
      })
    }
    function idbAll() { return idbRun('readonly', function (s) { return s.getAll() }).then(function (r) { return r || [] }) }
    function idbGet(id) { return idbRun('readonly', function (s) { return s.get(id) }) }
    function idbPut(rec) { return idbRun('readwrite', function (s) { return s.put(rec) }) }
    function idbDel(id) { return idbRun('readwrite', function (s) { return s.delete(id) }) }

    var DENSITY = {
      deep: ['rgba(16,16,18,0.74)', 'rgba(14,14,16,0.82)'],
      mid: ['rgba(16,16,18,0.58)', 'rgba(14,14,16,0.68)'],
      light: ['rgba(16,16,18,0.45)', 'rgba(14,14,16,0.55)'],
    }
    var MASCOT_WIDTH = { small: '110px', mid: '150px', large: '200px' }
    var WALLPAPER_LABELS = { anya: '木屋', lingerie: '幽梦', nightgirls: '花眠', maid: '银姬', silver: '花信', water: '浮光', koi: '锦鲤', roses: '蔷薇', sakura: '樱雪', meadow: '草原', lace: '蕾丝', amethyst: '紫绫' }
    var SET_LABELS = { anya: '阿尼亚', lycoris: '莉可丽丝', yor: '约尔', alya: '艾莉莎', girls100: '百花', roshidere: '败犬', witch: '魔女', mahiru: '邻家' }

    /* 颜色工具：#rrggbb → rgb 三元组串 / rgba() 串（主题 accent 派生透明度变体用） */
    function hexRgb(hex) {
      var n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255)
    }
    function hexRgba(hex, a) { return 'rgba(' + hexRgb(hex) + ',' + a + ')' }

    function loadSettings() {
      try {
        var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
        var s = {}
        for (var k in DEFAULTS) s[k] = saved[k] !== undefined ? saved[k] : DEFAULTS[k]
        // 旧版单张自定义壁纸（wallpaper:'custom'）迁移为多张格式的第一张
        if (s.wallpaper === 'custom') {
          var ids = Object.keys(loadCustomWalls())
          s.wallpaper = ids.length ? 'custom:' + ids[0] : (ASSETS.wallpapers.anya ? 'anya' : 'none')
          saveSettings(s)
        }
        // 旧版「预设组合包」一次性迁移：preset 与新主题 key 同名直接平移；曾拆散组合（preset=null）→ 极简；从未设置 → anya
        if (saved.theme === undefined) {
          s.theme = (typeof saved.preset === 'string' && THEMES.some(function (t) { return t.key === saved.preset }))
            ? saved.preset
            : (saved.preset === null ? 'minimal' : 'anya')
          saveSettings(s) // 立即落盘，同时把存储里的旧 preset 字段清掉
        }
        // 主题值白名单校验（防手改 localStorage）
        if (!THEMES.some(function (t) { return t.key === s.theme })) s.theme = 'anya'
        return s
      } catch (e) {
        return Object.assign({}, DEFAULTS)
      }
    }
    function saveSettings(s) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch (e) { /* 隐私模式等忽略 */ }
    }

    /* ---------------- 样式生成（整套接管：深浅两套全覆盖）---------------- */

    function buildCss(s) {
      /* 以下规则无论主题开关都注入：launcher、Session log 药丸、面板配色。
         药丸背景/hover 色跟随「浓度」设置（深/中/深→浅 → 不透明度递减），深浅模式各自成套；
         两个药丸共用同一组变量与过渡动画，保证 hover 动效一致。 */
      var pillDark = {
        bg: { deep: 'rgba(40,40,44,0.88)', mid: 'rgba(30,30,34,0.62)', light: 'rgba(30,30,34,0.36)' },
        hover: { deep: 'rgba(58,58,64,0.94)', mid: 'rgba(50,50,56,0.78)', light: 'rgba(42,42,48,0.55)' },
      }
      var pillLight = {
        bg: { deep: 'rgba(255,255,255,0.94)', mid: 'rgba(255,255,255,0.66)', light: 'rgba(255,255,255,0.40)' },
        hover: { deep: 'rgba(255,255,255,1)', mid: 'rgba(255,255,255,0.92)', light: 'rgba(255,255,255,0.78)' },
      }
      var density = s.density || 'mid'
      /* 当前主题定义（accent/pillText 供面板与药丸 always-on 使用；dark = null 即极简，不注入任何 dsh token 覆盖） */
      var th = getTheme(s.theme)
      var out = [
        /* 侧栏折叠时隐藏版本徽标：折叠 rail 只有 ~56px，90px 宽的徽标会把
           品牌 logo 和展开切换按钮挤出视野（折叠态展开按钮“消失”的根因） */
        'html[data-dsh-sidebar-collapsed="1"] #dsh-version-badge { display: none !important; }',

        'body[data-ds-dark-theme] { --dsh-pill-bg: ' + pillDark.bg[density] + ' !important;' +
        ' --dsh-pill-hover: ' + pillDark.hover[density] + ' !important; }',
        'body:not([data-ds-dark-theme]) { --dsh-pill-bg: ' + pillLight.bg[density] + ' !important;' +
        ' --dsh-pill-hover: ' + pillLight.hover[density] + ' !important; }',

        /* 两个药丸统一过渡动画与 hover（与顶栏按钮的轻底色 hover 风格一致）。
           浅色模式 hover：白底 + 蓝描边 + 投影（白上变白不可见，必须有可感知变化） */
        'html body [class*="sessionLogButton"] {' +
        ' transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }',
        'body[data-ds-dark-theme] [class*="sessionLogButton"]:hover {' +
        ' background: var(--dsh-pill-hover) !important; }',
        'body:not([data-ds-dark-theme]) [class*="sessionLogButton"]:hover {' +
        ' background: #ffffff !important; border-color: rgba(var(--dsh-anime-accent-light-rgb),0.55) !important;' +
        ' box-shadow: 0 2px 12px rgba(var(--dsh-anime-accent-light-rgb),0.28) !important; }',

        /* Session log 按钮回归原生位置（右上工具簇），仅补玻璃底保证壁纸下可见：
           壳已改为独立顶栏（无 overlay 遮挡），不再做任何定位调整 */
        'html body [class*="sessionLogButton"] { border-radius: 999px !important; background: var(--dsh-pill-bg) !important;' +
        ' border: 1px solid rgba(255,255,255,0.12) !important; color: var(--dsh-anime-pill-text, #cfd6ff) !important; font-size: 12px;' +
        ' backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }',
        'body:not([data-ds-dark-theme]) [class*="sessionLogButton"] { border-color: rgba(0,0,0,0.10) !important; color: #3c3c50 !important; }',

        /* 主题面板：深浅两套配色，跟随 dsh 原生主题切换（Win11 设置式：卡片网格 + 行式分组） */
        '#dsh-anime-panel { background: rgba(249,249,249,0.98) !important; border: 1px solid rgba(0,0,0,0.08) !important; }',
        '#dsh-anime-panel .dsh-panel-title { color: #2c2c2e !important; }',
        '#dsh-anime-panel .dsh-divider { background: rgba(0,0,0,0.08) !important; }',
        '#dsh-anime-panel .dsh-row-label { color: #6b6b70 !important; }',
        '#dsh-anime-panel button.dsh-opt { background: rgba(0,0,0,0.05) !important; border: 1px solid rgba(0,0,0,0.13) !important; color: #55555a !important; }',
        '#dsh-anime-panel button.dsh-opt:hover { background: rgba(0,0,0,0.09) !important; }',
        '#dsh-anime-panel button.dsh-opt.on { background: rgba(var(--dsh-anime-accent-light-rgb),0.14) !important; border-color: var(--dsh-anime-accent-light, #2c5fd6) !important; color: var(--dsh-anime-accent-light, #2c5fd6) !important; }',
        '#dsh-anime-panel button.dsh-off-btn { background: rgba(220,60,60,0.08) !important; border: 1px solid rgba(180,60,60,0.35) !important; color: #b04040 !important; }',
        '#dsh-anime-panel .dsh-close-btn { color: #888 !important; }',
        '#dsh-anime-panel .dsh-close-btn:hover { color: #333 !important; }',
        '#dsh-anime-panel .dsh-set-row { background: rgba(255,255,255,0.85) !important; border: 1px solid rgba(0,0,0,0.06) !important; }',
        '#dsh-anime-panel .dsh-set-row:hover { background: #ffffff !important; border-color: rgba(0,0,0,0.12) !important; }',
        '#dsh-anime-panel .dsh-set-title { color: #2c2c2e !important; }',
        '#dsh-anime-panel .dsh-set-value { color: #8a8a8e !important; }',
        '#dsh-anime-panel .dsh-set-arrow { color: #a0a0a5 !important; }',
        '#dsh-anime-panel .dsh-theme-card { border: 2px solid rgba(0,0,0,0.10) !important; }',
        '#dsh-anime-panel .dsh-theme-card:hover { border-color: rgba(0,0,0,0.28) !important; }',
        '#dsh-anime-panel .dsh-theme-card.on { border-color: var(--dsh-anime-accent-light, #2c5fd6) !important; box-shadow: 0 0 0 2px rgba(var(--dsh-anime-accent-light-rgb),0.25) !important; }',
        '#dsh-anime-panel .dsh-card-name { background: rgba(0,0,0,0.45) !important; color: #fff !important; }',
        '#dsh-anime-panel .dsh-sub-back { color: var(--dsh-anime-accent-light, #2c5fd6) !important; }',
        '#dsh-anime-panel .dsh-sub-back:hover { background: rgba(var(--dsh-anime-accent-light-rgb),0.10) !important; }',
        '#dsh-anime-panel .dsh-sub-title { color: #2c2c2e !important; }',
        '#dsh-anime-panel .dsh-sub-hint { color: #9a9aa0 !important; }',
        '#dsh-anime-panel .dsh-grid-cell { border: 2px solid rgba(0,0,0,0.10) !important; }',
        '#dsh-anime-panel .dsh-grid-cell:hover { border-color: rgba(0,0,0,0.30) !important; }',
        '#dsh-anime-panel .dsh-grid-cell.on { border-color: var(--dsh-anime-accent-light, #2c5fd6) !important; box-shadow: 0 0 0 2px rgba(var(--dsh-anime-accent-light-rgb),0.25) !important; }',
        '#dsh-anime-panel .dsh-cell-name { background: rgba(0,0,0,0.45) !important; color: #fff !important; }',
        '#dsh-anime-panel .dsh-enable-btn { background: transparent !important; border: 1px solid var(--dsh-anime-accent-light, #2c5fd6) !important; color: var(--dsh-anime-accent-light, #2c5fd6) !important; }',
        '#dsh-anime-panel .dsh-enable-btn:hover { background: rgba(var(--dsh-anime-accent-light-rgb),0.10) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel { background: rgba(32,32,34,0.97) !important; border-color: #3c3c3d !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-panel-title { color: #e8e8e8 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-divider { background: #3c3c3d !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-row-label { color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-opt { background: #2d2d30 !important; border-color: #3c3c3d !important; color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-opt:hover { background: #38383c !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-opt.on { background: rgba(var(--dsh-anime-accent-rgb),0.22) !important; border-color: var(--dsh-anime-accent, #4d86fe) !important; color: #cfd6ff !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-off-btn { background: rgba(242,90,90,0.12) !important; border-color: #5a2d2d !important; color: #e8a0a0 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-close-btn { color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-close-btn:hover { color: #e8e8e8 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-set-row { background: rgba(255,255,255,0.045) !important; border-color: rgba(255,255,255,0.07) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-set-row:hover { background: rgba(255,255,255,0.09) !important; border-color: rgba(255,255,255,0.14) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-set-title { color: #e8e8e8 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-set-value { color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-set-arrow { color: #8a8a90 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-theme-card { border-color: rgba(255,255,255,0.14) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-theme-card:hover { border-color: rgba(255,255,255,0.38) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-theme-card.on { border-color: var(--dsh-anime-accent, #4d86fe) !important; box-shadow: 0 0 0 2px rgba(var(--dsh-anime-accent-rgb),0.35) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-card-name { background: rgba(0,0,0,0.55) !important; color: #f0f0f0 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-sub-back { color: var(--dsh-anime-accent, #4d86fe) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-sub-back:hover { background: rgba(var(--dsh-anime-accent-rgb),0.16) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-sub-title { color: #e8e8e8 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-sub-hint { color: #8a8a90 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-grid-cell { border-color: rgba(255,255,255,0.14) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-grid-cell:hover { border-color: rgba(255,255,255,0.38) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-grid-cell.on { border-color: var(--dsh-anime-accent, #4d86fe) !important; box-shadow: 0 0 0 2px rgba(var(--dsh-anime-accent-rgb),0.35) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-cell-name { background: rgba(0,0,0,0.55) !important; color: #f0f0f0 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-enable-btn { border-color: var(--dsh-anime-accent, #4d86fe) !important; color: var(--dsh-anime-accent, #4d86fe) !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-enable-btn:hover { background: rgba(var(--dsh-anime-accent-rgb),0.16) !important; }',

        /* 折叠态椭圆胶囊的内边距收窄：56px rail 加边距后仅剩 ~48px，内层折叠容器保留原生 10px
           左右内边距会裁掉 36px 宽的折叠图标按钮，压到 4px 保证完整显示 */
        'html[data-dsh-sidebar-collapsed="1"] body [class*="sidebarCol"] [class*="_collapsed"] { padding-left: 4px !important; padding-right: 4px !important; }',
      ]
      /* 主题 accent / 药丸文字变量：always-on 注入（面板与药丸配色跟随主题；极简 = 原生蓝兜底）。
         rgb 三元组变量供 rgba(var(--…-rgb), α) 派生透明度变体 */
      out.push(
        'html { --dsh-anime-accent: ' + th.accent + '; --dsh-anime-accent-rgb: ' + hexRgb(th.accent) + ';' +
        ' --dsh-anime-accent-light: ' + th.accentLight + '; --dsh-anime-accent-light-rgb: ' + hexRgb(th.accentLight) + ';' +
        ' --dsh-anime-pill-text: ' + th.pillText + '; }',
      )
      if (!s.enabled) return out.join('\n')
      /* 选中壁纸：内置 key 或 custom:<id>；选中的自定义壁纸已被删时回退默认壁纸 */
      var wall = null
      if (typeof s.wallpaper === 'string' && s.wallpaper.indexOf('custom:') === 0) {
        var cw = loadCustomWalls()
        var hit = cw[s.wallpaper.slice(7)]
        wall = hit ? hit.uri : (ASSETS.wallpapers.anya || null)
      } else {
        wall = ASSETS.wallpapers[s.wallpaper]
      }
      var d = DENSITY[s.density] || DENSITY.mid

      /* ---- 壁纸层：深色压暗、浅色蒙白，两种模式都铺 ---- */
      if (wall) {
        out.push(
          'body[data-ds-dark-theme] { background: linear-gradient(' + d[0] + ',' + d[1] + '),' +
          'url("' + wall + '") center / cover no-repeat fixed #141416 !important; }',
          'body:not([data-ds-dark-theme]) { background: linear-gradient(rgba(244,246,250,' + (d[1] === DENSITY.mid[1] ? '0.66' : s.density === 'deep' ? '0.80' : '0.52') + '),' +
          'rgba(238,241,247,0.60)),' +
          'url("' + wall + '") center / cover no-repeat fixed #eef1f6 !important; }',
        )
      } else {
        /* 无壁纸：深色底取主题 bg-base（非极简时与 token 覆盖一致 = 纯配色模式）；浅色保持原生 */
        out.push(
          'body[data-ds-dark-theme] { background: ' + (th.dark ? th.dark['--dsw-alias-bg-base'] : '#1e1e1e') + ' !important; }',
          'body:not([data-ds-dark-theme]) { background: #f3f3f3 !important; }',
        )
      }

      /* 动态壁纸（video:<id>）：视频装不进 body 背景，视频层是 DOM 元素（z-index:-1，与图片壁纸
         同层——body 底色之上、全部内容之下）；浓度遮罩做独立 DOM 盖在视频上方（同 z-index 靠
         DOM 顺序在后取胜），深浅两套由 CSS 随原生主题切换，无需重渲染 */
      if (typeof s.wallpaper === 'string' && s.wallpaper.indexOf('video:') === 0) {
        out.push(
          'body[data-ds-dark-theme] #dsh-anime-wallpaper-mask { background: linear-gradient(' + d[0] + ',' + d[1] + ') !important; }',
          'body:not([data-ds-dark-theme]) #dsh-anime-wallpaper-mask { background: linear-gradient(rgba(244,246,250,' + (d[1] === DENSITY.mid[1] ? '0.66' : s.density === 'deep' ? '0.80' : '0.52') + '),' +
          'rgba(238,241,247,0.60)) !important; }',
        )
      }

      /* ---- 全局配色主题：dsh token 覆盖（深色全量 / 浅色仅强调三件套），与壁纸解耦、两种模式都注入 ---- */
      if (th.dark) {
        var dkProps = ''
        for (var tk in th.dark) dkProps += tk + ': ' + th.dark[tk] + ' !important; '
        out.push('html body[data-ds-dark-theme] { ' + dkProps + '}')
        var ltProps = ''
        for (var lk in th.lightAccent) ltProps += lk + ': ' + th.lightAccent[lk] + ' !important; '
        out.push('html body:not([data-ds-dark-theme]) { ' + ltProps + '}')
      }

      /* ---- 透明化 + 玻璃卡片 + 静态色 rgba 化：仅壁纸模式注入。
         无壁纸时原生表面直接着主题色（有壁纸 → 玻璃，无壁纸 → 原生表面）---- */
      if (s.wallpaper !== 'none') {
        out.push(
          'html body [class*="frame"], html body [data-conversation-scroll], html body [data-phase], html body [data-slot="conversation"] { background: transparent !important; }',
        )

        /* 玻璃卡底色随主题染色（--dsh-anime-glass-tint），壁纸优先透出 */
        var tint = th.glassTint
        var tr = tint.slice(tint.indexOf('(') + 1, tint.lastIndexOf(','))
        var glassDark = 'linear-gradient(rgba(' + tr + ',0.78),rgba(' + tr + ',0.72))'
        var glassLight = 'linear-gradient(rgba(255,255,255,0.66),rgba(255,255,255,0.56))'
        var blur = 'backdrop-filter: blur(16px) saturate(1.15); -webkit-backdrop-filter: blur(16px) saturate(1.15);'

        out.push(
          /* 侧栏 → 悬浮玻璃卡片：四角对称圆角；左右边距对称（原生拉宽手柄钉在轨道边缘，与卡片边距无关） */
          'html body [class*="sidebarCol"] { margin: 12px 12px 12px 12px; border-radius: 20px; }',
          'html body [class*="sidebarCol"] { background: ' + glassDark + ' !important; ' + blur +
          ' border: 1px solid rgba(255,255,255,0.09);' +
          ' box-shadow: inset 0 1px rgba(255,255,255,0.07), 0 10px 34px rgba(0,0,0,0.35) !important; }',
          /* 切换/拖拽动画期间（JS 挂 .dsh-anim）：暂停 backdrop-filter——宽度动画×模糊
             每帧重算是掉帧大户；渐变底色保留，视觉上玻璃感暂代、动完即恢复 */
          'html body [class*="sidebarCol"].dsh-anim { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
          'html body:not([data-ds-dark-theme]) [class*="sidebarCol"] { background: ' + glassLight + ' !important;' +
          ' border: 1px solid rgba(255,255,255,0.65); box-shadow: inset 0 1px #fff, 0 10px 30px rgba(80,90,120,0.16) !important; }',
          /* 侧栏加边距后内部多级元素仍按 280px 固定宽排版，会话/工作区行会溢出卡片：
             根节点与全部子级统一约束到卡片宽度内 */
          'html body [class*="sidebarCol"] > div > [class*="_root"] { width: 100% !important; max-width: 100% !important; }',
          'html body [class*="sidebarCol"] div { max-width: 100% !important; min-width: 0 !important; }',
          /* 关键：设置抽屉等 fixed 弹层挂在侧栏内部，backdrop-filter 会劫持 fixed 包含块，
             把抽屉压进侧栏宽度里。弹层存在时必须摘掉侧栏的 blur（同 Aqua 插件的兼容做法） */
          'html body [class*="sidebarCol"]:has([role="dialog"], [class*="Overlay"], [class*="overlay"]) ' +
          '{ backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
          /* 输入框 → 玻璃圆角卡片 */
          'html body [data-composer-card] { background: ' + glassDark + ' !important; ' + blur +
          ' border: 1px solid rgba(255,255,255,0.10) !important; border-radius: 24px !important;' +
          ' box-shadow: inset 0 1px rgba(255,255,255,0.08), 0 10px 36px rgba(0,0,0,0.38) !important; }',
          'html body:not([data-ds-dark-theme]) [data-composer-card] { background: ' + glassLight + ' !important;' +
          ' border: 1px solid rgba(255,255,255,0.7) !important; box-shadow: inset 0 1px #fff, 0 10px 32px rgba(80,90,120,0.18) !important; }',
          /* 弹层菜单/对话框 → 磨砂（弹层自身加 blur 不影响其内部 fixed 定位） */
          'html body [data-shell-overlay] [role="dialog"], html body [role="menu"] { ' + blur + ' }',
        )

        /* ---- 深色色板 rgba 化（玻璃感补强；非极简随主题带色相，极简保持原生中性灰）---- */
        if (th.dark) {
          var D = th.dark
          out.push(
            'html body[data-ds-dark-theme] {' +
            '--dsw-static-neutral-bluish-950: ' + hexRgba(D['--dsw-alias-bg-base'], 0.74) + ';' +
            '--dsw-static-neutral-bluish-900: ' + hexRgba(D['--dsw-specific-sidebar-fill'], 0.72) + ';' +
            '--dsw-static-neutral-bluish-875: ' + hexRgba(D['--dsw-alias-bg-layer-1'], 0.66) + ';' +
            '--dsw-static-neutral-bluish-850: ' + hexRgba(D['--dsw-alias-bg-layer-2'], 0.74) + ';' +
            '--dsw-static-neutral-bluish-800: ' + hexRgba(D['--dsw-alias-bg-overlay'], 0.82) + ';' +
            '--dsw-static-neutral-bluish-700: ' + hexRgba(D['--dsw-alias-bg-overlay'], 0.85) + ';' +
            '--dsw-static-neutral-850: ' + hexRgba(D['--dsw-alias-bg-layer-2'], 0.80) + ';' +
            '--dsw-static-neutral-800: ' + hexRgba(D['--dsw-alias-bg-overlay'], 0.82) + ';' +
            '--dsw-static-neutral-700: ' + hexRgba(D['--dsw-alias-bg-overlay'], 0.85) + ';' +
            '--dsw-specific-sidebar-nav-item-active-accent: ' + D['--dsw-specific-sidebar-nav-item-active-accent'] + ';' +
            '}',
          )
        } else {
          out.push(
            'html body[data-ds-dark-theme] {' +
            '--dsw-static-neutral-bluish-950: rgba(26,26,28,0.74);' +
            '--dsw-static-neutral-bluish-900: rgba(27,27,29,0.72);' +
            '--dsw-static-neutral-bluish-875: rgba(24,24,26,0.66);' +
            '--dsw-static-neutral-bluish-850: rgba(32,32,34,0.74);' +
            '--dsw-static-neutral-bluish-800: rgba(40,40,43,0.82);' +
            '--dsw-static-neutral-bluish-700: rgba(94,94,97,0.85);' +
            '--dsw-static-neutral-850: rgba(37,37,38,0.80);' +
            '--dsw-static-neutral-800: rgba(41,41,41,0.82);' +
            '--dsw-static-neutral-700: rgba(60,60,61,0.85);' +
            '--dsw-specific-sidebar-nav-item-active-accent: rgba(77,134,254,0.28);' +
            '}',
          )
        }
      }

      /* ---- 细节：选区按主题注入（极简不注入，保持原生蓝选区）---- */
      if (th.selection) {
        out.push(
          'html body[data-ds-dark-theme] ::selection { background: ' + th.selection + '; }',
          'html body:not([data-ds-dark-theme]) ::selection { background: ' + th.selectionLight + '; }',
        )
      }
      return out.join('\n')
    }

    function pickMascotUri(s) {
      var pool = []
      if (s.mascotSet === 'random') {
        for (var k in ASSETS.gifs) pool = pool.concat(ASSETS.gifs[k])
        pool = pool.concat(loadCustomMascots())
      } else if (s.mascotSet === 'mine') {
        pool = loadCustomMascots()
      } else {
        pool = ASSETS.gifs[s.mascotSet] || []
      }
      if (pool.length === 0) return null
      return pool[Math.floor(Math.random() * pool.length)]
    }

    /* ---------------- 自定义素材（壁纸/挂件上传与删除）---------------- */

    function pickFile(accept, multiple, cb) {
      var input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      if (multiple) input.multiple = true
      input.style.display = 'none'
      document.body.appendChild(input)
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || [])
        input.remove()
        cb(files)
      })
      input.click()
    }

    function fileToDataUri(file, cb) {
      var reader = new FileReader()
      reader.onload = function () { cb(reader.result) }
      reader.readAsDataURL(file)
    }

    function downscaleImage(dataUri, maxEdge, cb) {
      var img = new Image()
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight
        var ratio = Math.min(1, maxEdge / Math.max(w, h))
        var c = document.createElement('canvas')
        c.width = Math.round(w * ratio)
        c.height = Math.round(h * ratio)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        cb(c.toDataURL('image/jpeg', 0.82))
      }
      img.src = dataUri
    }

    /** 自定义壁纸上传：支持一次多选，逐张压缩后入库（多张管理，可单独删除）。 */
    function uploadWallpapers(onDone) {
      pickFile('image/*', true, function (files) {
        if (!files.length) return
        var done = 0
        var okCount = 0
        files.forEach(function (f) {
          fileToDataUri(f, function (uri) {
            downscaleImage(uri, 1920, function (small) {
              if (addCustomWall(f.name || '壁纸', small)) okCount++
              if (++done === files.length) {
                if (okCount > 0) onDone()
                else alert('自定义壁纸保存失败：图片过大（localStorage 上限约 5MB），请换小一些的图片')
              }
            })
          })
        })
      })
    }

    function uploadMascots(onDone) {
      pickFile('image/gif', true, function (files) {
        if (!files.length) return
        var uris = loadCustomMascots()
        var done = 0
        files.forEach(function (f) {
          fileToDataUri(f, function (uri) {
            uris.push(uri)
            if (++done === files.length) {
              if (saveCustomMascots(uris)) onDone()
              else alert('自定义挂件保存失败：GIF 总量过大（localStorage 上限约 5MB），请减少数量')
            }
          })
        })
      })
    }

    /** 视频截帧：blob URL 喂隐藏 video，seek 到 0.5 秒后 canvas 168×96 截 jpeg 作缩略图；
        编码不受支持等截帧失败时回调 null（网格降级为 🎬 占位，不影响入库与播放） */
    function videoThumb(file, cb) {
      var url = URL.createObjectURL(file)
      var video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:168px;height:96px;pointer-events:none;opacity:0;'
      var done = false
      function finish(dataUri) {
        if (done) return
        done = true
        URL.revokeObjectURL(url)
        video.removeAttribute('src')
        video.remove()
        cb(dataUri)
      }
      video.addEventListener('loadeddata', function () {
        try { video.currentTime = 0.5 } catch (e) { finish(null) }
      })
      video.addEventListener('seeked', function () {
        try {
          var c = document.createElement('canvas')
          c.width = 168
          c.height = 96
          c.getContext('2d').drawImage(video, 0, 0, 168, 96)
          finish(c.toDataURL('image/jpeg', 0.8))
        } catch (e) { finish(null) }
      })
      video.addEventListener('error', function () { finish(null) })
      document.body.appendChild(video)
      video.src = url
    }

    /** 动态壁纸上传：mp4/webm 可多选；单文件超 30MB 提示并跳过；Blob 入 IndexedDB（截帧作缩略图） */
    function uploadVideos(onDone) {
      pickFile('video/mp4,video/webm', true, function (files) {
        if (!files.length) return
        var pending = 0
        files.forEach(function (f) {
          if (f.size > VIDEO_MAX) {
            alert('「' + (f.name || '视频') + '」超过 30MB，已跳过')
            return
          }
          pending++
          videoThumb(f, function (thumb) {
            var rec = {
              id: 'v' + Date.now() + Math.floor(Math.random() * 1000),
              name: f.name || '动态壁纸', mime: f.type || 'video/mp4', size: f.size, blob: f, thumb: thumb,
            }
            idbPut(rec).then(function () {
              videoMeta[rec.id] = rec.name
              videoThumbs[rec.id] = rec.thumb
              if (--pending === 0) onDone()
            }).catch(function () {
              alert('动态壁纸保存失败：IndexedDB 不可用')
              if (--pending === 0) onDone()
            })
          })
        })
      })
    }

    /* ---------------- DOM 构建（纯 createElement，规避 Trusted Types）---------------- */

    function el(tag, style, text) {
      var node = document.createElement(tag)
      if (style) node.style.cssText = style
      if (text !== undefined) node.textContent = text
      return node
    }

    function optionRow(label, options, current, onPick) {
      var row = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 10px;')
      var lab = el('div', 'width:46px;font-size:11px;flex-shrink:0;', label)
      lab.className = 'dsh-row-label'
      row.appendChild(lab)
      options.forEach(function (opt) {
        var btn = el('button', 'padding:3px 10px;font-size:11px;border-radius:10px;cursor:pointer;', opt.label)
        btn.className = 'dsh-opt' + (opt.value === current ? ' on' : '')
        btn.addEventListener('click', function () { onPick(opt.value) })
        row.appendChild(btn)
      })
      return row
    }

    /* ---------------- 主题面板（Win11 设置式：配色主题卡片网格 + 行式分组 + 子页导航）---------------- */

    /** 全局配色主题（与壁纸彻底解耦，只改全局配色）：
        dark = 深色模式 --dsw-* token 覆盖表（官方白名单 alias/specific token + accent 三件套补充 token）；
        lightAccent = 浅色模式仅覆盖 accent 三件套（降亮度可读变体；浅色背景/文字/边框一律保持原生）；
        selection / selectionLight = 深浅模式文字选区色（极简不注入 = 原生蓝）；
        accent / accentLight = 面板与药丸强调色（深/浅两套可读变体）；glassTint = 壁纸模式玻璃卡染色；pillText = 药丸文字色。
        极简 = dark/lightAccent/selection 均为 null，不注入任何覆盖，等同 dsh 原生观感。 */
    var THEMES = [
      {
        key: 'anya', label: '阿尼亚', accent: '#f08caa', accentLight: '#d4668a',
        dark: {
          '--dsw-alias-bg-base': '#1f171a',
          '--dsw-alias-bg-layer-1': '#291f23',
          '--dsw-alias-bg-layer-2': '#2f2429',
          '--dsw-alias-bg-overlay': '#48333c',
          '--dsw-specific-sidebar-fill': '#241b1f',
          '--dsw-alias-border-l1': 'rgba(255,235,240,0.07)',
          '--dsw-alias-border-l2': 'rgba(255,235,240,0.13)',
          '--dsw-alias-label-primary': '#f5e9ee',
          '--dsw-alias-label-secondary': '#c2a3b0',
          '--dsw-alias-brand-primary': '#f2c4d4',
          '--dsw-alias-state-business-primary': '#f08caa',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#f08caa',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(240,140,170,0.28)',
        },
        lightAccent: {
          '--dsw-alias-state-business-primary': '#d4668a',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#d4668a',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(212,102,138,0.25)',
        },
        selection: 'rgba(240,140,170,0.32)', selectionLight: 'rgba(212,102,138,0.30)',
        glassTint: 'rgba(48,28,34,0.78)', pillText: '#f2d7e0',
      },
      {
        key: 'lycoris', label: '莉可丽丝', accent: '#e35c6a', accentLight: '#c94455',
        dark: {
          '--dsw-alias-bg-base': '#1e1417',
          '--dsw-alias-bg-layer-1': '#281b1f',
          '--dsw-alias-bg-layer-2': '#2e2024',
          '--dsw-alias-bg-overlay': '#462c32',
          '--dsw-specific-sidebar-fill': '#231719',
          '--dsw-alias-border-l1': 'rgba(255,230,230,0.07)',
          '--dsw-alias-border-l2': 'rgba(255,230,230,0.13)',
          '--dsw-alias-label-primary': '#f6eaea',
          '--dsw-alias-label-secondary': '#c4a0a4',
          '--dsw-alias-brand-primary': '#f2bfc4',
          '--dsw-alias-state-business-primary': '#e35c6a',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#e35c6a',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(227,92,106,0.28)',
        },
        lightAccent: {
          '--dsw-alias-state-business-primary': '#c94455',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#c94455',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(201,68,85,0.25)',
        },
        selection: 'rgba(227,92,106,0.32)', selectionLight: 'rgba(201,68,85,0.30)',
        glassTint: 'rgba(46,24,28,0.78)', pillText: '#f2d3d5',
      },
      {
        key: 'yor', label: '约尔', accent: '#d4a843', accentLight: '#a97f1f',
        dark: {
          '--dsw-alias-bg-base': '#191422',
          '--dsw-alias-bg-layer-1': '#221b2e',
          '--dsw-alias-bg-layer-2': '#282036',
          '--dsw-alias-bg-overlay': '#3c3050',
          '--dsw-specific-sidebar-fill': '#1e1828',
          '--dsw-alias-border-l1': 'rgba(240,225,255,0.07)',
          '--dsw-alias-border-l2': 'rgba(240,225,255,0.13)',
          '--dsw-alias-label-primary': '#f0eaf4',
          '--dsw-alias-label-secondary': '#a894be',
          '--dsw-alias-brand-primary': '#e6d2a0',
          '--dsw-alias-state-business-primary': '#d4a843',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#d4a843',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(212,168,67,0.28)',
        },
        lightAccent: {
          '--dsw-alias-state-business-primary': '#a97f1f',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#a97f1f',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(169,127,31,0.25)',
        },
        selection: 'rgba(212,168,67,0.30)', selectionLight: 'rgba(169,127,31,0.30)',
        glassTint: 'rgba(34,26,46,0.78)', pillText: '#e9ddc2',
      },
      {
        key: 'alya', label: '艾莉莎', accent: '#6f9fe8', accentLight: '#3d6fc4',
        dark: {
          '--dsw-alias-bg-base': '#14181f',
          '--dsw-alias-bg-layer-1': '#1c222c',
          '--dsw-alias-bg-layer-2': '#212937',
          '--dsw-alias-bg-overlay': '#31405c',
          '--dsw-specific-sidebar-fill': '#181d26',
          '--dsw-alias-border-l1': 'rgba(225,238,255,0.07)',
          '--dsw-alias-border-l2': 'rgba(225,238,255,0.13)',
          '--dsw-alias-label-primary': '#eaeff7',
          '--dsw-alias-label-secondary': '#97a6c0',
          '--dsw-alias-brand-primary': '#c8dcf5',
          '--dsw-alias-state-business-primary': '#6f9fe8',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#6f9fe8',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(111,159,232,0.28)',
        },
        lightAccent: {
          '--dsw-alias-state-business-primary': '#3d6fc4',
          '--dsw-alias-brand-primary-new-colorprimary-new-color': '#3d6fc4',
          '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(61,111,196,0.25)',
        },
        selection: 'rgba(111,159,232,0.32)', selectionLight: 'rgba(61,111,196,0.30)',
        glassTint: 'rgba(24,32,44,0.78)', pillText: '#d3e0f2',
      },
      {
        key: 'minimal', label: '极简', accent: '#4d86fe', accentLight: '#2c5fd6',
        dark: null, lightAccent: null, selection: null, selectionLight: null,
        glassTint: 'rgba(30,30,34,0.78)', pillText: '#cfd6ff',
      },
    ]

    /** 按 key 取主题定义；未知 key 回退首个（anya） */
    function getTheme(key) {
      for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === key) return THEMES[i]
      return THEMES[0]
    }

    /** 壁纸/挂件当前值的展示名 */
    function wallpaperName(s) {
      if (s.wallpaper === 'none') return '无'
      if (typeof s.wallpaper === 'string' && s.wallpaper.indexOf('video:') === 0) {
        return videoMeta[s.wallpaper.slice(6)] || '动态壁纸'
      }
      if (typeof s.wallpaper === 'string' && s.wallpaper.indexOf('custom:') === 0) {
        var hit = loadCustomWalls()[s.wallpaper.slice(7)]
        var name = hit ? (hit.name || '自定义') : '自定义'
        var dot = name.lastIndexOf('.')
        if (dot > 0) name = name.slice(0, dot)
        return name
      }
      return WALLPAPER_LABELS[s.wallpaper] || s.wallpaper
    }
    function mascotSetName(s) {
      if (s.mascotSet === 'random') return '随机'
      if (s.mascotSet === 'mine') return '我的'
      if (s.mascotSet === 'none') return '无'
      return SET_LABELS[s.mascotSet] || s.mascotSet
    }
    var PARTICLE_LABELS = { sakura: '樱花', firefly: '萤火', snow: '落雪' }

    /** 分组行（图标 + 标题 + 当前值 + › 箭头），点击进子页 */
    function setRow(icon, title, valueText, onOpen) {
      var row = el('button', 'display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;margin:0 0 6px;' +
        'border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;')
      row.className = 'dsh-set-row'
      row.appendChild(el('div', 'font-size:16px;width:22px;text-align:center;flex-shrink:0;', icon))
      var mid = el('div', 'flex:1;min-width:0;')
      var t = el('div', 'font-size:12.5px;font-weight:600;', title)
      t.className = 'dsh-set-title'
      var v = el('div', 'font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', valueText)
      v.className = 'dsh-set-value'
      mid.appendChild(t)
      mid.appendChild(v)
      row.appendChild(mid)
      var ar = el('div', 'font-size:13px;flex-shrink:0;', '›')
      ar.className = 'dsh-set-arrow'
      row.appendChild(ar)
      row.addEventListener('click', onOpen)
      return row
    }

    /** 主题卡 = 组合预设预览（Win11 式）：壁纸缩略图打底 + 右上角主题色块点缀，
        点击应用整套（配色 + 推荐壁纸 + 推荐挂件）；配色与背景仍是独立设置项，
        应用后单独换壁纸不动主题配色、单独换主题不动壁纸 */
    var THEME_BUNDLES = {
      anya: { wall: 'anya', mascot: 'random' },
      lycoris: { wall: 'nightgirls', mascot: 'lycoris' },
      yor: { wall: 'lingerie', mascot: 'yor' },
      alya: { wall: 'silver', mascot: 'alya' },
      minimal: { wall: 'none', mascot: 'random' },
    }

    /** 主题卡卡面：推荐壁纸打底 + 右上角三色块点缀（体现配色）+ 底部名称条；
        无壁纸的主题（极简）用纯配色缩影 */
    function themeCard(def, settings, onChange) {
      var bundle = THEME_BUNDLES[def.key] || { wall: 'none', mascot: 'random' }
      var card = el('button', 'position:relative;width:100%;height:58px;border-radius:8px;overflow:hidden;cursor:pointer;padding:0;font-family:inherit;')
      card.className = 'dsh-theme-card' + (settings.theme === def.key ? ' on' : '')
      var wallUri = bundle.wall !== 'none' && ASSETS.wallpapers[bundle.wall] ? ASSETS.wallpapers[bundle.wall] : null
      if (wallUri) {
        card.style.background = 'url(' + wallUri + ') center/cover'
        /* 右上角三色块：该主题的全局配色缩影（accent / 侧栏底 / 内容底） */
        var swatches = el('div', 'position:absolute;top:4px;right:4px;display:flex;gap:2px;')
        swatches.className = 'dsh-card-swatches'
        var swColors = [def.accent, def.dark['--dsw-specific-sidebar-fill'], def.dark['--dsw-alias-bg-base']]
        swColors.forEach(function (c) {
          var s = el('div', 'width:8px;height:8px;border-radius:2px;border:1px solid rgba(255,255,255,0.35);')
          s.style.background = c
          swatches.appendChild(s)
        })
        card.appendChild(swatches)
      } else {
        /* 无壁纸：迷你窗口配色缩影 */
        var pv = def.dark
          ? {
            surface: def.dark['--dsw-alias-bg-layer-1'],
            side: def.dark['--dsw-specific-sidebar-fill'],
            border: def.dark['--dsw-alias-border-l1'],
            text: def.dark['--dsw-alias-label-primary'],
            textDim: def.dark['--dsw-alias-label-secondary'],
            nav: def.dark['--dsw-specific-sidebar-nav-item-active-accent'],
            accent: def.accent,
          }
          : { surface: '#2b2b2e', side: '#202124', border: 'rgba(255,255,255,0.08)', text: '#e8e8e8', textDim: '#9aa0a6', nav: 'rgba(77,134,254,0.28)', accent: '#4d86fe' }
        var mini = el('div', 'position:absolute;inset:0;display:flex;overflow:hidden;')
        mini.style.background = pv.surface
        var side = el('div', 'width:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;')
        side.style.background = pv.side
        side.style.borderRight = '1px solid ' + pv.border
        var nav = el('div', 'width:70%;height:5px;border-radius:2px;')
        nav.style.background = pv.nav
        side.appendChild(nav)
        var content = el('div', 'flex:1;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:4px 6px;')
        var line1 = el('div', 'height:3px;width:72%;border-radius:2px;opacity:0.85;')
        line1.style.background = pv.text
        var lineDim = el('div', 'height:3px;width:58%;border-radius:2px;opacity:0.6;')
        lineDim.style.background = pv.textDim
        var btn = el('div', 'height:8px;width:34%;border-radius:4px;')
        btn.style.background = pv.accent
        content.appendChild(line1)
        content.appendChild(lineDim)
        content.appendChild(btn)
        mini.appendChild(side)
        mini.appendChild(content)
        card.appendChild(mini)
      }
      var nameBar = el('div', 'position:absolute;left:0;right:0;bottom:0;font-size:10px;line-height:17px;text-align:center;', def.label)
      nameBar.className = 'dsh-card-name'
      card.appendChild(nameBar)
      card.title = '应用「' + def.label + '」主题（配色' + (wallUri ? ' + 推荐壁纸 + 推荐挂件' : '') + '）'
      card.addEventListener('click', function () {
        onChange({ theme: def.key, wallpaper: bundle.wall, mascotSet: bundle.mascot, enabled: true })
      })
      return card
    }

    /** 子页网格单元：缩略图打底 + 底部名称条；delCb 提供时悬停出现 ✕ 删除角标 */
    function gridCell(previewUri, name, selected, onPick, delCb, emptyText) {
      var cell = el('button', 'position:relative;width:100%;height:54px;border-radius:8px;overflow:hidden;cursor:pointer;padding:0;font-family:inherit;')
      cell.className = 'dsh-grid-cell' + (selected ? ' on' : '')
      if (previewUri) {
        cell.style.background = 'url(' + previewUri + ') center/cover'
      } else {
        cell.style.background = 'linear-gradient(135deg,#4a4a52,#6b6b74)'
        cell.appendChild(el('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;', emptyText || name))
      }
      var nameBar = el('div', 'position:absolute;left:0;right:0;bottom:0;font-size:10px;line-height:16px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 3px;', name)
      nameBar.className = 'dsh-cell-name'
      cell.appendChild(nameBar)
      if (delCb) {
        var del = el('button', 'position:absolute;top:3px;right:3px;width:16px;height:16px;line-height:14px;font-size:10px;' +
          'border-radius:50%;border:1px solid rgba(128,128,128,0.6);cursor:pointer;padding:0;text-align:center;opacity:0;' +
          'transition:opacity 0.12s;background:rgba(30,30,32,0.9);color:#eee;', '✕')
        del.title = '删除'
        cell.appendChild(del)
        cell.addEventListener('mouseenter', function () { del.style.opacity = '1' })
        cell.addEventListener('mouseleave', function () { del.style.opacity = '0' })
        del.addEventListener('click', function (ev) { ev.stopPropagation(); delCb() })
      }
      cell.addEventListener('click', onPick)
      return cell
    }

    function buildPanel(settings, onChange, state) {
      var panel = el('div', 'position:fixed;top:40px;right:10px;width:344px;max-height:calc(100vh - 56px);' +
        'overflow:hidden;display:flex;flex-direction:column;padding:0;border-radius:12px;z-index:2147483002;' +
        'font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;')
      panel.id = 'dsh-anime-panel'

      /* 标题行：主页显示标题 + ✕；子页显示 ‹ 返回 + 面包屑 */
      var SUB_TITLES = { wall: '背景', mascot: '挂件', effects: '动态效果' }
      var head = el('div', 'display:flex;align-items:center;gap:8px;padding:12px 14px 10px;flex-shrink:0;')
      if (state.page !== 'main') {
        var back = el('button', 'background:transparent;border:none;cursor:pointer;font-size:13px;line-height:1;' +
          'padding:4px 8px;border-radius:6px;font-family:inherit;', '‹ 返回')
        back.className = 'dsh-sub-back'
        back.addEventListener('click', function () { onChange({ __nav: 'main' }) })
        head.appendChild(back)
        var crumb = el('div', 'font-size:13px;font-weight:600;', '个性化 › ' + (SUB_TITLES[state.page] || ''))
        crumb.className = 'dsh-panel-title'
        head.appendChild(crumb)
      } else {
        var title = el('div', 'font-size:13px;font-weight:600;flex:1;', '🎨 个性化')
        title.className = 'dsh-panel-title'
        head.appendChild(title)
        var closeBtn = el('button', 'background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;', '✕')
        closeBtn.className = 'dsh-close-btn'
        closeBtn.title = '关闭面板'
        closeBtn.addEventListener('click', function () { onChange({ __closePanel: true }) })
        head.appendChild(closeBtn)
      }
      panel.appendChild(head)

      var body = el('div', 'overflow-y:auto;padding:0 14px 14px;')
      panel.appendChild(body)

      /* 「主题已关闭」空状态：关闭态只渲染说明与显式开启按钮，不渲染任何设置项
         （修复「恢复原生」后主题被静默开回——任何入口都不再隐式改 enabled） */
      if (!settings.enabled) {
        var empty = el('div', 'display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px 10px 20px;')
        empty.appendChild(el('div', 'font-size:26px;line-height:1;margin-bottom:10px;', '🎨'))
        var eTitle = el('div', 'font-size:13px;font-weight:600;margin-bottom:8px;', '主题已关闭')
        eTitle.className = 'dsh-panel-title'
        empty.appendChild(eTitle)
        var eHint = el('div', 'font-size:11.5px;line-height:1.7;margin-bottom:2px;', '当前为 dsh 原生界面。')
        eHint.className = 'dsh-sub-hint'
        empty.appendChild(eHint)
        var eHint2 = el('div', 'font-size:11.5px;line-height:1.7;margin-bottom:16px;', '开启主题后可使用配色主题、壁纸、挂件与动态效果。')
        eHint2.className = 'dsh-sub-hint'
        empty.appendChild(eHint2)
        var onBtn = el('button', 'padding:6px 18px;font-size:12px;border-radius:8px;cursor:pointer;font-family:inherit;', '开启主题')
        onBtn.className = 'dsh-enable-btn'
        onBtn.addEventListener('click', function () { onChange({ enabled: true }) })
        empty.appendChild(onBtn)
        body.appendChild(empty)
        return panel
      }

      if (state.page === 'wall') {
        buildWallPage(body, settings, onChange)
      } else if (state.page === 'mascot') {
        buildMascotPage(body, settings, onChange)
      } else if (state.page === 'effects') {
        buildEffectsPage(body, settings, onChange)
      } else {
        buildMainPage(body, settings, onChange)
      }
      return panel
    }

    /** 主页：配色主题卡片网格 + 三个分组行 + 恢复原生 */
    function buildMainPage(body, settings, onChange) {
      var secTitle = el('div', 'font-size:11px;font-weight:600;margin:2px 0 8px;', '主题')
      secTitle.className = 'dsh-row-label'
      body.appendChild(secTitle)
      var grid = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;')
      THEMES.forEach(function (def) { grid.appendChild(themeCard(def, settings, onChange)) })
      body.appendChild(grid)

      body.appendChild(setRow('🖼️', '背景', wallpaperName(settings), function () { onChange({ __nav: 'wall' }) }))
      body.appendChild(setRow('🐱', '挂件', mascotSetName(settings), function () { onChange({ __nav: 'mascot' }) }))

      /* 动态效果平铺在主页（不收子页，一眼可选） */
      var fxTitle = el('div', 'font-size:11px;font-weight:600;margin:10px 0 8px;', '动态效果')
      fxTitle.className = 'dsh-row-label'
      body.appendChild(fxTitle)
      body.appendChild(optionRow('粒子', [
        { value: 'on', label: '开' }, { value: 'off', label: '关' },
      ], settings.particles ? 'on' : 'off', function (v) {
        onChange({ particles: v === 'on' })
      }))
      body.appendChild(optionRow('样式', [
        { value: 'sakura', label: '樱花' }, { value: 'firefly', label: '萤火' }, { value: 'snow', label: '落雪' },
      ], settings.particleStyle || 'sakura', function (v) {
        onChange({ particleStyle: v })
      }))

      var offRow = el('div', 'display:flex;justify-content:flex-end;margin-top:8px;')
      var offBtn = el('button', 'padding:5px 12px;font-size:11px;border-radius:8px;cursor:pointer;font-family:inherit;', '恢复原生界面')
      offBtn.className = 'dsh-off-btn'
      offBtn.addEventListener('click', function () { onChange({ enabled: false }) })
      offRow.appendChild(offBtn)
      body.appendChild(offRow)
    }

    /** 背景子页：壁纸网格（无/内置/自定义 + 上传）+ 浓度 */
    function buildWallPage(body, settings, onChange) {
      var customWalls = loadCustomWalls()
      var grid = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;')
      grid.appendChild(gridCell(null, '', settings.wallpaper === 'none', function () { onChange({ wallpaper: 'none' }) }, null, '无'))
      Object.keys(ASSETS.wallpapers).forEach(function (k) {
        grid.appendChild(gridCell(ASSETS.wallpapers[k], WALLPAPER_LABELS[k] || k, settings.wallpaper === k, function () { onChange({ wallpaper: k }) }))
      })
      Object.keys(customWalls).forEach(function (id) {
        var name = customWalls[id].name || '自定义'
        var dot = name.lastIndexOf('.')
        if (dot > 0) name = name.slice(0, dot)
        grid.appendChild(gridCell(customWalls[id].uri, name, settings.wallpaper === 'custom:' + id,
          function () { onChange({ wallpaper: 'custom:' + id }) },
          function () {
            removeCustomWall(id)
            var patch = { __refreshPanel: true }
            if (settings.wallpaper === 'custom:' + id) {
              patch.wallpaper = ASSETS.wallpapers.anya ? 'anya' : 'none'
              settings.wallpaper = patch.wallpaper
              saveSettings(settings)
            }
            onChange(patch)
          }))
      })
      var uploadCell = el('button', 'width:100%;height:54px;border-radius:8px;cursor:pointer;padding:0;font-size:11px;font-family:inherit;', '📎 上传壁纸')
      uploadCell.className = 'dsh-grid-cell'
      uploadCell.title = '上传自定义壁纸（可多选，自动压缩）'
      uploadCell.addEventListener('click', function () { uploadWallpapers(function () { onChange({ __refreshPanel: true }) }) })
      grid.appendChild(uploadCell)
      /* 动态壁纸格：悬停 ✕ 删除与自定义壁纸格同款；删除当前选中项回退 anya（无则 none） */
      Object.keys(videoMeta).forEach(function (id) {
        grid.appendChild(gridCell(videoThumbs[id] || null, videoMeta[id] || '动态壁纸', settings.wallpaper === 'video:' + id,
          function () { onChange({ wallpaper: 'video:' + id }) },
          function () {
            idbDel(id).then(function () {
              delete videoMeta[id]
              delete videoThumbs[id]
              var patch = { __refreshPanel: true }
              if (settings.wallpaper === 'video:' + id) {
                patch.wallpaper = ASSETS.wallpapers.anya ? 'anya' : 'none'
                settings.wallpaper = patch.wallpaper
                saveSettings(settings)
              }
              onChange(patch)
            })
          }, '🎬'))
      })
      var uploadVideoCell = el('button', 'width:100%;height:54px;border-radius:8px;cursor:pointer;padding:0;font-size:11px;font-family:inherit;', '🎬 上传动态壁纸')
      uploadVideoCell.className = 'dsh-grid-cell'
      uploadVideoCell.title = '上传动态壁纸（mp4/webm，可多选，单个不超过 30MB）'
      uploadVideoCell.addEventListener('click', function () { uploadVideos(function () { onChange({ __refreshPanel: true }) }) })
      grid.appendChild(uploadVideoCell)
      body.appendChild(grid)

      var densTitle = el('div', 'font-size:11px;font-weight:600;margin:4px 0 8px;', '壁纸浓度')
      densTitle.className = 'dsh-row-label'
      body.appendChild(densTitle)
      body.appendChild(optionRow('浓度', [
        { value: 'deep', label: '深' }, { value: 'mid', label: '中' }, { value: 'light', label: '浅' },
      ], settings.density, function (v) { onChange({ density: v }) }))
    }

    /** 挂件子页：套装网格（随机/内置/我的/无 + 上传）+ 我的缩略图管理 + 大小 */
    function buildMascotPage(body, settings, onChange) {
      var hasCustomMascots = loadCustomMascots().length > 0
      var grid = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;')
      var allGifs = []
      for (var k in ASSETS.gifs) allGifs = allGifs.concat(ASSETS.gifs[k])
      grid.appendChild(gridCell(allGifs[0], '随机', settings.mascotSet === 'random', function () { onChange({ mascotSet: 'random' }) }, null, '🎲 随机'))
      Object.keys(ASSETS.gifs).forEach(function (k) {
        grid.appendChild(gridCell(ASSETS.gifs[k][0], SET_LABELS[k] || k, settings.mascotSet === k, function () { onChange({ mascotSet: k }) }))
      })
      if (hasCustomMascots) {
        grid.appendChild(gridCell(loadCustomMascots()[0], '我的', settings.mascotSet === 'mine', function () { onChange({ mascotSet: 'mine' }) }))
      }
      grid.appendChild(gridCell(null, '', settings.mascotSet === 'none', function () { onChange({ mascotSet: 'none' }) }, null, '无'))
      var uploadCell = el('button', 'width:100%;height:54px;border-radius:8px;cursor:pointer;padding:0;font-size:11px;font-family:inherit;', '📎 上传挂件')
      uploadCell.className = 'dsh-grid-cell'
      uploadCell.title = '上传自定义挂件 GIF（可多选）'
      uploadCell.addEventListener('click', function () { uploadMascots(function () { onChange({ mascotSet: 'mine' }) }) })
      grid.appendChild(uploadCell)
      body.appendChild(grid)

      /* 我的挂件管理：每张可单独删除 */
      if (hasCustomMascots) {
        var strip = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-start;')
        loadCustomMascots().forEach(function (uri, idx) {
          var cell = el('div', 'position:relative;cursor:default;')
          var img = el('img', 'width:52px;height:38px;object-fit:contain;border-radius:6px;display:block;' +
            'background:rgba(128,128,128,0.15);border:1px solid rgba(128,128,128,0.4);')
          img.src = uri
          img.title = '自定义挂件 ' + (idx + 1)
          cell.appendChild(img)
          var del = el('button', 'position:absolute;top:-6px;right:-6px;width:15px;height:15px;line-height:13px;' +
            'font-size:10px;border-radius:50%;border:1px solid rgba(128,128,128,0.6);cursor:pointer;' +
            'padding:0;text-align:center;opacity:0;transition:opacity 0.12s;background:rgba(30,30,32,0.9);color:#eee;', '✕')
          del.title = '删除这个挂件'
          cell.appendChild(del)
          cell.addEventListener('mouseenter', function () { del.style.opacity = '1' })
          cell.addEventListener('mouseleave', function () { del.style.opacity = '0' })
          del.addEventListener('click', function (ev) {
            ev.stopPropagation()
            var arr = loadCustomMascots()
            arr.splice(idx, 1)
            saveCustomMascots(arr)
            var patch = { __refreshPanel: true }
            if (settings.mascotSet === 'mine' && arr.length === 0) {
              patch.mascotSet = 'random'
              settings.mascotSet = 'random'
              saveSettings(settings)
            }
            onChange(patch)
          })
          strip.appendChild(cell)
        })
        body.appendChild(strip)
      }

      var sizeTitle = el('div', 'font-size:11px;font-weight:600;margin:4px 0 8px;', '挂件大小')
      sizeTitle.className = 'dsh-row-label'
      body.appendChild(sizeTitle)
      body.appendChild(optionRow('大小', [
        { value: 'small', label: '小' }, { value: 'mid', label: '中' }, { value: 'large', label: '大' },
      ], settings.mascotSize, function (v) { onChange({ mascotSize: v }) }))
    }

    /** 动态效果子页：粒子开关 + 样式 */
    function buildEffectsPage(body, settings, onChange) {
      var fxTitle = el('div', 'font-size:11px;font-weight:600;margin:2px 0 8px;', '飘落粒子')
      fxTitle.className = 'dsh-row-label'
      body.appendChild(fxTitle)
      body.appendChild(optionRow('粒子', [
        { value: 'on', label: '开' }, { value: 'off', label: '关' },
      ], settings.particles ? 'on' : 'off', function (v) {
        onChange({ particles: v === 'on' })
      }))
      body.appendChild(optionRow('样式', [
        { value: 'sakura', label: '樱花' }, { value: 'firefly', label: '萤火' }, { value: 'snow', label: '落雪' },
      ], settings.particleStyle || 'sakura', function (v) {
        onChange({ particleStyle: v })
      }))
    }

    /* ---------------- 粒子动效（樱花 / 萤火 / 落雪 三种样式）---------------- */

    function mountParticles(style) {
      if (document.getElementById('dsh-anime-particles')) return function () {}
      style = style || 'sakura'
      var canvas = document.createElement('canvas')
      canvas.id = 'dsh-anime-particles'
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147482999;pointer-events:none;'
      document.body.appendChild(canvas)
      var ctx = canvas.getContext('2d')

      function resize() { canvas.width = innerWidth; canvas.height = innerHeight }
      resize()
      window.addEventListener('resize', resize)

      var COUNT = style === 'firefly' ? 26 : style === 'snow' ? 50 : 42
      var parts = []
      var r = Math.random

      function spawn(init) {
        if (style === 'firefly') {
          return {
            x: r() * innerWidth, y: init ? r() * innerHeight : r() * innerHeight,
            vx: (r() - 0.5) * 0.45, vy: (r() - 0.5) * 0.45,
            size: 2 + r() * 3, phase: r() * Math.PI * 2, phaseV: 0.02 + r() * 0.035,
          }
        }
        if (style === 'snow') {
          return {
            x: r() * innerWidth, y: init ? r() * innerHeight : -10,
            vy: 0.4 + r() * 0.9, drift: (r() - 0.5) * 0.5,
            size: 2.2 + r() * 3.4, alpha: 0.4 + r() * 0.5,
            rot: r() * Math.PI, rotV: (r() - 0.5) * 0.02,
          }
        }
        return {
          x: r() * innerWidth, y: init ? r() * innerHeight : -16,
          size: 4 + r() * 7, vy: 0.35 + r() * 0.85,
          phase: r() * Math.PI * 2, phaseV: 0.006 + r() * 0.014,
          rot: r() * Math.PI * 2, rotV: (r() - 0.5) * 0.028,
          alpha: 0.4 + r() * 0.42, hue: 332 + r() * 18, light: 78 + r() * 8,
        }
      }

      for (var i = 0; i < COUNT; i++) parts.push(spawn(true))
      var raf = 0

      function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i]
          if (style === 'firefly') {
            p.x += p.vx; p.y += p.vy; p.phase += p.phaseV
            if (p.x < -10) p.x = canvas.width + 10
            if (p.x > canvas.width + 10) p.x = -10
            if (p.y < -10) p.y = canvas.height + 10
            if (p.y > canvas.height + 10) p.y = -10
            var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4)
            glow.addColorStop(0, 'rgba(255, 226, 138,' + (0.55 + Math.sin(p.phase) * 0.35).toFixed(2) + ')')
            glow.addColorStop(1, 'rgba(255, 226, 138, 0)')
            ctx.fillStyle = glow
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = 'rgba(255, 240, 180,' + (0.7 + Math.sin(p.phase) * 0.3).toFixed(2) + ')'
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2)
            ctx.fill()
          } else if (style === 'snow') {
            p.y += p.vy
            p.x += p.drift + Math.sin(p.y / 40) * 0.3
            p.rot += p.rotV
            if (p.y > canvas.height + 12) { p.y = -12; p.x = r() * canvas.width }
            /* 六角雪花：六条辐射主干，每条带两根 30° 分叉 */
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot)
            ctx.globalAlpha = p.alpha
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = Math.max(0.8, p.size * 0.16)
            ctx.lineCap = 'round'
            ctx.beginPath()
            for (var arm = 0; arm < 6; arm++) {
              var ang = arm * Math.PI / 3
              var cos = Math.cos(ang), sin = Math.sin(ang)
              ctx.moveTo(0, 0)
              ctx.lineTo(cos * p.size, sin * p.size)
              var bx = cos * p.size * 0.62, by = sin * p.size * 0.62
              var br = p.size * 0.34
              ctx.moveTo(bx, by)
              ctx.lineTo(bx + Math.cos(ang + Math.PI / 3) * br, by + Math.sin(ang + Math.PI / 3) * br)
              ctx.moveTo(bx, by)
              ctx.lineTo(bx + Math.cos(ang - Math.PI / 3) * br, by + Math.sin(ang - Math.PI / 3) * br)
            }
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.restore()
          } else {
            /* 樱花：正弦摆动 + 旋落；花瓣 = 底尖 + 圆肩 + 顶部 V 形缺刻（贝塞尔），
               粉白径向渐变填充，翻转相位模拟花瓣翻面透视 */
            p.y += p.vy
            p.phase += p.phaseV
            p.x += Math.sin(p.phase) * 0.7
            p.rot += p.rotV
            p.flip += p.flipV
            if (p.y > canvas.height + 18) parts[i] = spawn(true)
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot)
            var squash = 0.35 + 0.65 * Math.abs(Math.sin(p.flip))
            ctx.scale(squash, 1)
            ctx.globalAlpha = p.alpha
            var s = p.size
            ctx.beginPath()
            ctx.moveTo(0, s * 0.58)
            ctx.bezierCurveTo(-s * 0.9, s * 0.26, -s * 0.66, -s * 0.44, -s * 0.2, -s * 0.52)
            ctx.quadraticCurveTo(0, -s * 0.36, s * 0.2, -s * 0.52)
            ctx.bezierCurveTo(s * 0.66, -s * 0.44, s * 0.9, s * 0.26, 0, s * 0.58)
            ctx.closePath()
            var petalFill = ctx.createRadialGradient(0, -s * 0.1, s * 0.08, 0, 0, s * 0.95)
            petalFill.addColorStop(0, 'hsla(' + p.hue + ', 90%, ' + (p.light + 8) + '%, 0.95)')
            petalFill.addColorStop(1, 'hsl(' + p.hue + ', 78%, ' + p.light + '%)')
            ctx.fillStyle = petalFill
            ctx.fill()
            ctx.lineWidth = Math.max(0.6, s * 0.09)
            ctx.strokeStyle = 'hsla(' + p.hue + ', 70%, ' + (p.light - 14) + '%, 0.4)'
            ctx.stroke()
            ctx.restore()
          }
        }
        raf = requestAnimationFrame(frame)
      }
      frame()

      return function stop() {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
        canvas.remove()
      }
    }

    /* ---------------- 侧栏玻璃卡片形态同步 ---------------- */

    /** 折叠态（56px rail）椭圆胶囊悬浮（dsh 原生折叠栏直角贴边，胶囊效果由插件自造）；
        展开态（280px）悬浮卡片。同时在根元素标记折叠状态，供隐藏版本徽标等规则使用。 */
    function syncSidebarGlass(s) {
      var col = document.querySelector('[class*="sidebarCol"]')
      if (!col) return
      /* 悬浮卡片几何（折叠胶囊 / 展开圆角）无条件生效——这是壳形态，不依赖主题与壁纸；
         玻璃化/染色由 buildCss 的 CSS 按 enabled 与壁纸注入，关闭态自然退化为原生底色的悬浮卡片 */
      var w = col.getBoundingClientRect().width
      if (w <= 0) return
      var collapsed = w < 100
      col.style.margin = collapsed ? '8px 0 8px 8px' : '12px 12px 12px 12px'
      col.style.borderRadius = collapsed ? '999px' : '20px'
      document.documentElement.dataset.dshSidebarCollapsed = collapsed ? '1' : '0'
      syncSidebarTrack()
    }

    /* 悬浮边距会把原生 280px 内容卡压窄、裁掉行尾时间标签（内容根节点是固定 280px 排版）。
       展开态把 frame 第一列轨道加宽 24px（左右 margin 合计），inner 完整保留。
       **基准只认 dsh 的原始写入**：记住自己上一次写的值，一致=稳定态跳过，不一致才是
       dsh 新基准→+24 并记住（禁止"量自己写自己"——主题 width:100% 会造成每轮+24 失控正反馈）。
       性能三则：① 折叠判定解析轨道值（<100px），零强制回流；② dsh 切换侧栏会重渲染
       frame 元素，观察器发现元素更换即重挂（否则 +24 迟到 600ms，动画放完二次滑动）；
       ③ 动画期间给卡片挂 .dsh-anim 暂停 backdrop-filter（宽度动画×模糊每帧重算是
       掉帧大户），transitionend/兜底计时恢复。 */
    var sidebarTrackObs = null
    var sidebarTrackWatchEl = null
    var sidebarTrackLast = null
    var sidebarAnimTimer = null
    function syncSidebarTrack() {
      var col0 = document.querySelector('[class*="sidebarCol"]')
      var frame0 = col0 && col0.parentElement
      if (!frame0 || frame0 === document.body) return

      var parseTrack = function (frame) {
        var m = /^([\d.]+px)([\s\S]*)$/.exec(frame.style.gridTemplateColumns || '')
        return m ? { cur: m[1], rest: m[2] } : null
      }
      var apply = function () {
        var col = document.querySelector('[class*="sidebarCol"]')
        var frame = col && col.parentElement
        if (!col || !frame) return
        var t = parseTrack(frame)
        if (!t || t.cur === sidebarTrackLast) return
        if (parseFloat(t.cur) < 100) { sidebarTrackLast = null; return } /* 折叠：dsh 的值直接用 */
        var want = (parseFloat(t.cur) + 24) + 'px'
        frame.style.gridTemplateColumns = want + t.rest
        sidebarTrackLast = want
        var handle = frame.querySelector('[class*="handle"]')
        if (handle && handle.style.left) handle.style.left = want
      }
      var restoreGlass = function () {
        var c = document.querySelector('[class*="sidebarCol"]')
        if (c) c.classList.remove('dsh-anim')
      }
      var onStyle = function () {
        var col = document.querySelector('[class*="sidebarCol"]')
        var frame = col && col.parentElement
        if (!col || !frame) return
        var t = parseTrack(frame)
        if (t && t.cur === sidebarTrackLast) return /* 自己写的稳定值：不动也不暂停玻璃 */
        /* 大幅变更（切换/拖拽起步）→ 动画期暂停玻璃模糊，过渡结束恢复 */
        col.classList.add('dsh-anim')
        clearTimeout(sidebarAnimTimer)
        sidebarAnimTimer = setTimeout(restoreGlass, 420)
        frame.addEventListener('transitionend', function (ev) {
          if (ev && ev.propertyName && ev.propertyName.indexOf('grid-template') < 0) return
          clearTimeout(sidebarAnimTimer)
          restoreGlass()
        }, { once: true })
        apply()
        if (sidebarTrackWatchEl !== frame) reobserve(frame)
      }
      var reobserve = function (frame) {
        if (sidebarTrackObs) sidebarTrackObs.disconnect()
        sidebarTrackWatchEl = frame
        sidebarTrackObs = new MutationObserver(onStyle)
        sidebarTrackObs.observe(frame, { attributes: true, attributeFilter: ['style'] })
      }
      apply()
      if (sidebarTrackWatchEl !== frame0) reobserve(frame0)
    }

    /* ---------------- 渲染编排 ---------------- */

    function render(root, settings, onChange, state) {
      // 清旧（含动态壁纸视频层/遮罩层；上一轮的 objectURL 一并释放防泄漏）
      for (var id of ['dsh-anime-theme-style', 'dsh-anime-mascot', 'dsh-anime-panel', 'dsh-anime-particles', 'dsh-anime-wallpaper-video', 'dsh-anime-wallpaper-mask']) {
        var old = document.getElementById(id)
        if (old) old.remove()
      }
      if (state.wallUrl) { URL.revokeObjectURL(state.wallUrl); state.wallUrl = null }
      if (stopParticles) { stopParticles(); stopParticles = null }

      var style = document.createElement('style')
      style.id = 'dsh-anime-theme-style'
      style.textContent = buildCss(settings)
      document.head.appendChild(style)

      if (settings.enabled) {
        var mascotUri = state.pickedMascot || (state.pickedMascot = pickMascotUri(settings))
        if (mascotUri) {
          var img = document.createElement('img')
          img.id = 'dsh-anime-mascot'
          img.src = mascotUri
          img.alt = ''
          img.draggable = false
          img.style.cssText = 'position:fixed;right:14px;bottom:12px;width:' + (MASCOT_WIDTH[settings.mascotSize] || '150px') +
            ';height:auto;z-index:2147483000;pointer-events:none;opacity:0.92;border-radius:14px;' +
            'filter:drop-shadow(0 8px 22px rgba(0,0,0,0.5));user-select:none;-webkit-user-drag:none;'
          document.body.appendChild(img)
        }
        /* 动态壁纸：视频层 + 浓度遮罩（遮罩底色由 buildCss 规则按深浅模式着色）。
           render 同步而 IDB 异步：先挂空 src 的 video，再异步取 Blob 建 objectURL 回填；
           过期渲染（视频节点已被新一轮替换）的 URL 立即释放 */
        if (typeof settings.wallpaper === 'string' && settings.wallpaper.indexOf('video:') === 0) {
          var vid = document.createElement('video')
          vid.id = 'dsh-anime-wallpaper-video'
          vid.autoplay = true
          vid.loop = true
          vid.muted = true
          vid.setAttribute('playsinline', '')
          vid.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none;'
          document.body.appendChild(vid)
          var mask = el('div', 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;')
          mask.id = 'dsh-anime-wallpaper-mask'
          document.body.appendChild(mask)
          idbGet(settings.wallpaper.slice(6)).then(function (rec) {
            if (!rec || !rec.blob) return
            var url = URL.createObjectURL(rec.blob)
            if (document.getElementById('dsh-anime-wallpaper-video') !== vid) { URL.revokeObjectURL(url); return }
            state.wallUrl = url
            vid.src = url
          }).catch(function () { /* 记录缺失/IDB 不可用：保持纯色底，不影响页面 */ })
        }
        if (settings.particles) stopParticles = mountParticles(settings.particleStyle)
      }

      if (state.panelOpen) {
        document.body.appendChild(buildPanel(settings, onChange, state))
      }
    }

    /* ---------------- 插件入口 ---------------- */

    var name = 'anime-theme'
    var inject = []
    var stopParticles = null

    function apply(ctx) {
      var settings = loadSettings()
      // 面板状态：page = 主列表 / 背景 / 挂件 / 动态效果 子页（Win11 设置式导航）
      // pickedMascot：「随机」套装只在套装变更或自定义集增删时重抽，开面板等重渲染不换图
      var state = { panelOpen: false, page: 'main', pickedMascot: null, wallUrl: null, videoMeta: videoMeta }
      var repickMascot = function () { state.pickedMascot = pickMascotUri(settings) }
      repickMascot()
      // 动态壁纸元数据异步装载（名称/缩略图入内存缓存，Blob 只在播放时按需取）；面板开着则刷新一次
      idbAll().then(function (recs) {
        recs.forEach(function (r) { videoMeta[r.id] = r.name || '动态壁纸'; videoThumbs[r.id] = r.thumb || null })
        if (state.panelOpen) rerender({ __refreshPanel: true })
      }).catch(function () { /* IndexedDB 不可用：动态壁纸降级，其余功能不受影响 */ })
      var rerender = function (patch) {
        if (patch.__togglePanel) {
          state.panelOpen = !state.panelOpen
          if (state.panelOpen) state.page = 'main'
        } else if (patch.__closePanel) {
          state.panelOpen = false
        } else if (patch.__nav !== undefined) {
          state.page = patch.__nav
        } else if (patch.__refreshPanel) {
          // 上传/删除素材后的面板原地刷新：保持面板开着与当前子页，不改动设置本体
        } else {
          for (var k in patch) settings[k] = patch[k]
          saveSettings(settings)
        }
        // 挂件池变化（套装切换 / 自定义集增删 / 重新开启主题）时重抽随机挂件
        if (patch.mascotSet !== undefined || patch.__refreshPanel || patch.enabled === true) repickMascot()
        render(document.body, settings, rerender, state)
      }
      // 顶栏（shell bar）的 🎨 按钮经主进程转发到这里（壳注入脚本桥接 window.dshDesktop.onShellCommand）
      window.__dshShellCommand = function (cmd) {
        if (cmd !== 'theme-button') return
        rerender({ __togglePanel: true })
      }
      // 点击面板以外的空白处 → 关闭面板
      var docListener = function (e) {
        if (!state.panelOpen) return
        var t = e.target
        if (t && t.closest && t.closest('#dsh-anime-panel')) return
        rerender({ __closePanel: true })
      }
      ctx.effect(function () {
        document.addEventListener('click', docListener, true)
        // 侧栏折叠/展开时同步玻璃卡片形态（600ms 自愈）
        var glassTimer = setInterval(function () { syncSidebarGlass(settings) }, 600)
        syncSidebarGlass(settings)
        render(document.body, settings, rerender, state)
        return function () {
          document.removeEventListener('click', docListener, true)
          clearInterval(glassTimer)
          if (stopParticles) { stopParticles(); stopParticles = null }
          if (state.wallUrl) { URL.revokeObjectURL(state.wallUrl); state.wallUrl = null }
          window.__dshShellCommand = null
          for (var id of ['dsh-anime-theme-style', 'dsh-anime-mascot', 'dsh-anime-panel', 'dsh-anime-wallpaper-video', 'dsh-anime-wallpaper-mask']) {
            var old = document.getElementById(id)
            if (old) old.remove()
          }
        }
      }, 'anime-theme: visual')
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
