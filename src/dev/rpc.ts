/**
 * RPC 网关空壳——koa 式中间件洋葱（v2.0.0 空壳化：v1.x 的 auth 三端点/会话门等
 * 策略件全部移出内核，进消费方；框架只留编排与机械件）。
 *
 * **空壳（createRpcServer）**：请求上下文构造 + 层组合（compose）+ 未捕获异常
 * 兜底 500。零路由假设、零协议形状、零自动挂载——发什么、认领什么、怎么鉴权
 * 全由层决定。
 *
 * **机械件（可组合，显式排层）**：
 * - jsonResponder——洋葱内唯一发送者：内层跑完按 ctx.value/ctx.failure/ctx.status
 *   应答（信封形态随 ctx.envelope）；内层认领而未落笔未存值（fire-and-forget
 *   迟写形态）则等其自身落笔，不抢发（防双写杀进程）；
 * - faceInvoker——通用 RPC 协议件：`POST /api/<ns>/<method>` 查面→标记匹配→
 *   参数名绑定（parameterNamesOf）→ signal 注入 → invoke 写 ctx.value（不发送）。
 *
 * **位置语义（洋葱可见，无钩子黑盒）**：jsonResponder 排最外层（应答汇——内层
 * 置 value/failure/status 或自带应答）；早段业务件（auth/门/日志）随后；**改写
 * value 的审计件排在 invoker 之外**（发送前最后一站）；嵌套语义天然支持（ALS
 * 型请求上下文传播=普通中间件包 next()）。生命周期（onInit/onReady/onDestroy）
 * 挂层对象上，经 createRpcFace 的 ready/dispose 槽随 runDevApp 派发。
 * @module @ling2/ling-coris/dev/rpc
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DevHttpFaceObject, DevHttpHandler } from './app.ts'

/** 面条目：service 本体 + 方法标记表。 */
export interface RpcFaceEntry {
  /** 面服务本体（方法按名调用）。 */
  service: object
  /** 方法标记（method=服务方法名；exportName 在场时按 wire 名匹配）。 */
  markers: readonly { method: string; exportName?: string }[]
}

/** 请求上下文——贯穿洋葱各层；自定义槽经索引签名开放。 */
export interface RpcContext {
  req: IncomingMessage
  res: ServerResponse
  pathname: string
  method: string
  /** 会话门产物（业务门层写入；后续层可读）。 */
  session?: unknown
  /** 协议件命中位（invoke 前写入）。 */
  namespace?: string
  methodName?: string
  face?: RpcFaceEntry
  args?: Record<string, unknown>
  /** 信封请求标记（client-request 形态，应答回信封）。 */
  envelope?: boolean
  rpcId?: string
  /** invoke 成功值（发送前任何内层可改写）。 */
  value?: unknown
  /** 协议件已跑位（faceInvoker 成功 invoke 后置——void 返回值也欠 responder 一次应答，迟写分支不放行）。 */
  invoked?: boolean
  /** 失败（协议 404/400 或 invoke 抛错折成；发送前可改写）。 */
  failure?: { code: string; message: string }
  /** 应答状态码（responder 取此，缺省 200；门层拒绝可置 401 等）。 */
  status?: number
  [slot: string]: unknown
}

/** 中间件：处理并返回 true=已认领（含自带应答）；交给内层则 await next()。 */
export type RpcMiddleware = (ctx: RpcContext, next: () => Promise<boolean>) => Promise<boolean>

/** 层：纯中间件，或带生命周期的对象形态（onInit/onReady/onDestroy 经挂件派发）。 */
export type RpcLayer = RpcMiddleware | {
  name?: string
  mw: RpcMiddleware
  /** 建网关时一次（建议同步）。 */
  onInit?(): void | Promise<void>
  /** listen 后一次（createRpcFace().ready → runDevApp 派发）。 */
  onReady?(): void | Promise<void>
  /** 停机时一次（createRpcFace().dispose 派发）。 */
  onDestroy?(): void | Promise<void>
}

/** 空壳构造项：层序列（外→内；最内层之后 next()=false 不认领）。 */
export interface RpcServerOptions {
  layers: readonly RpcLayer[]
}

/** 参数名解析（原型源码参数表解析，禁解构/默认值/剩余参——wire 按名传参的契约面）。 */
export function parameterNamesOf(service: object, method: string, endpoint: string): string[] {
  let prototype = Object.getPrototypeOf(service)
  let implementation: unknown
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
    if (descriptor !== undefined) {
      if ('value' in descriptor && typeof descriptor.value === 'function') implementation = descriptor.value
      break
    }
    prototype = Object.getPrototypeOf(prototype)
  }
  if (implementation === undefined) throw new Error(`Remote marker has no prototype method ${JSON.stringify(method)} (${endpoint})`)
  const source = Function.prototype.toString.call(implementation as () => unknown)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  if (open < 0 || close < 0) throw new Error(`SRC method ${JSON.stringify(method)} (${endpoint}) 参数表形状不符`)
  const body = source.slice(open + 1, close).trim()
  if (body.length === 0) return []
  const names = new Set<string>()
  for (const part of body.split(',').map(piece => piece.trim())) {
    if (!/^[$A-Za-z_][$\w]*$/u.test(part) || names.has(part)) {
      throw new Error(`SRC method ${JSON.stringify(method)} (${endpoint}) 参数须为唯一标识符（禁解构/默认值/剩余参）`)
    }
    names.add(part)
  }
  return [...names]
}

