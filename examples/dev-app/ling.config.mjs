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
import { createJsonRpcGateway, defineApp } from '../../src/dev/index.ts'

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

  // JSON-RPC 网关：内存凭据 demo/123456（真实项目换成自家鉴权 λ——satoken 等）。
  // 对象形态挂接（handle + healthz 附加位——面计数进健康检查）。
  // 三个面同表登记：demo/demo1/demo2——前端跨模块=换命名空间即达；
  // 后端跨模块在 demo2.report 内部经 ctx.get('demo1') 穿透（见 plugins/demo2.ts）。
  http: (ctx) => [{
    handle: createJsonRpcGateway({
      faces: () => new Map([
        ['demo', { service: ctx.get('greet'), markers: [{ method: 'hello' }, { method: 'add' }] }],
        ['demo1', { service: ctx.get('demo1'), markers: [{ method: 'double' }, { method: 'label' }] }],
        ['demo2', { service: ctx.get('demo2'), markers: [{ method: 'report' }] }],
      ]),
      auth: {
        login: async (account, password) => (account === 'demo' && password === '123456' ? { token: 't-demo', account } : { token: '' }),
        resolve: async (token) => (token === 't-demo' ? { account: 'demo' } : undefined),
      },
    }),
    healthz: () => ({ faces: 3 }),
  }],

  onReady: ({ port }) => { console.log(`[demo] 浏览器打开 http://127.0.0.1:${port}/ 试：登录 demo/123456 → 调 demo.hello`) },
})
