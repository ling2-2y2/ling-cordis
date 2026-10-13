# ling-cordis

独立发布的 [cordis](https://github.com/koishijs/cordis) 血统 TypeScript 插件运行时：可组合的**上下文**、生命周期受管的**插件 Fiber**、带类型的**事件总线**、**依赖注入服务**、**定时器**混入、**Schema** 校验（schemastery）与控制台**日志**——单包 ESM 交付，安装即用。

> English documentation: [README.md](./README.md)。

## 特性

- **上下文树**——代理式依赖容器，原型链作用域派生（`extend` / `isolate` / `intercept`）。
- **Fiber**——每个插件跑在独立 Fiber 里：epoch 制 reload/unload、effect 清理、启动前配置校验。
- **事件总线**——五种分发模式（`emit` / `parallel` / `serial` / `bail` / `waterfall`），经模块增强获得类型化事件表。
- **服务**——挂在 `ctx` 上的具名 API（`ctx.get(name)`）、`@Inject()` 装饰器、可调用服务、intercept 配置链。
- **定时器**——`ctx.timeout` / `interval` / `throttle` / `debounce`，全部由所属 Fiber 持有、随其撤销。
- **Schema**——schemastery 构建器：声明式配置模式、standard-schema v1 接口、`Volatile` 稳定引用配置。
- **控制台日志**——分级输出、着色、diff 后缀、按名取色。

## 环境要求

- Node.js **≥ 22**（用到 `Promise.withResolvers`）
- 仅 ESM（`"type": "module"`）；浏览器日志入口以源码形态保留，不在发布入口内

## 安装

```bash
npm install @ling2/ling-cordis
# 或：pnpm add @ling2/ling-cordis
```

## 快速上手

```ts
import { Context, LoggerConsole, Service, Timer } from '@ling2/ling-cordis'

// 插件即服务：具名 'hello'，暴露为 ctx.hello
class Hello extends Service {
  static inject = [] as const
  constructor(ctx: Context) {
    super(ctx, 'hello')
    // Timer 插件装配后 ctx 上就有定时混入；effect 随所属 Fiber 一并撤销
    ctx.setInterval(() => ctx.logger('hello').info('tick'), 1000)
  }
  greet(name = 'world') {
    return `hello, ${name}!`
  }
}

const ctx = new Context()
await ctx.plugin(LoggerConsole, { colors: false })
await ctx.plugin(Timer)
await ctx.plugin(Hello)

ctx.logger('app').info(ctx.get('hello').greet('cordis'))
await ctx.fiber.dispose() // 执行全部已登记的 effect
```

可运行版本见 [`examples/hello`](./examples/hello)（`pnpm smoke`）。

## 模块

| 路径 | 内容 | 上游来源 |
| --- | --- | --- |
| `src/core` | 上下文/Fiber/事件/注册表/服务/日志 | cordis |
| `src/kit` | 数组/字符串/时间/类型工具，`Volatile` 机制 | cosmokit |
| `src/schema` | 可调用 Schema 构建器与校验 | schemastery |
| `src/plugins/timer.ts` | 定时混入插件 | cordis-plugin-timer |
| `src/plugins/logger-console` | 控制台导出器插件 | cordis-plugin-logger-console |

## 概念

- **Context**——根容器与作用域工厂：服务、配置层、隔离标签都挂在上面；子作用域经原型链继承。
- **Fiber**——一次插件激活：setup 栅栏、effect（清理器/承诺/迭代器）、epoch 制 `restart()` / `update()`。
- **Service**——`ctx` 上的具名单例 API（`ctx.get('hello')`）；用 `static inject` 或 `@Inject()` 装饰器声明依赖。
- **Events**——监听器是 Fiber 持有的 effect；增强全局 `Events` 接口即可为自己的事件获得类型。
- **Schema**——用 `z.object({ port: z.number().default(3000) })` 描述插件 `Config`；Fiber 启动前完成校验。

## 开发

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest（39 例）
pnpm build       # tsdown 打包 JS + tsc 直出 d.ts 模块树
pnpm check:dts   # 以外部消费者视角编译 dist 类型冒烟
pnpm smoke       # 端到端启动 examples/hello
```

## 许可与致谢

MIT——见 [LICENSE](./LICENSE)。本项目承接 Shigma 的 cordis 生态血脉（经内部
`@deepseek-ai/*` fork 中转）；完整来源链与模块对照见 [NOTICE.md](./NOTICE.md)。
