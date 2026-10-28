/**
 * 载体内核 runDevApp——把一份声明式配置（vite.config.ts 同款薄形态）跑成
 * dev 服务器：env 装配 → Context+LoggerConsole+Timer → setup 钩子 → 三相模块
 * 循环（spec 动态 import → ctx.plugin → after 钩子）→ HTTP 面（配置挂件先行，
 * 框架内建路由殿后——2026-10-26 架构评审 O1 起内建路由自消费 ../webserver
 * WebServerRouter：exact→最长 prefix→404 fallback，机制与路由器包单源）→ 端口
 * 卫兵 → onReady → 有界停机。
 *
 * env 纪律：本内核不读任何环境变量——开关/端口/路径全部由配置传值；配置文件
 * 求值序契约=薄壳先 loadEnv('.env') 再动态 import 配置（配置体求值时 env 已在场，
 * 规避工厂函数自举环）。业务面（认证/RPC/面收编）经 http 挂件注入，框架零业务。
 * @module @ling2/ling-coris/dev/app
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Context } from '../core/index.ts'
import LoggerConsole from '../plugins/logger-console/index.ts'
import Timer from '../plugins/timer.ts'
import { ModuleRegistry, type ModuleEntry } from './registry.ts'
import { createViteEmbed, type ViteEmbed } from './hmr.ts'
import { WebServerRouter, type WebServerHandler } from '../webserver/index.ts'


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

/** 产物档配置（批① 2026-10-28：服务端产物规范化）。在场=产物形态——相位条目的
 *  spec 先经映射换算为产物树 file URL 再动态 import（裸 node 直载产物 .js，零
 *  tsx、零源码消费——「源码泄露不可接受」2026-10-27 用户裁定升格框架规范）。
 *  映射约定归消费方（specToPath；缺省=原样+尾换 .ts→.js）；产物树由
 *  buildProductTree 产（见 product-build.ts）。HMR/浏览器面与产物档互斥归
 *  消费方配置（产物档 hmr.enabled=false、staticApp 指产物位）。 */
export interface ProductBaseConfig {
  /** 产物树基址（file URL，尾含 /）。 */
  base: string
  /** 说明符→产物相对路径（缺省=原样并尾换 .ts→.js）。 */
  specToPath?: (spec: string) => string
}

