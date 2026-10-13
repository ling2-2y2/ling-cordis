/**
 * 物理层接线助手族——junction 清单与 shim 桥的机制化（树根 node_modules 真包
 * 解析：tsx 对 @ 开头 scoped 说明符不套 paths，运行时唯一解析通道）。
 * 数据（junction 清单/shim 出口表）由消费方持有，本模块只做幂等落盘。
 * @module @ling2/ling-cordis/dev/link
 */
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** junction 条目：name → 目标包目录（Windows junction 形态，跨平台回落 symlink）。 */
export interface JunctionSpec {
  /** node_modules/<scope>/ 下的链接名。 */
  name: string
  /** 目标包目录绝对路径。 */
  target: string
}

/** 清理 scope 目录下悬空链接（目标已删而链接尚在——nm 卷跨代残留），返回清理数。 */
export function pruneDangling(scopeDir: string): number {
  if (!existsSync(scopeDir)) return 0
  let pruned = 0
  for (const name of readdirSync(scopeDir)) {
    const link = join(scopeDir, name)
    if (!existsSync(link)) { rmSync(link, { recursive: true, force: true }); pruned += 1 }
  }
  return pruned
}

/** 幂等落 junction 清单（已存在且指向正确=跳过；指向漂移/坏链=重建）。
 * 指向判定用 realpath 双侧归一——Windows junction 的 readlink 带 \\?\ 扩展前缀，
 * 直接字符串比对会恒不中（每轮重建的隐性缺陷即源于此）。 */
export function ensureJunctions(scopeDir: string, entries: readonly JunctionSpec[]): { created: number; kept: number } {
  mkdirSync(scopeDir, { recursive: true })
  let created = 0
  let kept = 0
  for (const { name, target } of entries) {
    if (!existsSync(target)) throw new Error(`target package missing: ${target}`)
    const link = join(scopeDir, name)
    if (existsSync(link)) {
      try {
        if (realpathSync(link) === realpathSync(target)) { kept += 1; continue }
      } catch { /* 坏链走重建 */ }
      rmSync(link, { force: true, recursive: true })
    }
    symlinkSync(target, link, 'junction')
    created += 1
  }
  return { created, kept }
}

/** shim 桥条目：合成包内一个文件，单行 re-export 指向真源。 */
export interface ShimBridge {
  /** 桥文件路径（相对 shim 目录；如 'src/index.ts'）。 */
  file: string
  /** 真源文件绝对路径。 */
  target: string
  /** 桥文件头注释（缺省「子仓桥」一句话）。 */
  header?: string
}

/** 幂等写 shim 合成包：整体重建（package.json + 桥文件族；每次重跑再生）。 */
export function writeShim(dir: string, packageJson: Record<string, unknown>, bridges: readonly ShimBridge[]): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
  for (const { file, target, header } of bridges) {
    if (!existsSync(target)) throw new Error(`target package missing: ${target}`)
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    const rel = relative(dirname(join(dir, file)), target).split('\\').join('/')
    writeFileSync(join(dir, file), `// ${header ?? '子仓桥'}：→ ${target} 真源
export * from '${rel.startsWith('.') ? rel : './' + rel}'
`)
  }
}
