# 更新日志

## 0.0.1（2026-10-28）

- 更名发布：`@ling2/ling-cordis` → `@ling2/ling-coris`，npm 新包号自 0.0.1 起版（旧包 `@ling2/ling-cordis` 废弃标注指向本包）；GitHub/Gitee 仓同步更名 ling2-2y2/ling-coris、ling2/ling-coris。

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本语义遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更（2026-10-26 架构评审批 2·P1 四件，测试先行 112/112 全绿）

- **内建路由自消费 WebServerRouter（O1）**：`runDevApp` 的 if 链路由迁装配期注册（exact→最长 prefix→404 fallback 唯一座），同仓两套路由机制合一；挂件 handlers 先行语义钉死不变；upgrade 链不迁（exact-path 形态与谓词式/协议头认领不匹配，注释在案）。`webserver` 包自此被 dev 内核真实消费。对拍门=存量 spec+demo:check 7/7+hmr-react 真链 dev 自检 5/5。
- **静态资产流式下发（O7）**：`serveStaticFile` 改 `createReadStream` 管道——readFileSync 整读同步阻塞事件循环（10MB 级资产卡全进程）根除；缺席走 error 事件 404 回落、已落笔读错误只收尾（流错误吸收）。新钉：1MB 资产完整不截断。
- **全仓 `strict: true`（O5，超原方案）**：探测实证存量 0 错（含 vendored 血统），原「分档+豁免登记」案作废直接全开；extends 传导 build dts 与 dts-smoke。顺手真类型修正：`buildRegisteredModules`/`checkRegisteredModules` options 泛型化（TEnv 透传，具化注册表不再撞 strict 不变型）。
- **多面板 React 共享防线（O6）**：`buildClientBundle` 增 `warnBytes`（缺省 512KB）超阈值 WARN 提示 external 共享；README 双语补多子应用宿主共享 React 单例姿势（external react/react-dom+宿主全局 React；dev 态 vite 图天然单 React 无此问题）。
- 新钉 3 例（404 首见告警去重/1MB 流式完整/阈值 WARN），总数 **112**。

## [2.3.0] - 2026-10-26（已发布 npm）

### 新增（2026-10-26 用户令「坑知识进框架，简化使用方」吸收批）

- **前缀单源 `basePath`**（架构评审 O3 裁定落地）：`DevAppConfig` 增可选顶级键 `basePath`（缺省 `'/app'`，尾斜杠容错归一）——`staticApp.urlPrefix` 与 `hmr.base` 未显式设置时由它派生（urlPrefix=去尾杠、vite base=补尾杠），显式设置保留（越具体越优先）；防「前缀写两处、改一漏一=资产 404 静默错位」。`tests/base-path.spec.ts` 5 例钉派生/覆盖/归一/缺省不回归。
- **容器化三件套**（架构评审 O4+裁-2/裁-3）：`examples/hmr-react/{Dockerfile,.dockerignore,compose.yaml}`——多阶段镜像（构建期 sed 重写三处相对 import 为 `@ling2/ling-cordis/dev` 出口=消费方形态正典；运行期 `pnpm install --prod` 仅框架包，vite/esbuild/tsx 不进镜像）；Debian bookworm-slim 基底（裁-2）+非 root+`HEALTHCHECK` 打 `/healthz`+SIGTERM 有界停机；`ling.config.mjs` 增 `HOST` env 行（容器 0.0.0.0 由使用方薄壳读，框架 `/dev` 零 env 纪律不破）。
- **发布流水线 `scripts/release.mjs`**（裁-6 用户裁定：本地脚本编排，不走 GitHub Actions）：每流程节点一方法（gates 门禁四连/publish 发 npm/push 双远端两段式/remote 129 构建/run 重建容器/verify 探活三断言，`all` 全串；`--dry-run` 外发保护；`--image-version` 钉版）+`scripts/remote-exec.py`（paramiko 薄桥）。129 全链验证绿：镜像构建/容器 healthy+非 root/探活三断言/docker stop 有界停机。
- CI 增 `example-hmr-react`（标准模板三命令进机器门禁）与 `image`（Dockerfile 可构建性）两 job；`dts-smoke.ts` 翻旧账（退役桥符号换现役 `createViteEmbed`/`ViteEmbed`+补 basePath 类型面——check:dts 存量红修复）。
- 本版 npm 发布时点：仓 commit 8f4156e（含上述 basePath/容器化/CI），129 三修（0bd1f2a）仅涉 Dockerfile/release 脚本不入 npm 包。

