/**
 * 假 vite 内嵌替身工厂——在临时目录里铺一个「node_modules/vite」最小包，
 * 供 createViteEmbed 经 createRequire 解析加载（同进程 import → globalThis 台账
 * 直读，无子进程无端口）。替身行为：
 * - createServer(inline)：台账记 created+1 与入参快照，返回 connect 形态
 *   middlewares——URL 含 `/__next` 时走 next()（未认领透传），其余应答
 *   `fake-vite <url>`；close() 台账记 closed+1。
 * - 不实现 HMR ws（真实 vite 的 hmr.server 升级行为属本地真机轮判据，不在单测面）。
 * @module @ling2/ling-cordis/tests/helpers/fake-vite
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 同进程台账（替身与断言侧同进程直读；beforeEach 重置）。 */
export const fakeViteLedger: { created: number; closed: number; lastOptions: unknown } = (() => {
  const holder = globalThis as { __fakeViteLedger?: { created: number; closed: number; lastOptions: unknown } }
  holder.__fakeViteLedger ??= { created: 0, closed: 0, lastOptions: undefined }
  return holder.__fakeViteLedger
})()

/** 重置台账（各用例独立计数）。 */
export function resetFakeViteLedger(): void {
  fakeViteLedger.created = 0
  fakeViteLedger.closed = 0
  fakeViteLedger.lastOptions = undefined
}

const VITE_INDEX_MJS = [
  "// 假 vite（内嵌形态替身）——由 tests/helpers/fake-vite.ts 生成；台账=globalThis.__fakeViteLedger",
  "const ledger = globalThis.__fakeViteLedger",
  "export async function createServer(options) {",
  "  ledger.created += 1",
  "  ledger.lastOptions = options",
  "  return {",
  "    middlewares(req, res, next) {",
  "      if ((req.url ?? '').includes('/__next')) { next(); return }",
  "      res.writeHead(200, { 'content-type': 'text/plain' })",
  "      res.end(`fake-vite ${req.url}`)",
  "    },",
  "    async close() { ledger.closed += 1 },",
  "  }",
  "}",
  "",
].join('\n')

/** 铺假 vite 项目（临时目录），返回其绝对路径（作 createViteEmbed 的 cwd）。 */
export function createFakeViteProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'ling-cordis-fake-vite-'))
  mkdirSync(join(root, 'node_modules', 'vite'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fake-vite-project', private: true, type: 'module' }, null, 2)}\n`)
  writeFileSync(
    join(root, 'node_modules', 'vite', 'package.json'),
    `${JSON.stringify({ name: 'vite', version: '0.0.0-fake', type: 'module', main: 'index.mjs', exports: { '.': './index.mjs' } }, null, 2)}\n`,
  )
  writeFileSync(join(root, 'node_modules', 'vite', 'index.mjs'), VITE_INDEX_MJS)
  return root
}

/** 清掉假 vite 项目目录（afterEach 用）。 */
export function removeFakeViteProject(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
