/**
 * 假 vite 内嵌替身工厂——在临时目录里铺一个「node_modules/vite」最小包，
 * 供 createViteEmbed 经 createRequire 解析加载（同进程 import → globalThis 台账
 * 直读，无子进程无端口）。替身行为：
 * - createServer(inline)：台账记 created+1 与入参快照，返回 connect 形态
 *   middlewares——URL 含 `/__next` 时走 next()（未认领透传），其余应答
 *   `fake-vite <url>`；close() 台账记 closed+1。
 * - 不实现 HMR ws（真实 vite 的 hmr.server 升级行为属本地真机轮判据，不在单测面）。
 * @module @ling2/ling-coris/tests/helpers/fake-vite
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 同进程台账（替身与断言侧同进程直读；beforeEach 重置）。 */
export const fakeViteLedger: { created: number; closed: number; lastOptions: unknown; pluginCalled: number } = (() => {
  const holder = globalThis as { __fakeViteLedger?: { created: number; closed: number; lastOptions: unknown; pluginCalled: number } }
  holder.__fakeViteLedger ??= { created: 0, closed: 0, lastOptions: undefined, pluginCalled: 0 }
  return holder.__fakeViteLedger
})()

/** 重置台账（各用例独立计数）。 */
export function resetFakeViteLedger(): void {
  fakeViteLedger.created = 0
  fakeViteLedger.closed = 0
  fakeViteLedger.lastOptions = undefined
  fakeViteLedger.pluginCalled = 0
}

const VITE_INDEX_MJS = [
  "// 假 vite（内嵌形态替身）——由 tests/helpers/fake-vite.ts 生成；台账=globalThis.__fakeViteLedger",
  "// ws 面=忠实模拟真 vite 所有权语义：按（协议头 vite-hmr/vite-ping+base 路径）认领并持有",
  "// 升级 socket（不销毁不响应），close() 时统一销毁（=真 vite wss.close 收编客户端）——",
  "// 没有所有权模拟时，被 app 链放行的升级 socket 成孤儿，server.close() 永挂（实证）。",
  "const ledger = globalThis.__fakeViteLedger",
  "export async function createServer(options) {",
  "  ledger.created += 1",
  "  ledger.lastOptions = options",
  "  const base = '/app/'",
  "  const held = new Set()",
  "  const httpServer = options?.server?.hmr?.server",
  "  if (httpServer && typeof httpServer.on === 'function') {",
  "    httpServer.on('upgrade', (req, socket) => {",
  "      const protocol = req.headers['sec-websocket-protocol']",
  "      let claimed = protocol === 'vite-hmr' || protocol === 'vite-ping'",
  "      try { claimed = claimed && new URL(req.url ?? '/', 'http://e.com').pathname === base } catch { claimed = false }",
  "      if (claimed) { socket.pause(); held.add(socket); socket.on('close', () => held.delete(socket)) }",
  "    })",
  "  }",
  "  return {",
  "    config: { base },",
  "    middlewares(req, res, next) {",
  "      if ((req.url ?? '').includes('/__next')) { next(); return }",
  "      res.writeHead(200, { 'content-type': 'text/plain' })",
  "      res.end(`fake-vite ${req.url}`)",
  "    },",
  "    async close() { ledger.closed += 1; for (const s of held) s.destroy(); held.clear() },",
  "  }",
  "}",
  "",
].join('\n')

/** 假项目铺设选项。 */
export interface FakeViteProjectOptions {
  /** 铺假 @vitejs/plugin-react（CJS 工厂，调用记台账 pluginCalled）——hmr.react 断言用。 */
  react?: boolean
  /** 铺 <root>/src/client/index.tsx 占位——依赖预热约定探测断言用。 */
  clientEntry?: boolean
}

/** 铺假 vite 项目（临时目录），返回其绝对路径（作 createViteEmbed 的 cwd）。 */
export function createFakeViteProject(options: FakeViteProjectOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ling-coris-fake-vite-'))
  mkdirSync(join(root, 'node_modules', 'vite'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fake-vite-project', private: true, type: 'module' }, null, 2)}\n`)
  writeFileSync(
    join(root, 'node_modules', 'vite', 'package.json'),
    `${JSON.stringify({ name: 'vite', version: '0.0.0-fake', type: 'module', main: 'index.mjs', exports: { '.': './index.mjs' } }, null, 2)}\n`,
  )
  writeFileSync(join(root, 'node_modules', 'vite', 'index.mjs'), VITE_INDEX_MJS)
  if (options.react === true) {
    mkdirSync(join(root, 'node_modules', '@vitejs', 'plugin-react'), { recursive: true })
    writeFileSync(
      join(root, 'node_modules', '@vitejs', 'plugin-react', 'package.json'),
      `${JSON.stringify({ name: '@vitejs/plugin-react', version: '0.0.0-fake', main: 'index.cjs' }, null, 2)}\n`,
    )
    writeFileSync(
      join(root, 'node_modules', '@vitejs', 'plugin-react', 'index.cjs'),
      [
        '// 假 plugin-react（CJS 工厂替身）——hmr.react:true 内联注入断言用',
        "const ledger = globalThis.__fakeViteLedger",
        "module.exports = () => { ledger.pluginCalled += 1; return { name: 'fake-plugin-react' } }",
        '',
      ].join('\n'),
    )
  }
  if (options.clientEntry === true) {
    mkdirSync(join(root, 'src', 'client'), { recursive: true })
    writeFileSync(join(root, 'src', 'client', 'index.tsx'), '// 占位约定入口（依赖预热探测断言用）\n')
  }
  return root
}

/** 清掉假 vite 项目目录（afterEach 用）。 */
export function removeFakeViteProject(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
