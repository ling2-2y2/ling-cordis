/**
 * 服务端产物树构建引擎（批① 2026-10-28：吸收自 bsh 树 build-host.mjs 机制——
 * 「引擎归框架、事实归消费方」）。五步：
 *   1. tsc 整树镜像转译（调用方持 tsconfig；rewriteRelativeImportExtensions 由
 *      tsconfig 承担；类型诊断不阻断产物——门禁归各包 typecheck）；
 *   2. 运行时资产镜像（src 下非 TS 文件；顶层 client 半区跳过——浏览器产物归
 *      buildRegisteredModules）+包根补充目录镜像；
 *   3. 包元数据镜像（package.json 原样+client/node_modules junction——本地档；
 *      镜像形态由消费链原位 install 替换，junction 清单落 product-manifest.json）；
 *   4. 跨包裸名说明符反写（tsconfig paths 单源派生→产物树内相对路径；产物自
 *      包含铁律：残留裸名仅许 npm 包与 node 内建）；
 *   5. 入口语法验查（逐包 src/index.js 过 node --check，缺入口/失败=fails loud）。
 * 产物态零源码铁律（2026-10-27 用户裁定升格框架规范）：产物形态运行禁 tsx、
 * 禁源码消费——源码泄露不可接受。
 * @module @ling2/ling-coris/dev/product-build
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// ══════════════════ 反写映射推导（paths→exact/通配表）════════════════════════

/** 通配键条目：键 '@scope/pkg/*' 拆 prefix（含尾斜杠）/目标 head（含尾斜杠）/tail（如 '.ts'）。 */
export interface RewritePrefix {
  prefix: string
  head: string
  tail: string
}

/** 反写映射：exact 全表（显式键无通配）+通配前缀表（前缀长度降序=最具体优先）。 */
export interface RewriteMap {
  exact: Map<string, string>
  prefixes: RewritePrefix[]
}

/** 从 tsconfig paths 派生反写映射——scopePrefixes 外的键（如 @types/*）不参与反写。 */
export function deriveRewriteMap(
  paths: Record<string, readonly string[]>,
  options: { rootDir: string, scopePrefixes: readonly string[] },
): RewriteMap {
  const exact = new Map<string, string>()
  const prefixes: RewritePrefix[] = []
  for (const [key, targets] of Object.entries(paths)) {
    if (typeof targets?.[0] !== 'string') continue
    if (!options.scopePrefixes.some((scope) => key.startsWith(scope))) continue
    const target = resolve(options.rootDir, targets[0])
    if (key.endsWith('*')) {
      prefixes.push({
        prefix: key.slice(0, key.indexOf('*')),
        head: target.slice(0, target.indexOf('*')),
        tail: target.slice(target.indexOf('*') + 1),
      })
    } else {
      exact.set(key, target)
    }
  }
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length)
  return { exact, prefixes }
}

/** 说明符→绝对源路径（正斜杠归一）。exact 全表优先；通配命中做两类双拼塌缩归一
 * （①说明符自带 .ts 尾+表尾 '.ts'→.ts.ts；②自带 src/ 段+表头 '…/src/'→src/src/）
 * ——缺归一则产物目标误判缺席、裸名残留（bsh 树产物化批 3 .mjs 扩扫实证）。 */
export function resolveSpecifierToProduct(spec: string, map: RewriteMap): string | null {
  const exactHit = map.exact.get(spec)
  if (exactHit !== undefined) return exactHit.replaceAll('\\', '/')
  for (const p of map.prefixes) {
    if (!spec.startsWith(p.prefix)) continue
    let absSrc = p.head + spec.slice(p.prefix.length) + p.tail
    absSrc = absSrc.replaceAll('\\', '/').replace(/\.ts\.ts$/, '.ts').replace(/\/src\/src\//, '/src/')
    return absSrc
  }
  return null
}

// ══════════════════ 产物树文件收集（skip=仅顶层目录名语义）════════════════════

/** 递归收集 dir 下全部文件。skip 集合只作用于 base 顶层目录名（如 src/client
 * 浏览器半区跳过），深层同名子树保留（如 src/im/client 是运行时依赖——按目录名
 * 全深匹配会误伤，bsh 树 im 批实证）。 */
export function* walkProductFiles(dir: string, skip: ReadonlySet<string>, base = dir): Generator<string> {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(base, full)
    if (skip.has(entry.name) && rel === entry.name) continue
    if (entry.isDirectory()) yield* walkProductFiles(full, skip, base)
    else if (entry.isFile()) yield full
  }
}

// ══════════════════ 产物树反写执行（.js/.mjs 扫描→相对说明符）════════════════

