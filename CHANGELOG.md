# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本语义遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-10-13

### 破坏性变更（迁移指南随条）

- **RPC 网关空壳化**（用户裁定「authRoutesHook 仍属业务；基础架构可以是空壳」）：`createJsonRpcGateway`/`RpcAuthOptions`/`RpcHook` 及内置 auth 三端点/会话门**移除**——策略件归消费方。替代：`createRpcServer({ layers })` 空壳（koa 式洋葱组合 + 请求上下文 + 兜底 500，零路由/零协议/零自动挂载）+ 机械件 `jsonResponder`（最外层应答汇：内层置 value/failure/status 或自带应答；内层抛错折叠）与 `faceInvoker`（最内层 `POST /api/<ns>/<method>` 查面+按名绑参+signal 注入）；机械件出口 `readRequestBody`/`rpcSendJson` 供业务层自持。**层序即语义**：审计件排 invoker 外=发送前改写最后一站；嵌套天然支持（ALS 型上下文传播=中间件包 next()——v1.4 的 ALS 局限消亡）。层对象挂 `onInit`/`onReady`/`onDestroy` 经 `createRpcFace`/`runDevApp` 挂件槽派发。
- **迁移**：v1.3/1.4 的 `createJsonRpcGateway({ faces, adopt, auth, resolveSession, onSession, hooks })` → `createRpcServer({ layers: [jsonResponder(), 你的 authRoutes 层（原内置三端点语义，自持 cookie/凭据）, 你的会话门层（resolve+onSession 语义）, faceInvoker({ faces, adopt })] })`。auth 三端点与会话门的参考实现见 examples/dev-app（内存版）与消费方 ling-dsh-common dev-gateway（satoken 版）。

### 新增

- 测试重写为空壳范式 8 例（洋葱回程/认领止链/兜底 500/responder 应答形态与错误折叠/invoker 分派绑参/层生命周期/组合全景——业务 auth+门+审计件位置语义样板/parameterNamesOf 钉）。

## [1.4.0] - 2026-10-13

### 新增

- **JSON-RPC 网关内核生命周期钩子化**（机械层/策略层分离）：`RpcHook`（`onInit`/`onReady`/`beforeRequest`/`afterRequest`/`onError`/`onDestroy`，axios 拦截器 / vite 插件钩子同位概念）+ `RpcContext` 请求上下文（贯穿钩子链与分派核心，自定义槽开放）；认证三端点与会话门降为**内置可拔钩子**（用户钩子先行——公开路由可绕门；门正则与分派形状一致零漂移）；`createRpcFace` 对象挂件把 onReady/onDestroy 接进 `runDevApp` 新增的挂件 `ready` 槽（listen 后、config.onReady 前派发）。`createJsonRpcGateway` 既有 options 全兼容（兼容证=既有测试不动全绿）。ALS 型包裹类关注（请求级上下文传播）需嵌套语义，留在 handle 外组合——文档明示。
- 测试 +4（钩子顺序与认领止链/afterRequest 改写 value/onError 改写 failure/createRpcFace 生命周期派发），总数 78；demo 网关换 `createRpcFace`+访问日志钩子活示范。

## [Unreleased]

### 新增

- README 双语增**四层架构图**（Mermaid）：你的应用（唯一手写层）→ `/dev` 工具族 → 运行时 → kit 基座，跨模块前后端两条腿的调用关系随图标注。
- `examples/dev-app`——薄配置完整可跑演示：一份 `ling.config.mjs` 跑起 dev 服务器（三相插件双出口形态 + `createJsonRpcGateway` 内存凭据网关 + 静态 SPA + healthz）。`pnpm demo` 常驻把玩（浏览器 :8390）；`pnpm demo:check` 一条命令自检并进 CI。仓内演示走源码相对路径免构建直跑，消费者视角换包名 import 即同款。
- `examples/dev-app` 跨模块前后端两腿示例（demo1/demo2）：**后端**=demo2 `static inject = ['demo1']` 声明依赖（cordis 等侍语义，与挂载相序解耦），`report()` 面内经 `ctx.get('demo1')` 穿透组合，能力契约由 `Demo1Api` 接口跨模块显式化；**前端**=同一网关 faces 表登记多命名空间，浏览器换 `<ns>` 即达任一模块；自检 5→**7 项**（+demo1 直调 / +demo2 跨模块链断言 `via='demo1'` 且 `doubled=42`）。演示即验出并入册一坑：**`Service` 基类的 `name` 是服务名字符串成员——面方法命名避开 `name`**（被自有属性遮蔽，运行时 "not a function"、类型层 TS2416/2425）。

## [1.3.1] - 2026-10-13

### 新增

- `createJsonRpcGateway` 增 `onSession` 登录态确立回调（会话验签通过后随 token 调用——审计上下文/身份绑定挂点；测试钉）。

## [1.3.0] - 2026-10-13

`/dev` 出口再下一城：JSON-RPC 网关内核——`POST /api/<ns>/<method>` 面分派的通用机制进框架，业务树网关只剩自家接线。

### 新增

