/**
 * RPC 网关空壳回归——洋葱编排/认领止链/兜底 500、机械件（jsonResponder 应答形态/
 * faceInvoker 分派与绑参）、层生命周期（createRpcFace ready/dispose）、组合全景
 * （业务 auth+门 → responder → 审计件 → invoker，位置语义即洋葱序）。
 * req/res 用最小仿真件直调 handle（夹具时序：emit 须宏任务对齐真实 I/O）。
 * @module @ling2/ling-cordis/tests/dev-rpc
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createRpcFace, createRpcServer, faceInvoker, jsonResponder, parameterNamesOf, type RpcContext, type RpcFaceEntry, type RpcLayer, type RpcMiddleware } from '../src/dev/index.ts'

/** 最小请求仿真（headers/url/method/body 三段）。 */
function fakeReq(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): EventEmitter & { method: string; url: string; headers: Record<string, string>; socket: { remoteAddress?: string } } {
  const req = new EventEmitter() as never as EventEmitter & { method: string; url: string; headers: Record<string, string>; socket: { remoteAddress?: string } }
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = { remoteAddress: '127.0.0.1' }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

/** 跑一对请求/应答并返回 {claimed,status,body,headers,json()}。 */
async function call(handle: (req: never, res: never) => Promise<boolean>, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = fakeReq(method, url, body, headers)
  const captured = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    writeHead(status: number, headers: Record<string, unknown> = {}) { captured.status = status; for (const [k, v] of Object.entries(headers)) captured.headers[k] = String(v) },
    setHeader(k: string, v: string) { captured.headers[k] = v },
    end(out = '') { captured.body = out },
    on() { /* close 挂载位 */ },
    get headersSent() { return captured.status !== 0 },
  }
  const claimed = await handle(req as never, res as never)
  return { claimed, ...captured, json: () => JSON.parse(captured.body || '{}') as Record<string, unknown> }
}

class UsersFace {
  list(page: number) { return { page, rows: ['a', 'b'] } }
  boom() { const error = new Error('炸了') as Error & { code: string }; error.code = 'SYS500'; throw error }
  slow(signal: AbortSignal) { return signal.aborted ? 'aborted' : 'alive' }
}

function facesOf(): Map<string, RpcFaceEntry> {
  return new Map([['users', {
    service: new UsersFace(),
    markers: [{ method: 'list' }, { method: 'boom' }, { method: 'slow' }],
  }]])
}

describe('createRpcServer（空壳）', () => {
  it('洋葱回程序：外层 next 后代码在内层完成后执行；认领止链', async () => {
    const order: string[] = []
    const handle = createRpcServer({ layers: [
      async (_ctx, next) => { order.push('outer-in'); const r = await next(); order.push('outer-out'); return r },
      async (_ctx, next) => { order.push('inner-in'); return true }, // 认领（更内层不再有）
      async () => { order.push('never'); return true },
    ] })
    const out = await call(handle as never, 'GET', '/x')
    expect(out.claimed).toBe(true)
    expect(order).toEqual(['outer-in', 'inner-in', 'outer-out'])
  })

  it('全链不认领=透传 false；内层抛错未应答=兜底 500', async () => {
    const pass = createRpcServer({ layers: [async (_c, next) => next()] })
    expect((await call(pass as never, 'GET', '/x')).claimed).toBe(false)
    const boom = createRpcServer({ layers: [async () => { throw new Error('炸穿') }] })
    const out = await call(boom as never, 'GET', '/x')
    expect(out.claimed).toBe(true)
    expect(out.status).toBe(500)
    expect(out.json()).toMatchObject({ ok: false, error: { message: '炸穿' } })
  })
})

