/**
 * 插件注册表回归——@Inject 装饰器、Inject.resolve 归一、对象插件与注入栅栏。
 * @module @ling2/ling-cordis/tests/registry
 */
import { describe, expect, it } from 'vitest'
import { Context, Inject, Service } from '../src/index.ts'

describe('注册表与依赖注入', () => {
  it('@Inject 类装饰器汇入 static inject 表，Inject.resolve 归一为映射', () => {
    @Inject('timer')
    class PluginA {}
    expect(Inject.resolve((PluginA as any).inject)).toEqual({ timer: null })
  })

  it('Inject.resolve 三种声明形态（数组/对象/带配置对象）', () => {
    expect(Inject.resolve(['a', 'b'])).toEqual({ a: null, b: null })
    expect(Inject.resolve({ a: 1 })).toEqual({ a: 1 })
    expect(Inject.resolve(null)).toEqual({})
  })

  it('对象插件（{ apply }）可装载且 apply 收到 ctx', async () => {
    const ctx = new Context()
    let applied = false
    await ctx.plugin({ name: 'obj-probe', apply: () => { applied = true } })
    expect(applied).toBe(true)
    await ctx.fiber.dispose()
  })

  it('inject 栅栏：依赖缺席时回调不执行，服务上场即触发', async () => {
    const ctx = new Context()
    const opened: number[] = []
    await ctx.inject(['probe-svc'], () => { opened.push(1) })
    expect(opened).toEqual([])
    await ctx.plugin(class ProbeService extends Service {
      static inject = [] as const
      constructor(c: Context) { super(c, 'probe-svc') }
    })
    expect(opened).toEqual([1])
    await ctx.fiber.dispose()
  })
})
