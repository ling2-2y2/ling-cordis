/**
 * ModuleRegistry 回归——相过滤/重复与越相拒绝/静态表派生/find。
 * @module @ling2/ling-cordis/tests/dev-registry
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModuleRegistry } from '../src/dev/index.ts'

describe('ModuleRegistry', () => {
  it('ofPhase 按登记序取相内条目；all 保序全量', () => {
    const registry = new ModuleRegistry(['core', 'tail'])
    registry.add({ id: 'a', phase: 'core' }).add({ id: 'b', phase: 'core' }).add({ id: 'c', phase: 'tail' })
    expect(registry.ofPhase('core').map((mod) => mod.id)).toEqual(['a', 'b'])
    expect(registry.ofPhase('tail').map((mod) => mod.id)).toEqual(['c'])
    expect(registry.all().map((mod) => mod.id)).toEqual(['a', 'b', 'c'])
  })

  it('add 拒绝相表外 phase 与重复 id（防手误静默漏挂）', () => {
    const registry = new ModuleRegistry(['core', 'tail'])
    registry.add({ id: 'a', phase: 'core' })
    expect(() => registry.add({ id: 'x', phase: 'mid' })).toThrow(/不在相表/)
    expect(() => registry.add({ id: 'a', phase: 'tail' })).toThrow(/重复登记/)
  })

  it('clientTable：key → rootDir 下产物路径（path 缺省 client/client.js；无 client 条目不入表）', () => {
    const registry = new ModuleRegistry(['core'])
    registry.add({ id: 'p-a', phase: 'core', client: { key: 'p-a/client.js' } })
    registry.add({ id: 'p-b', phase: 'core', client: { key: 'b.js', path: 'dist/bundle.js' } })
    registry.add({ id: 'p-c', phase: 'core' })
    expect(registry.clientTable('/tree')).toEqual({
      'p-a/client.js': join('/tree', 'p-a', 'client/client.js'),
      'b.js': join('/tree', 'p-b', 'dist/bundle.js'),
    })
  })

  it('find 命中/缺席', () => {
    const registry = new ModuleRegistry(['core'])
    registry.add({ id: 'a', phase: 'core', note: '注' })
    expect(registry.find('a')?.note).toBe('注')
    expect(registry.find('nope')).toBeUndefined()
  })
})