- **vite 配置内联合成**——`hmr` 配置新增 `react`/`base`/`entries` 三键：`react:true` 从使用方 cwd 自备加载 `@vitejs/plugin-react` 注入 Fast Refresh（同 vite 对等件契约，缺席/越界 fail loud），base 缺省 `'/app/'`，依赖预热入口缺省按 `src/client/index.tsx|.ts` 约定探测——**简单使用方零 vite.config 直享 HMR**；自带 vite.config.ts 的复杂使用方（别名族）不设 `react` 自然合并（插件双开=重复注册禁）。
- **框架装载器 `/__ling/boot.js`**（`/app/__ling/boot.js` dev 态同源应答）：子应用协议 `window.__ModuleLoader__.load({id, factory})` 缺省实现（宿主已有自持装载器不覆盖）+ `lingLoadSubapps(keys)` 运行时动态导入正路——宿主页引两行即得子应用源码面 HMR；固化两坑知识：勿用 `<script src="/packages/…">`（vite html 转换前缀 base→404）与静态 import（html-proxy 中间件态 500）。
- **子应用自动装载入口 `/__ling/main.js`**（2026-10-26 用户三令：①「src/shell.ts 架构坏味道优化掉、其配置/动作统一收归 ling.config.mjs」②「panel 术语全线误导=坏味道，概念即 subapp」③「装载入口名与标准 `<script type="module" src="/src/main.ts">` 统一叫 main」）：装载器本体+按注册表 client 键登记序自动 `lingLoadSubapps`——宿主页一行经典 script 即得，消费者壳文件 `src/shell.ts` 全线退役（例程与 ling-harness-runner 双消，键列不再重复声明）；**术语全线改名 panel/面板→subapp/子应用**（入口路由/全局函数 lingLoadPanels→lingLoadSubapps/协议/键/产物/组件文件 DemoPanel.tsx→DemoView.tsx/全部注释文档）；标签形态保留经典 script——module 形态会被 vite 拉进构建图（dev 依赖扫描按盘上路径解析该 URL、`vite build` 会试图把该 src 解析进 dist 资产，双炸）；React Fast Refresh 前导经插件源码（transformIndexHtml 无条件分支）+真机 curl 双实证仍自动注入；例程自检 4→5 项（+自动装载入口探针）。
- **`/app/packages/*` dev 态别名**（坑吸收）：base 前缀形态别名回 /packages 源码面；产物态不吞（404 保持）。
- `examples/hmr-react`——前端 HMR 最小示例（ling-web 形态：标准 `vite.config.ts` + 项目标配三命令 `pnpm dev`（HMR 环境）/`pnpm build`（编译子应用+壳两产物）/`pnpm start`（产物启动），各带 `--check` 自检 4 项）；`examples/dev-app` 过时注释修正（「vite 缺席自动回落静态」与 fail-loud 裁定相反，勘正）。
- README 双语翻旧账：`createViteHmrBridge` 子进程桥叙事**退役**（该形态已被 2.1.0 内嵌件取代）→ 内嵌件+「前端 HMR」新节（最小接入/语义注意：组件与协议导出分模块、StrictMode 首改重挂载、依赖预热）+「构建与检查」节（三收编件用法）。
- **检查/构建收编三件**（2026-10-26 用户令「类型检查/样式检查/build 收归 ling-cordis、兼容 Linux 路径」）：`buildClientBundle`（子应用产物注册器包装件，charset/require 垫片内建，esbuild 对等件契约）；`runCheckScripts`/`checkRegisteredModules`（逐包 check 脚本全景编排）；`themeGate` 引擎（E1/E2/E3/strict + `stripCommentsLine`/`printThemeGateResult` 出口）——bsh 树 theme-guard 换芯对拍全等（427 token/9 bundle/0 WARN/exit 0）。路径纪律全 node:path/pathToFileURL 双平台兼容。
- `AGENTS.md` 立卷（用户令）：新件必说明 / 变更翻旧账 / 功能·说明·示例·文档四位一体 + 技术裁定指纹与能力面清单。
- `examples/hmr-react` 补项目标配自持命令（`pnpm dev` HMR 环境 / `pnpm build` 编译 / `pnpm start` 产物启动；整链=build.mjs 双目标——viteBuild 壳+buildClientBundle 子应用，防自递归）。
- README 双语：新增「名词解释（统一说法）」章（宿主壳/子应用=子应用被装载物/座位=宿主侧挂载位勿混称/子应用协议/子应用键/装载器/自动装载//packages 通道/两产物，2026-10-26 用户令）+「标准项目结构（ling-web 形态）」节（文件树+逐文件作用与属地表）；前端 HMR/构建与检查/装载规约按用户令精简为使用规范（README 不讲原理）——宿主页装载接线一行 `<script src="/__ling/main.js">`。
- 测试 +8（react 内联合成 2/boot 路由与别名 2/themeGate 2/check 编排 1/buildClientBundle 1），总数 **103**。

