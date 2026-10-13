/**
 * dts 冒烟消费者——以外部使用者视角验证打包产物类型面：
 * ①聚合入口符号可解析；②相对模块增强并入 Context（fiber 的 effect、events 的 on、
 * timer 的 setInterval/timeout）；③schemastery 全局命名空间在场。
 * 由 CI 在 build 之后独立编译（不在 tsconfig.json include 面内，防止源码态混入）。
 */
import { Context, Fiber, schemastery as z } from './dist/index.js'

/** fiber/events 增强面：ctx.effect 与 ctx.on 应存在于 Context 接口。 */
function face(ctx: Context) {
  const dispose = ctx.effect(() => () => {})
  dispose()
  ctx.on('internal/status', (fiber: Fiber, oldValue: number) => {
    void fiber.state
    void oldValue
  })
}

/** timer 增强面：ctx.setInterval/timeout 应并入 Context。 */
function timer(ctx: Context) {
  const stop = ctx.setInterval(() => {}, 1000)
  stop()
  void ctx.timeout(10)
}

/** fiber 类型面 + schemastery 构建器与全局命名空间。 */
function schema(fiber: Fiber) {
  const config = z.object({ port: z.number().default(3000) })
  const state: number = fiber.state
  type From = Schemastery.From<{ port: number }>
  const probe: From | null = null
  return { config, state, probe }
}

export const _checks = { face, timer, schema }
