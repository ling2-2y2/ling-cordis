# AGENTS.md — ling-cordis 仓规则（人与 AI 协作共守）

ling-cordis 是独立发布的 cordis 血统插件运行时 + `/dev` 开发工具族（模块注册表 / vite 内嵌 HMR / 客户端源码面 / 框架装载器 / 面板产物构建件 / 检查编排 / 主题门引擎 / 载体内核 runDevApp）。本仓的产物被 bsh 树等多项目消费——**框架件的每一处行为变化都会放大到所有消费方**，故立以下规则。

---

## 一、新件必说明 ⭐⭐（用户令 2026-10-26）

> **造出来一个新东西就要当场说明：是什么、为什么、怎么用——否则谁都不知道你要干嘛。**

- 新增任何导出 API / 路由 / 脚本 / 配置键 / 示例，必须在创建的同一批完成三件事：
  1. 源码 JSDoc（中文，含消费姿势与坑知识）；
  2. README 双语对应小节（英文 README.md + 中文 README.zh-CN.md 同步）；
  3. CHANGELOG 条目（Keep a Changelog，写清动机与用法）。
- 能力级新件还须配**可跑示例或自检**（`examples/` + `pnpm test` 断言）——只有实现没有演示=未交付。

## 二、变更翻旧账 ⭐⭐（用户令 2026-10-26）

> **改行为必须同步翻相关文档与示例的旧叙事——旧说明留着就是误导。**

- 反例实证：vite 内嵌件取代子进程桥后，README 双语仍教 `createViteHmrBridge` 与「vite 缺席回落静态」数版之久（2026-10-26 翻旧账清偿）。
- 翻旧账范围 checklist（改动命中哪条翻哪条）：
  - 行为/语义变化 → README 双语对应节 + JSDoc **就地重写**（禁追加勘正注记）；
  - API 增删 → 本文件「能力面清单」+ tsdown 出口 + `tests/` 断言面；
  - 示例形态变化 → `examples/README.md` 与示例内注释；
  - 版本化 → CHANGELOG 新版条目（破坏性变更必须带迁移指南——先例 2.0.0）。

## 三、功能·说明·示例·文档四位一体 ⭐⭐

> 一个能力的**实现（src）·断言（tests）·示例（examples）·文档（README/CHANGELOG）**四件必须在同一批保持一致；任何一件落后即视为该能力未完成。

---

## 四、本仓既定技术裁定（勿回潮）

- **对等件契约**：vite / @vitejs/plugin-react / esbuild 一律是**使用方自备**依赖——框架从使用方 cwd（或入口所在包）`createRequire` 解析 + 包含守卫（`isInside`/最近 package.json 锚），缺席/越界 **fail loud 拒启**，禁静默回落（2026-10-26 用户裁定）。
- **同进程单端口 HMR**：vite 以库形态 `middlewareMode` 内嵌载体进程，HMR ws 挂载体自己的 http 服务——**无独立 vite 端口、无子进程**（历史子进程桥形态已退役，勿再引用）。
- **面板协议**：源码入口 `export { inject, apply }`；装载面 `window.__ModuleLoader__.load({id, factory})`（框架装载器 `/__ling/boot.js` 提供缺省实现，宿主自持装载器不覆盖）；宿主页引面板走 `lingLoadPanels`（运行时动态导入）——**勿用** `<script src="/packages/…">`（vite html 转换前缀 base）或静态 import（html-proxy 中间件态 500）。
- **React Fast Refresh 语义**：组件与协议导出分模块（混出=热更重挂载丢状态）；StrictMode 使装载后首次热更重挂载一次；依赖预热（`optimizeDeps.entries` 约定探测）防首开优化器冷启动竞态。
- **路径纪律（Linux/Windows 双兼容）**：一切文件路径经 `node:path` join/relative；file URL 一律 `pathToFileURL()` 正造——**禁盘符/正斜杠字面拼接**（`file://C:/…` 拼接串在跨平台是坑）；跨平台展示位（报告 file 字段）正斜杠化。
- **env 纪律**：`/dev` 出口不读任何环境变量——开关/端口/路径全部由配置传值；逃生口（如 `enabled:false`）归调用方组合。
- **测试门禁**：`pnpm typecheck` + `pnpm test`（当前 103 例）+ 例程自检（`pnpm demo:check`；hmr-react 在包内 `pnpm dev --check` / `pnpm start --check`，例程依赖自备后可跑）全绿才算交付；`prepublishOnly` 三连（typecheck+test+build）。
- **注释语言**：代码注释一律中文；用户裁定内容必须在相关注释中显著写明。

## 五、能力面清单（动 API 先对表本清单）

| 能力 | 源码 | 示例 |
| --- | --- | --- |
| 运行时（Context/Fiber/事件/服务/Timer/Schema/日志） | `src/core` `src/plugins` `src/schema` | `examples/hello`（`pnpm smoke`） |
| 载体内核 runDevApp + RPC 空壳 | `src/dev/app.ts` `src/dev/rpc.ts` | `examples/dev-app`（`pnpm demo` / `demo:check`） |
| vite 内嵌 HMR + 客户端源码面 + 框架装载器 | `src/dev/hmr.ts` `src/dev/app.ts` | `examples/hmr-react`（包内 `pnpm dev` / `pnpm build` / `pnpm start`，各带 `--check`） |
| 面板产物构建件 buildClientBundle | `src/dev/client-bundle.ts` | `examples/hmr-react`（build:client 消费） |
| 检查编排 runCheckScripts/checkRegisteredModules | `src/dev/check.ts` | `tests/dev-kit-absorb.spec.ts` |
| 主题门引擎 themeGate | `src/dev/theme-gate.ts` | `tests/dev-kit-absorb.spec.ts`（bsh 树 theme-guard 为消费范本） |
| 模块注册表 + 编译编排 + 接线助手 | `src/dev/registry.ts` `build.ts` `link.ts` | `examples/dev-app` / `examples/hmr-react/build.mjs` |
| Web 路由器 | `src/webserver` | `tests/webserver.spec.ts` |

## 六、版本与发布

- SemVer；CHANGELOG 逐版条目（历史欠账已清：2.1.0/2.2.0/2.3.0 三版 2026-10-26 补齐）。
- `pnpm build`（tsdown 打包 JS + tsc 直出 d.ts）+ `pnpm check:dts`（外部消费者视角类型冒烟）后才可 publish。
