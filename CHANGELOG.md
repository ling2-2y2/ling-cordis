# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本语义遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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

[1.0.0]: https://github.com/ling2-2y2/ling-cordis/releases/tag/v1.0.0