describe('jsonResponder + faceInvoker（机械件）', () => {
  function server(extra: RpcLayer[] = []) {
    return createRpcServer({ layers: [jsonResponder(), ...extra, faceInvoker({ faces: facesOf })] })
  }
  // 注：responder 排最外（应答汇），extra 审计件插 invoker 外，invoker 最内

  it('参数按名绑定 + 裸应答；信封请求回信封应答', async () => {
    const out = await call(server() as never, 'POST', '/api/users/list', { args: { page: 2 } })
    expect(out.json()).toEqual({ ok: true, value: { page: 2, rows: ['a', 'b'] } })
    const env = await call(server() as never, 'POST', '/api/users/list', { type: 'client-request', rpcId: 'r1', payload: { args: { page: 3 } } })
    expect(env.json()).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { page: 3, rows: ['a', 'b'] } } })
  })

  it('面/方法未注册=404 折叠；invoke 抛错折叠 code=SYS500', async () => {
    const ns = await call(server() as never, 'POST', '/api/nope/list', { args: {} })
    expect(ns.status).toBe(404)
    expect(String((ns.json().error as { message: string }).message)).toContain("命名空间 'nope' 未注册")
    const mm = await call(server() as never, 'POST', '/api/users/missing', { args: {} })
    expect(mm.status).toBe(404)
    const boom = await call(server() as never, 'POST', '/api/users/boom', { args: {} })
    expect(boom.status).toBe(200)
    expect(boom.json()).toEqual({ ok: false, error: { code: 'SYS500', message: '炸了' } })
  })

  it('signal 参数自动注入；未成形路径不认领（404 归外层）', async () => {
    const slow = await call(server() as never, 'POST', '/api/users/slow', { args: {} })
    expect(slow.json()).toEqual({ ok: true, value: 'alive' })
    const malformed = await call(server() as never, 'POST', '/api/only-namespace', {})
    expect(malformed.claimed).toBe(false)
  })
})

describe('createRpcFace（层生命周期）', () => {
  it('ready/dispose 派发层对象 onReady/onDestroy；healthz 透传', async () => {
    const events: string[] = []
    const face = createRpcFace({
      layers: [
        { name: 'a', mw: async (_c, next) => next(), onReady: () => { events.push('ready-a') } },
        { name: 'b', mw: async (_c, next) => next(), onDestroy: () => { events.push('destroy-b') } },
      ],
      healthz: () => ({ faces: 9 }),
    })
    expect(face.healthz?.()).toEqual({ faces: 9 })
    await face.ready?.()
    await face.dispose?.()
    expect(events).toEqual(['ready-a', 'destroy-b'])
  })
})

