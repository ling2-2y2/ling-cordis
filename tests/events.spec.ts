/**
 * 事件总线回归——on/emit、once、parallel/serial 顺序、bail 短路与 waterfall 链传。
 * @module @ling2/ling-coris/tests/events
 */
import { describe, expect, it } from 'vitest'
import { Context, isBailed } from '../src/index.ts'

// 本测试自用的自定义事件（顺带验证 Events 接口增强机制）
declare module '../src/core/events.ts' {
  interface Events {
    'test/order'(value: number): void
    'test/async'(value: number): void
    'test/bail'(value: number): number | void
    'test/chain'(value: number, next: (value: number) => number): number
    'test/veto'(value: number, next: () => any): any
  }
}

describe('事件总线', () => {
  it('on/emit：监听器按注册序收到载荷', async () => {
    const ctx = new Context()
    const got: number[] = []
    ctx.on('test/order', (v) => got.push(v))
    ctx.on('test/order', (v) => got.push(v * 10))
    ctx.emit('test/order', 1)
    expect(got).toEqual([1, 10])
    await ctx.fiber.dispose()
  })

  it('on() 返回注销器：注销后不再收到事件', async () => {
    const ctx = new Context()
    let fired = 0
    const dispose = ctx.on('test/order', () => { fired += 1 })
    ctx.emit('test/order', 1)
    expect(fired).toBe(1)
    dispose()
    ctx.emit('test/order', 2)
    expect(fired).toBe(1)
    await ctx.fiber.dispose()
  })

  it('serial：异步监听器按注册序串行执行', async () => {
    const ctx = new Context()
    const order: number[] = []
    ctx.on('test/async', async (v) => {
      await new Promise(resolve => setTimeout(resolve, 20 - v * 2))
      order.push(v)
    })
    ctx.on('test/async', async (v) => {
      await new Promise(resolve => setTimeout(resolve, 1))
      order.push(v * 10)
    })
    await ctx.serial('test/async', 5)
    expect(order).toEqual([5, 50])
    await ctx.fiber.dispose()
  })

  it('once：只触发一次', async () => {
    const ctx = new Context()
    let fired = 0
    ctx.once('test/order', () => { fired += 1 })
    ctx.emit('test/order', 1)
    ctx.emit('test/order', 2)
    expect(fired).toBe(1)
    await ctx.fiber.dispose()
  })

  it('parallel：并发分发并等待全部异步监听器完成', async () => {
    const ctx = new Context()
    const done: number[] = []
    ctx.on('test/async', async (v) => {
      await new Promise(resolve => setTimeout(resolve, 10 - v))
      done.push(v)
    })
    await ctx.parallel('test/async', 1)
    await ctx.parallel('test/async', 8)
    expect(done.sort()).toEqual([1, 8])
    await ctx.fiber.dispose()
  })

  it('bail：首个非空返回值短路后续监听器；isBailed 判定', async () => {
    const ctx = new Context()
    const calls: string[] = []
    ctx.on('test/bail', () => { calls.push('a'); return 42 })
    ctx.on('test/bail', () => { calls.push('b') })
    const result = ctx.bail('test/bail', 1)
    expect(result).toBe(42)
    expect(calls).toEqual(['a'])
    expect(isBailed(result)).toBe(true)
    expect(isBailed(undefined)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('waterfall：监听器按注册序执行，终态回调收尾、返回值沿链回传；不调 next 即否决', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('test/chain', (value, next) => { order.push(`l1:${value}`); return next(value) })
    ctx.on('test/chain', (value, next) => { order.push(`l2:${value}`); return next(value) })
    const result = ctx.waterfall('test/chain', 1, (value: number) => value * 100)
    expect(order).toEqual(['l1:1', 'l2:1'])
    expect(result).toBe(100)
    // 否决语义：监听器不调 next()，其后链条（含终态回调）不再执行
    let terminal = false
    ctx.on('test/veto', () => 'vetoed')
    const veto = ctx.waterfall('test/veto', 1, () => { terminal = true })
    expect(veto).toBe('vetoed')
    expect(terminal).toBe(false)
    await ctx.fiber.dispose()
  })
})
