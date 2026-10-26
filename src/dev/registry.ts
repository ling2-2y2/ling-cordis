/**
 * 模块注册表机制——"哪些模块、按什么相序挂载、浏览器产物键是什么"的单点骨架。
 *
 * 条目数据（业务包清单）由消费方持有，本模块只提供形状校验与派生查询：
 * 挂载循环（ofPhase）、静态通道表（clientTable）、编译编排（./build.ts）
 * 三处消费同一注册表——改一处三处同生效。
 * @module @ling2/ling-cordis/dev/registry
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '../core/index.ts'

/** 模块注册条目。 */
export interface ModuleEntry<TEnv = unknown> {
  /** 包目录名（静态通道与编译脚本的键）。 */
  id: string
  /** 挂载相名（须在构造相表内；数组登记序即挂载序）。 */
  phase: string
  /** 一句话职责（人读注释，机制不消费）。 */
  note?: string
  /** 浏览器产物：key=静态通道键；path=产物相对包目录路径，缺省 'client/client.js'；
   * entry=**源码入口**相对包目录路径（dev 态客户端源码面直供用），缺省按约定
   * 依存在探测 src/client/index.tsx → src/client/index.ts（2026-10-26 用户裁定
   * 「面板真 HMR、机制落框架」—— ling-cordis 内建，见 app.ts /packages 分派）。 */
  client?: { key: string; path?: string; entry?: string }
  /** 挂载函数（装配方在相循环内调用；env=装配方构造的挂载环境，形状自定）。 */
  mount?: (ctx: Context, env: TEnv) => void | Promise<void>
}

/** 客户端源码面约定入口探测序（tsx 优先——React 面板主流形态）。 */
const CLIENT_ENTRY_CONVENTIONS = ['src/client/index.tsx', 'src/client/index.ts']

/** 模块注册表——构造后只增条目，查询均为纯派生（无副作用）。 */
export class ModuleRegistry<TEnv = unknown> {
  private readonly phases: readonly string[]
  private readonly entries: ModuleEntry<TEnv>[] = []

  /** @param phases 有序相名表（如 ['core', 'tail']；相间夹自有装配段由装配方组合）。 */
  constructor(phases: readonly string[]) {
    this.phases = phases
  }

  /** 登记一条；phase 不在相表内或 id 重复=抛错（防手误静默漏挂）。 */
  add(entry: ModuleEntry<TEnv>): this {
    if (!this.phases.includes(entry.phase)) {
      throw new Error(`模块 ${entry.id} 的 phase '${entry.phase}' 不在相表 [${this.phases.join(', ')}] 内`)
    }
    if (this.entries.some((candidate) => candidate.id === entry.id)) {
      throw new Error(`模块 ${entry.id} 重复登记`)
    }
    this.entries.push(entry)
    return this
  }

  /** 按 id 查条目（缺席=undefined）。 */
  find(id: string): ModuleEntry<TEnv> | undefined {
    return this.entries.find((entry) => entry.id === id)
  }

  /** 取指定相的条目（登记序）。 */
  ofPhase(phase: string): ModuleEntry<TEnv>[] {
    return this.entries.filter((entry) => entry.phase === phase)
  }

  /** 全部条目（登记序；编译全量档与装配日志消费）。 */
  all(): readonly ModuleEntry<TEnv>[] {
    return [...this.entries]
  }

  /** 浏览器产物静态通道表（有 client 键的条目 → key 到 rootDir 下产物绝对路径）。 */
  clientTable(rootDir: string): Record<string, string> {
    const table: Record<string, string> = {}
    for (const entry of this.entries) {
      if (entry.client === undefined) continue
      table[entry.client.key] = join(rootDir, entry.id, entry.client.path ?? 'client/client.js')
    }
    return table
  }

  /** 客户端源码面表（dev 态 /packages 源码直供消费）：client 键 → { id, entry 绝对
   * 路径 }。entry=条目显式声明或缺省约定探测（两式皆缺席=该键无源码面，dev 态回
   * 落产物文件）。extras=静态表额外键（packagesExtras——值=产物绝对路径，按其包
   * 目录同约定探测；ling-dsh-common 这类「无挂载面但有面板产物」的包由此纳入）。 */
  clientSourceTable(rootDir: string, extras: Record<string, string> = {}): Record<string, { id: string, entry: string }> {
    const table: Record<string, { id: string, entry: string }> = {}
    const probe = (id: string, pkgDir: string, declared?: string): { id: string, entry: string } | undefined => {
      if (declared !== undefined) {
        const explicit = join(pkgDir, declared)
        if (existsSync(explicit)) return { id, entry: explicit }
        return undefined
      }
      for (const convention of CLIENT_ENTRY_CONVENTIONS) {
        const candidate = join(pkgDir, convention)
        if (existsSync(candidate)) return { id, entry: candidate }
      }
      return undefined
    }
    for (const entry of this.entries) {
      if (entry.client === undefined) continue
      const found = probe(entry.id, join(rootDir, entry.id), entry.client.entry)
      if (found !== undefined) table[entry.client.key] = found
    }
    for (const [key, file] of Object.entries(extras)) {
      if (table[key] !== undefined) continue
      // extras 值=<包>/client/*.js 产物路径——包目录=两级上翻，id=目录名
      const pkgDir = join(file, '..', '..')
      const id = pkgDir.split(/[\\/]/).pop() ?? ''
      const found = probe(id, pkgDir)
      if (found !== undefined) table[key] = found
    }
    return table
  }
}
