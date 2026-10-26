/**
 * 子应用协议入口——dev 态经 /packages/demo 源码面（ESM 转接 shim → vite /app/@fs
 * 直拉本文件）进宿主装载器；产物态同键走 client/client.js 产物（pnpm build 生成）。
 * 协议形状 export { inject, apply } 与业务包子应用同形。
 * @module @ling2/ling-cordis/examples/hmr-react/src/client/index
 */
import { createRoot } from 'react-dom/client'
import { DemoView } from './DemoView.tsx'

/** 子应用协议：依赖服务声明（示例子应用零依赖）。 */
export const inject: readonly string[] = []

/** 子应用协议：装载器激活入口——渲染演示子应用。不包 StrictMode：其双挂载会让装载后
 * 首次热更重挂载一次（计数器回零），去掉后首改即保状态（真机实证裁定）。 */
export function apply(): void {
  const container = document.getElementById('root')
  if (container === null) return
  createRoot(container).render(<DemoView />)
}
