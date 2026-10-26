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

## 架构分层

四层——**你只写最顶层，其余三层都在包里**：

```mermaid
flowchart TD
  subgraph L4["你的应用——唯一手写层"]
    CFG["ling.config.mjs<br/>一份薄声明配置<br/>分相条目：spec + config + after"]
    MOD["业务插件模块<br/>跨模块：static inject + ctx.get<br/>（示例 demo1/demo2，或 34 条目的平台树）"]
    FE["浏览器 SPA"]
  end
  subgraph L3["/dev 工具族——import '@ling2/ling-cordis/dev'"]
    KERNEL["runDevApp 载体内核<br/>env → Context → 分相挂载 → HTTP 面 → 有界停机"]
    GW["createRpcServer 空壳<br/>+ jsonResponder / faceInvoker 机械件<br/>策略住在你的业务层"]
    HMR["createViteEmbed vite 内嵌件<br/>同进程单端口 HMR<br/>（vite 为使用方对等件，可选）"]
    UTILS["ModuleRegistry · 编译编排 · 接线助手"]
  end
  subgraph L2["运行时——import '@ling2/ling-cordis'"]
    CORE["Context 树 · Fiber 生命周期 · 事件总线 · Service 依赖注入"]
    PLUGINS["Timer · LoggerConsole · schemastery"]
  end
  subgraph L1["kit 基座"]
    KIT["cosmokit 工具 · Volatile"]
  end

  CFG --> KERNEL
  MOD -->|"ctx.plugin() / static inject"| CORE
  KERNEL --> GW
  KERNEL --> CORE
  GW --> UTILS
  FE -->|"POST /api/命名空间/方法"| GW
  FE -.->|"HMR ws（同端口）"| HMR
  GW -->|"faces()"| MOD
  CORE --> KIT
  PLUGINS --> KIT
```

- **你的应用**——一份配置 + 插件模块；跨模块调用后端走 `static inject` + `ctx.get`，前端走换命名空间。
- **/dev 工具族**——dev 服务器绕运行时之外的一切：载体内核、JSON-RPC 网关、vite HMR 桥、注册表/编译/接线助手。
- **运行时**——本包发布的 cordis 血统内核。
- **kit 基座**——零依赖工具箱，运行时建于其上。

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

## 开发工具族（`/dev`）

`/dev` 子出口承载"装配 + 开发工作流"工具族——一份注册表同时驱动模块挂载、
浏览器产物静态表与编译编排；外加**同进程单端口**的 vite 内嵌件，让 dev 服务器
不另开端口、不起子进程就获得前端 HMR（含 React Fast Refresh）：

```ts
import { ModuleRegistry, buildRegisteredModules, createViteEmbed } from '@ling2/ling-cordis/dev'

// ① 一份注册表三处消费（挂载 / 静态表 / 编译）
const registry = new ModuleRegistry(['core', 'tail'])
registry.add({
  id: 'my-plugin', phase: 'tail', note: '示例模块',
  client: { key: 'my-plugin/client.js' },        // → 静态通道表条目
  mount: async (ctx, env) => { await ctx.plugin(MyPlugin, { env }) },
})
for (const mod of registry.ofPhase('core')) await mod.mount?.(ctx, env)

// ② vite 内嵌 HMR（同进程同端口）：vite 以库形态从 cwd/node_modules 加载、
//    middlewareMode 进程内常驻——HMR ws 挂你自己的 http 服务，无独立 vite 端口；
//    缺席/越界 fail loud 拒启（禁静默回落 dist；逃生口 enabled:false 归你组合）
const embed = await createViteEmbed({ cwd: 'web-app', httpServer, react: true })
server.on('upgrade', (req, socket) => {
  if (embed.claimsUpgrade(req)) return          // vite-hmr 协议头+base 路径=vite 认领
  socket.destroy()
})
// HTTP 面上把 /app/* 交给 embed.middlewares（next()=未认领，显式报错勿回落）

// ③ 按注册表编译：全量 / 指名 / 载体特名 / skipCarrier
buildRegisteredModules({ registry, rootDir, carrier: { id: 'web', cwd: 'web-app', script: 'build' } })
```

认领顺序归你：内嵌件从不接管你的服务器——HTTP 面与 upgrade 链仍在你手里，
vite 只收它认领的 `/app` 页面与 HMR ws 升级。vite（与 `react:true` 时的
`@vitejs/plugin-react`）是使用方的对等件，本包零新增依赖。

