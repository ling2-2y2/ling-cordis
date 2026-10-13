/**
 * 最小启动示例——一条链演示四件套装配：
 * 根 Context + LoggerConsole（控制台日志）+ Timer（定时混入）+ 自定义服务。
 *
 * 运行：pnpm smoke（即 node --import tsx/esm examples/hello/boot.mjs）
 */
import { Context, LoggerConsole, Timer } from '../../src/index.ts'
import HelloFace from './face.ts'

const ctx = new Context()
await ctx.plugin(LoggerConsole, { colors: false })
await ctx.plugin(Timer)
const fiber = await ctx.plugin(HelloFace)

ctx.logger('hello').info('boot 完成，四件套装配齐')

// Timer 混入验证：interval 累计、timeout 到点收尾
let ticks = 0
const stop = ctx.setInterval(() => { ticks += 1 }, 20)
ctx.logger('hello').info(`服务问候：${ctx.get('hello').greet('cordis')}`)

ctx.timeout(120).then(async () => {
  stop()
  ctx.logger('hello').info(`收尾：interval 共触发 ${ticks} 次，fiber 状态 ${fiber.state}`)
  await ctx.fiber.dispose()
  if (ticks === 0) throw new Error('interval 从未触发——Timer 装配失败')
  process.exit(0)
})
