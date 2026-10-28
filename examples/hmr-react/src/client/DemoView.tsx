/**
 * HMR 演示子应用组件（独立纯组件模块——React Fast Refresh 保状态的前提：被热更的
 * 模块只导出组件；与 apply/inject 协议导出混在同一模块时热更走重挂载（丢状态），
 * 故协议入口在 index.tsx、组件在本文件）。编辑本文件文案应热替换且计数器状态保持。
 * @module @ling2/ling-coris/examples/hmr-react/src/client/DemoView
 */
import { useState } from 'react'

/** 热更实证锚：编辑此字符串验证热更（页面即时变、不刷新、计数不丢）。 */
const MARKER = 'v1'

export function DemoView() {
  const [count, setCount] = useState(0)
  const bootCount = (window as unknown as { __bootCount?: number }).__bootCount ?? 0
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 720 }}>
      <h1>ling-coris · 前端 HMR 最小示例</h1>
      <p>
        版本标记：<b data-hmr-marker>{MARKER}</b>（编辑 examples/hmr-react/src/client/DemoView.tsx 验证热更）
      </p>
      <button onClick={() => setCount((value) => value + 1)}>计数：{count}</button>
      <p>整页装载次数（热更应保持不变）：<b data-boot-count>{String(bootCount)}</b></p>
    </div>
  )
}
