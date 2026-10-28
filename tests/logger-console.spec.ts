/**
 * LoggerConsole 插件回归——装配、渲染输出与 colors:false 纯文本形态。
 * @module @ling2/ling-coris/tests/logger-console
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, LoggerConsole, Timer } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoggerConsole 插件', () => {
  it('装配后 ctx.logger 输出经 console 导出器落盘', async () => {
    const ctx = new Context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ctx.plugin(LoggerConsole, { colors: false })
    ctx.logger('probe').info('hello-console')
    expect(log).toHaveBeenCalled()
    const rendered = log.mock.calls.flat().join(' ')
    expect(rendered).toContain('hello-console')
    expect(rendered).toContain('probe')
    await ctx.fiber.dispose()
  })

  it('colors:false 时输出不含 ANSI 转义序列', async () => {
    const ctx = new Context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ctx.plugin(LoggerConsole, { colors: false })
    ctx.logger('plain').warn('no-colors')
    const rendered = log.mock.calls.flat().join(' ')
    // eslint-disable-next-line no-control-regex
    expect(rendered).not.toMatch(/\[/u)
    await ctx.fiber.dispose()
  })

  it('showTime 关闭时输出无时间前缀（[I] 直起）', async () => {
    const ctx = new Context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ctx.plugin(LoggerConsole, { colors: false, showTime: '' })
    ctx.logger('plain').info('no-time')
    const rendered = log.mock.calls.flat().join(' ')
    expect(rendered.trim().startsWith('[I]')).toBe(true)
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}/u)
    await ctx.fiber.dispose()
  })

  it('与 Timer 共存装配（boot 场景最小面）', async () => {
    const ctx = new Context()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await ctx.plugin(LoggerConsole, { colors: false })
    await ctx.plugin(Timer)
    let fired = 0
    ctx.setInterval(() => { fired += 1 }, 5)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fired).toBeGreaterThan(0)
    await ctx.fiber.dispose()
  })
})
