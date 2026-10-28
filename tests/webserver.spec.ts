/**
 * webserver 路由器回归钉（2026-10-24 归位批收编件）——注册三法对称拆卸、
 * 宿主同形分发语义（exact→最长前缀→fallback）、升级分派、clear 幂等。
 * @module @ling2/ling-coris/tests/webserver
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { WebServerRouter, type WebServerHandler, type WebServerRoute } from '../src/webserver/index.ts'

/** 最小请求桩（dispatch 只读 url）。 */
function reqOf(url: string): IncomingMessage {
  return { url, method: 'GET' } as unknown as IncomingMessage
}

/** 最小应答桩（handler 不写应答体的用例共用）。 */
const resOf = (): ServerResponse => ({ } as unknown as ServerResponse)

/** 记录调用序的处理器（返回认领标记）。 */
function handlerOf(log: string[], tag: string): WebServerHandler {
  return () => { log.push(tag) }
}

describe('WebServerRouter 注册三法', () => {
  it('exact/prefix 各自注册；重复 (kind,path) 抛错（宿主同语义）', () => {
    const router = new WebServerRouter()
    const dispose = router.register({ kind: 'exact', path: '/a', handler: handlerOf([], 'a') })
    router.register({ kind: 'prefix', path: '/api', handler: handlerOf([], 'api') })
    expect(router.exactSize).toBe(1)
    expect(router.prefixSize).toBe(1)
    expect(() => router.register({ kind: 'exact', path: '/a', handler: handlerOf([], 'a2') })).toThrow('路由重复注册')
    expect(() => router.register({ kind: 'prefix', path: '/api', handler: handlerOf([], 'api2') })).toThrow('路由重复注册')
    dispose()
    expect(router.exactSize).toBe(0)
  })

  it('upgrade 注册+重复抛错+拆卸对称', () => {
    const router = new WebServerRouter()
    const dispose = router.registerUpgrade({ path: '/ws', handler: () => {} })
    expect(() => router.registerUpgrade({ path: '/ws', handler: () => {} })).toThrow('升级路由重复注册')
    dispose()
    // 拆卸后再注册不抛（对称）
    expect(() => router.registerUpgrade({ path: '/ws', handler: () => {} })).not.toThrow()
  })

  it('fallback 唯一座：二注册抛错、拆卸后可再认领', () => {
    const router = new WebServerRouter()
    const dispose = router.registerFallback(handlerOf([], 'fb'))
    expect(() => router.registerFallback(handlerOf([], 'fb2'))).toThrow('fallback 已注册')
    dispose()
    expect(() => router.registerFallback(handlerOf([], 'fb3'))).not.toThrow()
  })
})

describe('WebServerRouter 分发语义（宿主 match 镜像）', () => {
  it('exact 命中优先于 prefix', async () => {
    const router = new WebServerRouter()
    const log: string[] = []
    router.register({ kind: 'exact', path: '/api/special', handler: handlerOf(log, 'exact') })
    router.register({ kind: 'prefix', path: '/api', handler: handlerOf(log, 'prefix') })
    await router.dispatch(reqOf('/api/special'), resOf())
    expect(log).toEqual(['exact'])
  })

  it('prefix 最长前缀胜（`p` 或 `p/` 边界——/api2 不被 /api 误吃）', async () => {
    const router = new WebServerRouter()
    const log: string[] = []
    router.register({ kind: 'prefix', path: '/api', handler: handlerOf(log, 'short') })
    router.register({ kind: 'prefix', path: '/api/v2', handler: handlerOf(log, 'long') })
    await router.dispatch(reqOf('/api/v2/item'), resOf())
    expect(log).toEqual(['long'])
    log.length = 0
    await router.dispatch(reqOf('/api2'), resOf())
    expect(log).toEqual([])
  })

  it('未命中路由但 fallback 在场=fallback 认领（回 true）；全未命中=回 false+onMiss 触发', async () => {
    const router = new WebServerRouter()
    const misses: string[] = []
    router.onMiss = (message) => { misses.push(message) }
    // 全未命中
    expect(await router.dispatch(reqOf('/none'), resOf())).toBe(false)
    expect(misses).toHaveLength(1)
    // fallback 认领
    const log: string[] = []
    router.registerFallback(handlerOf(log, 'fb'))
    expect(await router.dispatch(reqOf('/none'), resOf())).toBe(true)
    expect(log).toEqual(['fb'])
  })

  it('升级分派：命中执行回 true；未命中/坏 URL 回 false', () => {
    const router = new WebServerRouter()
    let upgraded = 0
    router.registerUpgrade({ path: '/ws', handler: () => { upgraded += 1 } })
    const socket = {} as never
    expect(router.dispatchUpgrade(reqOf('/ws'), socket, Buffer.alloc(0))).toBe(true)
    expect(upgraded).toBe(1)
    expect(router.dispatchUpgrade(reqOf('/other'), socket, Buffer.alloc(0))).toBe(false)
  })
})

describe('WebServerRouter 生命周期与诊断位', () => {
  it('clear 清三表+fallback，幂等可重调', async () => {
    const router = new WebServerRouter()
    router.register({ kind: 'exact', path: '/a', handler: handlerOf([], 'a') })
    router.register({ kind: 'prefix', path: '/p', handler: handlerOf([], 'p') })
    router.registerUpgrade({ path: '/ws', handler: () => {} })
    router.registerFallback(handlerOf([], 'fb'))
    router.clear()
    router.clear()
    expect(router.exactSize).toBe(0)
    expect(router.prefixSize).toBe(0)
    expect(await router.dispatch(reqOf('/a'), resOf())).toBe(false)
  })

  it('实例指纹在位（诊断位——双副本拓扑追查）', () => {
    const router = new WebServerRouter()
    expect(router.instanceId).toMatch(/^[0-9a-f]{8}$/)
  })
})

/** 路由类型形状编译期钉（kind 收窄枚举）。 */
describe('WebServerRouter 类型面', () => {
  it('WebServerRoute.kind 收窄 exact|prefix（编译期钉——运行时直通）', () => {
    const route: WebServerRoute = { kind: 'prefix', path: '/x', handler: () => {} }
    expect(route.kind).toBe('prefix')
  })
})
