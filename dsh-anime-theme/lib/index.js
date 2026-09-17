/**
 * dsh-anime-theme 宿主侧插件（无逻辑）。
 * 视觉主题完全在浏览器端：见 dsh.client face（lib/client.js）。
 * 本文件存在的意义是让本包成为 loader entry，从而被 client-modules 扫描。
 */

export const name = 'anime-theme'

export function apply(ctx) {
  // 故意留空：主题不需要宿主侧服务。
}
