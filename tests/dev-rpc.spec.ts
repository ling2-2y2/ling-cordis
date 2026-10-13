/**
 * JSON-RPC 网关内核回归——会话门/面与方法查表/参数名绑定/双信封/错误折叠/
 * 认证三端点（login 种 cookie·me·logout）。req/res 用最小仿真件直调 handle，
 * 不起真服务器（内核与 HTTP 传输解耦的收益即在此）。
 * @module @ling2/ling-cordis/tests/dev-rpc
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createJsonRpcGateway, createRpcFace, parameterNamesOf, type RpcFaceEntry } from '../src/dev/index.ts'

/** 最小请求仿真（headers/url/method/body 三段）。 */
function fakeReq(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): EventEmitter & { method: string; url: string; headers: Record<string, string>; socket: { remoteAddress?: string } } {
  const req = new EventEmitter() as never as EventEmitter & { method: string; url: string; headers: Record<string, string>; socket: { remoteAddress?: string } }
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = { remoteAddress: '127.0.0.1' }
  // setImmediate（宏任务）对齐真实网络 I/O 时序——queueMicrotask 会在 handle 的
  // 首个 await（会话解析）让出时就发完 data/end，readBody 监听器注册即晚
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

class UsersFace {
  list(page: number) { return { page, rows: ['a', 'b'] } }
  boom() { const error = new Error('炸了') as Error & { code: string }; error.code = 'SYS500'; throw error }
  slow(signal: AbortSignal) { return signal.aborted ? 'aborted' : 'alive' }
}

function setup() {
  const faces = new Map<string, RpcFaceEntry>([['users', {
    service: new UsersFace(),
    markers: [{ method: 'list' }, { method: 'boom' }, { method: 'slow' }],
  }]])
  const tokens = new Map([['t-ok', { account: 'admin' }]])
  const sessions: string[] = []
  const handle = createJsonRpcGateway({
    faces: () => faces,
    onSession: (token, session) => { sessions.push(`${token}:${String((session as { account?: string }).account)}`) },
    auth: {
      cookie: 'dsh_satoken',
      login: async (account, password) => (account === 'admin' && password === '123456' ? { token: 't-ok', account } : { token: '' }),
      resolve: async (token) => tokens.get(token),
      logout: async (token) => { tokens.delete(token) },
    },
  })
  return { handle, faces, sessions }
}

/** 跑一对请求/应答并返回 {status, body}。 */
async function call(handle: ReturnType<typeof createJsonRpcGateway>, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = fakeReq(method, url, body, headers)
  const captured = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    writeHead(status: number, headers: Record<string, unknown> = {}) { captured.status = status; for (const [k, v] of Object.entries(headers)) captured.headers[k] = String(v) },
    setHeader(k: string, v: string) { captured.headers[k] = v },
    end(out = '') { captured.body = out },
    on() { /* close 挂载位 */ },
  }
  const claimed = await handle(req as never, res as never)
  return { claimed, ...captured, json: () => JSON.parse(captured.body || '{}') as Record<string, unknown> }
}

describe('createJsonRpcGateway', () => {
  it('登录成功种 cookie；错误账密 401', async () => {
    const { handle } = setup()
    const ok = await call(handle, 'POST', '/api/auth/login', { account: 'admin', password: '123456' })
    expect(ok.claimed).toBe(true)
    expect(ok.json()).toMatchObject({ ok: true, token: 't-ok', account: 'admin' })
    expect(ok.headers['set-cookie']).toContain('dsh_satoken=t-ok')
    const bad = await call(handle, 'POST', '/api/auth/login', { account: 'admin', password: 'x' })
    expect(bad.status).toBe(401)
  })

  it('会话门：无令牌 401；有效令牌放行到方法调用（参数按名绑定）；onSession 登录态回调', async () => {
    const { handle, sessions } = setup()
    const denied = await call(handle, 'POST', '/api/users/list', { args: { page: 2 } })
    expect(denied.status).toBe(401)
    expect((denied.json().error as { code: string }).code).toBe('gateway/unauthorized')
    expect(sessions).toEqual([])
    const granted = await call(handle, 'POST', '/api/users/list', { args: { page: 2 } }, { satoken: 't-ok' })
    expect(granted.json()).toEqual({ ok: true, value: { page: 2, rows: ['a', 'b'] } })
    expect(sessions).toEqual(['t-ok:admin'])
  })

  it('面/方法未注册=404 带指路；信封请求回信封应答（错误折叠 code）', async () => {
    const { handle } = setup()
    const nsMissing = await call(handle, 'POST', '/api/nope/list', {}, { satoken: 't-ok' })
    expect(nsMissing.status).toBe(404)
    expect(String((nsMissing.json().error as { message: string }).message)).toContain("命名空间 'nope' 未注册")
    const methodMissing = await call(handle, 'POST', '/api/users/missing', {}, { satoken: 't-ok' })
    expect(methodMissing.status).toBe(404)
    const boom = await call(handle, 'POST', '/api/users/boom', { type: 'client-request', rpcId: 'r1', payload: { args: {} } }, { satoken: 't-ok' })
    expect(boom.json()).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: false, error: { code: 'SYS500', message: '炸了', details: {} } } })
  })

  it('signal 参数自动注入（未中止即可读）；非 /api 路径不认领', async () => {
    const { handle } = setup()
    const slow = await call(handle, 'POST', '/api/users/slow', { args: {} }, { satoken: 't-ok' })
    expect(slow.json()).toEqual({ ok: true, value: 'alive' })
    const passthrough = await call(handle, 'GET', '/healthz')
    expect(passthrough.claimed).toBe(false)
  })
})

