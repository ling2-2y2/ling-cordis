/**
 * vite 内嵌件回归（2026-10-26 用户裁定后的同进程同端口形态）——库加载/缺席
 * fail loud/未认领 next 透传/dispose 关停。替身=tests/helpers/fake-vite.ts 铺的
 * 假 vite 包（同进程 import+globalThis 台账，零子进程零端口）。/app 组合语义
 * （500 hmr-unclaimed、LNG_WEB_HMR=0 静态档）见 dev-app.spec.ts。
 * @module @ling2/ling-cordis/tests/dev-hmr
 */
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createViteEmbed, type ViteEmbed } from '../src/dev/index.ts'
import { createFakeViteProject, fakeViteLedger, removeFakeViteProject, resetFakeViteLedger } from './helpers/fake-vite.ts'

const roots: string[] = []
const shells: Server[] = []
const embeds: ViteEmbed[] = []

afterEach(async () => {
  for (const embed of embeds.splice(0)) await embed.dispose()
  for (const server of shells.splice(0)) await new Promise((resolve) => server.close(resolve))
  for (const root of roots.splice(0)) removeFakeViteProject(root)
  resetFakeViteLedger()
})

/** 起壳服务器：请求先交内嵌件，next（未认领）走 504 兜底（照生产消费方组合方式）。 */
function shellOf(embed: ViteEmbed): Promise<number> {
  const server = createServer((req, res) => {
    embed.middlewares(req, res, () => {
      res.statusCode = 504
      res.end('unclaimed')
    })
  })
  shells.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

describe('createViteEmbed', () => {
  it('以库形态加载 cwd 的 vite：middleWares 应答 fake-vite，入场参带 root+middlewareMode+hmr.server', async () => {
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const shell = createServer()
    shells.push(shell)
    await new Promise<void>((resolve) => shell.listen(0, '127.0.0.1', resolve))
    const embed = await createViteEmbed({ cwd, httpServer: shell })
    embeds.push(embed)
    expect(fakeViteLedger.created).toBe(1)
    const options = fakeViteLedger.lastOptions as { root: string; server: { middlewareMode: boolean; hmr: { server: unknown } } }
    expect(options.root).toBe(cwd)
    expect(options.server.middlewareMode).toBe(true)
    expect(options.server.hmr.server).toBe(shell)
    const port = await shellOf(embed)
    const res = await fetch(`http://127.0.0.1:${port}/app/src/main.tsx?x=1`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('fake-vite /app/src/main.tsx?x=1')
  })

  it('未认领路径走 next()：由调用方兜底（组合在 app.ts=500 hmr-unclaimed，本用例钉透传契约本身）', async () => {
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const shell = createServer()
    shells.push(shell)
    await new Promise<void>((resolve) => shell.listen(0, '127.0.0.1', resolve))
    const embed = await createViteEmbed({ cwd, httpServer: shell })
    embeds.push(embed)
    const port = await shellOf(embed)
    const res = await fetch(`http://127.0.0.1:${port}/app/__next/deep`)
    expect(res.status).toBe(504)
    expect(await res.text()).toBe('unclaimed')
  })

  it('vite 包缺席：reject（fail loud）且报错带修复指引——不静默回落', async () => {
    const shell = createServer()
    shells.push(shell)
    await new Promise<void>((resolve) => shell.listen(0, '127.0.0.1', resolve))
    // 空临时目录：node_modules/vite 必然缺席
    const cwd = join(tmpdir(), `ling-cordis-absent-vite-${Date.now()}`)
    roots.push(cwd)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(cwd, { recursive: true })
    await expect(createViteEmbed({ cwd, httpServer: shell })).rejects.toThrow(/vite 包缺席|pnpm install|LING_WEB_HMR=0/u)
  })

  it('dispose：vite server.close 被调（台账 closed+1）', async () => {
    const cwd = createFakeViteProject()
    roots.push(cwd)
    const shell = createServer()
    shells.push(shell)
    await new Promise<void>((resolve) => shell.listen(0, '127.0.0.1', resolve))
    const embed = await createViteEmbed({ cwd, httpServer: shell })
    await embed.dispose()
    expect(fakeViteLedger.closed).toBe(1)
  })
})
