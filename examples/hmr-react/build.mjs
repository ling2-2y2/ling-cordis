/**
 * `pnpm build`——编译产物两件（直调，不经 npm 脚本编排）：
 * ①壳：vite build（配置 vite.config.ts）出 dist/（index.html+hashed 资产，
 *   产物形态 staticApp 根）；
 * ②子应用：ling-cordis 框架件 buildClientBundle 打包 src/client → client/client.js
 *   子应用协议注册器（与 dev 态 ESM shim 同装载面，宿主页零改动）。
 * 跑完 `PRODUCT=1 pnpm start` 即产物形态启动（无需 vite）。
 * @module @ling2/ling-cordis/examples/hmr-react/build
 */
import { build as viteBuild } from 'vite'
import { buildClientBundle } from '../../src/dev/index.ts'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pkgDir = dirname(fileURLToPath(import.meta.url))

// ①壳产物（ling-web 同款命令形态：vite build 出 dist）
await viteBuild({ root: pkgDir, configFile: join(pkgDir, 'vite.config.ts') })
console.log('[hmr-react] 壳产物已生成 dist/')

// ②子应用产物（框架件：注册器包装/charset/require 垫片全部内建）
const bytes = await buildClientBundle({
  entry: join(pkgDir, 'src', 'client', 'index.tsx'),
  id: 'hmr-react',
})
console.log(`[hmr-react] 子应用产物 ${Math.round(bytes / 1024)} KB`)
