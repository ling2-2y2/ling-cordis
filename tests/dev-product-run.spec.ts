/**
 * 产物档挂载回归（批① 2026-10-28）：productBase 在场=模块 spec 经 specToPath
 * 映射为产物树 file URL 再动态 import——产物树 .js 产物被裸 node 直载（零 tsx、
 * 零源码消费——源码泄露不可接受，2026-10-27 用户裁定升格框架规范）。
 * 判据源=bsh 树 .project/ling-coris服务端产物规范化-方案-2026-10-28.md §3.1②。
 * @module @ling2/ling-coris/tests/dev-product-run
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runDevApp, type DevAppHandle } from '../src/dev/index.ts'

const apps: DevAppHandle[] = []
const roots: string[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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

/** 造一棵最小产物树：outDir/ling-fake/src/index.js（namespace 形插件产物）。 */
function makeProductTree(): { outDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ling-coris-product-run-'))
  roots.push(root)
  const outDir = join(root, '.host-dist')
  mkdirSync(join(outDir, 'ling-fake', 'src'), { recursive: true })
  writeFileSync(
    join(outDir, 'ling-fake', 'src', 'index.js'),
    [
      'export const mounted = []',
      'export function apply(_ctx, config) {',
      "  mounted.push(`product:${config?.mark ?? 'no-config'}`)",
      '}',
      'export function productFormMarker() { return true }',
      '',
    ].join('\n'),
  )
  return { outDir }
}

describe('runDevApp 产物档（productBase）', () => {
  it('spec 经 specToPath 映射为产物树 file URL 挂载——裸名源码态说明符不直接 import', async () => {
    const { outDir } = makeProductTree()
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      phases: ['only'],
      productBase: {
        base: `${pathToFileURL(outDir).href}/`,
        // 树内映射约定（scope 名剥壳+.ts→.js）由消费方持有——此处即树侧 specOf 的框架化形态
        specToPath: (spec) => spec.replace(/^@[a-z0-9-]+\//, '').replace(/\.ts$/, '.js'),
      },
      modules: [
        // 源码态裸名说明符：无 productBase 映射时 import 必失败（模块不可解析）——
        // 映射生效=从产物树挂载成功
        { id: 'p-prod', phase: 'only', spec: '@ling/ling-fake/src/index.ts', config: { mark: 'ns1' } },
      ],
    })
    apps.push(app)
    const { mounted } = await import(`${pathToFileURL(outDir).href}/ling-fake/src/index.js`)
    expect(mounted).toEqual(['product:ns1'])
    await app.dispose()
  })

  it('specToPath 缺省=原样+尾换 .ts→.js（说明符即产物相对路径的消费方形态）', async () => {
    const { outDir } = makeProductTree()
    const port = await freePort()
    const app = await runDevApp({
      rootDir: '.',
      port,
      phases: ['only'],
      productBase: { base: `${pathToFileURL(outDir).href}/ling-fake/../` },
      modules: [{ id: 'p-prod2', phase: 'only', spec: 'ling-fake/src/index.ts', config: { mark: 'ns2' } }],
    })
    apps.push(app)
    const { mounted } = await import(`${pathToFileURL(outDir).href}/ling-fake/src/index.js`)
    expect(mounted).toEqual(['product:ns2'])
    await app.dispose()
  })

  it('specToPath 返回空值=该说明符不经产物树、保持原样解析（非镜像族透传语义）', async () => {
    const { outDir } = makeProductTree()
    const port = await freePort()
    // 产物档下混一条非镜像族说明符：specToPath 对其返回 null → 原样 bare import
    // （经 node_modules 解析——本测以另一产物树内路径的 fixture 充当可解析目标）
    const fixtureNs = (await import('node:url')).pathToFileURL(
      (await import('node:path')).join(outDir, 'ling-fake', 'src', 'index.js'),
    ).href
    const app = await runDevApp({
      rootDir: '.',
      port,
      phases: ['only'],
      productBase: {
        base: `${pathToFileURL(outDir).href}/`,
        specToPath: (spec) => (spec.startsWith('@ling/') ? 'ling-fake/src/index.js' : null),
      },
      modules: [{ id: 'p-passthrough', phase: 'only', spec: fixtureNs, config: { mark: 'ns3' } }],
    })
    apps.push(app)
    const { mounted } = await import(`${pathToFileURL(outDir).href}/ling-fake/src/index.js`)
    expect(mounted).toEqual(['product:ns3'])
    await app.dispose()
  })
})
