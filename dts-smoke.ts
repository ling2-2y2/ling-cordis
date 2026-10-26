/**
 * dts 冒烟消费者——以外部使用者视角验证打包产物类型面：
 * ①聚合入口符号可解析；②相对模块增强并入 Context（fiber 的 effect、events 的 on、
 * timer 的 setInterval/timeout）；③schemastery 全局命名空间在场；
 * ④/dev 子出口三件（注册表/vite 内嵌件/编译编排）类型可导。
 * 由 CI 在 build 之后独立编译（不在 tsconfig.json include 面内，防止源码态混入）。
 * 2026-10-26 翻旧账：createViteHmrBridge/ViteHmrBridge（子进程桥，已退役）换现役
 * createViteEmbed/ViteEmbed（同进程单端口内嵌件）；补 basePath 单源键类型面。
 */
import { Context, Fiber, schemastery as z } from './dist/index.js'
import { buildRegisteredModules, createRpcFace, createRpcServer, createViteEmbed, defineApp, faceInvoker, jsonResponder, loadEnv, ModuleRegistry, parameterNamesOf, readRequestBody, registryOf, rpcSendJson, runDevApp, type DevAppConfig, type DevAppEntry, type DevAppHandle, type DevHttpFace, type ModuleEntry, type RpcContext, type RpcFaceEntry, type RpcLayer, type RpcMiddleware, type RpcServerOptions, type ViteEmbed } from './dist/dev/index.js'

/** fiber/events 增强面：ctx.effect 与 ctx.on 应存在于 Context 接口。 */
function face(ctx: Context) {
  const dispose = ctx.effect(() => () => {})
  dispose()
  ctx.on('internal/status', (fiber: Fiber, oldValue: number) => {
    void fiber.state
    void oldValue
  })
}

/** timer 增强面：ctx.setInterval/timeout 应并入 Context。 */
function timer(ctx: Context) {
  const stop = ctx.setInterval(() => {}, 1000)
  stop()
  void ctx.timeout(10)
}

/** fiber 类型面 + schemastery 构建器与全局命名空间。 */
function schema(fiber: Fiber) {
  const config = z.object({ port: z.number().default(3000) })
  const state: number = fiber.state
  type From = Schemastery.From<{ port: number }>
  const probe: From | null = null
  return { config, state, probe }
}

/** /dev 工具族出口：注册表/HMR 桥/编译编排/载体内核/接线助手类型可导。 */
function devKit() {
  interface MountEnv { pgUrl: string }
  const registry = new ModuleRegistry<MountEnv>(['core', 'tail'])
  const entry: ModuleEntry<MountEnv> = {
    id: 'pkg-a', phase: 'core', note: '冒烟',
    client: { key: 'pkg-a/client.js' },
    mount: async (_ctx: Context, env: MountEnv) => { void env.pgUrl },
  }
  registry.add(entry)
  const table: Record<string, string> = registry.clientTable('/tree')
  // vite 内嵌件（现役形态）：工厂函数类型引用 + 运行件接口形状（middlewares/claimsUpgrade/dispose）
  void (createViteEmbed as (options: { cwd: string, httpServer: never }) => Promise<ViteEmbed>)
  const embed: ViteEmbed = {
    middlewares: () => {},
    claimsUpgrade: () => false,
    dispose: async () => {},
  }
  void embed.middlewares
  void embed.claimsUpgrade
  void embed.dispose
  buildRegisteredModules({ registry, rootDir: '/tree', targets: ['pkg-a'] })
  // 载体内核（v2）：声明式配置面型与直通助手
  const config: DevAppConfig = defineApp({
    rootDir: '/tree',
    basePath: '/app',   // 前缀单源键（2026-10-26 O3）类型面冒烟
    phases: ['base', 'core', 'engine', 'tail'],
    modules: [{ id: 'pkg-a', phase: 'core', spec: '@scope/pkg-a', use: 'default', config: { a: 1 } } satisfies DevAppEntry],
    http: (): DevHttpFace[] => [{ healthz: () => ({ faces: 1 }) }],
  })
  void registryOf(config)
  loadEnv('/tmp/.env')
  const handle: Promise<DevAppHandle> = runDevApp(config)
  void handle
  // RPC 网关空壳（v2.0.0）：层序类型面 + 机械件 + 业务层中间件 + 挂件生命周期
  const faces = () => new Map<string, RpcFaceEntry>([['pkg-a', { service: {} as object, markers: [{ method: 'run' }] }]])
  const audit: RpcMiddleware = async (c: RpcContext, next) => {
    const handled = await next()
    if (c.namespace === 'pkg-a') c.value = 1
    return handled
  }
  const layers: RpcLayer[] = [jsonResponder(), audit, faceInvoker({ faces })]
  const serverOptions: RpcServerOptions = { layers }
  const rpcHandle = createRpcServer(serverOptions)
  void rpcHandle
  const layeredFace = createRpcFace({
    layers: [...layers, { name: '冒烟层', mw: audit, onReady: () => {}, onDestroy: () => {} }],
    healthz: () => ({ faces: 1 }),
  })
  void layeredFace.ready
  void layeredFace.dispose
  void layeredFace.healthz
  const names: string[] = parameterNamesOf({ run: () => 0 } as object, 'run', 'pkg-a/run')
  void (readRequestBody as (req: never) => Promise<Buffer>)
  void (rpcSendJson as (res: never, status: number, body: unknown) => void)
  return { table, names }
}

export const _checks = { face, timer, schema, devKit }
