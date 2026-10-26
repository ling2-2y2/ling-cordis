/**
 * @ling2/ling-cordis/dev——开发者工具族出口：模块注册表（分相挂载单点）、
 * vite 内嵌件（同进程同端口 HMR，2026-10-26 用户裁定形态）、按表编译编排、
 * 载体内核 runDevApp（声明式配置→dev 服务器）、物理层接线助手族（junction/shim）。
 *
 * 全部为开发期机制，不并入运行时主出口（`.`）；env 纪律：是否内嵌、回落策略
 * 均归调用方，本出口不读任何环境变量。
 * @module @ling2/ling-cordis/dev
 */
export { ModuleRegistry, type ModuleEntry } from './registry.ts'
export { createViteEmbed, type ViteEmbed, type ViteEmbedOptions } from './hmr.ts'
export { buildRegisteredModules, BuildFailedError, type BuildRegisteredOptions } from './build.ts'
export { defineApp, loadEnv, registryOf, runDevApp, type DevAppConfig, type DevAppEntry, type DevAppHandle, type DevHttpFace, type DevHttpFaceObject, type DevHttpHandler } from './app.ts'
export { createRpcServer, createRpcFace, faceInvoker, jsonResponder, parameterNamesOf, readRequestBody, rpcSendJson, type RpcContext, type RpcFaceEntry, type RpcLayer, type RpcMiddleware, type RpcServerOptions } from './rpc.ts'
export { ensureJunctions, pruneDangling, writeShim, type JunctionSpec, type ShimBridge } from './link.ts'