## [2.2.0] - 2026-10-26

### 新增（2026-10-26 用户裁定①②「子应用真 HMR、机制落 ling-cordis 底层」）

- **客户端源码面**：dev 态（vite 内嵌在场）注册表 `client` 键改发 ESM 转接 shim——浏览器经 vite `/app/@fs/` 直拉包源码入口（TSX 转译+Fast Refresh+单 React=vite 图天然保证），宿主装载器吃到的 ESM 命名空间与产物 CJS exports 同形（`inject`/`apply` 子应用协议）；`ModuleRegistry.clientSourceTable` 约定探测（`src/client/index.tsx`→`.ts`）+ packagesExtras 两级上翻纳入「无挂载面有子应用产物」的包；产物态原样产物通道不变。

## [2.1.0] - 2026-10-26

### 新增（2026-10-26 用户裁定①②「单进程单端口；fail loud 禁静默回落 dist」）

- **vite 内嵌件 `createViteEmbed`**（`src/dev/hmr.ts`）：以库形态从使用方 cwd 的 node_modules 加载 vite（`createRequire` 解析→动态 import），`createServer({ middlewareMode: true, hmr: { server } })` 同进程同端口——页面中间件由调用方挂进载体 HTTP 面、HMR WebSocket 升级挂载体自己的 http 服务，**无独立 vite 端口、无子进程**；`isInside` 包含守卫拒绝解析到项目外的 vite（vitest/NODE_PATH 注入防护）；缺席/初始化失败 reject（fail loud），逃生口 `enabled:false` 归调用方组合。
- `runDevApp` 的 `hmr` 配置接线：`/app` 面全权交 vite（未认领=显式 500 `gateway/hmr-unclaimed`，禁回落 dist）；upgrade 兜底销毁前按（`sec-websocket-protocol`∈{vite-hmr,vite-ping} 且路径=base）放行 vite 认领的升级——真机探针实证不放行则热更握手被 `socket.destroy()` 掐死；healthz 附加 `hmr:'vite-embedded'` 观测位。
- 替身测试基建 `tests/helpers/fake-vite.ts`（ws 所有权语义忠实模拟——被放行的升级 socket 由替身 close() 收编，否则 `server.close()` 永挂）。

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
