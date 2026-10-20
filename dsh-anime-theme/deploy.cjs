const fs = require('fs')
const path = require('path')
const srcDir = 'E:/Garyliu/MyWork/DSH/dsh-anime-theme'
// 每个目标 = { dir: profile 内插件目录, marker: 校验标记 }；
// assets 目标是壳内置母本（打包进 asar，供启动自愈恢复用），故意的第二份
const targets = [
  { dir: path.join(process.env.USERPROFILE, '.dsh/profiles/desktop/node_modules/dsh-anime-theme'), web: true },
  { dir: path.join(process.env.USERPROFILE, '.dsh/profiles/web/node_modules/dsh-anime-theme'), web: true },
  { dir: path.join(process.env.USERPROFILE, '.dsh/profiles/node_modules/dsh-anime-theme'), web: true },
  { dir: 'E:/Garyliu/MyWork/DSH/desktop/assets/plugin', web: false },
]
const files = [
  ['lib/client.js', 'lib/client.js'],
  ['package.json', 'package.json'],
  ['cordis.patch.yml', 'cordis.patch.yml'],
]
let bad = 0
for (const t of targets) {
  try {
    for (const [srcRel, destRel] of files) {
      const dest = path.join(t.dir, destRel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(srcDir, srcRel), dest)
    }
    const deployed = fs.readFileSync(path.join(t.dir, 'lib/client.js'), 'utf8')
    const ok = deployed.includes('syncSidebarGlass') && deployed.includes('dsh-anime-wallpaper-video') && deployed.includes('dsh-anime-fab')
    if (!ok) bad += 1
    console.log((ok ? 'OK  ' : 'BAD ') + t.dir)
  } catch (e) {
    bad += 1
    console.log('SKIP', t.dir, e.code)
  }
}
process.exit(bad > 0 ? 1 : 0)
