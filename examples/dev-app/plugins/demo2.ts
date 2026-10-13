/**
 * 演示模块 demo2（default 出口形态）——跨模块消费方：具名服务 'demo2'，
 * `static inject = ['demo1']` 声明依赖（cordis 等侍语义：demo1 服务在场后才激活
 * 本插件——与挂载相序/相位解耦，依赖契约显式化；构造时取用即安全）。
 *
 * 跨模块调用链（浏览器只见一个面）：
 *   POST /api/demo2/report → demo2.report → ctx.get('demo1').double（模块间后端调用）
 * @module @ling2/ling-cordis/examples/dev-app/plugins/demo2
 */
import { Service, type Context } from '../../../src/index.ts'
import type { Demo1Api } from './demo1.ts'

export default class Demo2 extends Service {
  /** 依赖声明：'demo1' 服务激活前本插件不启动（cordis inject 语义）。 */
  static inject = ['demo1'] as const

  private readonly demo1: Demo1Api

  constructor(ctx: Context) {
    super(ctx, 'demo2')
    // inject 已声明——构造时 demo1 必已在场，直接取用
    this.demo1 = ctx.get('demo1') as Demo1Api
  }

  /** 跨模块组合：内部穿透调用 demo1 能力，应答携带溯源（前端一跳、后端两跳）。 */
  report(n: number) {
    return { by: 'demo2', via: this.demo1.label(), n, doubled: this.demo1.double(n) }
  }
}