**或者干脆不接线**——`runDevApp` 把一份声明式配置直接跑成整个 dev 服务器
（`vite.config.ts` 式薄配置体验）：

```ts
import { defineApp, runDevApp } from '@ling2/ling-cordis/dev'

const config = defineApp({
  rootDir: import.meta.dirname,
  port: 3000,
  hmr: { cwd: 'web-app', react: true },   // 同进程单端口 vite 内嵌；零 vite.config（见下节）
  staticApp: { root: 'web-app/dist' },    // 仅产物形态消费（dev 形态 /app 全权交 vite，禁回落）
  phases: ['base', 'core', 'engine', 'tail'],
  modules: [
    { id: 'my-plugin', phase: 'tail', spec: './src/my-plugin.ts',
      client: { key: 'my-plugin/client.js' }, config: { port: 1 } },
  ],
  http: (ctx) => [{ handle: myGateway(ctx), healthz: () => ({ faces: 3 }) }],
})
await runDevApp(config) // env → Context → 相循环 → HTTP+HMR+静态 → 有界停机
```

条目经动态 `import(spec)` + `ctx.plugin` 挂载（class 插件加 `use: 'default'`），
复杂接线走 `after` 钩子；`loadEnv`/注册表/编译编排/接线助手凑齐整套工具族。
内核不读任何环境变量——开关与端口全部以普通配置值传入。

**`phases`=挂载相表**：声明相的先后顺序，条目挂进哪相由其 `phase` 字段指定——
内核按相序逐相挂载、相内按登记序。「先基座后业务、引擎晚于核心」这类顺序
约定用相表表达，相名自由命名（上例 `base/core/engine/tail`；单相小应用
`['only']`、`ling-harness-runner` 的 `['engine']` 皆常见）。跨相依赖不必靠
排相——插件 `static inject` 声明依赖即得等侍语义，挂载顺序与依赖解耦
（`examples/dev-app` 的 demo2 在 tail 相依赖 core 相的 demo1 即证）。

完整可跑演示见 [`examples/dev-app`](./examples/dev-app)：`pnpm demo` 起服
（浏览器开 http://127.0.0.1:8390/）；`pnpm demo:check` 一条命令自检全链
（登录 → RPC 参数绑定 → 会话门 → healthz → 静态 SPA）即退——验货最快路径。

### 前端 HMR（vite 内嵌，同进程单端口）

`hmr` 一行 + 宿主页两行，就是全部接入：

- **配置侧**：`hmr: { cwd: <vite 工程根>, react: true }`——框架从 cwd 自备
  `@vitejs/plugin-react`（对等件契约：缺席/越界拒启），内联合成 `base:'/app/'`
  与依赖预热（约定探测 `src/client/index.tsx|.ts`），**简单使用方零 vite.config**；
  复杂使用方（`@ling/*` 别名族）自带 `vite.config.ts` 自然合并——此时勿设
  `react:true`（插件双开=重复注册）。
- **宿主页侧**（ling-web 形态=标准项目形态）：`index.html` 只引 module 入口
  `<script type="module" src="/src/shell.ts">`；`shell.ts`（六行同款，逐件作用见
  下节「标准项目结构」）运行时动态 import `/__ling/boot.js` 再
  `lingLoadPanels(['my-plugin/client.js'])`。零构建宿主页可用两行式：
  `<script src="/__ling/boot.js"></script>` + 内联
  `<script>lingLoadPanels(['键'])</script>`——框架装载器内置面板协议装载面
  （`window.__ModuleLoader__.load({id, factory})` 缺省实现，宿主已有自持装载器
  则不覆盖）与运行时动态导入正路，两种形态同一装载面。**勿用**
  `<script src="/packages/…">` 或静态 `import` 引面板：dev 态 vite html 转换会
  给根相对 URL 前缀 base（`/app/packages/*` 已做别名兜底），内联 module 会被抽成
  html-proxy 而中间件态不被 vite 认领。
- **面板侧**：注册表条目带 `client: { key }` 且包内有约定入口
  （`src/client/index.tsx|.ts`）→ dev 态 `/packages/<key>` 改发 ESM 转接 shim
  （浏览器经 `/app/@fs/` 直拉源码，React Fast Refresh 生效）；产物态同键原样产物。
- **语义注意**（真机实证钉）：①组件与 `apply`/`inject` 协议导出须分模块——混出
  模块热更走重挂载（丢状态）；②React `StrictMode` 会让装载后**首次**热更重挂载
  一次（其后正常）；③依赖预热缺席时首开会撞 vite 优化器冷启动竞态（约定探测即
  为此默认开）。

