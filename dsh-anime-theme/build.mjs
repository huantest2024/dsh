import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const assets = join(root, 'assets')

function dataUri(p) {
  const lower = p.toLowerCase()
  const ext = lower.endsWith('.png') ? 'image/png'
    : lower.endsWith('.gif') ? 'image/gif'
    : lower.endsWith('.webm') ? 'video/webm'
    : lower.endsWith('.mp4') ? 'video/mp4'
    : 'image/jpeg'
  return `data:${ext};base64,${readFileSync(p).toString('base64')}`
}

// 壁纸：assets/wallpapers/*.jpg|png → { key: dataUri }
const wallpapers = {}
for (const f of readdirSync(join(assets, 'wallpapers'))) {
  if (!/\.(jpe?g|png)$/i.test(f)) continue
  wallpapers[f.replace(/\.(jpe?g|png)$/i, '')] = dataUri(join(assets, 'wallpapers', f))
}

// 包内视频壁纸：assets/wallpapers-video/*.mp4|webm → { key: dataUri }
// （主题预设可直接引用的动态背景；海报帧 *-poster.jpg 作主题卡缩略图 / video poster）
const videos = {}
const videoPosters = {}
const videoDir = join(assets, 'wallpapers-video')
if (existsSync(videoDir)) {
  for (const f of readdirSync(videoDir)) {
    const m = f.match(/^(.*)\.(mp4|webm)$/i)
    if (m) videos[m[1]] = dataUri(join(videoDir, f))
    const pm = f.match(/^(.*)-poster\.(jpe?g|png)$/i)
    if (pm) videoPosters[pm[1]] = dataUri(join(videoDir, f))
  }
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

const assetsJson = JSON.stringify({ wallpapers, gifs, videos, videoPosters })

let src = readFileSync(join(root, 'client-src.js'), 'utf8')
src = src.replaceAll('__ASSETS_JSON__', () => assetsJson)

writeFileSync(join(root, 'lib', 'client.js'), src)
console.log(`lib/client.js 生成完毕：${Object.keys(wallpapers).length} 张壁纸 / ${Object.keys(videos).length} 条包内视频 / ${Object.keys(gifs).length} 套动图，共 ${Math.round(src.length / 1024)} KB`)
