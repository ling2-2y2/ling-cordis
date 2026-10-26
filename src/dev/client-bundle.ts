/**
 * 子应用产物构建件（2026-10-26 用户令「build 过程收归 ling-cordis」）——消费方
 * （ling-web 形态多子应用平台的各子应用包）不再手写 esbuild 包装：本件打包
 * `src/client` 源码入口为单文件 cjs 产物，并包成**子应用协议注册器**
 * （`window.__ModuleLoader__.load({id, factory})`——与 dev 态 ESM 转接 shim 同
 * 一装载面，宿主页 dev/产物两形态零改动）。
 * esbuild 是使用方的对等件（从 entry 所在包自备解析；缺席/越界 fail loud——
 * 同 hmr.ts 的 vite 契约）。react 族是否内联归消费方（external 透传）。
 * @module @ling2/ling-cordis/dev/client-bundle
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 构造项。 */
export interface ClientBundleOptions {
  /** 源码入口（.tsx/.ts/.js；esbuild 与产物 outfile 均按其所在包定位）。 */
  entry: string
  /** 产物输出路径（缺省 <entry 包>/client/client.js——子应用产物约定位）。 */
  outfile?: string
  /** 子应用协议注册 id（装载面登记名）。 */
  id: string
  /** esbuild 透传覆盖（如 external/format 细调）。 */
  esbuild?: Record<string, unknown>
  /** 产物头注释（缺省自动生成）。 */
  banner?: string
}

/** 内联 require 垫片（零外部依赖时永不触达；真外置依赖时诚实报错）。 */
const REQUIRE_SHIM = "typeof require === 'function' ? require : function (id) { throw new Error('子应用产物外置依赖未内联: ' + id); }"

/** 从文件/目录向上找最近的 package.json 所在目录（消费包根锚——esbuild 对等件界）。 */
function nearestPackageRoot(from: string): string {
  let dir = from
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = join(dir, '..')
    if (up === dir) throw new Error(`nearestPackageRoot: 从 ${from} 向上未找到 package.json`)
    dir = up
  }
}

/** 构建子应用产物（返回产物字节数）。 */
export async function buildClientBundle(options: ClientBundleOptions): Promise<number> {
  // esbuild 对等件解析：锚=入口向上最近的 package.json（消费包根；测试夹具=仓根）
  const require = createRequire(join(options.entry, 'package.json'))
  let esbuildEntry: string
  try {
    const candidate = require.resolve('esbuild')
    const pkgRoot = nearestPackageRoot(options.entry)
    const rel = relative(pkgRoot, candidate)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`foreign:${candidate}`)
    esbuildEntry = candidate
  } catch (error) {
    const hint = error instanceof Error && error.message.startsWith('foreign:')
      ? `在 ${options.entry} 所在包之外解析到外部 esbuild（${error.message.slice('foreign:'.length)}）——只认项目自备依赖`
      : `${options.entry} 所在包解析不到 esbuild（原始错误：${error instanceof Error ? error.message : String(error)}）`
    throw new Error(`esbuild 包缺席或越界（${hint}）：先在该包安装 esbuild（对等件契约，同 vite）`)
  }
  const esbuild = await import(pathToFileURL(esbuildEntry).href) as {
    build: (opts: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }>
  }

  const outfile = options.outfile ?? join(dirname(options.entry), '..', '..', 'client', 'client.js')
  const result = await esbuild.build({
    entryPoints: [options.entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    jsx: 'automatic',
    minify: true,
    charset: 'utf8',
    write: false,
    logLevel: 'warning',
    ...options.esbuild,
  })
  const code = result.outputFiles[0]?.text ?? ''
  const banner = options.banner ?? '// 子应用产物（ling-cordis buildClientBundle 生成；dev 态此文件不被消费——/packages 源码面直供）'
  const wrapped = [
    banner,
    '(function () {',
    `  var requireShim = ${REQUIRE_SHIM};`,
    '  var module = { exports: {} };',
    '  ;(function (module, exports, require) {',
    code,
    '  })(module, module.exports, requireShim);',
    `  window.__ModuleLoader__.load({ id: ${JSON.stringify(options.id)}, factory: function () { return module.exports; } });`,
    '})();',
    '',
  ].join('\n')
  mkdirSync(join(outfile, '..'), { recursive: true })
  writeFileSync(outfile, wrapped)
  // 日志报真实落盘位（防缺省路径推导变化时日志骗人——实证教训）
  console.log(`[buildClientBundle] 子应用产物已生成 ${outfile}（${Math.round(Buffer.byteLength(wrapped) / 1024)} KB）`)
  return Buffer.byteLength(wrapped)
}
