/**
 * 物理层接线助手回归——junction 幂等/悬空清理/shim 桥重写相对路径。
 * @module @ling2/ling-coris/tests/dev-link
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureJunctions, pruneDangling, writeShim } from '../src/dev/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ling-coris-link-'))
  roots.push(root)
  return root
}

describe('ensureJunctions / pruneDangling', () => {
  it('幂等：首轮 created、复跑 kept；目标缺席=抛错', () => {
    const root = tmpRoot()
    const pkgA = join(root, 'pkg-a')
    mkdirSync(pkgA)
    const scope = join(root, 'node_modules', '@scope')
    const first = ensureJunctions(scope, [{ name: 'pkg-a', target: pkgA }])
    expect(first).toEqual({ created: 1, kept: 0 })
    const second = ensureJunctions(scope, [{ name: 'pkg-a', target: pkgA }])
    expect(second).toEqual({ created: 0, kept: 1 })
    expect(existsSync(join(scope, 'pkg-a'))).toBe(true)
    expect(() => ensureJunctions(scope, [{ name: 'missing', target: join(root, 'missing') }])).toThrow(/target package missing/)
  })

  it('悬空链接清理：目标删除后链接残留=pruneDangling 清掉', () => {
    const root = tmpRoot()
    const pkgB = join(root, 'pkg-b')
    mkdirSync(pkgB)
    const scope = join(root, 'node_modules', '@scope')
    ensureJunctions(scope, [{ name: 'pkg-b', target: pkgB }])
    rmSync(pkgB, { recursive: true, force: true })
    expect(existsSync(join(scope, 'pkg-b'))).toBe(false)
    expect(pruneDangling(scope)).toBe(1)
    expect(readdirSync(scope)).toEqual([])
  })
})

describe('writeShim', () => {
  it('整体重建：package.json+桥文件（相对路径正确、再跑幂等）', () => {
    const root = tmpRoot()
    const target = join(root, 'real', 'src', 'index.ts')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'export const x = 1\n')
    const shimDir = join(root, 'node_modules', '@s', 'real')
    const shim = () => writeShim(shimDir, {
      name: '@s/real', type: 'module', exports: { '.': './src/index.ts' },
    }, [{ file: 'src/index.ts', target }])
    shim()
    shim() // 复跑=整体重建幂等
    expect(JSON.parse(readFileSync(join(shimDir, 'package.json'), 'utf8'))).toMatchObject({ name: '@s/real', type: 'module' })
    const rel = relative(join(shimDir, 'src'), target).split('\\').join('/')
    const bridge = readFileSync(join(shimDir, 'src', 'index.ts'), 'utf8')
    expect(bridge).toContain(`export * from '${rel.startsWith('.') ? rel : './' + rel}'`)
  })
})
