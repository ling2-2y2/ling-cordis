/**
 * dts 冒烟消费者——以外部使用者视角验证打包产物类型面：
 * ①聚合入口符号可解析；②相对模块增强并入 Context（fiber 的 effect、events 的 on、
 * timer 的 setInterval/timeout）；③schemastery 全局命名空间在场；
 * ④/dev 子出口三件（注册表/HMR 桥/编译编排）类型可导。
 * 由 CI 在 build 之后独立编译（不在 tsconfig.json include 面内，防止源码态混入）。
 */
import { Context, Fiber, schemastery as z } from './dist/index.js'
import { buildRegisteredModules, createJsonRpcGateway, createRpcFace, createViteHmrBridge, defineApp, loadEnv, ModuleRegistry, parameterNamesOf, registryOf, runDevApp, type DevAppConfig, type DevAppEntry, type DevAppHandle, type DevHttpFace, type JsonRpcGatewayOptions, type ModuleEntry, type RpcContext, type RpcFaceEntry, type RpcHook, type ViteHmrBridge } from './dist/dev/index.js'

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
  const bridge: ViteHmrBridge = createViteHmrBridge({ cwd: '/app', port: 5174 })
  void bridge.port
  void bridge.ready
  void bridge.proxyHttp
  void bridge.proxyUpgrade
  buildRegisteredModules({ registry, rootDir: '/tree', targets: ['pkg-a'] })
  // 载体内核（v2）：声明式配置面型与直通助手
  const config: DevAppConfig = defineApp({
    rootDir: '/tree',
    phases: ['base', 'core', 'engine', 'tail'],
    modules: [{ id: 'pkg-a', phase: 'core', spec: '@scope/pkg-a', use: 'default', config: { a: 1 } } satisfies DevAppEntry],
    http: (): DevHttpFace[] => [{ healthz: () => ({ faces: 1 }) }],
  })
  void registryOf(config)
  loadEnv('/tmp/.env')
  const handle: Promise<DevAppHandle> = runDevApp(config)
  void handle
  // RPC 网关内核（v3）：面表/认证 λ/参数名解析类型可导
  const rpcOptions: JsonRpcGatewayOptions = {
    faces: () => new Map<string, RpcFaceEntry>([['pkg-a', { service: {} as object, markers: [{ method: 'run' }] }]]),
    auth: { login: async (account: string) => ({ token: account, account }), resolve: async (token: string) => ({ account: token }), cookie: 'token' },
  }
  const rpc = createJsonRpcGateway(rpcOptions)
  void rpc
  // 生命周期钩子（v4）：RpcHook/RpcContext 类型面 + createRpcFace 对象挂件
  const accessLog: RpcHook = {
    name: '冒烟钩子',
    beforeRequest: (c: RpcContext) => { void c.pathname },
    afterRequest: (c: RpcContext) => { if (c.namespace === 'pkg-a') c.value = 1 },
  }
  const face = createRpcFace({ ...rpcOptions, hooks: [accessLog], healthz: () => ({ faces: 1 }) })
  void face.ready
  void face.dispose
  void face.healthz
  const names: string[] = parameterNamesOf({ run: () => 0 } as object, 'run', 'pkg-a/run')
  return { table, names }
}

export const _checks = { face, timer, schema, devKit }
