/**
 * 主题 token 合规门引擎（通用件，2026-10-26 用户令「样式检查收归 ling-cordis」）——
 * 消费方（如 bsh 树 theme-guard）只出**事实**（token 事实源 css、扫描面、机制变量
 * 白名单），引擎负责扫描与判定：
 * - E1 [ERROR] 幽灵 token：var(--X) 的 X 既非事实源定义、非本文件自定义、也不在白名单。
 * - E2 [ERROR] 主题名 token 在插件 CSS 里硬编码定义（绕过宿主 overrideTokens）。
 * - E3 [WARN]  CSS 规则硬编码浅色背景（深色模式下发白）；semantic 白字/深色 rgba 豁免。
 * - strict：CSS 规则里其余硬编码色追加 WARN。
 * 路径纪律（Linux/Windows 双兼容）：全部经 node:path join/relative，跨平台展示位
 * （file 字段）一律正斜杠化；不拼盘符字面量、不走 shell。
 * @module @ling2/ling-cordis/dev/theme-gate
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 门构造项。 */
export interface ThemeGateOptions {
  /** token 事实源：css 文件或目录（目录=全部 .css 并读并集）。 */
  tokenSheets: readonly string[]
  /** token 名收集正则族（缺省 --dsw-/--ds-/--dsh-/--shiki- 四前缀）。 */
  tokenPrefixes?: readonly `--${string}-`[]
  /** 待扫描的经典脚本 bundle 清单（CSS 规则=行首引号字符串字面量且含花括号约定）。 */
  bundles: readonly string[]
  /** 路径展示锚（file 字段相对它；缺省 process.cwd()）。 */
  rootDir?: string
  /** 机制变量白名单（整名豁免——组件库/镜像件运行时自设自用，非主题色来源）。 */
  allowedVars?: readonly string[]
  /** 机制变量前缀白名单（整族豁免）。 */
  allowedPrefixes?: readonly string[]
  /** E2 豁免（上游镜像 CSS 本地定义登记——镜像禁改纪律）。 */
  allowedDswDefines?: readonly string[]
  /** bundle 级 E3 停报的 file 前缀（源码层另有严扫时防双计）。 */
  skipBundleE3Prefixes?: readonly string[]
  /** 额外严扫：CSS 规则里其余硬编码色 → WARN。 */
  strict?: boolean
}

/** 判定结果条目。 */
export interface ThemeGateFinding {
  level: 'error' | 'warn'
  code: 'E1-ghost-token' | 'E2-theme-define' | 'E3-light-bg' | 'strict-hardcoded-color'
  /** 相对 rootDir 的正斜杠路径（跨平台展示位）。 */
  file: string
  line: number
  message: string
}

/** 门结果。 */
export interface ThemeGateResult {
  ok: boolean
  errors: ThemeGateFinding[]
  warnings: ThemeGateFinding[]
  tokenCount: number
  scanned: number
}

const DEFAULT_TOKEN_PREFIXES = ['--dsw-', '--ds-', '--dsh-', '--shiki-'] as const

