/**
 * 假插件（命名空间形态）——runDevApp 三相挂载序断言用：apply 记录 mark 进
 * 模块级数组（测试侧 import 同一文件读取；`export function apply` 族树内先例）。
 */
export const mounted = []

export function apply(ctx, config) {
  // config 省略记录 'no-config'（区分 ctx.plugin(P) 与 ctx.plugin(P, {}) 的内核语义钉）
  mounted.push(config === undefined ? 'no-config' : String(config.mark ?? 'anonymous'))
  ctx.provide(`fake-${config === undefined ? 'bare' : String(config.mark ?? 'anon')}`, true)
}
