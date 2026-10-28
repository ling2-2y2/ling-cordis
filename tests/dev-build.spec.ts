/**
 * 编译编排回归——全量/指名/载体特名/skipCarrier/未注册与无产物报错/失败退出码透传。
 * 用临时目录假包（package.json 携构建脚本）实跑 npm run；成功脚本 node -v、
 * 失败脚本 node -e "process.exit(3)"（跨 shell 确定性退出码）。
 * @module @ling2/ling-coris/tests/dev-build
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRegisteredModules, BuildFailedError, ModuleRegistry } from '../src/dev/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 造一个带构建脚本的假包目录（scriptName 默认 build:client）。 */
function fakePkg(root: string, id: string, script: string, scriptName = 'build:client'): string {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: id, private: true, scripts: { [scriptName]: script },
  }))
  return dir
}

function sampleRegistry(): { registry: ModuleRegistry; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ling-coris-build-'))
  roots.push(root)
  fakePkg(root, 'm-a', 'node -v')
  fakePkg(root, 'm-b', 'node -v')
  fakePkg(root, 'm-c', 'node -v')
  const registry = new ModuleRegistry(['core'])
  registry.add({ id: 'm-a', phase: 'core', client: { key: 'm-a/client.js' } })
  registry.add({ id: 'm-b', phase: 'core' })
  registry.add({ id: 'm-c', phase: 'core', client: { key: 'm-c/client.js' } })
  return { registry, root }
}

describe('buildRegisteredModules', () => {
  it('全量档：有 client 的模块全编 + 载体（无 client 跳过）', () => {
    const { registry, root } = sampleRegistry()
    const webDir = fakePkg(root, 'web', 'node -v', 'build')
    expect(() => buildRegisteredModules({
      registry, rootDir: root, carrier: { id: 'web', cwd: webDir, script: 'build' },
    })).not.toThrow()
  })

  it('skipCarrier：全量档跳过载体（载体脚本若被执行会以 exit 5 失败——不抛即证跳过）', () => {
    const { registry, root } = sampleRegistry()
    const webDir = fakePkg(root, 'web', 'node -e "process.exit(5)"', 'build')
    expect(() => buildRegisteredModules({
      registry, rootDir: root, skipCarrier: true,
      carrier: { id: 'web', cwd: webDir, script: 'build' },
    })).not.toThrow()
  })

  it('指名档：只编指定模块；载体特名走载体脚本', () => {
    const { registry, root } = sampleRegistry()
    const webDir = fakePkg(root, 'web', 'node -v', 'build')
    expect(() => buildRegisteredModules({
      registry, rootDir: root, targets: ['m-c', 'web'],
      carrier: { id: 'web', cwd: webDir, script: 'build' },
    })).not.toThrow()
  })

  it('指名未注册模块=抛错指路注册表', () => {
    const { registry, root } = sampleRegistry()
    expect(() => buildRegisteredModules({ registry, rootDir: root, targets: ['nope'] }))
      .toThrow(/未注册模块：nope/)
  })

  it('指名无浏览器产物的模块=抛错', () => {
    const { registry, root } = sampleRegistry()
    expect(() => buildRegisteredModules({ registry, rootDir: root, targets: ['m-b'] }))
      .toThrow(/无浏览器产物/)
  })

  it('构建失败=BuildFailedError 且子进程退出码透传（后续目标中止）', () => {
    const { registry, root } = sampleRegistry()
    fakePkg(root, 'm-f', 'node -e "process.exit(3)"')
    registry.add({ id: 'm-f', phase: 'core', client: { key: 'm-f/client.js' } })
    try {
      buildRegisteredModules({ registry, rootDir: root, targets: ['m-f'] })
      expect.unreachable('失败脚本必须抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(BuildFailedError)
      expect((error as BuildFailedError).exitCode).toBe(3)
    }
  })
})
