/**
 * dsh-anime-theme — 浏览器端源码（由 build.mjs 注入素材 JSON 后生成 lib/client.js）
 *
 * 二次元主题 + 主题面板：
 *  - 主题入口在桌面壳顶栏 🎨 按钮（经主进程转发到 window.__dshShellCommand），可切换预设 / 壁纸 / 浓度 / 挂件套装 / 挂件大小 / 总开关
 *  - 自定义壁纸支持多张（可新增、可单独删除）；自定义挂件以缩略图管理（可新增、可单独删除）
 *  - 设置存 localStorage（key: dsh-anime-theme.settings），实时生效、刷新与重启后保留
 *  - 全部视觉仅深色模式生效（body[data-ds-dark-theme]），浅色保持 dsh 原生
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

    var DEFAULTS = { enabled: true, wallpaper: 'anya', density: 'mid', mascotSet: 'random', mascotSize: 'mid', particles: true, particleStyle: 'sakura', preset: 'anya' }
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
    var DENSITY = {
      deep: ['rgba(16,16,18,0.74)', 'rgba(14,14,16,0.82)'],
      mid: ['rgba(16,16,18,0.58)', 'rgba(14,14,16,0.68)'],
      light: ['rgba(16,16,18,0.45)', 'rgba(14,14,16,0.55)'],
    }
    var MASCOT_WIDTH = { small: '110px', mid: '150px', large: '200px' }
    var WALLPAPER_LABELS = { anya: '木屋', lingerie: '幽梦', nightgirls: '花眠', maid: '银姬', silver: '花信', water: '浮光', koi: '锦鲤', roses: '蔷薇', sakura: '樱雪', meadow: '草原', lace: '蕾丝', amethyst: '紫绫' }
    var SET_LABELS = { anya: '阿尼亚', lycoris: '莉可丽丝', yor: '约尔', alya: '艾莉莎', girls100: '百花', roshidere: '败犬', witch: '魔女', mahiru: '邻家' }

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
        ' background: #ffffff !important; border-color: rgba(77,134,254,0.55) !important;' +
        ' box-shadow: 0 2px 12px rgba(77,134,254,0.28) !important; }',

        /* Session log 按钮回归原生位置（右上工具簇），仅补玻璃底保证壁纸下可见：
           壳已改为独立顶栏（无 overlay 遮挡），不再做任何定位调整 */
        'html body [class*="sessionLogButton"] { border-radius: 999px !important; background: var(--dsh-pill-bg) !important;' +
        ' border: 1px solid rgba(255,255,255,0.12) !important; color: #cfd6ff !important; font-size: 12px;' +
        ' backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }',
        'body:not([data-ds-dark-theme]) [class*="sessionLogButton"] { border-color: rgba(0,0,0,0.10) !important; color: #3c3c50 !important; }',

        /* 主题面板：深浅两套配色，跟随 dsh 原生主题切换 */
        '#dsh-anime-panel { background: rgba(255,255,255,0.97) !important; border: 1px solid rgba(0,0,0,0.10) !important; }',
        '#dsh-anime-panel .dsh-panel-title { color: #2c2c2e !important; }',
        '#dsh-anime-panel .dsh-divider { background: rgba(0,0,0,0.10) !important; }',
        '#dsh-anime-panel .dsh-row-label { color: #6b6b70 !important; }',
        '#dsh-anime-panel button.dsh-opt { background: rgba(0,0,0,0.05) !important; border: 1px solid rgba(0,0,0,0.13) !important; color: #55555a !important; }',
        '#dsh-anime-panel button.dsh-opt:hover { background: rgba(0,0,0,0.09) !important; }',
        '#dsh-anime-panel button.dsh-opt.on { background: rgba(77,134,254,0.14) !important; border-color: #4d86fe !important; color: #2c5fd6 !important; }',
        '#dsh-anime-panel button.dsh-off-btn { background: rgba(220,60,60,0.08) !important; border: 1px solid rgba(180,60,60,0.35) !important; color: #b04040 !important; }',
        '#dsh-anime-panel .dsh-close-btn { color: #888 !important; }',
        '#dsh-anime-panel .dsh-close-btn:hover { color: #333 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel { background: rgba(28,28,30,0.96) !important; border-color: #3c3c3d !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-panel-title { color: #e8e8e8 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-divider { background: #3c3c3d !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-row-label { color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-opt { background: #2d2d30 !important; border-color: #3c3c3d !important; color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-opt:hover { background: #38383c !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-opt.on { background: rgba(77,134,254,0.22) !important; border-color: #4d86fe !important; color: #cfd6ff !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel button.dsh-off-btn { background: rgba(242,90,90,0.12) !important; border-color: #5a2d2d !important; color: #e8a0a0 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-close-btn { color: #9aa0a6 !important; }',
        'body[data-ds-dark-theme] #dsh-anime-panel .dsh-close-btn:hover { color: #e8e8e8 !important; }',
      ]
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
        out.push(
          'body[data-ds-dark-theme] { background: #1e1e1e !important; }',
          'body:not([data-ds-dark-theme]) { background: #f3f3f3 !important; }',
        )
      }

      /* ---- 主框架与对话区透明化，让壁纸透出 ---- */
      out.push(
        'html body [class*="frame"], html body [data-conversation-scroll], html body [data-phase], html body [data-slot="conversation"] { background: transparent !important; }',
      )

      /* ---- 玻璃卡片：侧栏 / 输入框（深浅两套）---- */
      var glassDark = 'linear-gradient(rgba(30,30,34,0.78),rgba(24,24,27,0.72))'
      var glassLight = 'linear-gradient(rgba(255,255,255,0.66),rgba(255,255,255,0.56))'
      var blur = 'backdrop-filter: blur(16px) saturate(1.15); -webkit-backdrop-filter: blur(16px) saturate(1.15);'

      out.push(
        /* 侧栏 → 悬浮玻璃卡片：四角对称圆角；右缘无外边距（拉宽手柄定位一致） */
        'html body [class*="sidebarCol"] { margin: 12px 0 12px 12px; border-radius: 20px; }',
        'html body [class*="sidebarCol"] { background: ' + glassDark + ' !important; ' + blur +
        ' border: 1px solid rgba(255,255,255,0.09);' +
        ' box-shadow: inset 0 1px rgba(255,255,255,0.07), 0 10px 34px rgba(0,0,0,0.35) !important; }',
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

      /* ---- 深色色板 rgba 化（玻璃感补强；浅色保持原生 token）---- */
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

      /* ---- 细节：选区/聚焦点缀 ---- */
      out.push(
        'html body[data-ds-dark-theme] ::selection { background: rgba(109,148,253,0.36); }',
        'html body:not([data-ds-dark-theme]) ::selection { background: rgba(109,148,253,0.25); }',
      )
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

    /** 自定义壁纸缩略图条：每张 44×26 缩略图 + 悬停出现 ✕ 删除角标。
        删除当前选中的自定义壁纸时自动回退到默认壁纸。 */
    function buildCustomWallStrip(customWalls, settings, onChange) {
      var strip = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin:-4px 0 10px 52px;align-items:flex-start;')
      Object.keys(customWalls).forEach(function (id) {
        var cell = el('div', 'position:relative;cursor:pointer;')
        var img = el('img', 'width:52px;height:30px;object-fit:cover;border-radius:6px;display:block;' +
          'border:1px solid rgba(128,128,128,0.4);')
        img.src = customWalls[id].uri
        img.title = customWalls[id].name || '自定义壁纸'
        cell.appendChild(img)
        if (settings.wallpaper === 'custom:' + id) {
          img.style.border = '2px solid #4d86fe'
          img.style.width = '50px'
          img.style.height = '28px'
        }
        var del = el('button', 'position:absolute;top:-6px;right:-6px;width:15px;height:15px;line-height:13px;' +
          'font-size:10px;border-radius:50%;border:1px solid rgba(128,128,128,0.6);cursor:pointer;' +
          'padding:0;text-align:center;opacity:0;transition:opacity 0.12s;background:rgba(30,30,32,0.9);color:#eee;', '✕')
        del.title = '删除这张壁纸'
        cell.appendChild(del)
        cell.addEventListener('mouseenter', function () { del.style.opacity = '1' })
        cell.addEventListener('mouseleave', function () { del.style.opacity = '0' })
        img.addEventListener('click', function () { onChange({ wallpaper: 'custom:' + id }) })
        del.addEventListener('click', function (ev) {
          ev.stopPropagation()
          removeCustomWall(id)
          var patch = { __refreshPanel: true }
          if (settings.wallpaper === 'custom:' + id) {
            patch.wallpaper = ASSETS.wallpapers.anya ? 'anya' : 'none'
            settings.wallpaper = patch.wallpaper
            saveSettings(settings)
          }
          onChange(patch)
        })
        strip.appendChild(cell)
      })
      return strip
    }

    /** 自定义挂件缩略图条：每张 40×30 缩略图 + 悬停出现 ✕ 删除角标。
        「我的」套装删空后自动脱离该套装。 */
    function buildCustomMascotStrip(settings, onChange) {
      var strip = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin:-4px 0 10px 52px;align-items:flex-start;')
      loadCustomMascots().forEach(function (uri, idx) {
        var cell = el('div', 'position:relative;cursor:default;')
        var img = el('img', 'width:40px;height:30px;object-fit:contain;border-radius:6px;display:block;' +
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
      return strip
    }

    function buildPanel(settings, onChange) {
      // 下拉式：挂在标题栏 🎨 按钮正下方；配色由 CSS 深浅规则驱动
      var panel = el('div', 'position:fixed;top:40px;right:10px;width:296px;max-height:calc(100vh - 56px);' +
        'overflow-y:auto;padding:14px;border-radius:14px;z-index:2147483002;' +
        'font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;')
      panel.id = 'dsh-anime-panel'
      var titleRow = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;')
      var title = el('div', 'font-size:13px;font-weight:600;', '🎨 二次元主题')
      title.className = 'dsh-panel-title'
      titleRow.appendChild(title)
      var closeBtn = el('button', 'background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;', '✕')
      closeBtn.className = 'dsh-close-btn'
      closeBtn.title = '关闭面板'
      closeBtn.addEventListener('click', function () { onChange({ __closePanel: true }) })
      titleRow.appendChild(closeBtn)
      panel.appendChild(titleRow)

      panel.appendChild(optionRow('预设', [
        { value: 'anya', label: '阿尼亚' },
        { value: 'lycoris', label: '莉可丽丝' },
        { value: 'yor', label: '约尔' },
        { value: 'alya', label: '艾莉莎' },
        { value: 'minimal', label: '极简' },
      ], settings.preset, function (v) {
        var preset = {
          anya: { enabled: true, wallpaper: 'anya', density: 'mid', mascotSet: 'random' },
          lycoris: { enabled: true, wallpaper: ASSETS.wallpapers.nightgirls ? 'nightgirls' : 'anya', density: 'deep', mascotSet: 'lycoris' },
          yor: { enabled: true, wallpaper: ASSETS.wallpapers.lingerie ? 'lingerie' : 'anya', density: 'deep', mascotSet: 'yor' },
          alya: { enabled: true, wallpaper: ASSETS.wallpapers.silver ? 'silver' : 'anya', density: 'mid', mascotSet: 'alya' },
          minimal: { enabled: true, wallpaper: 'none', density: 'mid', mascotSet: 'random' },
        }[v]
        preset.preset = v
        onChange(preset)
      }))

      var divider = el('div', 'height:1px;margin:2px 0 12px;')
      divider.className = 'dsh-divider'
      panel.appendChild(divider)

      /* ---- 壁纸行：内置壁纸 + 多张自定义壁纸（每张可删）+ 上传入口 ---- */
      var customWalls = loadCustomWalls()
      var customWallIds = Object.keys(customWalls)
      var wallOpts = [{ value: 'none', label: '无' }].concat(
        Object.keys(ASSETS.wallpapers).map(function (k) {
          return { value: k, label: WALLPAPER_LABELS[k] || k }
        }),
      )
      customWallIds.forEach(function (id) {
        var name = customWalls[id].name || '自定义'
        var dot = name.lastIndexOf('.')
        if (dot > 0) name = name.slice(0, dot)
        wallOpts.push({ value: 'custom:' + id, label: name.slice(0, 8) + (name.length > 8 ? '…' : '') })
      })
      var wallRow = optionRow('壁纸', wallOpts, settings.wallpaper, function (v) {
        onChange({ wallpaper: v })
      })
      var wallUpload = el('button', 'padding:3px 9px;font-size:10px;border-radius:10px;cursor:pointer;', '📎 上传')
      wallUpload.className = 'dsh-opt'
      wallUpload.title = '上传自定义壁纸（可多选，自动压缩）'
      wallUpload.addEventListener('click', function () {
        uploadWallpapers(function () { onChange({ __refreshPanel: true }) })
      })
      wallRow.appendChild(wallUpload)
      panel.appendChild(wallRow)

      /* 自定义壁纸缩略图条：每张带 ✕ 删除；删掉当前选中的壁纸时回退默认壁纸 */
      if (customWallIds.length > 0) {
        panel.appendChild(buildCustomWallStrip(customWalls, settings, onChange))
      }

      panel.appendChild(optionRow('浓度', [
        { value: 'deep', label: '深' }, { value: 'mid', label: '中' }, { value: 'light', label: '浅' },
      ], settings.density, function (v) { onChange({ density: v }) }))

      /* ---- 挂件行：内置套装 + 我的（缩略图管理）+ 上传入口 ---- */
      var hasCustomMascots = loadCustomMascots().length > 0
      var setOpts = [{ value: 'random', label: '随机' }].concat(
        Object.keys(ASSETS.gifs).map(function (k) {
          return { value: k, label: SET_LABELS[k] || k }
        }),
      )
      if (hasCustomMascots) setOpts.push({ value: 'mine', label: '我的' })
      setOpts.push({ value: 'none', label: '无' })
      var setRow = optionRow('挂件', setOpts, settings.mascotSet, function (v) {
        onChange({ mascotSet: v })
      })
      var setUpload = el('button', 'padding:3px 9px;font-size:10px;border-radius:10px;cursor:pointer;', '📎 上传')
      setUpload.className = 'dsh-opt'
      setUpload.title = '上传自定义挂件 GIF（可多选）'
      setUpload.addEventListener('click', function () {
        uploadMascots(function () { onChange({ mascotSet: 'mine' }) })
      })
      setRow.appendChild(setUpload)
      panel.appendChild(setRow)

      /* 自定义挂件缩略图条：每个带 ✕ 删除；「我的」删空后自动脱离该套装 */
      if (hasCustomMascots) {
        panel.appendChild(buildCustomMascotStrip(settings, onChange))
      }

      panel.appendChild(optionRow('大小', [
        { value: 'small', label: '小' }, { value: 'mid', label: '中' }, { value: 'large', label: '大' },
      ], settings.mascotSize, function (v) { onChange({ mascotSize: v }) }))

      panel.appendChild(optionRow('粒子', [
        { value: 'on', label: '开' }, { value: 'off', label: '关' },
      ], settings.particles ? 'on' : 'off', function (v) {
        onChange({ particles: v === 'on' })
      }))

      panel.appendChild(optionRow('样式', [
        { value: 'sakura', label: '樱花' }, { value: 'firefly', label: '萤火' }, { value: 'snow', label: '落雪' },
      ], settings.particleStyle || 'sakura', function (v) {
        onChange({ particleStyle: v })
      }))

      var offRow = el('div', 'display:flex;justify-content:flex-end;margin-top:4px;')
      var offBtn = el('button', 'padding:4px 12px;font-size:11px;border-radius:10px;cursor:pointer;', '关闭主题（恢复原生）')
      offBtn.className = 'dsh-off-btn'
      offBtn.addEventListener('click', function () { onChange({ enabled: false }) })
      offRow.appendChild(offBtn)
      panel.appendChild(offRow)
      return panel
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

      var COUNT = style === 'firefly' ? 26 : style === 'snow' ? 70 : 42
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
            x: r() * innerWidth, y: init ? r() * innerHeight : -8,
            vy: 0.4 + r() * 1.1, drift: (r() - 0.5) * 0.6,
            size: 1.5 + r() * 2.6, alpha: 0.35 + r() * 0.55,
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
            if (p.y > canvas.height + 8) { p.y = -8; p.x = r() * canvas.width }
            ctx.globalAlpha = p.alpha
            ctx.fillStyle = '#ffffff'
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
            ctx.fill()
            ctx.globalAlpha = 1
          } else {
            p.y += p.vy
            p.phase += p.phaseV
            p.x += Math.sin(p.phase) * 0.7
            p.rot += p.rotV
            if (p.y > canvas.height + 18) parts[i] = spawn(true)
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot)
            ctx.globalAlpha = p.alpha
            ctx.fillStyle = 'hsl(' + p.hue + ', 80%, ' + p.light + '%)'
            ctx.beginPath()
            ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2)
            ctx.fill()
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

    /** 折叠态（56px rail）全宽贴合不挤压图标；展开态（280px）悬浮卡片。
        同时在根元素标记折叠状态，供隐藏版本徽标等规则使用。 */
    function syncSidebarGlass() {
      var col = document.querySelector('[class*="sidebarCol"]')
      if (!col) return
      var w = col.getBoundingClientRect().width
      if (w <= 0) return
      var collapsed = w < 100
      col.style.margin = collapsed ? '0' : '12px 0 12px 12px'
      col.style.borderRadius = collapsed ? '0' : '20px'
      document.documentElement.dataset.dshSidebarCollapsed = collapsed ? '1' : '0'
    }

    /* ---------------- 渲染编排 ---------------- */

    function render(root, settings, onChange, panelOpen) {
      // 清旧
      for (var id of ['dsh-anime-theme-style', 'dsh-anime-mascot', 'dsh-anime-panel', 'dsh-anime-particles']) {
        var old = document.getElementById(id)
        if (old) old.remove()
      }
      if (stopParticles) { stopParticles(); stopParticles = null }

      var style = document.createElement('style')
      style.id = 'dsh-anime-theme-style'
      style.textContent = buildCss(settings)
      document.head.appendChild(style)

      if (settings.enabled) {
        var mascotUri = pickMascotUri(settings)
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
        if (settings.particles) stopParticles = mountParticles(settings.particleStyle)
      }

      if (panelOpen && settings.enabled) {
        document.body.appendChild(buildPanel(settings, onChange))
      }
    }

    /* ---------------- 插件入口 ---------------- */

    var name = 'anime-theme'
    var inject = []
    var stopParticles = null

    function apply(ctx) {
      var settings = loadSettings()
      var state = { panelOpen: false }
      var rerender = function (patch) {
        if (patch.__togglePanel) {
          state.panelOpen = !state.panelOpen
        } else if (patch.__closePanel) {
          state.panelOpen = false
        } else if (patch.__refreshPanel) {
          // 上传/删除素材后的面板原地刷新：保持面板开着，不改动设置本体
        } else {
          var isPresetPick = patch.preset !== undefined
          for (var k in patch) settings[k] = patch[k]
          // 单独调壁纸/浓度/挂件后不再属于任何预设（预设本身携带 preset 标记）
          if (!isPresetPick && (patch.wallpaper !== undefined || patch.density !== undefined || patch.mascotSet !== undefined)) settings.preset = null
          saveSettings(settings)
        }
        render(document.body, settings, rerender, state.panelOpen)
      }
      // 顶栏（shell bar）的 🎨 按钮经主进程转发到这里（壳注入脚本桥接 window.dshDesktop.onShellCommand）
      window.__dshShellCommand = function (cmd) {
        if (cmd !== 'theme-button') return
        rerender(settings.enabled ? { __togglePanel: true } : { enabled: true })
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
        var glassTimer = setInterval(syncSidebarGlass, 600)
        syncSidebarGlass()
        render(document.body, settings, rerender, state.panelOpen)
        return function () {
          document.removeEventListener('click', docListener, true)
          clearInterval(glassTimer)
          if (stopParticles) { stopParticles(); stopParticles = null }
          window.__dshShellCommand = null
          for (var id of ['dsh-anime-theme-style', 'dsh-anime-mascot', 'dsh-anime-panel']) {
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
