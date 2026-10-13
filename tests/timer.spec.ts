/**
 * Timer 插件回归——timeout 双形态、节流、防抖、dispose 撤销语义。
 * @module @ling2/ling-cordis/tests/timer
 */
import { describe, expect, it } from 'vitest'
import { Context, Timer } from '../src/index.ts'

describe('Timer 插件', () => {
  it('timeout(callback, delay) 到点单发', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    let fired = 0
    ctx.timeout(() => { fired += 1 }, 10)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(fired).toBe(1)
    await ctx.fiber.dispose()
  })

  it('timeout(delay) promise 形态随 ctx dispose 拒绝', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    const pending = ctx.timeout(10_000)
    await ctx.fiber.dispose()
    await expect(pending).rejects.toThrow()
  })

  it('throttle 窗口内首发即行、后续抑制（noTrailing 收尾不再补发）', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    let calls = 0
    const push = ctx.throttle(() => { calls += 1 }, 60, true)
    push(); push(); push()
    await new Promise(resolve => setTimeout(resolve, 20))
    const inWindow = calls
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(inWindow).toBe(1)
    expect(calls).toBe(1)
    await ctx.fiber.dispose()
  })

  it('debounce 静默期后单发', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    let calls = 0
    const push = ctx.debounce(() => { calls += 1 }, 30)
    push()
    await new Promise(resolve => setTimeout(resolve, 10))
    push()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(calls).toBe(1)
    await ctx.fiber.dispose()
  })

  it('fiber dispose 清除在途 interval（无句柄泄漏）', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    let fired = 0
    ctx.setInterval(() => { fired += 1 }, 5)
    await new Promise(resolve => setTimeout(resolve, 30))
    await ctx.fiber.dispose()
    const atDispose = fired
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(atDispose).toBeGreaterThan(0)
    expect(fired).toBe(atDispose)
  })

  it('interval(delay) 迭代器形态：next() 逐拍取值，return() 收尾后终结', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    const iterator = ctx.interval(20)
    const first = await iterator.next()
    expect(first.done).toBe(false)
    await iterator.return?.()
    const after = await iterator.next()
    expect(after.done).toBe(true)
    await ctx.fiber.dispose()
  })

  it('timeout(delay) promise 形态正常到点 resolve', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    await expect(ctx.timeout(10)).resolves.toBeUndefined()
    await ctx.fiber.dispose()
  })
})
