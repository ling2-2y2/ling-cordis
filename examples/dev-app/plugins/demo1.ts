/**
 * 演示模块 demo1（default 出口形态）——被跨模块消费的底层能力方：
 * 具名服务 'demo1'，能力面由 Demo1Api 接口显式契约化（消费方 import 该类型，
 * 跨模块契约不靠猜）。
 * 消费者视角：`import { Service, type Context } from '@ling2/ling-cordis'`。
 * @module @ling2/ling-cordis/examples/dev-app/plugins/demo1
 */
import { Service, type Context } from '../../../src/index.ts'

/** demo1 对外能力面（demo2 经此接口消费——跨模块契约显式化）。 */
export interface Demo1Api {
  label(): string
  double(n: number): number
}

export default class Demo1 extends Service {
  static inject = [] as const

  constructor(ctx: Context) {
    super(ctx, 'demo1')
  }

  /** 本模块身份（供消费方在组合结果中溯源）。注意：Service 基类的 `name`
   * 是服务名字符串成员——面方法别叫 name，会被自有属性遮蔽。 */
  label(): string {
    return 'demo1'
  }

  /** 底层能力：翻倍。 */
  double(n: number): number {
    return n * 2
  }
}
