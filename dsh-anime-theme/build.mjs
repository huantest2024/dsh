/**
 * 生成 lib/client.js：扫描 assets/wallpapers 与 assets/anime/<套装>/，
 * 以 base64 内嵌全部素材，产出带主题面板的浏览器插件
 * （dsh client module 协议：__ModuleLoader__ 工厂注册）。
 *
 * 自定义：往 assets/wallpapers 丢 jpg、往 assets/anime/<新套装>/ 丢 gif，
 * 重新 node build.mjs 即会自动出现在主题面板里。
 *
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const assets = join(root, 'assets')

function dataUri(p) {
  const ext = p.toLowerCase().endsWith('.png') ? 'image/png' : p.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/jpeg'
  return `data:${ext};base64,${readFileSync(p).toString('base64')}`
}

// 壁纸：assets/wallpapers/*.jpg|png → { key: dataUri }
const wallpapers = {}
for (const f of readdirSync(join(assets, 'wallpapers'))) {
  if (!/\.(jpe?g|png)$/i.test(f)) continue
  wallpapers[f.replace(/\.(jpe?g|png)$/i, '')] = dataUri(join(assets, 'wallpapers', f))
}

// 动图套装：assets/anime/<套装>/*.gif → { 套装: [dataUri, ...] }
const gifs = {}
for (const dir of readdirSync(join(assets, 'anime'))) {
  const dirPath = join(assets, 'anime', dir)
  if (!statSync(dirPath).isDirectory()) continue
  const list = readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.gif')).map(f => dataUri(join(dirPath, f)))
  if (list.length > 0) gifs[dir] = list
}

if (Object.keys(wallpapers).length === 0) throw new Error('assets/wallpapers 下没有壁纸')
if (Object.keys(gifs).length === 0) throw new Error('assets/anime 下没有动图套装')

const assetsJson = JSON.stringify({ wallpapers, gifs })

let src = readFileSync(join(root, 'client-src.js'), 'utf8')
src = src.replaceAll('__ASSETS_JSON__', () => assetsJson)

writeFileSync(join(root, 'lib', 'client.js'), src)
console.log(`lib/client.js 生成完毕：${Object.keys(wallpapers).length} 张壁纸 / ${Object.keys(gifs).length} 套动图，共 ${Math.round(src.length / 1024)} KB`)
