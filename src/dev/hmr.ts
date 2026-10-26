/**
 * vite 内嵌件（dev HMR 同进程同端口形态）——2026-10-26 用户裁定：①vite 必须与
 * 载体同一个进程、同一个端口，不设独立 vite 端口（根除「端口被孤儿进程占用」
 * 一类故障）；②dev 形态 vite 失场必须 fail loud 报错拒启，禁止静默回落 dist
 * 构建产物误导排障（回落档仅保留给显式 LING_WEB_HMR=0 与产物态，归调用方组合）。
 *
 * 机制：从使用方 cwd 的 node_modules 以库形态加载 vite（createRequire 解析入口
 * → 动态 import），`createServer({ server: { middlewareMode: true, hmr: { server } } })`
 * ——页面处理器（connect 形态 middlewares）由调用方挂进载体 HTTP 面；HMR
 * WebSocket 升级由 vite 自挂在传入的 httpServer 上、按 sec-websocket-protocol:
 * vite-hmr 认领自家连接，与载体其他 ws 升级面（站内信等）互不干扰。
 *
 * vite 是使用方的对等件（cwd/node_modules 自备），本件只加载不依赖、零子进程。
 * 配置合成（2026-10-26 用户令「坑知识进框架」）：base 缺省 '/app/'、react:true 时
 * 注入 @vitejs/plugin-react、依赖预热入口约定探测——简单使用方零 vite.config 直享
 * React Fast Refresh HMR（ling-harness-runner 演示页为消费范本）。
 * @module @ling2/ling-cordis/dev/hmr
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** vite 内嵌件构造项。 */
export interface ViteEmbedOptions {
  /** vite 项目目录（vite 与可选的 react 插件均在 cwd/node_modules 自备解析）。 */
  cwd: string
  /** 载体 http 服务实例——vite 的 HMR WebSocket 升级监听挂它上面（同端口）。 */
  httpServer: Server
  /** 站点 base（缺省 '/app/'——载体 /app 面约定）；热更 ws 认领路径按它判定。 */
  base?: string
  /** React Fast Refresh 自备档：true=从 cwd 加载 @vitejs/plugin-react 注入插件——
   *  简单使用方零 vite.config 直享 HMR（内联 base+插件+依赖预热全合成）；自带
   *  vite.config.ts 的复杂使用方（ling-web 别名族）勿设（文件配置自然合并，
   *  插件双开会重复注册）。插件与 vite 同款对等件契约：缺席/越界 fail loud。 */
  react?: boolean
  /** 依赖预热入口（vite optimizeDeps.entries）；缺省按约定探测
   *  <cwd>/src/client/index.tsx → .ts。不预热时浏览器首访才发现 react 族裸依赖
   *  →优化器冷启动竞态 → 首开卡「装载中」（实证）。 */
  entries?: string[]
  /** 日志出口（缺省静默——库不刷屏）。 */
  logger?: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** vite createServer 入参的最小类型面（真形=vite 官方 InlineConfig，此处只钉本件消费的字段）。 */
interface ViteCreateServerOptions {
  root: string
  base?: string
  plugins?: unknown[]
  optimizeDeps?: { entries: string[] }
  server: { middlewareMode: true; hmr: { server: Server } }
}

/** vite dev server 的最小类型面（middlewares+close+config.base 三消费点）。 */
interface ViteDevServerLike {
  middlewares: ViteEmbed['middlewares']
  close: () => Promise<void>
  /** vite 配置面（本件只消费 base——热更 ws 认领路径判定用）。 */
  config?: { base?: string }
}

/** 运行中的 vite 内嵌件。 */
export interface ViteEmbed {
  /** connect 形态页面处理器——next=未认领（调用方须显式报错，禁回落 dist）。 */
  middlewares: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void
  /** 热更 ws 升级认领判定：true=该升级请求属 vite HMR（协议头 vite-hmr/vite-ping 且
   * 路径=base），调用方 upgrade 兜底销毁前必须放行——vite 自挂的监听器会接管
   * （真机探针实证：不放行则热更握手被兜底 socket.destroy() 掐死）。 */
  claimsUpgrade(req: IncomingMessage): boolean
  /** 停机（vite server.close：关文件监听/模块图缓存/HMR 通道）。 */
  dispose(): Promise<void>
}

/** 路径包含判定：resolved 是否落在 base 目录之内（vitest/NODE_PATH 会把外部依赖
 * 注入全局解析路径——无此守卫会加载到「别人的 vite」，破坏 fail loud 契约）。 */
function isInside(base: string, resolved: string): boolean {
  const rel = relative(base, resolved)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 依赖预热入口探测约定（与 registry.ts 的 CLIENT_ENTRY_CONVENTIONS 同序——
 *  约定入口存在即预热，首开免优化器冷启动竞态）。 */
const ENTRY_CONVENTIONS = ['src/client/index.tsx', 'src/client/index.ts']

/** 从 cwd 自备对等件加载 @vitejs/plugin-react 工厂（缺席/越界 fail loud——同 vite 契约）。 */
async function loadReactPluginFactory(cwd: string): Promise<() => unknown> {
  const require = createRequire(join(cwd, 'package.json'))
  let entry: string
  try {
    const candidate = require.resolve('@vitejs/plugin-react')
    if (!isInside(cwd, candidate)) throw new Error(`foreign:${candidate}`)
    entry = candidate
  } catch (error) {
    const hint = error instanceof Error && error.message.startsWith('foreign:')
      ? `在 ${cwd} 之外解析到外部插件（${error.message.slice('foreign:'.length)}）——只认项目自备依赖`
      : `${cwd} 下解析不到 node_modules/@vitejs/plugin-react`
    throw new Error(
      `@vitejs/plugin-react 包缺席或越界（${hint}）——hmr.react=true 须项目自备该插件（与 vite 同款对等件契约）`,
    )
  }
  try {
    const mod = await import(pathToFileURL(entry).href) as { default?: unknown }
    const factory = mod.default ?? mod
    if (typeof factory !== 'function') throw new Error('no-factory')
    return factory as () => unknown
  } catch (error) {
    throw new Error(`@vitejs/plugin-react 加载失败（${entry}）：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 建内嵌件：vite 缺席/初始化失败即 reject（fail loud）——绝不静默降级。 */
export async function createViteEmbed(options: ViteEmbedOptions): Promise<ViteEmbed> {
  const log = options.logger ?? (() => {})
  const require = createRequire(join(options.cwd, 'package.json'))
  let viteEntry: string
  try {
    const candidate = require.resolve('vite')
    // 2026-10-26 用户裁定②：缺席（或解析到项目目录之外的外部 vite）=报错拒启，
    // 禁静默回落 dist——内嵌件只认 cwd 自备的对等件
    if (!isInside(options.cwd, candidate)) {
      throw new Error(`foreign:${candidate}`)
    }
    viteEntry = candidate
  } catch (error) {
    const hint = error instanceof Error && error.message.startsWith('foreign:')
      ? `在 ${options.cwd} 之外解析到外部 vite（${error.message.slice('foreign:'.length)}）——只认项目自备依赖`
      : `${options.cwd} 下解析不到 node_modules/vite`
    throw new Error(
      `vite 包缺席或越界（${hint}）——dev HMR 形态必须项目自备 vite 在场：` +
        `先在该目录 pnpm install，或显式设 LING_WEB_HMR=0 走产物静态档`,
    )
  }
  let vite: { createServer: (inline: ViteCreateServerOptions) => Promise<ViteDevServerLike> }
  try {
    vite = await import(pathToFileURL(viteEntry).href) as typeof vite
  } catch (error) {
    throw new Error(`vite 库加载失败（${viteEntry}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof vite.createServer !== 'function') {
    throw new Error(`vite 入口形态异常（${viteEntry} 无 createServer 导出）——疑似安装不完整，请重装依赖`)
  }
  // React Fast Refresh 自备档（react:true）：从 cwd 加载插件并注入——简单使用方
  // 零 vite.config 直享 HMR；复杂使用方不设（文件配置自然合并）
  const reactPluginFactory = options.react === true ? await loadReactPluginFactory(options.cwd) : undefined
  // 依赖预热入口：显式优先，缺省按约定探测（见 ENTRY_CONVENTIONS 注释）
  const entries = options.entries ?? ENTRY_CONVENTIONS.filter((entry) => existsSync(join(options.cwd, entry)))
  // middlewareMode=零监听零端口；hmr.server=热更 ws 挂载体自己的 http 服务（同进程同端口）
  const inline: ViteCreateServerOptions = {
    root: options.cwd,
    base: options.base ?? '/app/',
    ...(reactPluginFactory !== undefined ? { plugins: [reactPluginFactory()] } : {}),
    ...(entries.length > 0 ? { optimizeDeps: { entries } } : {}),
    server: { middlewareMode: true, hmr: { server: options.httpServer } },
  }
  let viteServer: ViteDevServerLike
  try {
    viteServer = await vite.createServer(inline)
  } catch (error) {
    throw new Error(`vite dev server 初始化失败（cwd=${options.cwd}）：${error instanceof Error ? error.message : String(error)}`)
  }
  // 热更 ws 认领路径=vite base（对齐 vite 源码 createWebSocketServer：协议头
  // vite-hmr/vite-ping 且 pathname===base 才接管；本件未配 hmr.path——配了需同款 join）
  const hmrBase = viteServer.config?.base ?? '/'
  log('info', 'vite 内嵌就绪（同进程同端口：页面中间件+HMR ws 均走载体口，无独立 vite 端口）')
  return {
    middlewares: viteServer.middlewares,
    claimsUpgrade: (req) => {
      const protocol = req.headers['sec-websocket-protocol']
      if (protocol !== 'vite-hmr' && protocol !== 'vite-ping') return false
      try {
        return new URL(req.url ?? '/', 'http://example.com').pathname === hmrBase
      } catch {
        return false
      }
    },
    dispose: () => viteServer.close(),
  }
}
