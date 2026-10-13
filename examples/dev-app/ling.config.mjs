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
  ],

  // JSON-RPC 网关：内存凭据 demo/123456（真实项目换成自家鉴权 λ——satoken 等）。
  // 对象形态挂接（handle + healthz 附加位——面计数进健康检查）。
  http: (ctx) => [{
    handle: createJsonRpcGateway({
      faces: () => new Map([['demo', {
        service: ctx.get('greet'),
        markers: [{ method: 'hello' }, { method: 'add' }],
      }]]),
      auth: {
        login: async (account, password) => (account === 'demo' && password === '123456' ? { token: 't-demo', account } : { token: '' }),
        resolve: async (token) => (token === 't-demo' ? { account: 'demo' } : undefined),
      },
    }),
    healthz: () => ({ faces: 1 }),
  }],

  onReady: ({ port }) => { console.log(`[demo] 浏览器打开 http://127.0.0.1:${port}/ 试：登录 demo/123456 → 调 demo.hello`) },
})
