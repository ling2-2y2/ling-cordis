/**
 * basePath 前缀单源回归（2026-10-26 架构评审 O3）——`/app` 前缀原本在
 * app.ts（staticApp.urlPrefix 缺省）与 hmr.ts（vite base 缺省）两处独立约定，
 * 改一漏一=资产 404 静默错位；本族钉死单源派生契约：
 * - staticApp.urlPrefix 与 hmr.base 未显式设置时由 basePath 派生（urlPrefix=去尾杠、
 *   vite base=补尾杠）；
 * - 显式设置保留（越具体越优先）；
 * - 尾斜杠容错归一（'/foo/' 与 '/foo' 同值）；
 * - 不设 basePath=缺省 '/app'，行为与历史逐字节一致（含 /__ling 双路由前缀形态）。
 * @module @ling2/ling-coris/tests/base-path
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDevApp, type DevAppHandle } from '../src/dev/index.ts'
import { createFakeViteProject, fakeViteLedger, removeFakeViteProject, resetFakeViteLedger } from './helpers/fake-vite.ts'

const apps: DevAppHandle[] = []
const roots: string[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
  for (const root of roots.splice(0)) removeFakeViteProject(root)
  resetFakeViteLedger()
})

/** 找空闲端口（listen 0 取内核分配值后释放）。 */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/** 铺临时 SPA 静态根（index.html 可识别内容）。 */
function spaRoot(content = '<html>spa-index</html>'): string {
  const root = mkdtempSync(join(tmpdir(), 'ling-coris-basepath-'))
  roots.push(root)
  const web = join(root, 'web')
  mkdirSync(web)
  writeFileSync(join(web, 'index.html'), content)
  return web
}

describe('basePath 前缀单源（O3）', () => {
  it("basePath='/foo'：SPA 面、/__ling 前缀形态路由随派生，旧缺省 /app 不再命中", async () => {
    const staticRoot = spaRoot('<html>foo-spa</html>')
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      basePath: '/foo',
      staticApp: { root: staticRoot },
      phases: ['only'],
      modules: [],
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    // SPA 面与深链兜底都挂到 /foo
    expect(await fetch(`${base}/foo/`).then((r) => r.text())).toContain('foo-spa')
    expect(await fetch(`${base}/foo/deep/link`).then((r) => r.text())).toContain('foo-spa')
    // /__ling 双路由的前缀形态跟随派生；根形态恒在
    expect((await fetch(`${base}/foo/__ling/main.js`)).status).toBe(200)
    expect((await fetch(`${base}/__ling/main.js`)).status).toBe(200)
    // 旧缺省前缀不再是 SPA 面（前缀已单源改道——防半改残留）
    expect((await fetch(`${base}/app/deep/link`)).status).toBe(404)
    await app.dispose()
  })

  it("hmr.base 由 basePath 派生：假 vite 收到 base='/foo/'，/foo 面由 vite 应答", async () => {
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      basePath: '/foo',
      hmr: { cwd },
      phases: ['only'],
      modules: [],
    })
    apps.push(app)
    const options = fakeViteLedger.lastOptions as { base?: string }
    expect(options.base).toBe('/foo/')
    expect(await fetch(`http://127.0.0.1:${port}/foo/`).then((r) => r.text())).toBe('fake-vite /foo/')
    await app.dispose()
  })

  it('显式覆盖优先：staticApp.urlPrefix 与 hmr.base 各自压过 basePath', async () => {
    // a) urlPrefix 显式档（无 vite=产物档思维）：SPA 在 /bar，/foo 不命中
    const staticRoot = spaRoot('<html>bar-spa</html>')
    const portA = await freePort()
    const appA = await runDevApp({
      rootDir: '.',
      port: portA,
      basePath: '/foo',
      staticApp: { root: staticRoot, urlPrefix: '/bar' },
      phases: ['only'],
      modules: [],
    })
    apps.push(appA)
    const baseA = `http://127.0.0.1:${portA}`
    expect(await fetch(`${baseA}/bar/`).then((r) => r.text())).toContain('bar-spa')
    expect((await fetch(`${baseA}/foo/`)).status).toBe(404)
    await appA.dispose()
    // b) hmr.base 显式档（vite 在场=dev 档思维）：vite 收到 '/baz/'（不随 basePath）；
    //    此时前缀面全权交 vite（dev 态禁回落 dist 是既定语义，SPA 断言归 a 档）
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const portB = await freePort()
    const appB = await runDevApp({
      rootDir: '.',
      port: portB,
      basePath: '/foo',
      hmr: { cwd, base: '/baz/' },
      phases: ['only'],
      modules: [],
    })
    apps.push(appB)
    const options = fakeViteLedger.lastOptions as { base?: string }
    expect(options.base).toBe('/baz/')
    await appB.dispose()
  })

  it("尾斜杠容错：basePath='/foo/' 归一为 '/foo'（防 /foo//__ling 双斜杠）", async () => {
    const staticRoot = spaRoot('<html>norm-spa</html>')
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      basePath: '/foo/',
      staticApp: { root: staticRoot },
      phases: ['only'],
      modules: [],
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    expect(await fetch(`${base}/foo/`).then((r) => r.text())).toContain('norm-spa')
    expect((await fetch(`${base}/foo/__ling/main.js`)).status).toBe(200)
    await app.dispose()
  })

  it('缺省档不回归：不设 basePath 时 /app 行为与历史一致（SPA+__ling 前缀形态）', async () => {
    const staticRoot = spaRoot()
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      staticApp: { root: staticRoot },
      phases: ['only'],
      modules: [],
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    expect(await fetch(`${base}/app/`).then((r) => r.text())).toContain('spa-index')
    expect((await fetch(`${base}/app/__ling/main.js`)).status).toBe(200)
    expect((await fetch(`${base}/__ling/main.js`)).status).toBe(200)
    await app.dispose()
  })
})
