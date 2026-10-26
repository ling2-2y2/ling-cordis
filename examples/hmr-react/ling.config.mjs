/**
 * hmr-react 例程配置——**dev/产物两形态一份配置**：
 * - dev（`pnpm dev`）：vite 内嵌 HMR（本包自带 vite.config.ts——ling-web 形态
 *   消费者，React 插件在文件里，故 hmr 不设 react:true 防双开）；
 * - 产物（`pnpm build` 后 `pnpm start`）：staticApp 静态面（vite build 出的 dist）
 *   + `/packages/demo` 回产物通道（client/client.js）。
 * 消费者视角把 '../../src/dev/index.ts' 换成 '@ling2/ling-cordis/dev' 即同款。
 * @module @ling2/ling-cordis/examples/hmr-react/ling.config
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineApp } from '../../src/dev/index.ts'

const pkgDir = dirname(fileURLToPath(import.meta.url))

/** 产物形态开关（env PRODUCT=1 或命令行 --product）。 */
export const product = process.env.PRODUCT === '1' || process.argv.includes('--product')

export default defineApp({
  // rootDir=上一级（examples/）：注册表 client 探测与产物表都按 join(rootDir, id) 找包目录
  rootDir: resolve(pkgDir, '..'),
  label: 'hmr-demo',
  port: Number(process.env.PORT ?? '8391'),
  // 两形态一切换就这两行（构建见 build.mjs；语义见 README「前端 HMR」）：
  // dev=vite 内嵌（本包自带 vite.config.ts——ling-web 形态消费者，React 插件在文件里，
  // 故此处不设 react:true 防双开；零 vite.config 原型见 ling-harness-runner 演示）；
  // 产物=staticApp 托管 vite build 出的 dist（壳资产）+ /packages/demo 回产物通道
  ...(product
    ? { staticApp: { root: join(pkgDir, 'dist') } }
    : { hmr: { cwd: pkgDir } }),
  phases: ['only'],
  modules: [
    // 纯 client 登记（无 spec=不挂宿主插件）：dev 态 /packages/demo → 源码面 ESM shim；
    // 产物态同键 → client/client.js 产物（clientTable 缺省路径）
    { id: 'hmr-react', phase: 'only', note: 'HMR 演示面板（/packages/demo）', client: { key: 'demo' } },
  ],
  onReady: ({ port }) => {
    console.log(product
      ? `[hmr-demo] 产物形态就绪 http://127.0.0.1:${port}/app/（client/client.js 产物通道，无 vite）`
      : `[hmr-demo] 浏览器打开 http://127.0.0.1:${port}/app/，编辑 src/client/DemoPanel.tsx 看热更（不刷新、计数不丢）`)
  },
})
