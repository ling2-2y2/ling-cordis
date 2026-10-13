/**
 * 演示插件乙（命名空间出口形态：`export function apply` 函数族）——计数器服务，
 * 演示 config 传递（框架省略即不传，默认参兜底）与 after 钩子时序。
 * 消费者视角：`import type { Context } from '@ling2/ling-cordis'`。
 * @module @ling2/ling-cordis/examples/dev-app/plugins/metrics
 */
import type { Context } from '../../../src/index.ts'

export function apply(ctx: Context, config: { start?: number } = {}) {
  let count = config.start ?? 0
  ctx.provide('metrics', {
    bump: () => { count += 1 },
    count: () => count,
  })
}