- `src/dev/rpc.ts`——`createJsonRpcGateway(options)`：会话门（resolveSession/auth.resolve 双路线）→ 命名空间与方法查表（faces 表 + adopt 惰性收编钩子）→ 参数名绑定（`parameterNamesOf` 随批上收为公共件）→ `signal` 参数自动注入（应答 close 即 abort）→ 双形态应答（裸 `{ok,value}` / client-request→server-response 信封）→ 错误折叠（code+message）；可选认证三端点（login/me/logout，凭据语义 λ 注入，cookie 名可配）。
- 测试 +5（req/res 最小仿真件直调 handle——内核与 HTTP 传输解耦；夹具时序坑在册：emit 须宏任务对齐真实 I/O），总数 74。

## [1.2.1] - 2026-10-13

### 修复

- runDevApp 相位条目 `config` 省略时不再传 `{}`——`ctx.plugin(P)` 与 `ctx.plugin(P, {})` 不等价（`config ?? 缺省档` 形态的插件会走岔），语义保真优先于形状整齐（测试钉：no-config 条目收到的 config 为 undefined）。

## [1.2.0] - 2026-10-13

`/dev` 出口补齐"装配故事"下半场：声明式配置直接跑成 dev 服务器（vite.config.ts 式薄配置体验）。

### 新增

- `src/dev/app.ts`——`runDevApp(config)` 载体内核：env 装配助手 `loadEnv` → Context+LoggerConsole+Timer → `setup` 钩子 → 三相模块循环（`spec` 动态 import → `ctx.plugin` → `after` 钩子；`use:'default'|'namespace'` 兼容两种插件出口形态）→ HTTP 面（配置挂件先行，内建 healthz 附加位/boot-status/静态 SPA/`/packages` 表/重定向/API 前缀剥离/HMR 组合殿后）→ 端口卫兵 → `onReady` → 有界停机；返回编程式 `DevAppHandle.dispose()`；`defineApp` 类型锚、`registryOf` 配置→注册表。
- `src/dev/link.ts`——物理层接线助手族：`ensureJunctions`（幂等 junction 清单；指向判定用 realpath 双侧归一——修正 Windows junction readlink `\\?\` 前缀导致每轮重建的隐性缺陷）、`pruneDangling`（悬空链接清理）、`writeShim`（合成包整体重建：package.json+桥文件族）。
- 测试 +9（app 6：三相序/HTTP 内建面/dispose 链/HMR 组合/registryOf/loadEnv；link 3），总数 69。

## [1.1.0] - 2026-10-13

新增 `/dev` 子出口：应用装配与开发工作流工具族（机制自生产树"开发三令"上收——HMR 形态 / 模块注册表单点 / 全量+单模块编译，2026-10-10 用户三令）。

### 新增

- `src/dev/registry.ts`——`ModuleRegistry` 分相模块注册表：条目数据消费方持有，`ofPhase` 挂载循环 / `clientTable` 浏览器产物静态表 / `find`·`all` 查询同一单点派生（改一处三处同生效）。
- `src/dev/hmr.ts`——`createViteHmrBridge` vite HMR 桥：dev 服务器进程内代管 vite 子进程（就绪探针 30s 有界、HTTP 管道反代、ws 升级透传、缺席/退出/dispose 三态回落 `port === 0`）；排障四修内建（`--host 127.0.0.1` 对齐、ws 握手头一次性构造、`\r\n` 拼接、探针有界）。vite 为使用方对等件，本包零新增依赖。
- `src/dev/build.ts`——`buildRegisteredModules` 按注册表编排编译：全量 / 指名单 / 载体特名 / `skipCarrier`；stdio 直通、失败抛 `BuildFailedError` 携子进程退出码。
- 测试 +15 例（注册表 4 / HMR 桥 5——仓内 fake-vite 替身子进程、零 vite 依赖 / 编译编排 6——临时目录假包实跑 npm）；dts 冒烟扩 `/dev` 出口断言。

## [1.0.0] - 2026-10-13

首发：cordis 血统插件运行时的独立开源发布。

### 新增

- `src/core`——上下文树、Fiber 生命周期、事件总线（五种分发模式）、插件注册表与 `@Inject()` 依赖注入、服务基类、日志门面（承接 cordis 4.0.5-alpha.1）。
- `src/kit`——cosmokit 工具箱（1.8.6-alpha.1），含 deepseek fork 自有的 `Volatile` 稳定引用配置机制。
- `src/schema`——schemastery 构建器与校验（3.18.5-alpha.1），standard-schema v1 接口。
- `src/plugins/timer.ts`——定时混入插件（cordis-plugin-timer 1.1.7-alpha.1）。
- `src/plugins/logger-console`——控制台导出器插件（1.0.5-alpha.1），Node 入口 + 浏览器源码入口。
- 工程化：tsdown 单文件 JS 打包 + tsc 直出 d.ts 模块树、vitest 39 例、外部消费者视角 dts 冒烟、双语 README、CI（Node 22/24 矩阵）。

### 相对上游的整理

- 五件 vendor 镜像重组为 `src/{core,kit,schema,plugins}` 单包布局；包内 `@deepseek-ai/*` 裸导入全部相对化。
- 删除死件 `bin.js`（引用未纳入的 loader/include 插件）。
- 修复 4 处存量类型层错误（fiber.ts/utils.ts，纯类型断言，零运行时变更）。
- 模块增强改指向定义文件（`declare module '../core/context.ts'`，与 cordis 核心内部写法一致）。

[2.0.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v2.0.0
[1.4.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.4.0
[1.3.1]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.3.1
[1.3.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.3.0
[1.2.1]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.2.1
[1.2.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.2.0
[1.1.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.1.0
[1.0.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.0.0
