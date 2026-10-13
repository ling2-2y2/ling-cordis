/**
 * JSON-RPC 网关内核——`POST /api/<ns>/<method>` 面分派。分两层：
 *
 * **机械层（真·基础架构，留内核）**：请求上下文贯穿、钩子链编排、读体记忆化、
 * JSON 下发、路由匹配。
 * **策略层（wire 约定，全部为可拔内置钩子）**：认证三端点（authRoutes）、会话门
 * （sessionGate）、参数名绑定与双信封应答（分派核心内，afterRequest/onError 可改写）。
 *
 * 生命周期（axios interceptor / vite plugin hook 同款思路）：
 *   onInit（建网关一次，建议同步）→ 每请求 beforeRequest（可认领止链）→
 *   [内置 authRoutes → sessionGate → 分派核心] → afterRequest（invoke 成功后、
 *   发送前，可改写 value）→ onError（invoke 抛错后，可改写 failure）→
 *   onReady（listen 后经 createRpcFace().ready 派发）/ onDestroy（停机派发）。
 *
 * 钩子顺序契约：用户 hooks 先于内置策略钩子（用户可先认领公开路由，如验证码/
 * 健康探针/静态直出）；会话门只拦 `/api/` 族。ALS 型包裹类关注（请求级上下文
 * 传播）需嵌套语义，before/after 对不适用——留在调用方组合（包裹 handle）。
 *
 * 等价性出处：机械+策略语义自 ling 树 dev 载体网关逐行上收（2026-10-13 v3），
 * v1.4.0 钩子化重构保持 createJsonRpcGateway 既有行为零变化（兼容证=既有测试
 * 不动全绿）。
 * @module @ling2/ling-cordis/dev/rpc
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

/** 认证三端点语义（凭据/token 机制由调用方注入）。 */
export interface RpcAuthOptions {
  /** 登录：成功返回 token（+可选账号回显）；失败抛错或返回空 token。 */
  login: (account: string, password: string, clientIp?: string) => Promise<{ token: string; account?: string }>
  /** 会话查询（兼作 RPC 会话门）：无效/缺席=undefined。 */
  resolve: (token: string) => Promise<unknown>
  /** 登出（会话可能已死——内核吞错照常应答）。 */
  logout?: (token: string) => Promise<void>
  /** 会话 cookie 名，缺省 'token'。 */
  cookie?: string
}

/** 请求上下文——贯穿钩子链与分派核心；自定义槽经索引签名开放。 */
export interface RpcContext {
  req: IncomingMessage
  res: ServerResponse
  pathname: string
  method: string
  /** 会话门产物（门通过后在场；钩子可自读）。 */
  session?: unknown
  /** 分派命中位（invoke 前写入）。 */
  namespace?: string
  methodName?: string
  face?: RpcFaceEntry
  args?: Record<string, unknown>
  /** 信封请求标记（client-request 形态，应答回信封）。 */
  envelope: boolean
  rpcId?: string
  /** invoke 成功值（afterRequest 可改写，发送取此）。 */
  value?: unknown
  /** invoke 失败（onError 可改写，发送取此）。 */
  failure?: { code: string; message: string }
  [slot: string]: unknown
}

/** 网关生命周期钩子（axios interceptor / vite plugin hook 同位概念）。 */
export interface RpcHook {
  /** 钩子名（诊断用）。 */
  name?: string
  /** 建网关时一次（建议同步——async 不阻塞首请求不保证完成）。 */
  onInit?(): void | Promise<void>
  /** listen 后一次（经 createRpcFace().ready → runDevApp 派发）。 */
  onReady?(): void | Promise<void>
  /** 每请求前置：返回 true=认领止链（自带应答）；只写 rctx 不认领则透传。 */
  beforeRequest?(ctx: RpcContext): boolean | Promise<boolean> | void
  /** invoke 成功后、发送前：可改写 ctx.value。 */
  afterRequest?(ctx: RpcContext): void | Promise<void>
  /** invoke 抛错后、发送前：可改写 ctx.failure。 */
  onError?(ctx: RpcContext): void | Promise<void>
  /** 停机时一次（经 createRpcFace().dispose 派发）。 */
  onDestroy?(): void | Promise<void>
}

