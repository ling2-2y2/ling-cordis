/**
 * @ling2/ling-cordis/dev——开发者工具族出口：模块注册表（分相挂载单点）、
 * vite HMR 桥（子进程代管+HTTP 反代+ws 透传）、按表编译编排、载体内核
 * runDevApp（声明式配置→dev 服务器）、物理层接线助手族（junction/shim）。
 *
 * 全部为开发期机制，不并入运行时主出口（`.`）；env 纪律：是否建桥、端口取值、
 * 回落策略均归调用方，本出口不读任何环境变量。
 * @module @ling2/ling-cordis/dev
 */
export { ModuleRegistry, type ModuleEntry } from './registry.ts'
export { createViteHmrBridge, type ViteHmrBridge, type ViteHmrOptions } from './hmr.ts'
export { buildRegisteredModules, BuildFailedError, type BuildRegisteredOptions } from './build.ts'
export { defineApp, loadEnv, registryOf, runDevApp, type DevAppConfig, type DevAppEntry, type DevAppHandle, type DevHttpFace, type DevHttpFaceObject, type DevHttpHandler } from './app.ts'
export { createJsonRpcGateway, createRpcFace, parameterNamesOf, type JsonRpcGatewayOptions, type RpcAuthOptions, type RpcContext, type RpcFaceEntry, type RpcHook } from './rpc.ts'
export { ensureJunctions, pruneDangling, writeShim, type JunctionSpec, type ShimBridge } from './link.ts'
