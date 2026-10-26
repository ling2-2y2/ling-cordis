/**
 * 收编件回归（2026-10-26 用户令「类型检查/样式检查/build 收归 ling-cordis」）——
 * themeGate 引擎判定面、runCheckScripts 编排、buildClientBundle 子应用产物包装器。
 * @module @ling2/ling-cordis/tests/dev-kit-absorb
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildClientBundle, runCheckScripts, themeGate } from '../src/dev/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 铺一个主题门夹具（事实源 css+一个假 bundle），返回 {root, sheetDir, bundle}。 */
function themeFixture(): { root: string, sheetDir: string, bundle: string } {
  const root = mkdtempSync(join(tmpdir(), 'ling-cordis-theme-'))
  roots.push(root)
  const sheetDir = join(root, 'sheets')
  mkdirSync(sheetDir)
  writeFileSync(join(sheetDir, 'base.css'), ':root {\n  --dsw-bg: #fff;\n  --dsw-fg: #111;\n  --dsh-fs: 14px;\n}\n')
  const pkg = join(root, 'fake-pkg', 'client')
  mkdirSync(pkg, { recursive: true })
  const bundle = join(pkg, 'client.js')
  writeFileSync(bundle, [
    "// 假子应用产物（CSS 单行串约定）",
    "  '--ink: #333',",
    "  '.panel { background: #fff; }',",
    "  '.a { color: var(--dsw-bg) }',",
    "  '.b { color: var(--dsw-ghost) }',",
    "  '.c { color: var(--ink) }',",
    "  '.d { color: var(--mech-x) }',",
    "  '.e { --dsw-hack: red }',",
    '',
  ].join('\n'))
  return { root, sheetDir, bundle }
}

describe('themeGate 引擎', () => {
  it('E1 幽灵 token/E2 主题名硬编码/E3 浅底 WARN；白名单与本文件自定义豁免', () => {
    const { root, sheetDir, bundle } = themeFixture()
    const result = themeGate({
      tokenSheets: [sheetDir],
      bundles: [bundle],
      rootDir: root,
      allowedVars: ['--mech-x'],
    })
    expect(result.tokenCount).toBe(3)
    expect(result.scanned).toBe(1)
    // E1：只抓 --dsw-ghost（--dsw-bg 事实源在、--ink 本文件自定义、--mech-x 白名单）
    expect(result.errors.filter((e) => e.code === 'E1-ghost-token').map((e) => e.message)).toHaveLength(1)
    expect(result.errors[0]!.message).toContain('--dsw-ghost')
    // E2：--dsw-hack 在插件 CSS 里定义
    expect(result.errors.some((e) => e.code === 'E2-theme-define' && e.message.includes('--dsw-hack'))).toBe(true)
    // E3：#fff 浅底 WARN 一条
    expect(result.warnings.filter((w) => w.code === 'E3-light-bg')).toHaveLength(1)
    // 跨平台展示位：file 字段正斜杠相对路径
    expect(result.errors[0]!.file).toBe('fake-pkg/client/client.js')
    expect(result.ok).toBe(false)
  })

  it('skipBundleE3Prefixes 停报防双计+allowedDswDefines 镜像豁免+E2 前缀豁免整族', () => {
    const { root, sheetDir, bundle } = themeFixture()
    const result = themeGate({
      tokenSheets: [sheetDir],
      bundles: [bundle],
      rootDir: root,
      allowedVars: ['--mech-x', '--dsw-ghost'],
      allowedDswDefines: ['--dsw-hack'],
      skipBundleE3Prefixes: ['fake-pkg/'],
    })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.filter((w) => w.code === 'E3-light-bg')).toHaveLength(0)
    expect(result.ok).toBe(true)
  })
})

describe('runCheckScripts 编排', () => {
  it('逐目标跑 npm run check：全景聚合（败不抛），ok/failed 退出码如实', () => {
    const root = mkdtempSync(join(tmpdir(), 'ling-cordis-check-'))
    roots.push(root)
    const good = join(root, 'good')
    const bad = join(root, 'bad')
    for (const [dir, code] of [[good, 0], [bad, 3]] as const) {
      mkdirSync(dir)
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: `check-${code}`, private: true,
        scripts: { check: `node -e "process.exit(${String(code)})"` },
      }))
    }
    const report = runCheckScripts({ targets: [{ id: 'good', cwd: good }, { id: 'bad', cwd: bad }] })
    expect(report.ok).toBe(false)
    expect(report.passed).toEqual(['good'])
    expect(report.failed).toEqual([{ id: 'bad', exitCode: 3 }])
  }, 60000)
})

describe('buildClientBundle 子应用产物包装器', () => {
  it('打包源码入口→注册器产物：装载面收到 id+factory（factory 返回模块 exports）', async () => {
    // 夹具入口放在仓内 tests/fixtures（esbuild 对等件解析从此处向上达 cordis devDeps）
    const entry = join(import.meta.dirname, 'fixtures', 'client-bundle-entry.ts')
    const outRoot = mkdtempSync(join(tmpdir(), 'ling-cordis-cb-'))
    roots.push(outRoot)
    const outfile = join(outRoot, 'client', 'client.js')
    const bytes = await buildClientBundle({ entry, outfile, id: 'fixture-panel' })
    expect(bytes).toBeGreaterThan(100)
    // 假宿主装载面执行产物
    const loaded: { id: string, exports: unknown }[] = []
    const holder = globalThis as unknown as Record<string, unknown>
    const prevWindow = holder.window
    holder.window = { __ModuleLoader__: { load: (e: { id: string, factory: () => unknown }) => loaded.push({ id: e.id, exports: e.factory() }) } }
    try {
      await import(pathToFileURL(outfile).href)
    } finally {
      if (prevWindow === undefined) delete holder.window
      else holder.window = prevWindow
    }
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.id).toBe('fixture-panel')
    const exports = loaded[0]!.exports as { inject: unknown, apply: unknown }
    expect(Array.isArray(exports.inject)).toBe(true)
    expect(typeof exports.apply).toBe('function')
  }, 60000)
})
