/**
 * dev-app 演示配置——vite.config.ts 同款薄形态的完整最小样：三相插件挂载
 * （default/命名空间双出口形态）+ JSON-RPC 网关（内存凭据，零业务依赖）+
 * 静态 SPA + healthz。消费者视角把 '../../src/dev/index.ts' 换成
 * '@ling2/ling-cordis/dev' 即同款。
 *
 * 动态 import 说明符须绝对化且用 file:// URL（相对路径按内核文件解析不随本配置；
 * Windows 裸盘符路径非合法 ESM 说明符）——spec()/dir() 两助手即此用。
 * @module @ling2/ling-cordis/examples/dev-app/ling.config
 */
import { fileURLToPath } from 'node:url'
import { createRpcFace, defineApp, faceInvoker, jsonResponder, readRequestBody, rpcSendJson } from '../../src/dev/index.ts'

/** 演示自持业务件：内存凭据 auth 三端点（空壳化的意义——凭据语义属应用，
 * 真实项目=树 ling-dsh-common dev-gateway 的 satoken 版同位层）。 */
function demoAuthRoutes() {
  const cookie = 't-demo'
  const tokens = new Map([['t-demo', { account: 'demo' }]])
  const readToken = (req) => req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${cookie}=([^;]*)`))?.[1] ?? req.headers.satoken ?? ''
  return async (ctx, next) => {
    const { method, pathname, req, res } = ctx
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = JSON.parse((await readRequestBody(req)).toString('utf8') || '{}')
      const ok = body.account === 'demo' && body.password === '123456'
      res.setHeader('set-cookie', `${cookie}=${ok ? 't-demo' : ''}; Path=/; HttpOnly; SameSite=Strict`)
      rpcSendJson(res, ok ? 200 : 401, ok ? { ok: true, token: 't-demo', account: 'demo' } : { ok: false, message: '登录失败' })
      return true
    }
    if (method === 'POST' && pathname === '/api/auth/me') {
      const session = tokens.get(readToken(req))
      rpcSendJson(res, session === undefined ? 401 : 200, session === undefined ? { ok: false } : { ok: true, account: session.account })
      return true
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      res.setHeader('set-cookie', `${cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
      rpcSendJson(res, 200, { ok: true })
      return true
    }
    // 会话门（/api/ 族）：缺席置 401 failure 交 responder 发
    if (method === 'POST' && /^\/api\/[a-zA-Z][\w.-]*\/[\w.-]+$/.test(pathname)) {
      const session = tokens.get(readToken(req))
      if (session === undefined) {
        ctx.status = 401
        ctx.failure = { code: 'gateway/unauthorized', message: `未登录：会话令牌缺席或已失效 (path=${pathname})` }
        return true
      }
      ctx.session = session
    }
    return next()
  }
}

/** 动态 import 说明符（file:// URL——Windows 裸盘符路径非合法 ESM 说明符）。 */
const spec = (path) => new URL(path, import.meta.url).href
/** 文件系统路径（rootDir/静态根等 readFileSync 消费位）。 */
const dir = (path) => fileURLToPath(new URL(path, import.meta.url))

export default defineApp({
  rootDir: dir('.'),
  label: 'demo',
  port: Number(process.env.PORT ?? 8390),
  redirects: { '/': '/app/' },
  staticApp: { root: dir('./web') },
  // 想要前端热更？在 web/ 装 vite 后放开下一行（vite 缺席自动回落静态，不炸）：
  // hmr: { cwd: dir('./web') },

  phases: ['base', 'core', 'tail'],
  modules: [
    // default 出口形态（class 插件；use:'default'）
    { id: 'greet', phase: 'core', note: '问候服务（RPC 面本体）', spec: spec('./plugins/greet.ts'), use: 'default' },
    // 命名空间出口形态（apply 函数族）+ config + after 钩子
    { id: 'metrics', phase: 'core', note: '计数器（apply 形态）', spec: spec('./plugins/metrics.ts'), config: { start: 10 }, after: (ctx) => { ctx.get('metrics').bump() } },
    // ── 跨模块示例：demo1（能力方，core 相）→ demo2（消费方，tail 相）──
    // demo2 用 static inject 声明依赖 demo1——cordis 等侍语义保证构造时已在场，
    // 故跨 tail/core 两相挂载也不怕序（依赖契约 > 挂载顺序）
    { id: 'demo1', phase: 'core', note: '跨模块·能力方（double/name）', spec: spec('./plugins/demo1.ts'), use: 'default' },
    { id: 'demo2', phase: 'tail', note: '跨模块·消费方（static inject 依赖 demo1）', spec: spec('./plugins/demo2.ts'), use: 'default' },
  ],

  // RPC 网关（v2 空壳化）：框架只出机械件（jsonResponder 应答汇/faceInvoker 分派），
  // 业务层（auth 三端点+会话门）是演示自持中间件——层序即语义：
  // responder(最外·应答汇) → 业务 auth/门 → 审计件(invoker 外·发送前改写) → invoker。
  http: (ctx) => [createRpcFace({
    layers: [
      jsonResponder(),
      demoAuthRoutes(),
      async (c, next) => { console.log(`[demo] → ${c.method} ${c.pathname}`); const r = await next(); if (c.namespace !== undefined) console.log(`[demo] ← ${c.namespace}/${c.methodName}`); return r },
      async (c, next) => { const r = await next(); if (c.namespace === 'demo2') c.value = { ...c.value, audited: true }; return r },
      faceInvoker({ faces: () => new Map([
        ['demo', { service: ctx.get('greet'), markers: [{ method: 'hello' }, { method: 'add' }] }],
        ['demo1', { service: ctx.get('demo1'), markers: [{ method: 'double' }, { method: 'label' }] }],
        ['demo2', { service: ctx.get('demo2'), markers: [{ method: 'report' }] }],
      ]) }),
    ],
    healthz: () => ({ faces: 3 }),
  })],

  onReady: ({ port }) => { console.log(`[demo] 浏览器打开 http://127.0.0.1:${port}/ 试：登录 demo/123456 → 调 demo.hello`) },
})
