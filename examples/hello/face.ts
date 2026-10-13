/**
 * 演示插件——一个挂在 `ctx.hello` 上的最小服务。
 * @module @ling2/ling-cordis/examples/hello/face
 */
import { Service, type Context } from '../../src/index.ts'

export default class HelloFace extends Service {
  static inject = [] as const

  constructor(ctx: Context) {
    super(ctx, 'hello')
  }

  /** 返回问候语——服务方法经 ctx.get('hello') 消费的示例。 */
  greet(name = 'world') {
    return `hello, ${name}!`
  }
}