describe('parameterNamesOf', () => {
  it('空参表/常规参表/解构拒绝', () => {
    class Probe { two(a: string, b: number) { return [a, b] }; none() { return 0 } }
    expect(parameterNamesOf(new Probe(), 'two', 'p/two')).toEqual(['a', 'b'])
    expect(parameterNamesOf(new Probe(), 'none', 'p/none')).toEqual([])
    class Broken { broken({ a }: { a: number }) { return a } }
    expect(() => parameterNamesOf(new Broken(), 'broken', 'p/broken')).toThrow(/唯一标识符/)
  })
})

describe('RpcHook 生命周期', () => {
  it('用户钩子先于内置策略：认领止链（公开路由不被会话门拦）；未认领全链透传到门', async () => {
    const order: string[] = []
    const handle = createJsonRpcGateway({
      faces: () => new Map([['users', { service: new UsersFace(), markers: [{ method: 'list' }] }]]),
      hooks: [
        {
          name: 'public-routes',
          beforeRequest: (c) => {
            order.push(`h1:${c.pathname}`)
            if (c.pathname !== '/api/public/ping' || c.method !== 'POST') return false
            c.res.writeHead(200, { 'content-type': 'application/json' })
            c.res.end('{"ok":true,"value":"pong"}')
            return true
          },
        },
        { name: 'observer', beforeRequest: (c) => { order.push('h2') } },
      ],
      auth: {
        login: async (account) => ({ token: account }),
        resolve: async (token) => (token === 't-ok' ? { account: 'admin' } : undefined),
      },
    })
    const pong = await call(handle, 'POST', '/api/public/ping', {})
    expect(pong.claimed).toBe(true)
    expect(pong.json()).toEqual({ ok: true, value: 'pong' })
    expect(order).toEqual(['h1:/api/public/ping']) // 认领即止：h2/内置门未跑
    const denied = await call(handle, 'POST', '/api/users/list', { args: {} })
    expect(denied.status).toBe(401) // 门在用户钩子之后拒未登录
    expect(order).toEqual(['h1:/api/public/ping', 'h1:/api/users/list', 'h2'])
  })

  it('afterRequest 改写 value；onError 改写 failure（发送取改写值）', async () => {
    const handle = createJsonRpcGateway({
      faces: () => new Map([['users', { service: new UsersFace(), markers: [{ method: 'list' }, { method: 'boom' }] }]]),
      auth: {
        login: async (account) => ({ token: account }),
        resolve: async (token) => (token === 't-ok' ? { account: 'admin' } : undefined),
      },
      hooks: [
        { afterRequest: (c) => { if (c.namespace === 'users' && c.methodName === 'list') c.value = 43 } },
        { onError: (c) => { c.failure = { code: 'REWRITTEN', message: '钩子改写' } } },
      ],
    })
    const granted = await call(handle, 'POST', '/api/users/list', { args: { page: 1 } }, { satoken: 't-ok' })
    expect(granted.json()).toEqual({ ok: true, value: 43 })
    const boom = await call(handle, 'POST', '/api/users/boom', { args: {} }, { satoken: 't-ok' })
    expect(boom.json()).toEqual({ ok: false, error: { code: 'REWRITTEN', message: '钩子改写' } })
  })

  it('会话门正则与分派形状一致：未成形 POST /api/x 不被门拦（不认领，404 归外层）', async () => {
    const handle = createJsonRpcGateway({
      faces: () => new Map(),
      auth: { login: async (a) => ({ token: a }), resolve: async () => undefined },
    })
    const malformed = await call(handle, 'POST', '/api/only-namespace', {})
    expect(malformed.claimed).toBe(false)
  })

  it('createRpcFace：healthz 透传；ready/dispose 派发钩子 onReady/onDestroy', async () => {
    const events: string[] = []
    const face = createRpcFace({
      faces: () => new Map(),
      hooks: [
        { onReady: () => { events.push('ready') } },
        { onDestroy: () => { events.push('destroy') } },
      ],
      healthz: () => ({ faces: 9 }),
    })
    expect(face.healthz?.()).toEqual({ faces: 9 })
    await face.ready?.()
    await face.dispose?.()
    expect(events).toEqual(['ready', 'destroy'])
  })
})
