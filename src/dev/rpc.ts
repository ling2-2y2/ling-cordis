/**
 * JSON-RPC 网关内核——`POST /api/<ns>/<method>` 面分派的通用机制：会话门 →
 * 命名空间/方法查表（惰性收编钩子）→ 参数名绑定（原型源码解析）→ abort signal
 * 注入 → 双形态应答（裸 {ok,value} / typert 信封 client-request→server-response）
 * → 错误折叠（code+message）。可选认证三端点（login/me/logout，凭据语义由
 * 调用方以 λ 注入——内核零业务知识）。
 *
 * 等价性出处：机制自 ling 树 dev 载体网关逐行上收（2026-10-13 v3 薄配置化批），
 * 会话门/参数绑定/信封三件语义钉由测试与真机回归双锁。
 * @module @ling2/ling-cordis/dev/rpc
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DevHttpHandler } from './app.ts'

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

/** 网关内核构造项。 */
export interface JsonRpcGatewayOptions {
  /** RPC 会话门（缺省=auth.resolve 路线；两者皆无=裸奔，慎用）。 */
  resolveSession?: (req: IncomingMessage) => Promise<unknown>
  /** 命名空间表（每次分派现取；配合 adopt 实现惰性收编）。 */
  faces: () => Map<string, RpcFaceEntry>
  /** 首查未中钩子（收编后再查一次；典型=启动后面注册）。 */
  adopt?: () => void
  /** 认证三端点（/api/auth/login|me|logout；缺省无）。 */
  auth?: RpcAuthOptions
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

/** 建 JSON-RPC 网关内核（认领 /api/auth/* 与 /api/<ns>/<method>；未命中返回 false）。 */
export function createJsonRpcGateway(options: JsonRpcGatewayOptions): DevHttpHandler {
  const { faces, adopt, auth } = options
  const cookieName = auth?.cookie ?? 'token'
  const resolveSession = options.resolveSession
    ?? (auth === undefined ? undefined : async (req: IncomingMessage) => {
      const token = readToken(req, cookieName)
      if (token === '') return undefined
      try { return await auth.resolve(token) } catch { return undefined }
    })

  return async function jsonRpcGateway(req, res): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    // 认证三端点（匿名；凭据语义=auth λ）
    if (auth !== undefined) {
      if (pathname === '/api/auth/login' && req.method === 'POST') {
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
      if (pathname === '/api/auth/me' && req.method === 'POST') {
        const token = readToken(req, cookieName)
        const session = token !== '' ? await auth.resolve(token).catch(() => undefined) : undefined
        if (session === undefined || session === null) { sendJson(res, 401, { ok: false }); return true }
        const account = (session as { account?: unknown }).account ?? (session as { userName?: unknown }).userName ?? (session as { userId?: unknown }).userId ?? ''
        sendJson(res, 200, { ok: true, account: String(account) })
        return true
      }
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = readToken(req, cookieName)
        if (token !== '' && auth.logout !== undefined) { try { await auth.logout(token) } catch { /* 会话可能已死——照常应答 */ } }
        res.setHeader('set-cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
        sendJson(res, 200, { ok: true })
        return true
      }
    }

    // 业务 RPC：会话门 → 面/方法查表 → 参数绑定 → 双形态应答
    const match = /^\/api\/([a-zA-Z][\w.-]*)\/([\w.-]+)$/.exec(pathname)
    if (req.method === 'POST' && match !== null) {
      if (resolveSession !== undefined) {
        const session = await resolveSession(req)
        if (session === undefined || session === null) {
          sendJson(res, 401, { ok: false, error: { code: 'gateway/unauthorized', message: `未登录：会话令牌缺席或已失效 (path=${pathname})` } })
          return true
        }
      }
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
      try {
        const fn = (entry.service as Record<string, unknown>)[marker.method] as (this: unknown, ...rest: unknown[]) => unknown
        const names = parameterNamesOf(entry.service, marker.method, `${namespace}/${method}`)
        const effective: Record<string, unknown> = { ...args }
        if (names.includes('signal') && effective.signal === undefined) {
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          effective.signal = controller.signal
        }
        const value = await Reflect.apply(fn as () => unknown, entry.service, names.map(name => effective[name]))
        sendJson(res, 200, envelope
          ? { type: 'server-response', rpcId: parsed.rpcId, result: { ok: true, value: value ?? null } }
          : { ok: true, value: value ?? null })
        return true
      } catch (error) {
        const failure = failureOf(error)
        sendJson(res, 200, envelope
          ? { type: 'server-response', rpcId: parsed.rpcId, result: { ok: false, error: { code: failure.error.code, message: failure.error.message, details: {} } } }
          : { ok: false, error: failure.error })
        return true
      }
    }
    return false
  }
}