可跑样 [`examples/hmr-react`](./examples/hmr-react)——ling-web 形态（标准
`vite.config.ts` + 项目标配三命令，包内 `pnpm install --ignore-workspace` 后）：

| 命令 | 角色 |
| --- | --- |
| `pnpm dev` | 开发环境（HMR）：vite 内嵌同进程单端口起服，开 `/app/` 改 `src/client/DemoPanel.tsx` 即时热更；`--check` 跑 4 项自检 |
| `pnpm build` | 编译产物两件：壳 `dist/`（vite build）+ 面板 `client/client.js`（框架件 `buildClientBundle` 包成面板协议注册器） |
| `pnpm start` | 产物启动：吃 build 产物、无 vite，同一页面同一装载面；`--check` 自检 |

另一消费范本=`ling-harness-runner`（容器形态：与 sample 同款三命令与源码直载
规范，`pnpm start` 同源 `--product` 跑产物档，无 bundle 形态；零 vite.config
形态（`react:true`）暂无独立样例——能力保留，简单使用方按上节配置侧说明即用）。

### 构建与检查（同样一行接入）

- **面板产物**：`buildClientBundle({ entry, id })`——esbuild 打包面板源码为单文件
  cjs 并包成**面板协议注册器**（charset/require 垫片/装载面全内建；esbuild 是
  使用方自备对等件，缺席 fail loud）；产物位缺省 `<包>/client/client.js`。
- **构建编排**：`buildRegisteredModules({ registry, rootDir, carrier })`——注册表
  逐包跑 `build:client`，外加载体目标（壳 `vite build` 出 dist）；
  `examples/hmr-react` 的 `pnpm build` 即整链范本（面板+壳双目标）。
- **类型检查编排**：`runCheckScripts({ targets })` / `checkRegisteredModules`——
  逐包跑 `check` 脚本、全景聚合（败不抛，报告 ok/failed 携退出码）。
- **主题门引擎**：`themeGate({ tokenSheets, bundles, allowedVars, allowedPrefixes,
  skipBundleE3Prefixes, strict })`——E1 幽灵 token / E2 主题名硬编码 / E3 浅底
  WARN / strict 硬编码色；`stripCommentsLine` 与 `printThemeGateResult` 一并出口
  供消费方自持严扫复用（bsh 树 theme-guard 即消费范本：策略白名单本地、引擎框架）。
- **路径纪律**：全部 `node:path` / `pathToFileURL`（Linux/Windows 双兼容，禁盘符
  字面拼接）；产物启动形态范本=`ling-harness-runner`（`pnpm dev/build/start` 三标配）。

**网关是空壳，一切策略都是你的层。** `createRpcServer` 只做 koa 式洋葱组合——
零路由假设、零协议形状、零自动挂载。显式排层组合：包内机械件（`jsonResponder`
——最外层应答汇；`faceInvoker`——最内层 `POST /api/<ns>/<method>` 分派+按名
绑参），中间夹你的业务层（auth 三端点、会话门、审计、日志）。**层序即语义**：
审计件排在 invoker 之外=发送前改写 value 的最后一站；嵌套天然支持（ALS 型
请求上下文传播=中间件包 `next()`）。层对象可挂 `onInit`/`onReady`/`onDestroy`，
经 `createRpcFace` 与 `runDevApp` 挂件槽派发。`examples/dev-app` 里整套 auth
三端点+会话门是演示自持的 ~40 行中间件——这就是策略件应有的形态。

### 标准项目结构（ling-web 形态）

接入本框架的标准消费者包长什么样——[`examples/hmr-react`](./examples/hmr-react)
与消费范本 `ling-harness-runner` **逐文件同构**，下树即规范：新接入包照此起形，
与树不一致=要翻旧账（容器形态的 `engines.json`/`Dockerfile*`/`entrypoint.sh` 等
是域增量件，不属框架结构必件）：

