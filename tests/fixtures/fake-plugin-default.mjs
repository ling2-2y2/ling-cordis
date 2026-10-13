/**
 * 假插件（default 形态）——runDevApp use:'default' 断言用（class/callable 族树内先例）。
 */
export const mountedDefault = []

export default function (ctx, config) {
  mountedDefault.push(config?.mark ?? 'anonymous')
  ctx.provide(`faked-${String(config?.mark ?? 'anon')}`, true)
}
