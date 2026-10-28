/**
 * 服务端产物树引擎回归（批① 2026-10-28：吸收自 bsh 树 build-host.mjs 机制）——
 * 反写映射推导/说明符解析归一/产物树反写执行/资产收集 skip 语义/manifest 结构。
 * 判据源=bsh 树 .project/ling-coris服务端产物规范化-方案-2026-10-28.md §14 U-PRD05。
 * @module @ling2/ling-coris/tests/dev-product-build
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveRewriteMap,
  resolveSpecifierToProduct,
  rewriteAliasSpecifiers,
  walkProductFiles,
  writeProductManifest,
} from '../src/dev/product-build.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ling-coris-product-'))
  roots.push(root)
  return root
}

// tsconfig paths 样例（bsh 树实况裁剪）：exact 深路径键+通配键混排，scope 外键须被过滤
const PATHS = {
  '@ling2/ling-rdb': ['ling-rdb/src/index.ts'],
  '@ling2/ling-rdb/query': ['ling-rdb/src/query/index.ts'],
  '@ling2/ling-rdb/*': ['ling-rdb/src/*'],
  '@ling/ling-aip': ['ling-aip/src/index.ts'],
  '@ling/ling-aip/*': ['ling-aip/src/*'],
  '@types/node': ['node_modules/@types/node'],   // scope 外——不参与反写
}

describe('deriveRewriteMap（paths→exact/通配表，scope 过滤+最具体前缀优先）', () => {
  it('exact 键全表入列、通配键拆 head/tail、scope 外键被过滤', () => {
    const root = tmpRoot()
    const map = deriveRewriteMap(PATHS, { rootDir: root, scopePrefixes: ['@ling/ling-', '@ling2/ling-rdb'] })
    expect(map.exact.get('@ling2/ling-rdb')).toBe(join(root, 'ling-rdb/src/index.ts'))
    expect(map.exact.get('@ling2/ling-rdb/query')).toBe(join(root, 'ling-rdb/src/query/index.ts'))
    expect(map.exact.has('@types/node')).toBe(false)
    expect(map.prefixes.map((p) => p.prefix).sort()).toEqual(['@ling/ling-aip/', '@ling2/ling-rdb/'])   // 两 scope 各留通配键，@types 外滤
  })

  it('多通配键按前缀长度降序（最具体优先——tests/* 先于 /*）', () => {
    const root = tmpRoot()
    const map = deriveRewriteMap(
      { '@ling/ling-a/*': ['ling-a/src/*'], '@ling/ling-a/tests/*': ['ling-a/tests/*'] },
      { rootDir: root, scopePrefixes: ['@ling/ling-'] },
    )
    expect(map.prefixes.map((p) => p.prefix)).toEqual(['@ling/ling-a/tests/', '@ling/ling-a/'])
  })
})

describe('resolveSpecifierToProduct（说明符→绝对源路径，双拼塌缩归一）', () => {
  const root = tmpRoot()
  const map = deriveRewriteMap(PATHS, { rootDir: root, scopePrefixes: ['@ling/ling-', '@ling2/ling-rdb'] })

  it('exact 优先命中（显式深路径键不走通配）', () => {
    expect(resolveSpecifierToProduct('@ling2/ling-rdb/query', map))
      .toBe(join(root, 'ling-rdb/src/query/index.ts').replaceAll('\\', '/'))
  })

  it('通配命中+两类双拼塌缩归一（.ts.ts / src/src/）', () => {
    // 说明符自带 .ts 尾+表尾 '.ts' → index.ts.ts 塌缩
    expect(resolveSpecifierToProduct('@ling2/ling-rdb/src/entry.ts', map))
      .toBe(`${join(root, 'ling-rdb/src/entry.ts').replaceAll('\\', '/')}`)
    // 说明符自带 src/ 段+表头 '…/src/' → src/src/ 塌缩
    expect(resolveSpecifierToProduct('@ling2/ling-rdb/src/sub/mod.ts', map))
      .toBe(join(root, 'ling-rdb/src/sub/mod.ts').replaceAll('\\', '/'))
  })

  it('未命中返回 null（scope 外/未知包）', () => {
    expect(resolveSpecifierToProduct('@types/node', map)).toBeNull()
    expect(resolveSpecifierToProduct('@ling2/ling-unknown/x', map)).toBeNull()
  })
})

describe('rewriteAliasSpecifiers（产物树 .js/.mjs 扫描反写→相对路径）', () => {
  it('命中改写为相对说明符并计数；dist 目标缺席=保原样+警告；.mjs 同扫；非命中文件零改', () => {
    const root = tmpRoot()
    const outDir = join(root, '.host-dist')
    // 产物树摆件：两个包的产物 js+一个 .mjs 直载件+一个无关文件
    mkdirSync(join(outDir, 'ling-rdb', 'src'), { recursive: true })
    writeFileSync(join(outDir, 'ling-rdb', 'src', 'index.js'), 'export {}')
    mkdirSync(join(outDir, 'ling-aip', 'src', 'deep'), { recursive: true })
    writeFileSync(
      join(outDir, 'ling-aip', 'src', 'deep', 'consumer.js'),
      `import { q } from '@ling2/ling-rdb/query'\nimport { i } from '@ling2/ling-rdb'\nexport { q, i }\n`,
    )
    writeFileSync(
      join(outDir, 'ling-aip', 'src', 'loader.mjs'),
      `import '@ling/ling-aip'\n`,
    )
    writeFileSync(join(outDir, 'ling-aip', 'src', 'plain.js'), 'export const x = 1\n')
    // 源树摆件：反写目标真实在场（ling-rdb/src/index.js、…/query/index.js、ling-aip/src/index.js）
    // ——注意 dist 目标=源 .ts 路径换 .js 尾、且落在 outDir 镜像位
    for (const p of ['ling-rdb/src/index.js', 'ling-rdb/src/query/index.js', 'ling-aip/src/index.js']) {
      const target = join(outDir, p)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, 'export {}')
    }
    // 缺席目标：引用存在说明符但产物位无文件
    mkdirSync(join(outDir, 'ling-aip', 'src', 'miss'), { recursive: true })
    writeFileSync(join(outDir, 'ling-aip', 'src', 'miss', 'refs-missing.js'), `import '@ling2/ling-rdb/src/absent.js'\n`)

    const map = deriveRewriteMap(PATHS, { rootDir: root, scopePrefixes: ['@ling/ling-', '@ling2/ling-rdb'] })
    const result = rewriteAliasSpecifiers({ scanDir: outDir, rootDir: root, outDir, map })

    expect(result.rewritten).toBe(3)   // query+根名（consumer.js）+ ling-aip 根名（loader.mjs）
    expect(result.touched).toBe(2)     // consumer.js + loader.mjs
    expect(result.warnings.length).toBe(1)   // refs-missing.js 的缺席目标

    const consumer = readFileSync(join(outDir, 'ling-aip', 'src', 'deep', 'consumer.js'), 'utf8')
    expect(consumer).toContain(`from '../../../ling-rdb/src/query/index.js'`)
    expect(consumer).toContain(`from '../../../ling-rdb/src/index.js'`)
    const loader = readFileSync(join(outDir, 'ling-aip', 'src', 'loader.mjs'), 'utf8')
    expect(loader).toContain(`import './index.js'`)   // 裸副作用 import 改写后仍为 import 形
    // 缺席目标保原样
    expect(readFileSync(join(outDir, 'ling-aip', 'src', 'miss', 'refs-missing.js'), 'utf8'))
      .toContain(`import '@ling2/ling-rdb/src/absent.js'`)
    // 非命中文件零改（无 ling-* 字样快跳）
    expect(readFileSync(join(outDir, 'ling-aip', 'src', 'plain.js'), 'utf8')).toBe('export const x = 1\n')
  })
})

describe('walkProductFiles（资产收集 skip=仅顶层目录名语义）', () => {
  it('顶层 client 跳过、深层 client 子树保留（src/im/client 是运行时依赖）；node_modules 跳过', () => {
    const root = tmpRoot()
    for (const p of [
      'src/index.ts', 'src/assets/logo.png', 'src/client/entry.tsx', 'src/im/client/feishu.ts', 'skill/qian.json',
    ]) {
      const f = join(root, 'pkg', p)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, 'x')
    }
    const files = [...walkProductFiles(join(root, 'pkg', 'src'), new Set(['client']))]
      .map((f) => f.slice(join(root, 'pkg', 'src').length + 1).replaceAll('\\', '/'))
      .sort()
    expect(files).toEqual(['assets/logo.png', 'im/client/feishu.ts', 'index.ts'])   // client/ 顶层被跳、im/client 深层保留
  })
})

describe('writeProductManifest（产物清单三段结构）', () => {
  it('落盘 product-manifest.json：packages/entries/junctions 三段齐、回读 JSON 可解析', () => {
    const outDir = join(tmpRoot(), '.host-dist')
    mkdirSync(outDir, { recursive: true })
    const path = writeProductManifest(outDir, {
      formatVersion: 1,
      generator: '@ling2/ling-coris/dev buildProductTree',
      packages: ['ling-aip', 'ling-rdb'],
      entries: ['ling-aip/src/index.js', 'ling-rdb/src/index.js'],
      junctions: [
        { kind: 'client', pkg: 'ling-aip', target: 'ling-aip/client' },
        { kind: 'node_modules', pkg: 'ling-aip', target: 'ling-aip/node_modules' },
      ],
    })
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    expect(manifest.packages).toEqual(['ling-aip', 'ling-rdb'])
    expect(manifest.entries).toHaveLength(2)
    expect(manifest.junctions.map((j: { kind: string }) => j.kind)).toEqual(['client', 'node_modules'])
    expect(manifest.formatVersion).toBe(1)
  })
})
