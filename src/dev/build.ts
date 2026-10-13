/**
 * 按注册表编排编译——注册表内有浏览器产物（client 键）的模块逐个跑构建脚本，
 * 外加一个特名载体目标（如整站 dist）。三种档位：全量（targets 空）/ 指名单 /
 * 载体特名（targets 命中 carrier.id 或全量末尾）；skipCarrier 供全量档跳过载体。
 *
 * 子进程 stdio 直通（看得到每包进度）；任一失败即抛 BuildFailedError 中止后续，
 * 错误携子进程退出码供调用方透传 `process.exit`。
 * @module @ling2/ling-cordis/dev/build
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { ModuleRegistry } from './registry.ts'

/** 编译编排项。 */
export interface BuildRegisteredOptions {
  /** 模块注册表（有 client 键的条目即有浏览器产物）。 */
  registry: ModuleRegistry
  /** 树根绝对路径（模块目录 = join(rootDir, id)）。 */
  rootDir: string
  /** 模块构建脚本名，缺省 'build:client'。 */
  script?: string
  /** 特名载体目标（如整站 dist；不在注册表内，独立 cwd 与脚本名）。 */
  carrier?: { id: string; cwd: string; script: string }
  /** 指名编译清单（空或缺席 = 全量）；未注册或无浏览器产物 = 抛错。 */
  targets?: string[]
  /** 全量档跳过载体（`--no-web` 等价物）。 */
  skipCarrier?: boolean
}

/** 编译失败错（携子进程退出码，调用方透传 process.exit 用）。 */
export class BuildFailedError extends Error {
  /** 失败子进程的退出码（null = 未能启动）。 */
  readonly exitCode: number | null

  constructor(target: string, exitCode: number | null) {
    super(`✗ ${target} 构建失败（exit ${String(exitCode)}）`)
    this.exitCode = exitCode
  }
}

/** 跑一条构建脚本（stdio 直通；失败即抛，后续目标中止）。 */
function runScript(target: string, cwd: string, script: string): void {
  console.log(`\n▶ ${target} ${script} …`)
  const run = spawnSync('npm', ['run', script], { cwd, stdio: 'inherit', shell: true })
  if (run.status !== 0) throw new BuildFailedError(target, run.status)
  console.log(`✓ ${target}`)
}

/** 编译编排主入口（同步执行，逐目标打印进度）。 */
export function buildRegisteredModules(options: BuildRegisteredOptions): void {
  const { registry, rootDir, script = 'build:client', carrier, targets, skipCarrier } = options

  if (targets !== undefined && targets.length > 0) {
    // 指名档：逐名编译（载体特名走载体脚本；其余须已注册且有浏览器产物）
    for (const target of targets) {
      if (carrier !== undefined && target === carrier.id) {
        runScript(carrier.id, carrier.cwd, carrier.script)
        continue
      }
      const mod = registry.find(target)
      if (mod === undefined) throw new Error(`✗ 未注册模块：${target}（不在注册表清单内；先登记条目）`)
      if (mod.client === undefined) throw new Error(`✗ ${target} 无浏览器产物（注册表无 client 键）`)
      runScript(mod.id, join(rootDir, mod.id), script)
    }
    return
  }

  // 全量档：注册表有产物的模块逐个 + 载体（skipCarrier 跳过）
  let built = 0
  for (const mod of registry.all()) {
    if (mod.client === undefined) continue
    runScript(mod.id, join(rootDir, mod.id), script)
    built += 1
  }
  if (carrier !== undefined && !skipCarrier) {
    runScript(carrier.id, carrier.cwd, carrier.script)
    built += 1
  }
  console.log(`\n✅ 编译完成（${built} 项${carrier !== undefined && !skipCarrier ? `（含载体 ${carrier.id}）` : ''}）`)
}
