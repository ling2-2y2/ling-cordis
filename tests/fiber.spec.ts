/**
 * Fiber 生命周期回归——状态机、effect 清理、插件重载与错误面。
 * @module @ling2/ling-cordis/tests/fiber
 */
import { describe, expect, it } from 'vitest'
import { Context, CordisError, FiberState, ValidationError } from '../src/index.ts'

describe('Fiber 生命周期', () => {
  it('FiberState 状态枚举在场', () => {
    expect(FiberState.PENDING).toBeTypeOf('number')
    expect(FiberState.ACTIVE).toBeTypeOf('number')
    expect(FiberState.DISPOSED).toBeTypeOf('number')
  })

  it('插件启动后 fiber 进入 ACTIVE，dispose 后进入 DISPOSED', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(() => {})
    await fiber
    expect(fiber.state).toBe(FiberState.ACTIVE)
    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
  })

  it('effect 清理回调随 fiber dispose 执行；手动 dispose 即时生效', async () => {
    const ctx = new Context()
    const cleaned: string[] = []
    const fiber = await ctx.plugin((c) => {
      c.effect(() => () => cleaned.push('effect-a'))
      c.effect(() => () => cleaned.push('effect-b'))
    })
    expect(cleaned).toEqual([])
    await fiber.dispose()
    expect(cleaned.sort()).toEqual(['effect-a', 'effect-b'])
  })

  it('restart() 重跑插件体（apply 再次执行，旧 effect 先清理）', async () => {
    const ctx = new Context()
    const events: string[] = []
    const fiber = await ctx.plugin((c) => {
      events.push('apply')
      c.effect(() => () => events.push('cleanup'))
    })
    await fiber.restart()
    expect(events).toEqual(['apply', 'cleanup', 'apply'])
    await fiber.dispose()
  })

  it('CordisError/ValidationError 错误面在场且为 Error 子类形态', () => {
    expect(CordisError).toBeTypeOf('function')
    expect(ValidationError).toBeTypeOf('function')
    expect(new ValidationError([])).toBeInstanceOf(Error)
  })
})
