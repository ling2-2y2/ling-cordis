/**
 * 演示插件甲（default 出口形态：class 插件）——挂在 ctx.greet 上的服务，
 * 同时充当 RPC 面本体（ling.config.mjs 把它登记进网关 faces 表）。
 * 消费者视角：`import { Service } from '@ling2/ling-cordis'`
 * （仓内演示走源码相对路径，免构建直跑）。
 * @module @ling2/ling-cordis/examples/dev-app/plugins/greet
 */
import { Service, type Context } from '../../../src/index.ts'

export default class Greet extends Service {
  static inject = [] as const

  constructor(ctx: Context) {
    super(ctx, 'greet')
  }

  /** 问候——RPC 面方法（网关按参数名绑定 wire 参数；面方法禁默认参/解构/剩余参，
   * 缺省语义在方法体内自行兜底——wire 契约，违者网关 400 拒收）。 */
  hello(name?: string) {
    return `hello, ${name ?? 'world'}!`
  }

  /** 加法——演示一面多方法。 */
  add(a: number, b: number) {
    return a + b
  }
}
