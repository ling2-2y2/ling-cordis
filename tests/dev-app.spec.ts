/**
 * runDevApp 载体内核回归——三相序/spec 双形态/HTTP 内建面（healthz 附加位·重定向·
 * 静态 SPA·包表·strip 前缀）/dispose 链（setup 清理器+face 清理器）/HMR 组合。
 * 全部用临时端口+编程式 dispose 句柄，进程不悬挂。
 * @module @ling2/ling-cordis/tests/dev-app
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineApp, loadEnv, registryOf, runDevApp, type DevAppHandle } from '../src/dev/index.ts'
import { createFakeViteProject, fakeViteLedger, removeFakeViteProject, resetFakeViteLedger } from './helpers/fake-vite.ts'

const fixtureNs = fileURLToPath(new URL('./fixtures/fake-plugin.mjs', import.meta.url))
const fixtureDefault = fileURLToPath(new URL('./fixtures/fake-plugin-default.mjs', import.meta.url))
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

  it('404 首见告警去重：同 miss 只告警首见、不同 miss 各告警（missedRoutes 观测面——路由机制迁移防丢钉）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-dedup-'))
    roots.push(root)
    const port = await freePort()
    const app = await runDevApp({ rootDir: root, port, phases: ['only'], modules: [] })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    // 模块级去重表防跨用例污染：用独立路径名（其他用例的 miss 不影响本用例首见判定）
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await fetch(`${base}/dedup-a`)
      await fetch(`${base}/dedup-a`)
      await fetch(`${base}/dedup-a`)
      await fetch(`${base}/dedup-b`)
      expect((await fetch(`${base}/dedup-a`)).status).toBe(404)
      const warns = warnSpy.mock.calls.map((call) => String(call[0]))
      expect(warns.filter((w) => w.includes('GET /dedup-a'))).toHaveLength(1)
      expect(warns.some((w) => w.includes('GET /dedup-b'))).toBe(true)
    } finally {
      warnSpy.mockRestore()
      await app.dispose()
    }
  })

  it('静态资产流式下发：1MB 资产完整不截断；登记键物理缺席走 404（O7 流式化钉）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-stream-'))
    roots.push(root)
    const staticRoot = join(root, 'web')
    mkdirSync(staticRoot)
    const payload = 'x'.repeat(1024 * 1024)
    writeFileSync(join(staticRoot, 'big.js'), payload)
    // 登记存在但物理缺席（packagesExtras 指向已删文件——serveStaticFile 的 notFound 回落）
    const ghost = join(root, 'ghost.js')
    writeFileSync(ghost, '// ghost')
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      staticApp: { root: staticRoot },
      packagesExtras: { 'ghost/client.js': ghost },
      phases: ['only'],
      modules: [],
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    const body = await fetch(`${base}/app/big.js`).then((r) => r.text())
    expect(body.length).toBe(1024 * 1024)
    expect(body).toBe(payload)
    rmSync(ghost)
    expect((await fetch(`${base}/packages/ghost/client.js`)).status).toBe(404)
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

  it('HMR 组合（内嵌形态）：/app 由假 vite 应答；未认领 → 500 hmr-unclaimed（禁回落 dist）', async () => {
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const staticRoot = join(root, 'web')
    mkdirSync(staticRoot)
    writeFileSync(join(staticRoot, 'index.html'), '<html>spa-index</html>')
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [],
      hmr: { cwd },
      staticApp: { root: staticRoot },
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    expect(await fetch(`${base}/app/`).then((r) => r.text())).toBe('fake-vite /app/')
    expect(await fetch(`${base}/app/src/main.tsx?x=1`).then((r) => r.text())).toBe('fake-vite /app/src/main.tsx?x=1')
    // 健康位带内嵌标记（真机判据用）
    expect(await fetch(`${base}/healthz`).then((r) => r.json())).toMatchObject({ ok: true, hmr: 'vite-embedded' })
    // vite 未认领路径：显式 500（2026-10-26 用户裁定②——dev 形态禁静默回落 dist）
    const unclaimed = await fetch(`${base}/app/__next/deep`)
    expect(unclaimed.status).toBe(500)
    await expect(unclaimed.json()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/hmr-unclaimed' } })
    await app.dispose()
    expect(fakeViteLedger.closed).toBeGreaterThanOrEqual(1)
  })

  it('ws 升级分派：vite HMR 认领面放行（不被兜底 destroy 掐死）、他面路径照常销毁', async () => {
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [],
      hmr: { cwd },
    })
    apps.push(app)
    // 原始升级探针（真机 8461 轮同款手法）：A=vite-hmr 协议头@base → app 链放行
    // （假 vite 无 ws 实现 → 无 101 应答，判据=socket 不被立即销毁、存活>1.2s）；
    // B=他面路径普通升级 → 兜底 socket.destroy()（<600ms 内断）
    const sockets: ReturnType<typeof connect>[] = []
    const probe = (path: string, protocol?: string): Promise<'survive' | 'destroyed'> =>
      new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1')
        sockets.push(socket)
        let settled = false
        socket.on('connect', () => {
          let head = `GET ${path} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\n`
          if (protocol !== undefined) head += `sec-websocket-protocol: ${protocol}\r\n`
          socket.write(`${head}\r\n`)
        })
        socket.on('close', () => { if (!settled) { settled = true; resolve('destroyed') } })
        socket.on('error', (error) => { if (!settled) { settled = true; reject(error) } })
        setTimeout(() => { if (!settled) { settled = true; resolve('survive') } }, 1200)
      })
    try {
      const started = Date.now()
      expect(await probe('/app/', 'vite-hmr')).toBe('survive')
      expect(Date.now() - started).toBeGreaterThanOrEqual(1100)
      expect(await probe('/message/websocket')).toBe('destroyed')
    } finally {
      for (const socket of sockets) socket.destroy()
    }
    await app.dispose()
  }, 20000)

  it('客户端源码面：dev 态注册表 client 键改发 ESM 转接 shim（@fs 源码入口+装载器注册）；纯资产 extras 仍走产物', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    // 假包：约定源码入口 src/client/index.ts + 产物 client/client.js
    const pkg = join(root, 'fake-pkg')
    mkdirSync(join(pkg, 'src', 'client'), { recursive: true })
    mkdirSync(join(pkg, 'client'), { recursive: true })
    writeFileSync(join(pkg, 'src', 'client', 'index.ts'), 'export const inject = []\nexport function apply() {}\n')
    writeFileSync(join(pkg, 'client', 'client.js'), '// product bundle')
    // 纯资产键：放在无源码约定的目录（不触发源码面发现）
    mkdirSync(join(root, 'loose'), { recursive: true })
    writeFileSync(join(root, 'loose', 'asset.js'), '// loose asset')
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [{ id: 'fake-pkg', phase: 'only', client: { key: 'fake-pkg/client.js' } }],
      packagesExtras: { 'asset-only.js': join(root, 'loose', 'asset.js') },
      hmr: { cwd },
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    // dev 态：client 键→ESM 转接 shim（@fs 源码入口 + 框架契约装载器注册 + 正确 id）
    const shim = await fetch(`${base}/packages/fake-pkg/client.js`)
    expect(shim.status).toBe(200)
    const body = await shim.text()
    expect(body).toContain('/app/@fs/')
    expect(body).toContain('src/client/index.ts')
    expect(body).toContain('"fake-pkg"')
    expect(body).toContain('window.__ModuleLoader__.load')
    expect(body).not.toContain('// product bundle')
    // extras 纯资产键（无源码约定）=产物文件原样
    expect(await fetch(`${base}/packages/asset-only.js`).then((r) => r.text())).toBe('// loose asset')
    await app.dispose()
  })

  it('客户端源码面：产物态（无 vite 内嵌）client 键=产物文件原样（回归钉）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const pkg = join(root, 'fake-pkg')
    mkdirSync(join(pkg, 'src', 'client'), { recursive: true })
    mkdirSync(join(pkg, 'client'), { recursive: true })
    writeFileSync(join(pkg, 'src', 'client', 'index.ts'), 'export const inject = []\n')
    writeFileSync(join(pkg, 'client', 'client.js'), '// product bundle')
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [{ id: 'fake-pkg', phase: 'only', client: { key: 'fake-pkg/client.js' } }],
    })
    apps.push(app)
    expect(await fetch(`http://127.0.0.1:${port}/packages/fake-pkg/client.js`).then((r) => r.text())).toBe('// product bundle')
    await app.dispose()
  })

  it('HMR 内嵌+依赖缺席：runDevApp 拒启（fail loud，不静默回落 dist）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const port = await freePort()
    await expect(runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [],
      hmr: { cwd: root },
      staticApp: { root: join(root, 'web') },
    })).rejects.toThrow(/vite 包缺席|LING_WEB_HMR=0/u)
  })

  it('框架装载器路由：/__ling/boot.js 与 /app/__ling/boot.js 同源应答（内容=装载面+运行时装载正路）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const port = await freePort()
    const app = await runDevApp({ rootDir: root, port, phases: ['only'], modules: [] })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    const plain = await fetch(`${base}/__ling/boot.js`)
    const prefixed = await fetch(`${base}/app/__ling/boot.js`)
    expect(plain.status).toBe(200)
    expect(prefixed.status).toBe(200)
    expect(plain.headers.get('content-type')).toContain('text/javascript')
    const body = await plain.text()
    expect(body).toContain('__ModuleLoader__')
    expect(body).toContain('lingLoadSubapps')
    // 同源：两路由字节一致
    expect(await prefixed.text()).toBe(body)
    await app.dispose()
  })

  it('子应用自动装载路由：/__ling/main.js = 装载器+ling.config 键序自动装载（src/shell.ts 退役件）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['core', 'tail'],
      modules: [
        { id: 'pkg-a', phase: 'core', client: { key: 'pkg-a/client.js' } },
        { id: 'pkg-b', phase: 'tail', client: { key: 'pkg-b/client.js' } },
        { id: 'no-face', phase: 'tail' },
      ],
      packagesExtras: { 'shared/client.js': join(root, 'shared', 'client', 'client.js') },
    })
    apps.push(app)
    const base = `http://127.0.0.1:${port}`
    const plain = await fetch(`${base}/__ling/main.js`)
    const prefixed = await fetch(`${base}/app/__ling/main.js`)
    expect(plain.status).toBe(200)
    expect(prefixed.status).toBe(200)
    const body = await plain.text()
    // 装载器本体在场 + 按 client 键登记序自动装载；无 client 条目与 extras 共享键不掺入
    expect(body).toContain('__ModuleLoader__')
    expect(body).toContain('window.lingLoadSubapps(["pkg-a/client.js","pkg-b/client.js"])')
    expect(body).not.toContain('shared/client.js')
    expect(await prefixed.text()).toBe(body)
    await app.dispose()
    // 无 client 条目应用：main.js 退化为纯装载器（无自动装载调用行）
    const port2 = await freePort()
    const app2 = await runDevApp({ rootDir: root, port: port2, phases: ['only'], modules: [] })
    apps.push(app2)
    const bare = await fetch(`http://127.0.0.1:${port2}/__ling/main.js`)
    expect(bare.status).toBe(200)
    expect(await bare.text()).not.toContain('window.lingLoadSubapps([')
    await app2.dispose()
  })

  it('/app/packages/* 别名（dev 态坑吸收）：base 前缀形态回源码面 shim；产物态不别名（404 不误吞）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const pkg = join(root, 'fake-pkg')
    mkdirSync(join(pkg, 'src', 'client'), { recursive: true })
    writeFileSync(join(pkg, 'src', 'client', 'index.ts'), 'export const inject = []\n')
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [{ id: 'fake-pkg', phase: 'only', client: { key: 'fake-pkg/client.js' } }],
      hmr: { cwd },
    })
    apps.push(app)
    // dev 态：/app/packages/*（vite html 转换前缀 base 后的形态）→ 与 /packages/* 同源码面
    const aliased = await fetch(`http://127.0.0.1:${port}/app/packages/fake-pkg/client.js`)
    expect(aliased.status).toBe(200)
    const body = await aliased.text()
    expect(body).toContain('/app/@fs/')
    expect(body).toContain('window.__ModuleLoader__.load')
    await app.dispose()
    // 产物态（无 vite 内嵌）：/app/packages/* 走静态面（文件不存在=404，别名不吞）
    const staticRoot = join(root, 'web')
    mkdirSync(staticRoot)
    writeFileSync(join(staticRoot, 'index.html'), '<html>spa-index</html>')
    const port2 = await freePort()
    const app2 = await runDevApp({
      rootDir: root,
      port: port2,
      phases: ['only'],
      modules: [{ id: 'fake-pkg', phase: 'only', client: { key: 'fake-pkg/client.js' } }],
      staticApp: { root: staticRoot },
    })
    apps.push(app2)
    expect((await fetch(`http://127.0.0.1:${port2}/app/packages/fake-pkg/client.js`)).status).toBe(404)
    await app2.dispose()
  })

  it('hmr 显式关（enabled:false）：/app 走 dist 静态档（逃生口保留）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-app-'))
    roots.push(root)
    const staticRoot = join(root, 'web')
    mkdirSync(staticRoot)
    writeFileSync(join(staticRoot, 'index.html'), '<html>spa-index</html>')
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const port = await freePort()
    const app = await runDevApp({
      rootDir: root,
      port,
      phases: ['only'],
      modules: [],
      hmr: { cwd, enabled: false },
      staticApp: { root: staticRoot },
    })
    apps.push(app)
    expect(await fetch(`http://127.0.0.1:${port}/app/deep/link`).then((r) => r.text())).toContain('spa-index')
    expect(fakeViteLedger.created).toBe(0)
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
