/**
 * hmr-react 例程入口——dev/产物两形态一个入口（形态开关见 ling.config.mjs）。
 * **包内自持命令**（先 `pnpm install --ignore-workspace`）：
 *   pnpm dev            # dev 常驻：http://127.0.0.1:8391/app/ 改 DemoView.tsx 看热更
 *   pnpm dev --check    # dev 自检 5 项（healthz·vite-embedded/装载器路由/自动装载路由/源码面 shim/宿主页）
 *   pnpm build          # 编译产物（子应用 client/client.js+壳 dist/——见 build.mjs）
 *   pnpm start          # 产物形态常驻（吃 build 产物，无 vite）；自检加 --check
 * @module @ling2/ling-cordis/examples/hmr-react/boot
 */
import { runDevApp } from '../../src/dev/index.ts'
import config, { product } from './ling.config.mjs'

const app = await runDevApp(config)

if (process.argv.includes('--check')) {
  const base = `http://127.0.0.1:${config.port}`
  const healthz = await fetch(`${base}/healthz`).then((r) => r.json())
  const boot = await fetch(`${base}/__ling/boot.js`)
  const main = await fetch(`${base}/__ling/main.js`)
  const subapp = await fetch(`${base}/packages/demo`).then((r) => r.text())
  const page = await fetch(`${base}/app/`).then((r) => r.text())
  const mainJs = await main.text()
  const checks = product
    ? [
      ['healthz ok（产物形态无 vite 内嵌位）', healthz.ok === true && healthz.hmr === undefined],
      ['框架装载器路由 /__ling/boot.js 下发（含 lingLoadSubapps）', boot.status === 200 && (await boot.text()).includes('lingLoadSubapps')],
      ['子应用自动装载路由 /__ling/main.js（键序=ling.config.mjs 模块清单）', main.status === 200 && mainJs.includes('window.lingLoadSubapps(["demo"])')],
      ['产物通道：/packages/demo = 子应用协议注册器（装载面+子应用内容）', subapp.includes('window.__ModuleLoader__.load') && subapp.includes('计数')],
      ['宿主页静态下发（装载计数锚+main.js 一行接线，壳文件已退役）', page.includes('__bootCount') && page.includes('__ling/main.js') && !page.includes('/src/shell.ts')],
    ]
    : [
      ['healthz 带 hmr:vite-embedded（vite 已内嵌同进程单端口）', healthz.ok === true && healthz.hmr === 'vite-embedded'],
      ['框架装载器路由 /__ling/boot.js 下发（含 lingLoadSubapps）', boot.status === 200 && (await boot.text()).includes('lingLoadSubapps')],
      ['子应用自动装载路由 /__ling/main.js（键序=ling.config.mjs 模块清单）', main.status === 200 && mainJs.includes('window.lingLoadSubapps(["demo"])')],
      ['源码面 shim：/packages/demo → /app/@fs 源码直拉 + 装载器注册', subapp.includes('/app/@fs/') && subapp.includes('window.__ModuleLoader__.load')],
      ['宿主页下发（装载计数锚+main.js 一行接线，壳文件已退役）', page.includes('__bootCount') && page.includes('__ling/main.js') && !page.includes('/src/shell.ts')],
    ]
  let failed = 0
  for (const [name, pass] of checks) {
    console.log(`[hmr-demo] ${pass ? '✓' : '✗'} ${name}`)
    if (!pass) failed += 1
  }
  await app.dispose()
  if (failed > 0) {
    console.error(product
      ? '[hmr-demo] 产物自检有未过项（产物编了吗？先 node --import tsx/esm examples/hmr-react/build.mjs）'
      : '[hmr-demo] dev 自检有未过项（依赖装了吗？cd examples/hmr-react && pnpm install --ignore-workspace）')
  } else {
    console.log(`[hmr-demo] ${product ? '产物' : 'dev'}形态自检 5/5 全过`)
  }
  process.exitCode = failed > 0 ? 1 : 0
}
