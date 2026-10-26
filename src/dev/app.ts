/**
 * 载体内核 runDevApp——把一份声明式配置（vite.config.ts 同款薄形态）跑成
 * dev 服务器：env 装配 → Context+LoggerConsole+Timer → setup 钩子 → 三相模块
 * 循环（spec 动态 import → ctx.plugin → after 钩子）→ HTTP 面（配置挂件先行，
 * 框架内建 healthz/boot-status/静态 SPA//packages 表/HMR 组合殿后）→ 端口卫兵
 * → onReady → 有界停机。
 *
 * env 纪律：本内核不读任何环境变量——开关/端口/路径全部由配置传值；配置文件
 * 求值序契约=薄壳先 loadEnv('.env') 再动态 import 配置（配置体求值时 env 已在场，
 * 规避工厂函数自举环）。业务面（认证/RPC/面收编）经 http 挂件注入，框架零业务。
 * @module @ling2/ling-cordis/dev/app
 */
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Context } from '../core/index.ts'
import LoggerConsole from '../plugins/logger-console/index.ts'
import Timer from '../plugins/timer.ts'
import { ModuleRegistry, type ModuleEntry } from './registry.ts'
import { createViteEmbed, type ViteEmbed } from './hmr.ts'

/** 404 未命中去重表（方法+路径 → 次数；首见告警，进程级）。 */
const missedRoutes = new Map<string, number>()

