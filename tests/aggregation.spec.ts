/**
 * 聚合出口回归钉——出口符号面 + Timer 装配行为 + Service 挂载。
 * @module @ling2/ling-cordis/tests/aggregation
 */
import { describe, expect, it } from 'vitest'
import { Context, LoggerConsole, Service, symbols, Timer, schemastery } from '../src/index.ts'

describe('聚合出口', () => {
  it('核心符号与装配件全导出', () => {
    expect(Context).toBeTypeOf('function')
    expect(Service).toBeTypeOf('function')
    expect(symbols).toBeTypeOf('object')
    expect(Timer).toBeTypeOf('function')
    expect(LoggerConsole).toBeTypeOf('function')
    expect(schemastery).toBeTypeOf('function')
    // Events/Fiber 为 type-only：存在性由本文件编译期 import 保证，运行时不断言
  })

  it('Timer 装配：ctx.setInterval 触发且随 stop() 停止', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    let fired = 0
    const stop = ctx.setInterval(() => { fired += 1 }, 5)
    await new Promise(resolve => setTimeout(resolve, 30))
    stop()
    const count = fired
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(count).toBeGreaterThan(0)
    expect(fired).toBe(count)
    await ctx.fiber.dispose()
  })

  it('symbols.original 在场（Symbol.for 品牌键）', () => {
    expect(symbols.original).toBeTypeOf('symbol')
  })

  it('Service 子类可挂载并经 ctx.get() 取回', async () => {
    const ctx = new Context()
    class Probe extends Service {
      static inject = [] as const
      constructor(c: Context) { super(c, 'ling-cordis-probe') }
    }
    await ctx.plugin(Probe)
    expect(ctx.get('ling-cordis-probe')).toBeInstanceOf(Probe)
    await ctx.fiber.dispose()
  })
})