/** 反写执行结果。warnings=目标缺席保原样的登记（fail 语义归调用方裁定）。 */
export interface RewriteResult {
  rewritten: number
  touched: number
  warnings: string[]
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 产物树内裸名说明符反写为镜像树相对路径。扫描面=.js+.mjs（直载件同样经资产
 * 镜像进产物树，其裸名引用不反写=裸 node 加载落 node_modules TS 源必炸）；
 * 目标缺席（指 tests/ 或 external 误中）保原样并登记警告。 */
export function rewriteAliasSpecifiers(options: {
  scanDir: string
  rootDir: string
  outDir: string
  map: RewriteMap
}): RewriteResult {
  const { scanDir, rootDir, outDir, map } = options
  // 匹配式从映射表动态派生（键族归数据）：备选源最长的先试，避免短前缀截断长说明符
  const alternation = [...map.exact.keys(), ...map.prefixes.map((p) => p.prefix)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')
  if (alternation === '') return { rewritten: 0, touched: 0, warnings: [] }
  // 备选族须自包非捕获组再接量词——量词直接跟 alternation 只作用于末分支
  // （`A|B[^'"]*`=A|(B[^'"]*)，长说明符漏配实证）
  const aliasRe = new RegExp(`((?:from|import)\\s*\\(?\\s*)['"]((?:${alternation})[^'"]*)['"]`, 'g')
  const prefilter = [...map.exact.keys(), ...map.prefixes.map((p) => p.prefix)]
  let rewritten = 0
  let touched = 0
  const warnings: string[] = []
  for (const file of walkProductFiles(scanDir, new Set(['node_modules']))) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue
    const text = readFileSync(file, 'utf8')
    if (!prefilter.some((stem) => text.includes(stem))) continue
    let warned = false
    const out = text.replace(aliasRe, (whole: string, lead: string, spec: string) => {
      const absSrc = resolveSpecifierToProduct(spec, map)
      if (absSrc === null) return whole
      const distTarget = join(outDir, relative(rootDir, absSrc)).replace(/\.ts$/, '.js')
      if (!existsSync(distTarget)) {
        if (!warned) { warnings.push(`dist target missing, kept as-is: ${spec} (${file})`); warned = true }
        return whole
      }
      const rel = relative(dirname(file), distTarget).replaceAll('\\', '/')
      rewritten += 1
      return `${lead}'${rel.startsWith('.') ? rel : './' + rel}'`
    })
    if (out !== text) { writeFileSync(file, out, 'utf8'); touched += 1 }
  }
  return { rewritten, touched, warnings }
}

// ══════════════════ 产物清单（镜像链消费单源）════════════════════════════════

/** 产物清单 junction 条目——镜像形态由消费链原位 install 替换（本地档 junction
 * 指回源树；镜像档按此清单替换，源码零携带）。 */
export interface ProductManifestJunction {
  kind: 'client' | 'node_modules'
  pkg: string
  target: string
}

/** 产物清单：包清单+入口清单+junction 清单三段（formatVersion 钉 1）。 */
export interface ProductManifest {
  formatVersion: 1
  generator: string
  packages: string[]
  entries: string[]
  junctions: ProductManifestJunction[]
}

/** 落盘 product-manifest.json，返回清单路径。 */
export function writeProductManifest(outDir: string, manifest: ProductManifest): string {
  mkdirSync(outDir, { recursive: true })
  const manifestPath = join(outDir, 'product-manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifestPath
}

// ══════════════════ 构建编排主入口 ═══════════════════════════════════════════

/** 构建编排项——机制归框架、事实归消费方（包清单/tsconfig/paths/scope 全由调用方持）。 */
export interface ProductBuildOptions {
  /** 树根（tsc cwd 与反写 rootDir）。 */
  rootDir: string
  /** 业务包目录名清单（资产/元数据镜像面+入口验查面）。 */
  packages: readonly string[]
  /** 转译配置（相对 rootDir；须含 rewriteRelativeImportExtensions=true）。 */
  tsconfig: string
  /** 产物树输出位（如树配 '.host-dist'）。 */
  outDir: string
  /** 反写映射事实源（tsconfig paths——读法归调用方，框架不读盘外配置）。 */
  rewritePaths: Record<string, readonly string[]>
  /** 反写 scope 前缀（如 ['@ling/ling-', '@ling2/ling-rdb']）。 */
  scopePrefixes: readonly string[]
  /** 包根补充镜像表（运行时按包根相对路径读的非 src 资源）。 */
  extraRootDirs?: Readonly<Record<string, readonly string[]>>
  /** 退役期兼容目录前缀（镜像发现面并入，如 'dsh-'）。 */
  legacyPkgPrefixes?: readonly string[]
  /** 全量重建（先清空 outDir）。 */
  clean?: boolean
  /** tsc.js 位（缺省 <rootDir>/node_modules/typescript/lib/tsc.js）。 */
  tscJs?: string
}

/** 构建结果（对拍口径：assets/rewritten/touched/entries 四数）。 */
export interface ProductBuildResult {
  assets: number
  rewritten: number
  touched: number
  entries: number
  diagnostics: number
  warnings: string[]
  manifestPath: string
}

/** 服务端产物树构建编排：转译→资产/元数据镜像→反写→入口验查→清单落盘。
 * 入口缺失/语法失败抛错（fails loud）；tsc 类型诊断不阻断（门禁归 typecheck）。 */
export function buildProductTree(options: ProductBuildOptions): ProductBuildResult {
  const { rootDir, packages, tsconfig, outDir, rewritePaths, scopePrefixes } = options
  const legacy = options.legacyPkgPrefixes ?? []
  const tscJs = options.tscJs ?? resolve(rootDir, 'node_modules', 'typescript', 'lib', 'tsc.js')
  if (options.clean && existsSync(outDir)) {
    rmSync(outDir, { recursive: true })
    console.log('[product-build] cleaned outDir')
  }
  mkdirSync(outDir, { recursive: true })

  // ── 1. tsc 整树镜像转译 ──
  console.log('[product-build] tsc mirror transpile ...')
  // maxBuffer 默认 1MB——全树转译诊断输出超限即 spawnSync ENOBUFS（容器首建实证）
  const tsc = spawnSync(process.execPath, [tscJs, '-p', tsconfig], { cwd: rootDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (tsc.error) throw tsc.error
  const diagnostics = (tsc.stdout.match(/error TS/g) ?? []).length
  if (diagnostics > 0) console.warn(`[product-build] tsc reported ${diagnostics} diagnostics (emitted anyway; gates live in per-package typecheck)`)

  // ── 2+3. 资产镜像+包元数据镜像（junction 清单随行） ──
  const mirrorTarget = (srcBase: string, destBase: string, skip: ReadonlySet<string>): number => {
    let count = 0
    for (const file of walkProductFiles(srcBase, skip)) {
      const dest = join(destBase, file.slice(srcBase.length + 1))
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(file, dest)
      count += 1
    }
    return count
  }
  let assets = 0
  const junctions: ProductManifestJunction[] = []
  const mirrored: string[] = []
  for (const name of readdirSync(rootDir)) {
    if (!packages.includes(name) && !legacy.some((p) => name.startsWith(p))) continue
    const pkg = join(rootDir, name)
    if (!statSync(pkg).isDirectory()) continue
    mirrored.push(name)
    // src 下非 TS 资产镜像（顶层 client 浏览器半区跳过）
    assets += mirrorTarget(join(pkg, 'src'), join(outDir, name, 'src'), new Set(['client']))
    // 包根补充目录镜像
    for (const extra of options.extraRootDirs?.[name] ?? []) {
      assets += mirrorTarget(join(pkg, extra), join(outDir, name, extra), new Set(['node_modules']))
    }
    // 包元数据镜像：package.json 原样+client/node_modules junction（本地档）
    const pkgJson = join(pkg, 'package.json')
    if (existsSync(pkgJson)) {
      mkdirSync(join(outDir, name), { recursive: true })
      cpSync(pkgJson, join(outDir, name, 'package.json'))
      for (const [kind, dirName] of [['client', 'client'], ['node_modules', 'node_modules']] as const) {
        const real = join(pkg, dirName)
        if (!existsSync(real)) continue
        const link = join(outDir, name, dirName)
        rmSync(link, { force: true, recursive: true })
        symlinkSync(resolve(real), link, 'junction')
        junctions.push({ kind, pkg: name, target: relative(rootDir, real).replaceAll('\\', '/') })
      }
    }
  }
  console.log(`[product-build] mirrored ${assets} runtime asset files`)

  // ── 4. 跨包裸名反写 ──
  const map = deriveRewriteMap(rewritePaths, { rootDir, scopePrefixes })
  const rewrite = rewriteAliasSpecifiers({ scanDir: outDir, rootDir, outDir, map })
  console.log(`[product-build] alias specifiers rewritten: ${rewrite.rewritten} in ${rewrite.touched} files`)
  for (const warning of rewrite.warnings) console.warn(`[product-build] alias rewrite: ${warning}`)

  // ── 5. 入口语法验查（fails loud） ──
  const entries: string[] = []
  for (const name of mirrored) {
    const entry = join(outDir, name, 'src', 'index.js')
    if (!existsSync(entry)) continue
    const check = spawnSync(process.execPath, ['--check', entry], { encoding: 'utf8' })
    if (check.error) throw check.error
    if (check.status !== 0) throw new Error(`[product-build] entry syntax check FAILED: ${entry}\n${check.stderr}`)
    entries.push(`${name}/src/index.js`)
  }
  console.log(`[product-build] ${entries.length} entries passed node --check`)

  const manifestPath = writeProductManifest(outDir, {
    formatVersion: 1,
    generator: '@ling2/ling-coris/dev buildProductTree',
    packages: mirrored.sort(),
    entries,
    junctions,
  })
  console.log('[product-build] done')
  return { assets, rewritten: rewrite.rewritten, touched: rewrite.touched, entries: entries.length, diagnostics, warnings: rewrite.warnings, manifestPath }
}
