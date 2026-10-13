/**
 * JSON-RPC 网关内核回归——会话门/面与方法查表/参数名绑定/双信封/错误折叠/
 * 认证三端点（login 种 cookie·me·logout）。req/res 用最小仿真件直调 handle，
 * 不起真服务器（内核与 HTTP 传输解耦的收益即在此）。
 * @module @ling2/ling-cordis/tests/dev-rpc
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createJsonRpcGateway, parameterNamesOf, type RpcFaceEntry } from '../src/dev/index.ts'

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
  const handle = createJsonRpcGateway({
    faces: () => faces,
    auth: {
      cookie: 'dsh_satoken',
      login: async (account, password) => (account === 'admin' && password === '123456' ? { token: 't-ok', account } : { token: '' }),
      resolve: async (token) => tokens.get(token),
      logout: async (token) => { tokens.delete(token) },
    },
  })
  return { handle, faces }
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

  it('会话门：无令牌 401；有效令牌放行到方法调用（参数按名绑定）', async () => {
    const { handle } = setup()
    const denied = await call(handle, 'POST', '/api/users/list', { args: { page: 2 } })
    expect(denied.status).toBe(401)
    expect((denied.json().error as { code: string }).code).toBe('gateway/unauthorized')
    const granted = await call(handle, 'POST', '/api/users/list', { args: { page: 2 } }, { satoken: 't-ok' })
    expect(granted.json()).toEqual({ ok: true, value: { page: 2, rows: ['a', 'b'] } })
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