/** 网关内核构造项。 */
export interface JsonRpcGatewayOptions {
  /** RPC 会话门（缺省=auth.resolve 路线；两者皆无=裸奔，慎用）。 */
  resolveSession?: (req: IncomingMessage) => Promise<unknown>
  /** 登录态确立回调（会话验签通过后随 token 调用——审计上下文/身份绑定挂点）。 */
  onSession?: (token: string, session: unknown) => void
  /** 命名空间表（每次分派现取；配合 adopt 实现惰性收编）。 */
  faces: () => Map<string, RpcFaceEntry>
  /** 首查未中钩子（收编后再查一次；典型=启动后面注册）。 */
  adopt?: () => void
  /** 认证三端点（/api/auth/login|me|logout；缺省无）。 */
  auth?: RpcAuthOptions
  /** 用户钩子链（先于内置策略钩子执行——可先认领公开路由）。 */
  hooks?: readonly RpcHook[]
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

// ── 机械层（私有）：读体记忆化 / JSON 下发 / 令牌读取 / 错误折叠 ──────────────

// 体读取惰性化（WeakMap 记忆化，同请求多读不重放——裸路由先行消费原生流的兼容位）
const bodyOf = new WeakMap<IncomingMessage, Promise<Buffer>>()

function readBody(req: IncomingMessage): Promise<Buffer> {
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

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const failureOf = (error: unknown) => ({ ok: false, error: { code: (typeof (error as { code?: string })?.code === 'string' && (error as { code?: string }).code) || 'gateway/internal', message: error instanceof Error ? error.message : String(error) } })

function readToken(req: IncomingMessage, cookieName: string): string {
  const cookieRe = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`)
  const cookie = cookieRe.exec(String(req.headers.cookie ?? ''))?.[1]
  if (cookie !== undefined && cookie !== '') return decodeURIComponent(cookie)
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))
  if (bearer !== null) return bearer[1]!.trim()
  const header = req.headers.satoken
  return typeof header === 'string' ? header.trim() : ''
}

async function readJson(raw: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

// ── 策略层（内置可拔钩子工厂）───────────────────────────────────────────────

/** 内置钩子①：认证三端点路由（/api/auth/login|me|logout——wire 约定，可经
 * options.auth 缺席整体拔除；登录种 cookie、me 回账号、logout 清 cookie+踢线）。 */
function authRoutesHook(auth: RpcAuthOptions): RpcHook {
  const cookieName = auth.cookie ?? 'token'
  return {
    name: 'auth-routes',
    async beforeRequest(ctx) {
      const { req, res, pathname, method } = ctx
      if (pathname === '/api/auth/login' && method === 'POST') {
        try {
          const body = await readJson((await readBody(req)).toString('utf8'))
          const account = typeof body.account === 'string' ? body.account : ''
          const password = typeof body.password === 'string' ? body.password : ''
          if (account === '' || password === '') { sendJson(res, 400, { ok: false, message: '账号与密码不能为空' }); return true }
          const info = await auth.login(account, password, req.socket.remoteAddress)
          if (typeof info?.token !== 'string' || info.token === '') { sendJson(res, 401, { ok: false, message: '登录失败（签发空令牌）' }); return true }
          res.setHeader('set-cookie', `${cookieName}=${info.token}; Path=/; HttpOnly; SameSite=Strict`)
          sendJson(res, 200, { ok: true, token: info.token, account: info.account ?? account })
          return true
        } catch (error) {
          sendJson(res, 401, { ok: false, message: error instanceof Error ? error.message : String(error) })
          return true
        }
      }
      if (pathname === '/api/auth/me' && method === 'POST') {
        const token = readToken(req, cookieName)
        const session = token !== '' ? await auth.resolve(token).catch(() => undefined) : undefined
        if (session === undefined || session === null) { sendJson(res, 401, { ok: false }); return true }
        const account = (session as { account?: unknown }).account ?? (session as { userName?: unknown }).userName ?? (session as { userId?: unknown }).userId ?? ''
        sendJson(res, 200, { ok: true, account: String(account) })
        return true
      }
      if (pathname === '/api/auth/logout' && method === 'POST') {
        const token = readToken(req, cookieName)
        if (token !== '' && auth.logout !== undefined) { try { await auth.logout(token) } catch { /* 会话可能已死——照常应答 */ } }
        res.setHeader('set-cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
        sendJson(res, 200, { ok: true })
        return true
      }
      return false
    },
  }
}

/** 内置钩子②：会话门（resolveSession/auth.resolve 路线；只拦与分派形状一致
 * 的 POST /api/<ns>/<method> 路径——未成形路径仍走分派核心的 404，语义零漂移；
 * 通过即写 ctx.session 并回调 onSession，缺席=401 拒）。 */
function sessionGateHook(options: JsonRpcGatewayOptions): RpcHook | undefined {
  const { auth, onSession } = options
  const cookieName = auth?.cookie ?? 'token'
  const resolveSession = options.resolveSession
    ?? (auth === undefined ? undefined : async (req: IncomingMessage) => {
      const token = readToken(req, cookieName)
      if (token === '') return undefined
      try {
        const session = await auth.resolve(token)
        if (session !== undefined && session !== null && onSession !== undefined) onSession(token, session)
        return session
      } catch { return undefined }
    })
  if (resolveSession === undefined) return undefined
  return {
    name: 'session-gate',
    async beforeRequest(ctx) {
      if (ctx.method !== 'POST' || !/^\/api\/[a-zA-Z][\w.-]*\/[\w.-]+$/.test(ctx.pathname)) return false
      const session = await resolveSession(ctx.req)
      if (session === undefined || session === null) {
        sendJson(ctx.res, 401, { ok: false, error: { code: 'gateway/unauthorized', message: `未登录：会话令牌缺席或已失效 (path=${ctx.pathname})` } })
        return true
      }
      ctx.session = session
      return false
    },
  }
}

// ── 组装：钩子链 + 分派核心 ────────────────────────────────────────────────

/** 组装产物：处理器 + 全量钩子（生命周期派发用）。 */
interface RpcAssembly {
  handle: DevHttpHandler
  hooks: readonly RpcHook[]
}

function assembleRpc(options: JsonRpcGatewayOptions): RpcAssembly {
  const { faces, adopt } = options
  // 顺序契约：用户钩子 → 内置策略钩子（auth 三端点先于会话门——公开路由不得被门拦）
  const hooks: RpcHook[] = [...(options.hooks ?? [])]
  if (options.auth !== undefined) hooks.push(authRoutesHook(options.auth))
  const gate = sessionGateHook(options)
  if (gate !== undefined) hooks.push(gate)
  for (const hook of hooks) void Promise.resolve(hook.onInit?.()).catch(() => { /* onInit 建议同步；异步失败不阻塞首请求 */ })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const rctx: RpcContext = { req, res, pathname: url.pathname, method: req.method ?? 'GET', envelope: false }

    // 钩子链前置段：认领即止（自带应答）
    for (const hook of hooks) {
      if (await hook.beforeRequest?.(rctx) === true) return true
    }

    // 分派核心：面/方法查表 → 参数绑定 → invoke → afterRequest → 应答
    const match = /^\/api\/([a-zA-Z][\w.-]*)\/([\w.-]+)$/.exec(rctx.pathname)
    if (rctx.method !== 'POST' || match === null) return false
    const [, namespace, method] = match
    let entry = faces().get(namespace)
    if (entry === undefined && adopt !== undefined) { adopt(); entry = faces().get(namespace) }
    if (entry === undefined) {
      sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: `命名空间 '${namespace}' 未注册 (已挂: ${[...faces().keys()].join(', ') || '无'})` } })
      return true
    }
    const marker = entry.markers.find(candidate => (candidate.exportName ?? candidate.method) === method)
    if (marker === undefined) {
      sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: `面 '${namespace}' 无方法 '${method}'` } })
      return true
    }
    let parsed: Record<string, unknown>
    try { parsed = await readJson((await readBody(req)).toString('utf8')) } catch (error) {
      sendJson(res, 400, { ok: false, error: { code: 'gateway/bad-request', message: error instanceof Error ? error.message : String(error) } })
      return true
    }
    const envelope = parsed?.type === 'client-request' && typeof parsed.rpcId === 'string'
    if (envelope && typeof (parsed.payload as { args?: unknown } | undefined)?.args !== 'object') {
      sendJson(res, 400, { ok: false, error: { code: 'gateway/bad-request', message: 'RPC 信封请求缺 payload.args' } })
      return true
    }
    const args = (envelope ? (parsed.payload as { args: Record<string, unknown> }).args : parsed.args) as Record<string, unknown> | undefined ?? {}
    rctx.namespace = namespace
    rctx.methodName = method
    rctx.face = entry
    rctx.args = args
    rctx.envelope = envelope
    if (envelope) rctx.rpcId = parsed.rpcId as string

    try {
      const fn = (entry.service as Record<string, unknown>)[marker.method] as (this: unknown, ...rest: unknown[]) => unknown
      const names = parameterNamesOf(entry.service, marker.method, `${namespace}/${method}`)
      const effective: Record<string, unknown> = { ...args }
      if (names.includes('signal') && effective.signal === undefined) {
        const controller = new AbortController()
        res.on('close', () => controller.abort())
        effective.signal = controller.signal
      }
      rctx.value = await Reflect.apply(fn as () => unknown, entry.service, names.map(name => effective[name]))
      for (const hook of hooks) await hook.afterRequest?.(rctx)
      sendJson(res, 200, envelope
        ? { type: 'server-response', rpcId: rctx.rpcId, result: { ok: true, value: rctx.value ?? null } }
        : { ok: true, value: rctx.value ?? null })
      return true
    } catch (error) {
      const failure = failureOf(error)
      rctx.failure = failure.error
      for (const hook of hooks) await hook.onError?.(rctx)
      sendJson(res, 200, envelope
        ? { type: 'server-response', rpcId: rctx.rpcId, result: { ok: false, error: { code: (rctx.failure as { code: string }).code, message: (rctx.failure as { message: string }).message, details: {} } } }
        : { ok: false, error: rctx.failure })
      return true
    }
  }

  return { handle, hooks }
}

/** 建 JSON-RPC 网关（纯处理器形态；options 兼容 v1.3.x 全字段）。
 * 生命周期派发用对象形态见 createRpcFace。 */
export function createJsonRpcGateway(options: JsonRpcGatewayOptions): DevHttpHandler {
  return assembleRpc(options).handle
}

/** 建网关挂件（对象形态）：handle 之外收拢钩子生命周期——ready 在 runDevApp
 * listen 后被调（派发 onReady）、dispose 停机被调（派发 onDestroy）；healthz
 * 附加位随挂件并入健康检查应答。 */
export function createRpcFace(options: JsonRpcGatewayOptions & { healthz?: () => Record<string, unknown> }): DevHttpFaceObject {
  const { handle, hooks } = assembleRpc(options)
  return {
    handle,
    async ready() {
      for (const hook of hooks) await hook.onReady?.()
    },
    async dispose() {
      for (const hook of hooks) await hook.onDestroy?.()
    },
    healthz: options.healthz,
  }
}
