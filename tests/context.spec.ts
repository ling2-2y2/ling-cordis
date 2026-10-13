/**
 * Context 根容器回归——品牌判定、静态符号、子作用域与服务可达性。
 * @module @ling2/ling-cordis/tests/context
 */
import { describe, expect, it } from 'vitest'
import { Context, EventsService, RegistryService } from '../src/index.ts'

describe('Context', () => {
  it('Context.is() 跨领域品牌判定（Symbol.for）', () => {
    expect(Context.is(new Context())).toBe(true)
    expect(Context.is({})).toBe(false)
    expect(Context.is(null)).toBe(false)
  })

  it('四个静态作用域符号在场', () => {
    for (const key of ['effect', 'filter', 'isolate', 'intercept'] as const) {
      expect(Context[key]).toBeTypeOf('symbol')
    }
  })

  it('extend() 派生子作用域，根服务经原型链可达（按调用方上下文包装）', () => {
    const ctx = new Context()
    const child = ctx.extend({})
    expect(child).not.toBe(ctx)
    expect(child.registry).toBeInstanceOf(RegistryService)
    expect(child.events).toBeInstanceOf(EventsService)
  })

  it('isolate() 产出服务隔离作用域', () => {
    const ctx = new Context()
    const scoped = ctx.isolate('probe')
    expect(Context.is(scoped)).toBe(true)
  })

  it('effect() 登记的清理回调随根 fiber dispose 执行', async () => {
    const ctx = new Context()
    const cleaned: number[] = []
    ctx.effect(() => () => cleaned.push(1))
    ctx.effect(() => () => cleaned.push(2))
    await ctx.fiber.dispose()
    expect(cleaned.sort()).toEqual([1, 2])
  })
})