```
<包根>/
├── ling.config.mjs        # 装配声明（唯一组合源）：模块清单+相表；dev=嵌 HMR，产物态=吃 dist 静态
├── boot.mjs               # 启动器：import 配置 → runDevApp；dev/产物两态共用；--check 自检即退
├── build.mjs              # pnpm build 入口：viteBuild 出壳 dist/ + buildClientBundle 出面板产物
├── vite.config.ts         # 标准 vite 配置（base '/app/' + react 插件）——复杂使用方必带，简单使用方可省
├── index.html             # 宿主页：唯一职责 = 容器 #root + <script type="module" src="/src/shell.ts">
├── src/
│   ├── shell.ts           # 浏览器壳入口（六行同款）：运行时拉框架装载器 + 点名面板键（详见表后）
│   └── client/
│       ├── index.tsx      # 面板协议出口 export { inject, apply }——/packages 源码面约定入口
│       └── DemoPanel.tsx  # 纯 React 组件与业务源码（与协议出口分文件 = Fast Refresh 保状态）
├── dist/                  # 【产物·不入库】壳静态资产（vite build 产出；产物态 staticApp 服务根）
├── client/
│   └── client.js          # 【产物·不入库】面板协议注册器（buildClientBundle 产出；产物态 /packages 通道）
└── package.json           # 三命令标配 dev/build/start + 对等件 devDeps（vite/react/esbuild/tsx）
```

逐文件作用与属地（**约定**=路径/职责框架定、不可换名；**你的**=内容业务自持）：

| 文件 | 作用 | 属地 |
| --- | --- | --- |
| `ling.config.mjs` | 唯一组合源：模块清单（id/phase/client/mount）、dev 态 `hmr` 一行、产物态 `staticApp` 切换 | 路径=约定，内容=你的 |
| `boot.mjs` | 启动器：读配置 → `runDevApp`；`--check` 自检即退 | 同上 |
| `build.mjs` | `pnpm build` 入口：壳+面板双目标编译 | 同上 |
| `vite.config.ts` | 标准 vite 配置（`base '/app/'`+react 插件）；简单使用方可省（`hmr.react:true` 框架内联合成） | 可选件 |
| `index.html` | 宿主页：`#root` 容器+引 shell.ts；**勿**写装载逻辑或直引面板 | 唯一 html，入构建图 |
| `src/shell.ts` | 浏览器壳入口：六行同款触发器（见下段），键列=本页面板 | 路径=约定，键列=你的 |
| `src/client/index.tsx` | 面板协议出口 `export { inject, apply }`；**禁**与组件混出（混出热更走重挂载丢状态） | 约定入口 |
| `src/client/*.tsx` | 纯组件与业务源码——热更保状态的本体 | 你的 |
| `dist/`、`client/client.js` | 构建产物两件（壳/面板） | 产物，不入库 |

**`src/shell.ts` 定位**（为何装载动作必须由它承担，而不是写进 `index.html`）：
要躲开三个真机实证的 vite 坑——①根相对 `<script src>` 被 vite html 转换加
base 前缀（→404）；②内联 `type="module"` 被抽成 html-proxy、中间件态无人认领
（→500）；③源码里写死的静态 `import '/__ling/boot.js'` 会被 vite import 分析
改写。正路=「vite 根内本地模块（进构建图、dev 态同路径直载、React 前导自动注入
html）+ 运行时动态 import（`new Function` 逃逸，运行时 URL 不进构建图）」——
`shell.ts` 就是这个最小载体：先运行时拉 `/__ling/boot.js`（框架路由）拿到
`lingLoadPanels`，再点名本页面板键。所有消费者逐字同款、仅键列不同；装载器
本体（`window.__ModuleLoader__` 缺省实现+`lingLoadPanels`）在框架侧，消费者零
装载逻辑。零构建宿主页不走 shell.ts，直接用上一节的两行式——两种形态同一装载面。

## 模块

| 路径 | 内容 | 上游来源 |
| --- | --- | --- |
| `src/core` | 上下文/Fiber/事件/注册表/服务/日志 | cordis |
| `src/kit` | 数组/字符串/时间/类型工具，`Volatile` 机制 | cosmokit |
| `src/schema` | 可调用 Schema 构建器与校验 | schemastery |
| `src/plugins/timer.ts` | 定时混入插件 | cordis-plugin-timer |
| `src/plugins/logger-console` | 控制台导出器插件 | cordis-plugin-logger-console |
| `src/dev` | 开发工具族：模块注册表 / vite 内嵌 HMR / 客户端源码面 / 框架装载器 / 编译编排 | 原创（本仓） |

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
pnpm test        # vitest（99 例）
pnpm build       # tsdown 打包 JS + tsc 直出 d.ts 模块树
pnpm check:dts   # 以外部消费者视角编译 dist 类型冒烟
pnpm smoke       # 端到端启动 examples/hello
```

## 许可与致谢

MIT——见 [LICENSE](./LICENSE)。本项目承接 Shigma 的 cordis 生态血脉（经内部
`@deepseek-ai/*` fork 中转）；完整来源链与模块对照见 [NOTICE.md](./NOTICE.md)。
