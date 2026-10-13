/**
 * @ling2/ling-cordis/dev——开发者工具族出口：模块注册表（分相挂载单点）、
 * vite HMR 桥（子进程代管+HTTP 反代+ws 透传）、按表编译编排。
 *
 * 全部为开发期机制，不并入运行时主出口（`.`）；env 纪律：是否建桥、端口取值、
 * 回落策略均归调用方，本出口不读任何环境变量。
 * @module @ling2/ling-cordis/dev
 */
export { ModuleRegistry, type ModuleEntry } from './registry.ts'
export { createViteHmrBridge, type ViteHmrBridge, type ViteHmrOptions } from './hmr.ts'
export { buildRegisteredModules, BuildFailedError, type BuildRegisteredOptions } from './build.ts'
