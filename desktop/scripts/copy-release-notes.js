/**
 * 打包收尾：把桌面版的版本迭代更新说明复制进产物目录。
 * 由 package.json 的 dist 脚本在 electron-builder 成功后调用。
 * 产物：release\版本更新说明.md（最新）+ release\版本更新说明-v{version}.md（按版本留档）
 *       + win-unpacked\ 内同名副本
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = path.join(root, 'CHANGELOG.md')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const release = path.join(root, 'release')

const targets = [
  path.join(release, '版本更新说明.md'),
  path.join(release, `版本更新说明-v${version}.md`),
  path.join(release, 'win-unpacked', '版本更新说明.md'),
]
for (const dest of targets) {
  // win-unpacked 副本仅 Windows 构建存在（mac 构建无此目录，跳过而非报错）
  if (dest.includes('win-unpacked') && !fs.existsSync(path.dirname(dest))) continue
  fs.copyFileSync(src, dest)
  console.log('已复制版本说明 ->', dest)
}