describe('组合全景（位置语义=洋葱序）', () => {
  it('responder(最外) → 业务 auth → 会话门 → 审计件(invoker 外) → invoker', async () => {
    const tokens = new Map([['t-ok', { account: 'admin' }]])
    const handle = createRpcServer({ layers: [
      jsonResponder(),
      // 业务件①：auth 三端点（示意——login 认领 + 自带应答种 cookie，headersSent 让路）
      async (ctx: RpcContext, next) => {
        if (ctx.method === 'POST' && ctx.pathname === '/api/auth/login') {
          ctx.res.setHeader('set-cookie', 'token=t-ok; Path=/; HttpOnly')
          sendRaw(ctx, { ok: true, token: 't-ok' })
          return true
        }
        return next()
      },
      // 业务件②：会话门（/api/ 族验 token；缺席置 401 failure 返回 true——responder 发）
      async (ctx: RpcContext, next) => {
        if (ctx.method !== 'POST' || !/^\/api\/[a-zA-Z][\w.-]*\/[\w.-]+$/.test(ctx.pathname)) return next()
        const token = String(ctx.req.headers.satoken ?? '')
        const session = tokens.get(token)
        if (session === undefined) {
          ctx.status = 401
          ctx.failure = { code: 'gateway/unauthorized', message: '未登录' }
          return true
        }
        ctx.session = session
        return next()
      },
      // 审计件：invoker 之外——发送前最后一站，可改写 value
      async (ctx: RpcContext, next) => {
        const handled = await next()
        if (ctx.namespace === 'users') ctx.value = { ...(ctx.value as object), audited: true }
        return handled
      },
      faceInvoker({ faces: facesOf }),
    ] })
    const denied = await call(handle as never, 'POST', '/api/users/list', { args: { page: 1 } })
    expect(denied.status).toBe(401)
    const login = await call(handle as never, 'POST', '/api/auth/login', {})
    expect(login.headers['set-cookie']).toContain('token=t-ok')
    const granted = await call(handle as never, 'POST', '/api/users/list', { args: { page: 1 } }, { satoken: 't-ok' })
    expect(granted.json()).toEqual({ ok: true, value: { page: 1, rows: ['a', 'b'], audited: true } })
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

/** 直发助手（业务件自带应答位示意）。 */
function sendRaw(ctx: RpcContext, body: unknown): void {
  ctx.res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  ctx.res.end(JSON.stringify(body))
}

// ── 迟写形态（fire-and-forget 认领防双写——2026-10-14 dev 载体 /api/a2a/card 崩溃）──
// 病灶：内层 handler 内 `void 异步处理`（树内裸路由惯例）——认领时响应未落笔，
// responder 抢发 200 空值应答后，迟到的 writeHead 抛 ERR_HTTP_HEADERS_SENT、
// 未捕获 rejection 杀进程。修：responder 迟写分支等落笔/收尾再判。

/** 带收尾事件的应答仿真（end→finish、断开→close；对位真实 ServerResponse 事件面）。 */
function fakeResEmitting() {
  const captured = { status: 0, body: '', finished: false }
  const res = new EventEmitter() as EventEmitter & {
    writeHead(status: number, headers?: Record<string, unknown>): void
    setHeader(key: string, value: string): void
    end(out?: string): void
    readonly headersSent: boolean
    readonly writableEnded: boolean
  }
  res.writeHead = (status: number, headers: Record<string, unknown> = {}): void => {
    captured.status = status
    for (const key of Object.keys(headers)) res.setHeader(key, String(headers[key]))
  }
  res.setHeader = (): void => { /* 头表内容非本组断言面 */ }
  res.end = (out = ''): void => {
    captured.body = out
    captured.finished = true
    setImmediate(() => res.emit('finish'))
  }
  // getter 须经 defineProperty 挂（Object.assign 会把 getter 摊平成静态值）
  Object.defineProperty(res, 'headersSent', { get: () => captured.status !== 0 })
  Object.defineProperty(res, 'writableEnded', { get: () => captured.finished })
  return { res, captured }
}

describe('jsonResponder 迟写形态（fire-and-forget 认领防双写）', () => {
  it('认领而未落笔未存值——不抢发，等内层自身落笔胜出', async () => {
    const { res, captured } = fakeResEmitting()
    const handle = createRpcServer({ layers: [
      jsonResponder(),
      // 树内裸路由惯例形态：void 异步处理，跨宏任务后才落笔
      async () => {
        void (async () => {
          await new Promise((resolve) => { setTimeout(resolve, 20) })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ name: 'late-card' }))
        })()
        return true
      },
    ] })
    const claimed = await handle(fakeReq('GET', '/api/a2a/card') as never, res as never)
    expect(claimed).toBe(true)
    // 修前病态：抢发 {ok:true,value:null} + 迟到 writeHead 抛 ERR_HTTP_HEADERS_SENT
    expect(JSON.parse(captured.body)).toEqual({ name: 'late-card' })
  })

  it('faceInvoker void 返回值仍由 responder 应答（invoked 位不放行迟写分支）', async () => {
    class OpsFace { touch() { /* void 返回 */ } }
    const facesMap = new Map([['ops', { service: new OpsFace(), markers: [{ method: 'touch' }] }]]) as Map<string, RpcFaceEntry>
    const { res, captured } = fakeResEmitting()
    const handle = createRpcServer({ layers: [jsonResponder(), faceInvoker({ faces: () => facesMap })] })
    const claimed = await handle(fakeReq('POST', '/api/ops/touch', { args: {} }) as never, res as never)
    expect(claimed).toBe(true)
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body)).toEqual({ ok: true, value: null })
  })

  it('认领者从不落笔而连接断开——收尾补发不死（流错误吸收）', async () => {
    const { res, captured } = fakeResEmitting()
    const handle = createRpcServer({ layers: [
      jsonResponder(),
      async () => {
        setImmediate(() => res.emit('close')) // 客户端断开，认领者始终未落笔
        return true
      },
    ] })
    const claimed = await handle(fakeReq('GET', '/x') as never, res as never)
    expect(claimed).toBe(true)
    expect(captured.status).toBe(200) // 停摆尾补发（死连接上，错误已吸收）
    res.emit('error', new Error('死连接流错误意象'))
  })
})
