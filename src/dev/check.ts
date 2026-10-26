/**
 * 检查编排（2026-10-26 用户令「类型检查收归 ling-cordis 简化项目配置」）——
 * 与 build.ts 同族的子进程编排：逐目标在各自目录跑 `npm run <script>`（缺省
 * 'check'，消费方惯例如 `tsc --noEmit`），失败聚合不中断（与 build 的「任一
 * 失败即抛」不同——检查要的是全景报告）。
 * 路径纪律（Linux/Windows 双兼容）：cwd 用 node:path 绝对路径；spawn 恒走
 * shell（npm 在 Windows 是 .cmd）；不拼盘符字面量。
 * @module @ling2/ling-cordis/dev/check
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { ModuleRegistry } from './registry.ts'

/** 检查目标（一个目标=一个目录里的一条 npm script）。 */
export interface CheckTarget {
  /** 目标名（报告位；registry 消费形态=模块 id）。 */
  id: string
  /** 目标目录（npm run 的 cwd）。 */
  cwd: string
  /** 脚本名，缺省 'check'。 */
  script?: string
}

/** 检查编排项。 */
export interface RunCheckOptions {
  /** 目标清单（或经 registry 派生——见 checkRegisteredModules）。 */
  targets: readonly CheckTarget[]
}

/** 检查结果。 */
export interface CheckReport {
  /** 全过=true。 */
  ok: boolean
  /** 通过的目标名。 */
  passed: readonly string[]
  /** 失败目标（携子进程退出码；null=未能启动）。 */
  failed: readonly { id: string, exitCode: number | null }[]
}

/** 跑一条检查脚本（stdio 直通；失败记录不抛——检查要全景）。 */
function runOne(target: CheckTarget): { id: string, exitCode: number | null } | null {
  const script = target.script ?? 'check'
  console.log(`\n▶ ${target.id} ${script} …`)
  const run = spawnSync('npm', ['run', script], { cwd: target.cwd, stdio: 'inherit', shell: true })
  if (run.status === 0) return null
  return { id: target.id, exitCode: run.status }
}

/** 检查编排主入口：逐目标跑、聚合报告（不抛错——判 ok 与退出码归调用方）。 */
export function runCheckScripts(options: RunCheckOptions): CheckReport {
  const passed: string[] = []
  const failed: { id: string, exitCode: number | null }[] = []
  for (const target of options.targets) {
    const failure = runOne(target)
    if (failure === null) { passed.push(target.id); console.log(`✓ ${target.id}`) } else failed.push(failure)
  }
  console.log(`\n检查收束：${passed.length} 过 / ${failed.length} 败`)
  return { ok: failed.length === 0, passed, failed }
}

/** 注册表驱动检查：全部登记模块在其包目录（join(rootDir, id)）跑 check 脚本
 *  （TEnv 泛型透传——具化注册表直传，同 build.ts strict 不变型修正）。 */
export function checkRegisteredModules<TEnv>(options: { registry: ModuleRegistry<TEnv>, rootDir: string, script?: string }): CheckReport {
  const targets: CheckTarget[] = options.registry.all()
    .map((entry) => ({ id: entry.id, cwd: join(options.rootDir, entry.id), script: options.script }))
  return runCheckScripts({ targets })
}
