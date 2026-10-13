# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本语义遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.3.0] - 2026-10-13

`/dev` 出口再下一城：JSON-RPC 网关内核——`POST /api/<ns>/<method>` 面分派的通用机制进框架，业务树网关只剩自家接线。

### 新增

- `src/dev/rpc.ts`——`createJsonRpcGateway(options)`：会话门（resolveSession/auth.resolve 双路线）→ 命名空间与方法查表（faces 表 + adopt 惰性收编钩子）→ 参数名绑定（`parameterNamesOf` 随批上收为公共件）→ `signal` 参数自动注入（应答 close 即 abort）→ 双形态应答（裸 `{ok,value}` / client-request→server-response 信封）→ 错误折叠（code+message）；可选认证三端点（login/me/logout，凭据语义 λ 注入，cookie 名可配）。
- 测试 +5（req/res 最小仿真件直调 handle——内核与 HTTP 传输解耦；夹具时序坑在册：emit 须宏任务对齐真实 I/O），总数 74。

## [1.3.1] - 2026-10-13

### 新增

- `createJsonRpcGateway` 增 `onSession` 登录态确立回调（会话验签通过后随 token 调用——审计上下文/身份绑定挂点；测试钉）。

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

[1.3.1]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.3.1
[1.3.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.3.0
[1.2.1]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.2.1
[1.2.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.2.0
[1.1.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.1.0
[1.0.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.0.0