const RE = {
  lightBg: /(background|background-color)\s*:\s*(#fff\b|#ffffff|#fafafa|#f5f5f5|#f0f0f0|#f[4-9a-f][0-9a-f]{4}\b|white)\b/i,
  varUse: /var\(/i,
  whiteTxt: /(^|[^-])color\s*:\s*(#fff\b|#ffffff|white)\b/i,
  semantic: /#(2f6b3a|7db98a|22c55e|16a34a|67c23a|52c41a|2e7d32|ef4444|dc2626|f56c6c|f43f5e|c0392b|e74c3c|b91c1c|f59e0b|e6a23c|faad14|fbbf24|b45309|3b82f6|60a5fa|409eff|1677ff|1890ff|8b5cf6|a855f7|6366f1|0ea5e9|f97316|64748b)\b/i,
  dswDefine: /(--dsw-[a-z0-9-]+)\s*:/i,
  localDefine: /['"]?(--[a-z][a-z0-9-]+)['"]?\s*:/g,
  hex: /#[0-9a-f]{3,8}\b/gi,
}

/** 经典脚本约定：CSS 规则=行首引号的字符串字面量且含花括号。 */
const isCssRule = (line: string): boolean => /^\s*['"`].*\{.*\}/.test(line)

/** rgba 三分量均 ≤31 视为深色遮罩/阴影（允许硬编码）。 */
function isDarkRgba(line: string): boolean {
  for (const m of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    if (Number(m[1]) > 31 || Number(m[2]) > 31 || Number(m[3]) > 31) return false
  }
  return true
}

/**
 * 剥离注释（块注释跨行 + 行注释），保留行号，返回当行代码片段——引擎与
 * 消费方自持的源码层严扫共用（消费方经此导出复用，勿各抄一份）。
 */
export function stripCommentsLine(line: string, state: { inBlock: boolean }): string {
  let code = ''
  let j = 0
  while (j < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', j)
      if (end === -1) { j = line.length } else { state.inBlock = false; j = end + 2 }
    } else {
      const blk = line.indexOf('/*', j)
      const ln = line.indexOf('//', j)
      let cut = -1
      let type: 'blk' | 'ln' | null = null
      if (blk !== -1 && (cut === -1 || blk < cut)) { cut = blk; type = 'blk' }
      if (ln !== -1 && (cut === -1 || ln < cut)) { cut = ln; type = 'ln' }
      if (cut === -1) { code += line.slice(j); j = line.length } else {
        code += line.slice(j, cut)
        if (type === 'blk') { state.inBlock = true; j = cut + 2 } else { j = line.length }
      }
    }
  }
  return code
}

/** css 文件或目录→文件清单（目录=全部 .css，递归一层目录内直读）。 */
function cssFilesOf(sheets: readonly string[]): string[] {
  const files: string[] = []
  for (const sheet of sheets) {
    if (!existsSync(sheet)) continue
    if (statSync(sheet).isFile()) { files.push(sheet); continue }
    for (const name of readdirSync(sheet)) {
      if (name.endsWith('.css')) files.push(join(sheet, name))
    }
  }
  return files
}

/** 事实源并集收集 token 名（按前缀族）。 */
export function collectThemeTokens(sheets: readonly string[], prefixes: readonly string[] = DEFAULT_TOKEN_PREFIXES): Set<string> {
  const tokens = new Set<string>()
  const pattern = new RegExp(`^\\s*(${prefixes.map((p) => `${p}[a-z0-9-]+`).join('|')})\\s*:`, 'gm')
  for (const file of cssFilesOf(sheets)) {
    for (const m of readFileSync(file, 'utf8').matchAll(pattern)) tokens.add(m[1]!)
  }
  return tokens
}

/** 门主入口：纯函数式扫描（不打印不退码——报告/退出语义归消费方组合）。 */
export function themeGate(options: ThemeGateOptions): ThemeGateResult {
  const root = options.rootDir ?? process.cwd()
  const prefixes = options.tokenPrefixes ?? DEFAULT_TOKEN_PREFIXES
  const tokens = collectThemeTokens(options.tokenSheets, prefixes)
  const allowedVars = new Set(options.allowedVars ?? [])
  const allowedPrefixes = options.allowedPrefixes ?? []
  const allowedDswDefines = new Set(options.allowedDswDefines ?? [])
  const skipE3 = options.skipBundleE3Prefixes ?? []

  const errors: ThemeGateFinding[] = []
  const warnings: ThemeGateFinding[] = []
  let scanned = 0

  for (const bundle of options.bundles) {
    if (!existsSync(bundle)) continue
    scanned += 1
    const rel = relative(root, bundle).replaceAll('\\', '/')
    const lines = readFileSync(bundle, 'utf8').split(/\r?\n/)
    const cstate = { inBlock: false }

    // 先全文件收集本文件自定义 custom props（主题名 --dsw-* 只认事实源）
    const locals = new Set<string>()
    for (const raw of lines) {
      for (const m of stripCommentsLine(raw, { inBlock: false }).matchAll(RE.localDefine)) {
        if (!m[1]!.startsWith('--dsw-')) locals.add(m[1]!)
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = stripCommentsLine(lines[i]!, cstate)
      const n = i + 1
      if (!line.trim()) continue

      // E1 幽灵 token
      for (const m of line.matchAll(/var\((--[a-z][a-z0-9-]+)/g)) {
        const name = m[1]!
        if (tokens.has(name) || locals.has(name) || allowedVars.has(name)) continue
        if (allowedPrefixes.some((prefix) => name.startsWith(prefix))) continue
        errors.push({
          level: 'error', code: 'E1-ghost-token', file: rel, line: n,
          message: `var(${name}) 既非事实源 token 也非本文件自定义——永远走 fallback 浅色，深色模式失效`,
        })
      }

      if (!isCssRule(line)) continue

      // E2 主题名 token 硬编码定义
      const dsw = line.match(RE.dswDefine)
      if (dsw !== null && !allowedDswDefines.has(dsw[1]!)) {
        errors.push({
          level: 'error', code: 'E2-theme-define', file: rel, line: n,
          message: `"${dsw[1]}" 在插件 CSS 里定义——应走宿主 theme.overrideTokens`,
        })
      }

      // E3 浅色背景硬编码（skip 前缀=源码层另有严扫，防双计）
      if (RE.lightBg.test(line) && !RE.varUse.test(line) && !skipE3.some((prefix) => rel.startsWith(prefix))) {
        warnings.push({
          level: 'warn', code: 'E3-light-bg', file: rel, line: n,
          message: '硬编码浅色背景，深色模式下会发白——改主题 token',
        })
      }

      if (options.strict === true) {
        const hexes = line.match(RE.hex)
        if (hexes !== null && !RE.varUse.test(line) && !RE.semantic.test(line) && !RE.whiteTxt.test(line) && !isDarkRgba(line)) {
          warnings.push({
            level: 'warn', code: 'strict-hardcoded-color', file: rel, line: n,
            message: `硬编码 ${hexes.join(',')} 建议改主题 token`,
          })
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, tokenCount: tokens.size, scanned }
}

/** 结果打印（消费方直接复用的报告形态；额外错误可经 extraErrors 并入——如源码层严扫产物）。 */
export function printThemeGateResult(
  result: ThemeGateResult,
  extraErrors: readonly string[] = [],
  logger: (line: string) => void = console.log,
): void {
  logger(`主题 token ${result.tokenCount} 个（事实源并集）| 扫描 ${result.scanned} 个 bundle`)
  if (result.warnings.length > 0) {
    logger(`\n⚠ WARN (${result.warnings.length}) 需人工确认:`)
    for (const w of result.warnings.slice(0, 50)) logger(`  ${w.file}:${w.line} [${w.code}] ${w.message}`)
    if (result.warnings.length > 50) logger(`  ...还有 ${result.warnings.length - 50} 条`)
  }
  const totalErrors = result.errors.length + extraErrors.length
  if (totalErrors > 0) {
    logger(`\n✗ ERROR (${totalErrors}) 阻断提交:`)
    for (const e of result.errors) logger(`  ${e.file}:${e.line} [${e.code}] ${e.message}`)
    for (const e of extraErrors) logger(`  ${e}`)
  } else {
    logger(`\n✓ 主题合规通过（${result.warnings.length} 条 WARN 待确认）`)
  }
}