/** 载体配置（声明式；env 取值在配置体内算——薄壳先 loadEnv 再 import 本配置）。 */
export interface DevAppConfig {
  /** 树根绝对路径（/packages 表与 carrier 的基準；配置体内 import.meta.dirname 取）。 */
  rootDir: string
  /** 站点前缀单源（2026-10-26 架构评审 O3 裁定落地）：staticApp.urlPrefix 与
   *  hmr.base 未显式设置时由此派生（urlPrefix=去尾杠形态、vite base=补尾杠形态），
   *  尾斜杠容错归一（'/foo/' 与 '/foo' 同值）；缺省 '/app'。显式设置保留——
   *  越具体越优先。防「前缀写两处、改一漏一=资产 404 静默错位」。 */
  basePath?: string
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
  /** vite 内嵌件（同进程同端口 HMR，2026-10-26 用户裁定：无独立 vite 端口；启用即必须就绪——缺席/初始化失败拒启）。未配置/显式关=走静态 dist 档。
   * base/react/entries 透传内嵌件（react:true=从 cwd 自备 @vitejs/plugin-react 注入——简单使用方零 vite.config；缺省依赖预热探测同 hmr.ts）。 */
  hmr?: { cwd: string; enabled?: boolean; base?: string; react?: boolean; entries?: string[] }
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
  /** 产物档（在场=spec 经映射指产物树 file URL——源码态缺省行为不变）。 */
  productBase?: ProductBaseConfig
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

/** 前缀归一（O3 尾斜杠容错）：剥尾部斜杠；全斜杠输入归一为根 '/'。 */
function normalizeBasePath(path: string): string {
  const stripped = path.replace(/\/+$/u, '')
  return stripped === '' ? '/' : stripped
}

/**
 * 框架装载器（宿主页引导件，2026-10-26 用户令「坑知识进框架」）——装载面本体：
 * `window.__ModuleLoader__.load({id, factory})` 缺省实现（宿主已有自持装载器
 * （如 ling-web client-kernel）则不覆盖）+ `lingLoadSubapps(keys)` 运行时动态导入
 * 正路。标准项目形态宿主页只引一行 `<script src="/__ling/main.js">`（本件+
 * 按 ling.config.mjs 模块清单 client 键序自动装载——消费者零壳文件，见路由段
 * LING_MAIN_JS）；零构建/自持装载宿主用两行式：`<script src="/__ling/boot.js">`
 * + 内联 `<script>lingLoadSubapps(['键'])</script>`。
 * 固化的坑知识（ling-harness-runner 最小集合真机实证）：
 * ①宿主页引子应用勿用 `<script src="/packages/…">` 或静态 `import`——dev 态 vite html
 *   转换会给根相对 URL 前缀 base（/app/packages/*→404），内联 module 会被抽成
 *   html-proxy 而中间件态不被 vite 认领（500）——正路=运行时动态 import（本件内置）。
 * ②React Fast Refresh 前导由 @vitejs/plugin-react 的 transformIndexHtml 无条件注入
 *   html 转换管线（与 html 是否有 module 入口无关）——宿主页纯经典 script 引
 *   main.js 不影响热更链（实证于插件源码 transformIndexHtml 分支）。
 */
const LING_BOOT_JS = [
  ';(() => {',
  "  if (typeof window === 'undefined') return",
  '  function showError(error) {',
  "    console.error('[ling-coris] 子应用装载失败', error)",
  "    const box = document.getElementById('root')",
  '    if (box) {',
  '      const pre = document.createElement(\'pre\')',
  "      pre.style.cssText = 'color:#b91c1c;white-space:pre-wrap;margin:24px;font:13px/1.6 monospace'",
  "      pre.textContent = '子应用装载失败：' + String((error && (error.stack || error.message)) || error)",
  '      box.replaceChildren(pre)',
  '    }',
  '  }',
  '  if (window.__ModuleLoader__ === undefined) {',
  '    window.__ModuleLoader__ = {',
  '      load(entry) {',
  '        try {',
  '          const exports = entry.factory()',
  '          void Promise.resolve(exports.apply(window.__lingHostCtx ?? {})).catch(showError)',
  '        } catch (error) { showError(error) }',
  '      },',
  '    }',
  '  }',
  "  const rawImport = new Function('url', 'return import(url)')",
  "  window.lingLoadSubapps = (keys) => Promise.all(keys.map((key) => rawImport('/packages/' + key).catch(showError)))",
  '})()',
  '',
].join('\n')

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 静态资产 content-type 判定（扩展名白名单）。 */
function contentTypeOf(file: string): string {
  const ext = extname(file)
  return ext === '.js' || ext === '.mjs' ? 'text/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css'
    : ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.json' || ext === '.map' ? 'application/json; charset=utf-8'
    : ext === '.svg' ? 'image/svg+xml'
    : ext === '.png' ? 'image/png'
    : ext === '.woff2' ? 'font/woff2'
    : 'application/octet-stream'
}

/**
 * 静态资产下发（O7 流式化）：createReadStream 管道——readFileSync 整读会同步阻塞
 * 事件循环，10MB 级资产（Univer 先例）每个未命中缓存的请求都卡住全进程所有请求。
 * 缺席/不可读=error 事件走 notFound 回落；已落笔后的读错误只收尾（流错误吸收，
 * 不升级进程级异常——与 rpc.ts 停摆尾同款纪律）。
 */
function serveStaticFile(file: string, res: ServerResponse, notFound: () => void): void {
  const stream = createReadStream(file)
  stream.on('error', () => {
    if (!res.headersSent) { notFound(); return }
    res.end()
  })
  stream.on('open', () => {
    res.writeHead(200, { 'content-type': contentTypeOf(file) })
    stream.pipe(res)
  })
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
  // spec 解析单点：产物档=经 specToPath 映射为产物树 file URL（零 tsx 零源码）；
  // 源码态=原样（tsx paths/裸名解析归运行时）。
  const resolveSpec = (spec: string): string => {
    if (config.productBase === undefined) return spec
    const { base, specToPath } = config.productBase
    const productPath = specToPath !== undefined ? specToPath(spec) : spec.replace(/\.ts$/, '.js')
    return `${base}${productPath}`
  }
  for (const phase of config.phases) {
    for (const entry of registry.ofPhase(phase) as DevAppEntry[]) {
      if (entry.spec !== undefined) {
        const mod = await import(resolveSpec(entry.spec))
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
  // 站点前缀单源（O3）：urlPrefix 与 vite base 未显式设置时都由 basePath 派生
  const basePath = normalizeBasePath(config.basePath ?? '/app')
  const urlPrefix = staticConf?.urlPrefix ?? basePath
  const packagesTable: Record<string, string> = { ...registry.clientTable(config.rootDir), ...config.packagesExtras }
  // 客户端源码面表（dev 态 /packages 源码直供——2026-10-26 用户裁定①②「子应用真
  // HMR、机制落 ling-coris 框架」：注册表 client 键与 extras 键按约定自动发现
  // 源码入口，宿主零接线白拿；见下方 /packages 分派与 shim）
  const clientSourceTable = registry.clientSourceTable(config.rootDir, config.packagesExtras)

  // 子应用自动装载件（2026-10-26 用户令「src/shell.ts 是架构坏味道，其配置/动作统一
  // 收归 ling.config.mjs」）：/__ling/main.js = 装载器本体 + 按注册表 client 键
  // 登记序自动 lingLoadSubapps——宿主页一行经典 script 即得，消费者壳文件退役零携带。
  // 键序唯一来源=ling.config.mjs 模块清单的 client.key（shell.ts 重复声明键列即坏
  // 味道根因，由此消灭）；packagesExtras 是共享件/纯资产（无挂载面），不参与自动装载。
  const subappKeys = registry.all().filter((entry) => entry.client !== undefined).map((entry) => entry.client!.key)
  const LING_MAIN_JS = subappKeys.length > 0
    ? `${LING_BOOT_JS}window.lingLoadSubapps(${JSON.stringify(subappKeys)})\n`
    : LING_BOOT_JS

  /** 宿主装载器全局名（框架契约——宿主内核须实现 window.__ModuleLoader__.load(
   * {id, factory}) 注册面与 exports.{inject,apply} 激活语义；ling-web client-kernel
   * 现役即此形态，dev 态 ESM 命名空间与产物 CJS exports 同形直入）。 */
  const CLIENT_LOADER_GLOBAL = 'window.__ModuleLoader__'

  // vite 内嵌件占位（同进程同端口；创建时序=端口卫兵之后、listen 之前——见下）
  let viteEmbed: ViteEmbed | undefined

  // ── 内建路由自消费 WebServerRouter（2026-10-26 架构评审 O1：同仓两套路由机制
  // 合一——dev 内核不再手写 if 链，webserver 路由器自此被真实消费/回归。行为语义
  // 与迁移前 if 链逐条对拍（存量 spec+两示例 --check 为门）：exact（redirects/
  // healthz/boot-status/__ling 双路由）→ 最长 prefix（/packages、urlPrefix 的 /app
  // 面）→ fallback 唯一座（404 首见去重观测）。非 GET 的内建路由等价回落 404。───
  const router = new WebServerRouter()
  // 404 去重表=实例级（O9：模块级形态会让单进程多实例（测试场景）跨实例污染告警语义）
  const missedRoutes = new Map<string, number>()

  /** 404 未命中应答+观测（2026-10-16 上传 404 静默事故立法）：同 miss 只告警首见
   * （防资产类重复刷屏），重复计数进 missedRoutes（实例级——O9）。 */
  const notFound = (req: IncomingMessage, res: ServerResponse): void => {
    const key = `${req.method} ${new URL(req.url ?? '/', 'http://localhost').pathname}`
    const hits = (missedRoutes.get(key) ?? 0) + 1
    missedRoutes.set(key, hits)
    if (hits === 1) console.warn(`[${label}] 路由未命中(404)：${key}`)
    sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: `not found: ${key}` } })
  }

  /** GET 化包装：内建路由全为 GET 语义（迁移前 if 链同款）——非 GET 等价回落 404。 */
  const getOnly = (handler: WebServerHandler): WebServerHandler => (req, res) => {
    if (req.method !== 'GET') return notFound(req, res)
    handler(req, res)
  }

  /** /packages 面单点（源码面→产物通道；正路与 /app/packages/* 别名共用）。 */
  const servePackagesFace = (req: IncomingMessage, res: ServerResponse, key: string): void => {
    // 客户端源码面（2026-10-26 用户裁定①②）：dev 态（vite 内嵌在场）且该键有
    // 源码入口 → 改发 ESM 转接 shim——浏览器经 vite /app/@fs/ 直拉包源码入口
    // （TSX 转译+Fast Refresh+单 React=vite 图天然保证），宿主装载器吃到的
    // ESM 命名空间与产物 CJS exports 同形（inject/apply）。产物态/无源码面键
    // （含纯资产 extras）=原样产物文件通道。
    const source = viteEmbed !== undefined ? clientSourceTable[key] : undefined
    if (source !== undefined) {
      const fsUrl = `/app/@fs/${source.entry.replaceAll('\\', '/')}`
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(
        `import * as mod from ${JSON.stringify(fsUrl)}\n` +
        `${CLIENT_LOADER_GLOBAL}.load({ id: ${JSON.stringify(source.id)}, factory: () => mod })\n`,
      )
      return
    }
    const file = packagesTable[key]
    if (file === undefined) return sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: `包面文件未登记: /packages/${key}` } })
    return serveStaticFile(file, res, () => notFound(req, res))
  }

  /** /packages 前缀处理器：剥前缀取键（URL 解码）交面单点。 */
  const packagesFace: WebServerHandler = (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    servePackagesFace(req, res, decodeURIComponent(pathname.slice('/packages/'.length)))
  }

  /** /app 面处理器：vite 内嵌态=全权交 vite（未认领=显式 500，禁回落 dist——
   * 2026-10-26 用户裁定②「我需要知道有错误而不是回落 dist」）；无内嵌件（hmr
   * 未配置/显式关）才走 dist 静态+SPA 兜底。含 /app/packages/* 别名（dev 态坑
   * 吸收：宿主页根相对 script 被 vite html 转换前缀 base 后的形态——别名回
   * /packages 面，正路仍推荐 /__ling/boot.js 运行时装载）。 */
  const appFace: WebServerHandler = (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (viteEmbed !== undefined && pathname.startsWith(`${urlPrefix}/packages/`)) {
      servePackagesFace(req, res, decodeURIComponent(pathname.slice(`${urlPrefix}/packages/`.length)))
      return
    }
    if (viteEmbed !== undefined) {
      viteEmbed.middlewares(req, res, () => sendJson(res, 500, {
        ok: false,
        error: { code: 'gateway/hmr-unclaimed', message: `vite 未认领 ${req.method} ${pathname}（dev HMR 形态无 dist 回落——排障见控制台日志）` },
      }))
      return
    }
    if (pathname === urlPrefix || pathname === `${urlPrefix}/`) {
      if (staticConf !== undefined) return serveStaticFile(join(staticConf.root, 'index.html'), res, () => notFound(req, res))
      return notFound(req, res)
    }
    if (staticConf !== undefined) {
      const rel = pathname.slice(`${urlPrefix}/`.length)
      const extra = staticConf.extras?.[rel]
      if (extra !== undefined) return serveStaticFile(extra, res, () => notFound(req, res))
      const file = join(staticConf.root, rel)
      if (!file.startsWith(staticConf.root)) return sendJson(res, 404, { ok: false, error: { code: 'gateway/bad-request', message: '路径越界' } })
      const assetExt = staticConf.assetExt ?? DEFAULT_ASSET_EXT
      if (assetExt.test(rel.split('/').pop() ?? '')) return serveStaticFile(file, res, () => notFound(req, res))
      return serveStaticFile(join(staticConf.root, 'index.html'), res, () => notFound(req, res))
    }
    return notFound(req, res)
  }

  for (const [path, location] of Object.entries(config.redirects ?? {})) {
    router.register({ kind: 'exact', path, handler: getOnly((_req, res) => {
      res.writeHead(302, { location })
      res.end()
    }) })
  }
  router.register({ kind: 'exact', path: '/healthz', handler: getOnly((_req, res) => {
    const extra: Record<string, unknown> = {}
    for (const bit of healthzBits) Object.assign(extra, bit())
    if (viteEmbed !== undefined) extra.hmr = 'vite-embedded'
    sendJson(res, 200, { ok: true, runtime: label, ...extra })
  }) })
  router.register({ kind: 'exact', path: '/boot-status', handler: getOnly((_req, res) => {
    sendJson(res, 200, { phase: 'ready', elapsedMs: Math.max(0, Date.now() - bootStartedAt) })
  }) })
  // 框架装载器/自动装载双路由（根形态恒在+base 前缀形态；Set 防重注册——
  // register 重复 (kind,path) 抛错）
  for (const path of new Set(['/__ling/boot.js', `${urlPrefix}/__ling/boot.js`])) {
    router.register({ kind: 'exact', path, handler: getOnly((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(LING_BOOT_JS)
    }) })
  }
  for (const path of new Set(['/__ling/main.js', `${urlPrefix}/__ling/main.js`])) {
    router.register({ kind: 'exact', path, handler: getOnly((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(LING_MAIN_JS)
    }) })
  }
  router.register({ kind: 'prefix', path: '/packages', handler: getOnly(packagesFace) })
  router.register({ kind: 'prefix', path: urlPrefix, handler: getOnly(appFace) })
  router.registerFallback(notFound)

  async function handleInner(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // API 前缀剥离（仅 API 生效；静态路径原样——SPA 深链）
    if (req.url !== undefined) {
      for (const prefix of config.stripApiPrefixes ?? []) {
        if (req.url.startsWith(`${prefix}/api/`)) { req.url = req.url.slice(prefix.length); break }
      }
    }
    // 挂件先行（消费方 http faces 优先于内建路由——迁移前语义钉死）
    for (const handler of handlers) {
      if (await handler(req, res)) return
    }
    // 内建路由：exact→最长 prefix→fallback（404 首见去重观测）
    await router.dispatch(req, res)
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
    // upgrade 链不迁 WebServerRouter（O1 边界）：路由器 registerUpgrade 是
    // exact-path 形态，而消费方挂件是谓词式、vite 认领是协议头+base 路径判定——
    // 形态不匹配，强行迁会削语义；HTTP 面单源化收益已兑现，upgrade 保持链式
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
      // O3 单源：hmr.base 缺省由 basePath 派生（补尾杠= vite base 形态）；显式设置优先
      base: config.hmr.base ?? `${basePath}/`,
      react: config.hmr.react,
      entries: config.hmr.entries,
      // 跨包源码面放行（2026-10-27 ling-web 真机 403 根因）：/packages 源码直供的
      // 入口全在 rootDir 树内、常在 vite cwd（如 ling-web）之外——vite 缺省
      // fs.allow 只盖 cwd，不显式放行=子应用源码 /app/@fs/ 全线 403
      fsAllow: [config.rootDir],
      logger: (level, message) => console[level](`[${label}] ${message}`),
    })
    console.log(`[${label}] vite HMR 内嵌就绪（同进程单端口 /app，无独立 vite 端口）`)
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
