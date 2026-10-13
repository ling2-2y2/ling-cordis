/**
 * @ling2/ling-cordis 聚合入口——cordis 运行时单口出口。
 *
 * 布局：`core/` 框架内核（Context/Fiber/Registry/Events/Service/Logger），
 * `kit/` 通用工具箱（cosmokit 血缘，含 Volatile 稳定引用配置机制），
 * `schema/` Schema 构建与校验（schemastery），`plugins/` 官方插件
 * （timer 定时器混入、logger-console 控制台导出器）。
 *
 * Timer / LoggerConsole 为 boot 装配件出口（程序化 `ctx.plugin()` 装配）；
 * schemastery 以默认导出再出口（callable Schema 工厂）。
 * @module @ling2/ling-cordis
 */
export * from './core/index.ts'
export { default as Timer } from './plugins/timer.ts'
export { default as LoggerConsole } from './plugins/logger-console/index.ts'
export { default as schemastery } from './schema/index.ts'
