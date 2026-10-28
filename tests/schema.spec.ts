/**
 * schemastery 回归——构建器校验、默认值、错误面、volatile 机制往返。
 * @module @ling2/ling-coris/tests/schema
 */
import { describe, expect, it } from 'vitest'
import { schemastery as z } from '../src/index.ts'
import { createVolatile, isVolatile, volatileEntries } from '../src/kit/index.ts'

/** 校验直连（schemastery 校验为同步；标准接口返回联合形态，此处收窄断言用）。 */
const validate = (schema: any, input: unknown) =>
  schema['~standard'].validate(input) as { issues?: any[]; value?: any }

describe('schemastery', () => {
  it('object 校验：字段类型不符报 issues', () => {
    const schema = z.object({ port: z.number() })
    const result = validate(schema, { port: 'x' })
    expect(result.issues).toBeTruthy()
    expect(result.issues!.length).toBeGreaterThan(0)
  })

  it('default() 默认值在缺省时回填', () => {
    const schema = z.object({ port: z.number().default(3000) })
    expect(validate(schema, {}).value).toEqual({ port: 3000 })
  })

  it('required() 强制必填', () => {
    const schema = z.object({ name: z.string().required() })
    expect(validate(schema, {}).issues).toBeTruthy()
  })

  it('校验 issues 携带字段路径前缀（ValidationError 私有类，仅经错误面抛出）', () => {
    const schema = z.object({ nested: z.object({ name: z.string().required() }) })
    const result = validate(schema, { nested: {} })
    expect(result.issues).toBeTruthy()
    const paths = result.issues!.map((issue: any) => issue.path?.join('.')).filter(Boolean)
    expect(paths.some((p: string) => p.includes('nested'))).toBe(true)
  })

  it('toString() 以 TS 类型形态呈现 schema', () => {
    expect(z.object({ a: z.string() }).toString()).toContain('a?')
    expect(z.string().toString()).toContain('string')
  })
})

describe('volatile 稳定引用配置机制', () => {
  it('createVolatile 冻结快照，get() 稳定返回同一引用', () => {
    const source = { list: [1, 2, 3] }
    const vol = createVolatile(source)
    expect(isVolatile(vol)).toBe(true)
    const snapshot1 = vol.get()
    const snapshot2 = vol.get()
    expect(snapshot1).toBe(snapshot2)
    expect(snapshot1).not.toBe(source)
    expect(Object.isFrozen(snapshot1)).toBe(true)
  })

  it('volatileEntries 沿容器对象路径收集引用', () => {
    const vol = createVolatile({ a: 1, b: 2 })
    const entries = volatileEntries({ v: vol, plain: 3 })
    expect(entries).toEqual([{ path: ['v'], ref: vol }])
  })

  it('非 volatile 普通对象 isVolatile 为假', () => {
    expect(isVolatile({})).toBe(false)
    expect(isVolatile(null)).toBe(false)
  })
})