// ── 机械私有件：读体记忆化 / JSON 下发 / 错误折叠 ────────────────────────────

// 体读取惰性化（WeakMap 记忆化，同请求多读不重放——裸路由先行消费原生流的兼容位）
const bodyOf = new WeakMap<IncomingMessage, Promise<Buffer>>()

/** 读请求体（机械件出口——业务层 auth 等自读体用；与 invoker 同一记忆化通道）。 */
export function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  let pending = bodyOf.get(req)
  if (pending === undefined) {
    pending = new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', () => resolve(Buffer.concat(chunks)))
    })
    bodyOf.set(req, pending)
  }
  return pending
}

/** JSON 直发（机械件出口——业务层自带应答位用）。 */
export function rpcSendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  rpcSendJson(res, status, body)
}

/** 等响应首次落笔或收尾（finish=正常收尾 / close=含连接断开），先到者解栅。 */
function settleWhenWritten(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { res.off('finish', done); res.off('close', done); resolve() }
    res.once('finish', done)
    res.once('close', done)
  })
}

const failureOf = (error: unknown): { code: string; message: string } => ({
  code: (typeof (error as { code?: string })?.code === 'string' && (error as { code?: string }).code) || 'gateway/internal',
  message: error instanceof Error ? error.message : String(error),
})

// ── 空壳与挂件 ──────────────────────────────────────────────────────────────

interface RpcAssembly {
  handle: DevHttpHandler
  layers: readonly RpcLayer[]
}

/** 组装：洋葱 compose + 生命周期归集 + 未捕获异常兜底 500。 */
function assembleRpc(options: RpcServerOptions): RpcAssembly {
  const layers = options.layers
  const mws = layers.map(layer => typeof layer === 'function' ? layer : layer.mw)
  for (const layer of layers) {
    if (typeof layer !== 'function') void Promise.resolve(layer.onInit?.()).catch(() => { /* onInit 建议同步；异步失败不阻塞首请求 */ })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ctx: RpcContext = { req, res, pathname: url.pathname, method: req.method ?? 'GET' }
    const dispatch = (i: number): Promise<boolean> =>
      i >= mws.length ? Promise.resolve(false) : Promise.resolve(mws[i]!(ctx, () => dispatch(i + 1)))
    try {
      return await dispatch(0)
    } catch (error) {
      // 兜底：业务层未捕获且未应答——500 收口（发送者是层的职责，壳只擦底）
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: failureOf(error) })
      return true
    }
  }

  return { handle, layers }
}

/** 建 RPC 网关空壳（纯处理器形态；生命周期派发用对象形态见 createRpcFace）。 */
export function createRpcServer(options: RpcServerOptions): DevHttpHandler {
  return assembleRpc(options).handle
}

/** 建网关挂件（对象形态）：ready/dispose 派发层生命周期；healthz 进健康检查；
 * upgrade 透传 ws 升级分派（DevHttpFaceObject 协议位——2026-10-27 /message/websocket
 * 断连根修：工厂此前造不出协议自有的 upgrade 槽，消费方经工厂建 face 后无法暴露
 * ws 升级路由，载体升级链走不到桥、连接被兜底销毁）。 */
export function createRpcFace(options: RpcServerOptions & {
  healthz?: () => Record<string, unknown>
  /** ws 升级处理器（认领=true 止链；透传进 face 对象——runDevApp 升级链消费）。 */
  upgrade?: DevHttpFaceObject['upgrade']
}): DevHttpFaceObject {
  const { handle, layers } = assembleRpc(options)
  return {
    handle,
    upgrade: options.upgrade,
    async ready() {
      for (const layer of layers) {
        if (typeof layer !== 'function') await layer.onReady?.()
      }
    },
    async dispose() {
      for (const layer of layers) {
        if (typeof layer !== 'function') await layer.onDestroy?.()
      }
    },
    healthz: options.healthz,
  }
}

// ── 机械件（可组合，显式排层；无任何自动挂载）──────────────────────────────

/**
 * 机械件①：洋葱的应答汇——内层跑完按 ctx 应答（value/failure/status/信封），
 * 内层抛错在此折叠为 failure。**排最外层**（一切业务件之前）：内层自带应答
 * （headersSent）则让路；内层置 ctx.value/failure/status 返回 true 则由本件发送；
 * 内层认领而四皆无（未落笔/无 value/无 failure/无 status 且 invoked 未置）=
 * **迟写形态**（fire-and-forget 裸路由惯例：handler 内 void 异步处理，将来自带
 * 落笔）——本件等响应真正落笔/收尾再判，绝不抢发（抢发会与迟到的落笔双写，
 * 后到的 writeHead 抛 ERR_HTTP_HEADERS_SENT、未捕获 rejection 杀进程——
 * 2026-10-14 dev 载体 /api/a2a/card 崩溃实证）。
 * 改写 value 的审计件排在 invoker 之外（发送前最后一站）。
 */