/** .env 装配：解析 key=value 行（parseEnv 语义）注入 process.env（不覆盖显式注入）。 */
export function loadEnv(file: string, defaults: Record<string, string> = {}): void {
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
      const match = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/u.exec(line)
      if (match === null || match[1]!.startsWith('#')) continue
      const value = match[2]!.replace(/^["']|["']$/gu, '')
      if (process.env[match[1]!] === undefined) process.env[match[1]!] = value
    }
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

/** 相位条目：spec+config 声明式挂载（动态 import 由内核代劳），复杂逻辑走 after。 */
export interface DevAppEntry extends Omit<ModuleEntry, 'mount'> {
  /** 动态 import 说明符（缺席=纯 after 条目——挂载钩子/补供等用途）。 */
  spec?: string
  /** import 形态：'default' 取 mod.default；缺省 'namespace' 传整个命名空间
   * （树内两形态并存：class 插件走 default，`export function apply` 族走命名空间）。 */
  use?: 'default' | 'namespace'
  /** ctx.plugin 第二参（spec 在场才有意义）。 */
  config?: unknown
  /** 挂载后钩子（补供/栅栏/行序修正等）。 */
  after?: (ctx: Context) => void | Promise<void>
}

/** HTTP 面处理器（认领=true 止链）。 */
export type DevHttpHandler = (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>

/** HTTP 面挂件对象形态（带升级/就绪/停机/健康位的网关走此形态）。 */
export interface DevHttpFaceObject {
  /** HTTP 处理器（认领=true 止链）。 */
  handle?: DevHttpHandler
  /** ws 升级处理器（认领=true 止链；先于 HMR 透传）。 */
  upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean
  /** 就绪回调（listen+自检之后、config.onReady 之前派发——钩子 onReady 通道）。 */
  ready?: () => void | Promise<void>
  /** 停机清理器（HMR/fiber 清理之前调用——钩子 onDestroy 通道）。 */
  dispose?: () => void | Promise<void>
  /** healthz 附加位（并进应答体）。 */
  healthz?: () => Record<string, unknown>
}

/** HTTP 面挂件：纯处理器或对象形态。 */
export type DevHttpFace = DevHttpHandler | DevHttpFaceObject

/** 载体配置（声明式；env 取值在配置体内算——薄壳先 loadEnv 再 import 本配置）。 */
export interface DevAppConfig {
  /** 树根绝对路径（/packages 表与 carrier 的基準；配置体内 import.meta.dirname 取）。 */
  rootDir: string
  /** 日志前缀，缺省 'dev'。 */
  label?: string
  /** 监听端口，缺省 3000。 */
  port?: number
  /** 监听地址，缺省 127.0.0.1（容器形态传 0.0.0.0）。 */
  host?: string
  /** env 缺省注入（loadEnv 薄壳已先行；此处为运行期消费者的兜底）。 */
  envDefaults?: Record<string, string>
  /** API 前缀剥离：`<p>/api/*` → `/api/*`（仅 API，静态路径不动——SPA 深链语义）。 */
  stripApiPrefixes?: string[]
  /** 整路径重定向（如 '/' → '/app/'）。 */
  redirects?: Record<string, string>
  /** vite 内嵌件（同进程同端口 HMR，2026-10-26 用户裁定：无独立 vite 端口；启用即必须就绪——缺席/初始化失败拒启）。未配置/显式关=走静态 dist 档。 */
  hmr?: { cwd: string; enabled?: boolean }
  /** 静态 SPA 面（urlPrefix 缺省 '/app'；extras=前缀下额外文件映射）。 */
  staticApp?: {
    urlPrefix?: string
    root: string
    extras?: Record<string, string>
    /** 资产扩展名白名单（命中才直出文件，否则 SPA index 兜底）。 */
    assetExt?: RegExp
  }
  /** /packages/ 静态表额外条目（模块 client 条目自动并入）。 */
  packagesExtras?: Record<string, string>
  /** 有序相名表（如 ['base', 'core', 'engine', 'tail']；相间无夹层——夹层内容条目化）。 */
  phases: readonly string[]
  /** 相位条目（登记序即挂载序）。 */
  modules: DevAppEntry[]
  /** 装配首站钩子（LoggerConsole/Timer 之后、相循环之前）；返回函数=停机清理器。 */
  setup?: (ctx: Context) => void | Promise<void> | (() => void)
  /** HTTP 面挂件工厂（相循环之后调用；返回纯处理器或对象形态的数组）。 */
  http?: (ctx: Context) => DevHttpFace[]
  /** 编译载体特名（build 薄壳消费）。 */
  carrier?: { id: string; cwd: string; script: string }
  /** 模块构建脚本名（build 薄壳消费），缺省 'build:client'。 */
  buildScript?: string
  /** 就绪钩子（listen+自检之后；种子跑批/自定义就绪日志）。 */
  onReady?: (app: { port: number; host: string; label: string }) => void | Promise<void>
}

/** 配置类型锚（vite defineConfig 同款直通助手）。 */
export function defineApp<T extends DevAppConfig>(config: T): T {
  return config
}

/** 运行句柄：编程式停机（信号接管之外，嵌入方/测试的 dispose 通道）。 */
export interface DevAppHandle {
  dispose(): Promise<void>
}

/** 配置→注册表（/packages 表与 build 薄壳同源消费）。 */
export function registryOf(config: Pick<DevAppConfig, 'phases' | 'modules'>): ModuleRegistry {
  const registry = new ModuleRegistry(config.phases)
  for (const entry of config.modules) registry.add(entry as ModuleEntry)
  return registry
}

const DEFAULT_ASSET_EXT = /^[\w.-]+\.(js|mjs|css|map|png|jpg|jpeg|svg|woff2?|ttf|ico|json|wasm)$/u

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function serveStaticFile(file: string, res: ServerResponse, notFound: () => void): void {
  let body: Buffer
  try {
    body = readFileSync(file)
  } catch {
    notFound()
    return
  }
  const ext = extname(file)
  const contentType = ext === '.js' || ext === '.mjs' ? 'text/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css'
    : ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.json' || ext === '.map' ? 'application/json; charset=utf-8'
    : ext === '.svg' ? 'image/svg+xml'
    : ext === '.png' ? 'image/png'
    : ext === '.woff2' ? 'font/woff2'
    : 'application/octet-stream'
  res.writeHead(200, { 'content-type': contentType })
  res.end(body)
}

/** 有界停机：dispose 挂起 5s 强杀兜底；停机中再按立即强杀。 */
function createBoundedShutdown(label: string, dispose: () => void | Promise<void>): (code: number) => void {
  let shuttingDown = false
  return function interrupt(code) {
    if (shuttingDown) { console.error(`[${label}] 停机中再按——立即强杀`); process.exit(137) }
    shuttingDown = true
    console.log(`[${label}] 停机中（${code}）——dispose 挂起 5s 强杀兜底`)
    const killer = setTimeout(() => { console.error(`[${label}] dispose 超时——强杀`); process.exit(code) }, 5000)
    killer.unref?.()
    void Promise.resolve(dispose()).then(() => { clearTimeout(killer); process.exit(code) }, () => { clearTimeout(killer); process.exit(code) })
  }
}

/** 跑载体：配置 → dev 服务器（常驻；进程信号接管停机；返回编程式 dispose 句柄）。 */
export async function runDevApp(config: DevAppConfig): Promise<DevAppHandle> {
  const label = config.label ?? 'dev'
  const port = config.port ?? 3000
  const host = config.host ?? '127.0.0.1'
  const bootStartedAt = Date.now()
  loadEnv('', config.envDefaults ?? {})

  const ctx = new Context()
  await ctx.plugin(LoggerConsole)
  await ctx.plugin(Timer)
  const setupDisposer = await config.setup?.(ctx)

  // 三相挂载循环（spec→plugin→after；数组登记序即挂载序）
  const registry = registryOf(config)
  for (const phase of config.phases) {
    for (const entry of registry.ofPhase(phase) as DevAppEntry[]) {
      if (entry.spec !== undefined) {
        const mod = await import(entry.spec)
        const plugin = entry.use === 'default' ? mod.default : mod
        // config 省略即传 undefined（ctx.plugin(P) ≠ ctx.plugin(P, {})——`config ?? 缺省档`
        // 形态的插件族会走岔；签名必填故显式 undefined 保真语义）
        await ctx.plugin(plugin as never, (entry.config === undefined ? undefined : entry.config) as never)
      }
      await entry.after?.(ctx)
      console.log(`[${label}] 模块挂载 ${phase}: ${entry.id}${entry.note === undefined ? '' : `（${entry.note}）`}`)
    }
  }

  // HTTP 面挂件收集（纯处理器或对象形态五槽分拣）
  const faces = config.http === undefined ? [] : await config.http(ctx)
  const handlers: DevHttpHandler[] = []
  const upgraders: NonNullable<DevHttpFaceObject['upgrade']>[] = []
  const readyBits: NonNullable<DevHttpFaceObject['ready']>[] = []
  const faceDisposers: NonNullable<DevHttpFaceObject['dispose']>[] = []
  const healthzBits: (() => Record<string, unknown>)[] = []
  for (const face of faces) {
    if (typeof face === 'function') { handlers.push(face); continue }
    if (face.handle !== undefined) handlers.push(face.handle)
    if (face.upgrade !== undefined) upgraders.push(face.upgrade)
    if (face.ready !== undefined) readyBits.push(face.ready)
    if (face.dispose !== undefined) faceDisposers.push(face.dispose)
    if (face.healthz !== undefined) healthzBits.push(face.healthz)
  }

  const staticConf = config.staticApp
  const urlPrefix = staticConf?.urlPrefix ?? '/app'
  const packagesTable: Record<string, string> = { ...registry.clientTable(config.rootDir), ...config.packagesExtras }

  // vite 内嵌件占位（同进程同端口；创建时序=端口卫兵之后、listen 之前——见下）
  let viteEmbed: ViteEmbed | undefined

  async function handleInner(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // API 前缀剥离（仅 API 生效；静态路径原样——SPA 深链）
    if (req.url !== undefined) {
      for (const prefix of config.stripApiPrefixes ?? []) {
        if (req.url.startsWith(`${prefix}/api/`)) { req.url = req.url.slice(prefix.length); break }
      }
    }
    for (const handler of handlers) {
      if (await handler(req, res)) return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname
    // 路由未命中观测（2026-10-16 上传 404 静默事故立法）：404 曾零日志——前端只
    // 见兜底文案、后端控制台无线索，排障无从下手。同 miss 只告警首见（防资产类
    // 重复刷屏），重复计数进 missedRoutes。
    const notFound = () => {
      const key = `${req.method} ${pathname}`
      const hits = (missedRoutes.get(key) ?? 0) + 1
      missedRoutes.set(key, hits)
      if (hits === 1) console.warn(`[${label}] 路由未命中(404)：${key}`)
      return sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: `not found: ${key}` } })
    }

    const redirect = config.redirects?.[pathname]
    if (req.method === 'GET' && redirect !== undefined) {
      res.writeHead(302, { location: redirect })
      res.end()
      return
    }
    if (req.method === 'GET' && pathname === '/healthz') {
      const extra: Record<string, unknown> = {}
      for (const bit of healthzBits) Object.assign(extra, bit())
      if (viteEmbed !== undefined) extra.hmr = 'vite-embedded'
      return sendJson(res, 200, { ok: true, runtime: label, ...extra })
    }
    if (req.method === 'GET' && pathname === '/boot-status') {
      return sendJson(res, 200, { phase: 'ready', elapsedMs: Math.max(0, Date.now() - bootStartedAt) })
    }

    // /app 面：vite 内嵌态=全权交 vite（未认领=显式 500，禁回落 dist——2026-10-26
    // 用户裁定②「我需要知道有错误而不是回落 dist」）；无内嵌件（hmr 未配置/显式
    // 关）才走 dist 静态+SPA 兜底
    if (req.method === 'GET' && (pathname === urlPrefix || pathname.startsWith(`${urlPrefix}/`))) {
      if (viteEmbed !== undefined) {
        viteEmbed.middlewares(req, res, () => sendJson(res, 500, {
          ok: false,
          error: { code: 'gateway/hmr-unclaimed', message: `vite 未认领 ${req.method} ${pathname}（dev HMR 形态无 dist 回落——排障见控制台日志）` },
        }))
        return
      }
      if (pathname === urlPrefix || pathname === `${urlPrefix}/`) {
        if (staticConf !== undefined) return serveStaticFile(join(staticConf.root, 'index.html'), res, notFound)
        return notFound()
      }
      if (staticConf !== undefined) {
        const rel = pathname.slice(`${urlPrefix}/`.length)
        const extra = staticConf.extras?.[rel]
        if (extra !== undefined) return serveStaticFile(extra, res, notFound)
        const file = join(staticConf.root, rel)
        if (!file.startsWith(staticConf.root)) return sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: '路径越界' } })
        const assetExt = staticConf.assetExt ?? DEFAULT_ASSET_EXT
        if (assetExt.test(rel.split('/').pop() ?? '')) return serveStaticFile(file, res, notFound)
        return serveStaticFile(join(staticConf.root, 'index.html'), res, notFound)
      }
      return notFound()
    }
    if (req.method === 'GET' && pathname.startsWith('/packages/')) {
      const file = packagesTable[decodeURIComponent(pathname.slice('/packages/'.length))]
      if (file === undefined) return sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: `包面文件未登记: ${pathname}` } })
      return serveStaticFile(file, res, notFound)
    }
    return notFound()
  }

  const server = createServer((req, res) => {
    void handleInner(req, res).catch((error) => {
      // 500 曾零日志（404 静默同族——2026-10-16 上传排障立法）：内部错必须上控制台
      console.error(`[${label}] 内部错误(500)：${req.method} ${req.url}`, error)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error) } })
      else res.end()
    })
  })
  server.on('upgrade', (req, socket, head) => {
    for (const upgrader of upgraders) {
      if (upgrader(req, socket, head)) return
    }
    // vite HMR 的升级请求由 vite 自挂在 server 上的监听器按（协议头+base 路径）
    // 认领接管——本链不处置、放行给 vite（真机探针实证：此处若照常 destroy 会把
    // 热更 ws 握手掐死，HMR 断连）
    if (viteEmbed?.claimsUpgrade(req) === true) return
    socket.destroy()
  })

  // 端口卫兵：healthz 已有应答=旧实例在跑，fail loud
  if (await fetch(`http://${host}:${port}/healthz`).then(() => true, () => false)) {
    throw new Error(`[${label}] 端口 ${port} 已有 healthz 应答（旧实例在跑）——先停旧实例再起`)
  }
  // vite 内嵌件（2026-10-26 用户裁定①②）：启用即必须就绪——缺席/初始化失败
  // =createViteEmbed reject→载体拒启（fail loud，禁静默回落 dist）；时序=端口
  // 卫兵之后（省掉白启 vite）、listen 之前（healthz 自检时内嵌位已可观测）
  if (config.hmr !== undefined && config.hmr.enabled !== false) {
    viteEmbed = await createViteEmbed({
      cwd: config.hmr.cwd,
      httpServer: server,
      logger: (level, message) => console[level](`[${label}] ${message}`),
    })
    console.log(`[${label}] vite HMR 内嵌就绪（同进程同端口 /app，无独立 vite 端口）`)
  }
  await new Promise<void>((resolveListen) => { server.listen(port, host, () => resolveListen()) })
  const health = await fetch(`http://${host}:${port}/healthz`).then(
    (r) => r.json(),
    (error) => { throw new Error(`[${label}] 自检探活失败（:${port}）: ${String(error)}`) },
  )
  if ((health as { ok?: boolean })?.ok !== true) throw new Error(`[${label}] healthz 应答异常: ${JSON.stringify(health)}`)
  console.log(`[${label}] ready http://${host}:${port}/`)
  // 挂件就绪派发（钩子 onReady 通道）先于配置 onReady（种子跑批等收尾件）
  for (const ready of readyBits) await ready()
  await config.onReady?.({ port, host, label })
  console.log(`[${label}] 进程常驻（Ctrl+C 收敛——有界停机）`)

  async function disposeAll(): Promise<void> {
    for (const disposer of faceDisposers) await disposer()
    if (setupDisposer !== undefined && typeof setupDisposer === 'function') setupDisposer()
    await viteEmbed?.dispose()
    await new Promise<void>((resolveClose) => { server.close(() => resolveClose()) })
    await ctx.fiber.dispose()
  }
  const shutdown = createBoundedShutdown(label, disposeAll)
  const signals: [NodeJS.Signals, (code: number) => void][] = [
    ['SIGINT', () => shutdown(130)],
    ['SIGTERM', () => shutdown(0)],
    ['SIGBREAK', () => shutdown(130)],
  ]
  for (const [signal, handler] of signals) process.on(signal, handler)
  return {
    async dispose() {
      for (const [signal, handler] of signals) process.off(signal, handler)
      await disposeAll()
    },
  }
}
