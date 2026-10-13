/**
 * runDevApp 载体内核回归——三相序/spec 双形态/HTTP 内建面（healthz 附加位·重定向·
 * 静态 SPA·包表·strip 前缀）/dispose 链（setup 清理器+face 清理器）/HMR 组合。
 * 全部用临时端口+编程式 dispose 句柄，进程不悬挂。
 * @module @ling2/ling-cordis/tests/dev-app
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { defineApp, loadEnv, registryOf, runDevApp, type DevAppHandle } from '../src/dev/index.ts'

const fixtureNs = fileURLToPath(new URL('./fixtures/fake-plugin.mjs', import.meta.url))
const fixtureDefault = fileURLToPath(new URL('./fixtures/fake-plugin-default.mjs', import.meta.url))
const viteBin = fileURLToPath(new URL('./fixtures/fake-vite.mjs', import.meta.url))
const apps: DevAppHandle[] = []
const roots: string[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
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

describe('runDevApp', () => {
  it('三相按序挂载：spec 双形态（namespace/default）+config 省略不传+after 钩子', async () => {
    const { mounted } = await import(fixtureNs)
    const { mountedDefault } = await import(fixtureDefault)
    mounted.length = 0
    mountedDefault.length = 0
    const order: string[] = []
    const port = await freePort()
    const app = await runDevApp(defineApp({
      rootDir: '.',
      port,
      phases: ['base', 'tail'],
      modules: [
        { id: 'p-ns', phase: 'base', spec: fixtureNs, config: { mark: 'ns1' } },
        { id: 'p-default', phase: 'base', spec: fixtureDefault, use: 'default', config: { mark: 'd1' } },
        { id: 'p-bare', phase: 'base', spec: fixtureNs },
        { id: 'p-after-only', phase: 'tail', after: () => { order.push('after-only') } },
      ],
    }))
    apps.push(app)
    expect(mounted).toEqual(['ns1', 'no-config'])
    expect(mountedDefault).toEqual(['d1'])
    expect(order).toEqual(['after-only'])
    await app.dispose()
  })

  it('HTTP 内建面：挂件先行（strip 前缀）+healthz 附加位+重定向+静态 SPA+包表+404', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const staticRoot = join(root, 'web')
    mkdirSync(staticRoot)
    writeFileSync(join(staticRoot, 'index.html'), '<html>spa-index</html>')
    writeFileSync(join(staticRoot, 'asset.js'), '// asset')
    const bundle = join(root, 'bundle.js')
    writeFileSync(bundle, '// bundle')
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      label: 'tdev',
      redirects: { '/': '/app/' },
      stripApiPrefixes: ['/app'],
      staticApp: { root: staticRoot, extras: { 'chat.js': bundle } },
      packagesExtras: { 'x/client.js': bundle },
      phases: ['only'],
      modules: [],
      http: () => [{
        handle: (req, res) => {
          if (req.url !== '/api/probe') return false
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('claimed')
          return true
        },
        healthz: () => ({ faces: 3 }),
      }],
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    expect(await fetch(`${base}/app/api/probe`).then((r) => r.text())).toBe('claimed')
    expect(await fetch(`${base}/healthz`).then((r) => r.json())).toMatchObject({ ok: true, runtime: 'tdev', faces: 3 })
    expect((await fetch(`${base}/`, { redirect: 'manual' })).status).toBe(302)
    expect(await fetch(`${base}/app/deep/link`).then((r) => r.text())).toContain('spa-index')
    expect(await fetch(`${base}/app/asset.js`).then((r) => r.text())).toBe('// asset')
    expect(await fetch(`${base}/app/chat.js`).then((r) => r.text())).toBe('// bundle')
    expect(await fetch(`${base}/packages/x/client.js`).then((r) => r.text())).toBe('// bundle')
    expect((await fetch(`${base}/nope`)).status).toBe(404)
    await app.dispose()
  })

  it('dispose 链：face 清理器与 setup 清理器按序执行，进程信号解绑', async () => {
    const events: string[] = []
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      phases: ['only'],
      modules: [],
      setup: () => () => { events.push('setup-dispose') },
      http: () => [{ dispose: () => { events.push('face-dispose') } }],
    })
    apps.push(app)
    await app.dispose()
    expect(events).toEqual(['face-dispose', 'setup-dispose'])
  })

  it('HMR 组合：/app 反代假 vite（静态面被桥接管）', async () => {
    const port = await freePort()
    const vitePort = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      phases: ['only'],
      modules: [],
      hmr: { cwd: '.', port: vitePort, bin: viteBin },
      staticApp: { root: join(tmpdir(), 'ling-cordis-absent-dist') },
    })
    apps.push(app)
    // 根路径反代不带 query（/app 精确匹配分支平移原 dev.mjs 语义）；带 query 的深路径原样透传
    expect(await fetch(`http://127.0.0.1:${port}/app/`).then((r) => r.text())).toBe('fake-vite /app/')
    expect(await fetch(`http://127.0.0.1:${port}/app/src/main.tsx?x=1`).then((r) => r.text())).toBe('fake-vite /app/src/main.tsx?x=1')
    await app.dispose()
  })
})

describe('配置助手', () => {
  it('registryOf：配置条目→注册表（相过滤/静态表同源）', () => {
    const registry = registryOf({
      phases: ['core', 'tail'],
      modules: [
        { id: 'a', phase: 'core', client: { key: 'a/client.js' } },
        { id: 'b', phase: 'tail' },
      ],
    })
    expect(registry.ofPhase('core').map((m) => m.id)).toEqual(['a'])
    expect(registry.clientTable('/tree')).toEqual({ 'a/client.js': join('/tree', 'a', 'client/client.js') })
  })

  it('loadEnv：文件解析+defaults 注入+不覆盖显式在场值', () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-env-'))
    roots.push(root)
    const file = join(root, '.env')
    writeFileSync(file, 'LC_TEST_A=from-file\nLC_TEST_B="quoted"\n# comment\n')
    process.env.LC_TEST_A = 'explicit'
    loadEnv(file, { LC_TEST_C: 'default' })
    expect(process.env.LC_TEST_A).toBe('explicit')
    expect(process.env.LC_TEST_B).toBe('quoted')
    expect(process.env.LC_TEST_C).toBe('default')
    delete process.env.LC_TEST_A
    delete process.env.LC_TEST_B
    delete process.env.LC_TEST_C
  })
})