export function jsonResponder(): RpcMiddleware {
  return async (ctx, next) => {
    let handled: boolean
    try {
      handled = await next()
    } catch (error) {
      handled = true
      if (ctx.failure === undefined) ctx.failure = failureOf(error)
    }
    if (handled !== true) return handled
    if (ctx.res.headersSent) return true
    if (ctx.invoked !== true && ctx.value === undefined && ctx.failure === undefined && ctx.status === undefined) {
      // 迟写形态：等内层自身的落笔/收尾，再回来走发送判定。
      await settleWhenWritten(ctx.res)
      if (ctx.res.headersSent) return true
      // 停摆尾（连接收尾而认领者从未落笔）：补发落在死连接上，吸掉流错误，
      // 不让收尾写入升级成进程级未捕获异常。
      ctx.res.once('error', () => {})
    }
    if (ctx.failure !== undefined) {
      sendJson(ctx.res, ctx.status ?? 200, ctx.envelope === true
        ? { type: 'server-response', rpcId: ctx.rpcId, result: { ok: false, error: { code: ctx.failure.code, message: ctx.failure.message, details: {} } } }
        : { ok: false, error: ctx.failure })
      return true
    }
    sendJson(ctx.res, ctx.status ?? 200, ctx.envelope === true
      ? { type: 'server-response', rpcId: ctx.rpcId, result: { ok: true, value: ctx.value ?? null } }
      : { ok: true, value: ctx.value ?? null })
    return true
  }
}

/** 协议件②：`POST /api/<ns>/<method>` 面调用——查面（惰性 adopt）→标记匹配→
 * 读体→信封识别→参数名绑定→signal 注入→invoke 写 ctx.value（不发送；404/400
 * 折成 ctx.failure+status 交 responder）。排层位：最内层。 */
export function faceInvoker(options: { faces: () => Map<string, RpcFaceEntry>; adopt?: () => void }): RpcMiddleware {
  const { faces, adopt } = options
  return async (ctx) => {
    const match = /^\/api\/([a-zA-Z][\w.-]*)\/([\w.-]+)$/.exec(ctx.pathname)
    if (ctx.method !== 'POST' || match === null) return false
    const [, namespace, method] = match
    let entry = faces().get(namespace)
    if (entry === undefined && adopt !== undefined) { adopt(); entry = faces().get(namespace) }
    if (entry === undefined) {
      ctx.status = 404
      ctx.failure = { code: 'gateway/bad-request', message: `命名空间 '${namespace}' 未注册 (已挂: ${[...faces().keys()].join(', ') || '无'})` }
      return true
    }
    const marker = entry.markers.find(candidate => (candidate.exportName ?? candidate.method) === method)
    if (marker === undefined) {
      ctx.status = 404
      ctx.failure = { code: 'gateway/bad-request', message: `面 '${namespace}' 无方法 '${method}'` }
      return true
    }
    ctx.namespace = namespace
    ctx.methodName = method
    ctx.face = entry
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse((await readRequestBody(ctx.req)).toString('utf8') || '{}') as Record<string, unknown>
    } catch {
      ctx.status = 400
      ctx.failure = { code: 'gateway/bad-request', message: '请求体不是合法 JSON' }
      return true
    }
    const envelope = parsed?.type === 'client-request' && typeof parsed.rpcId === 'string'
    if (envelope && typeof (parsed.payload as { args?: unknown } | undefined)?.args !== 'object') {
      ctx.status = 400
      ctx.failure = { code: 'gateway/bad-request', message: 'RPC 信封请求缺 payload.args' }
      return true
    }
    const args = (envelope ? (parsed.payload as { args: Record<string, unknown> }).args : parsed.args) as Record<string, unknown> | undefined ?? {}
    ctx.args = args
    ctx.envelope = envelope
    if (envelope) ctx.rpcId = parsed.rpcId as string
    const fn = (entry.service as Record<string, unknown>)[marker.method] as (this: unknown, ...rest: unknown[]) => unknown
    const names = parameterNamesOf(entry.service, marker.method, `${namespace}/${method}`)
    const effective: Record<string, unknown> = { ...args }
    if (names.includes('signal') && effective.signal === undefined) {
      const controller = new AbortController()
      ctx.res.on('close', () => controller.abort())
      effective.signal = controller.signal
    }
    ctx.value = await Reflect.apply(fn as () => unknown, entry.service, names.map(name => effective[name]))
    // invoked 位：void 返回值（value===undefined）也欠 responder 一次应答——
    // 迟写分支只放行「认领而四皆无」的 fire-and-forget 形态，不误伤协议件。
    ctx.invoked = true
    return true
  }
}
