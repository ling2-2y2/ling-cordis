/**
 * webserver 路由器——通用 web 路由注册表+分发器（cordis 基础架构件）。
 *
 * 出身（2026-10-24 归位批）：自 ling-dsh-harness/src/provider-standalone/
 * webserver-bridge.ts（187 行 StandaloneWebServerBridge）平移收编——该件出生时
 * 服务 standalone 部署档，载体化后成为现役载体 webServer 服务本体（路由表），
 * 按职责归位 cordis 基础架构（类平移零行为变化，仅中性化命名）。
 *
 * 职责一句话：业务件按 exact/prefix/upgrade 三形态注册路由，HTTP 请求到达时
 * 按钉死语义查表转发——**服务器本体（createServer/listen）不在此件**（dev
 * 形态=dev/app.ts runDevApp；本件只做路由簿记与分派）。
 *
 * 分发语义钉（宿主 webServer 同形契约镜像，行为基线=收编前 spec 对拍）：
 * - exact 命中 → 最长 prefix（`p` 或 `p/` 前缀——不遮蔽 `/api/<ns>/<method>`
 *   类 RPC 命名空间）→ fallback（唯一座）；
 * - register 重复 (kind,path) 抛错（组合级契约冲突=misconfiguration）；
 * - 映射表在请求时**现查**（不缓存 handler 引用）——webGate 原地换守卫
 *   （wrapServer 存量表替换）后分派自然走到缠绕后的处理器。
 *
 * 诊断位（观测面，随收编保留）：onMiss 首未命中观测、instanceId 实例指纹
 * （同进程双副本拓扑追查）、dumpKeysOnFirstMiss 键位 dump 辅位。
 * @module @ling2/ling-coris/webserver
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** 裸路由 HTTP 处理器（收到原始 req/res，自持应答）。 */
export type WebServerHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** 裸升级路由处理器（websocket 等协议升级）。 */
export type WebServerUpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>

/** 注册路由（kind+path+handler）。 */
export interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: WebServerHandler
}

/** 注册升级路由（path+handler）。 */
export interface WebServerUpgradeRoute {
  path: string
  handler: WebServerUpgradeHandler
}

/**
 * webServer 路由器：exact/prefixes/upgrades 三 Map + fallback 唯一座 + 三注册法
 * + 两分派入口（dispatch/dispatchUpgrade）。
 */
export class WebServerRouter {
  private readonly exact = new Map<string, WebServerRoute>()
  private readonly prefixes = new Map<string, WebServerRoute>()
  private readonly upgrades = new Map<string, WebServerUpgradeRoute>()
  private fallback: WebServerHandler | undefined

  /** miss 观测位（诊断用——未命中告警的订阅口，缺席=零开销）。 */
  onMiss: ((message: string) => void) | undefined
  /** 实例指纹（诊断用：同进程两副本=两指纹——双类副本拓扑追查）。 */
  readonly instanceId = randomUUID().slice(0, 8)
  /** miss 观测辅位：首 miss 时 dump 全部 exact/prefix 键（注册面追查）。 */
  dumpKeysOnFirstMiss: (() => string) | undefined

  /** 已注册 exact/prefix 路由数（诊断读位）。 */
  get exactSize(): number { return this.exact.size }
  get prefixSize(): number { return this.prefixes.size }

  /** 注册命名路由；重复 (kind,path) 抛错。@returns 移除 disposer。 */
  register(route: WebServerRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: ${route.kind} 路由重复注册: ${route.path}`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /** 注册 exact-path 升级路由；重复 path 抛错。@returns 移除 disposer。 */
  registerUpgrade(route: WebServerUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: 升级路由重复注册: ${route.path}`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /** 认领 fallback 座（唯——二注册抛错）。@returns 移除 disposer。 */
  registerFallback(handler: WebServerHandler): () => void {
    if (this.fallback !== undefined) throw new Error('webserver: fallback 已注册')
    this.fallback = handler
    return () => { if (this.fallback === handler) this.fallback = undefined }
  }

  /**
   * HTTP 分派：exact 命中→最长 prefix→fallback。@returns 是否已认领
   * （true=调用方终止后续管线）。
   */
  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const pathname = new URL(req.url ?? '/', 'http://webserver.local').pathname
    const route = this.match(pathname)
    if (route !== undefined) {
      await route.handler(req, res)
      return true
    }
    if (this.fallback !== undefined) {
      await this.fallback(req, res)
      return true
    }
    this.onMiss?.(`${pathname} (router=${this.instanceId} exact=${this.exact.size} prefix=${this.prefixes.size})`)
    return false
  }

  /**
   * 升级分派（websocket 等）：未命中=false 交回调用方管线。
   */
  dispatchUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://webserver.local').pathname
    } catch {
      return false
    }
    const route = this.upgrades.get(pathname)
    if (route === undefined) return false
    void route.handler(req, socket, head)
    return true
  }

  /** 停路由清表（幂等——插件卸载对称清理的第二收敛点）。 */
  clear(): void {
    this.exact.clear()
    this.prefixes.clear()
    this.upgrades.clear()
    this.fallback = undefined
  }

  /** exact 命中→最长 prefix（`p` 或 `p/` 前缀）。 */
  private match(pathname: string): WebServerRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebServerRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }
}
