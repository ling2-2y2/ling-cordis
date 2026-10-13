# examples

可直接跑的两个示例。仓内演示走源码相对路径（免构建直跑）；消费者视角把
`'../../src/index.ts'` 换成 `'@ling2/ling-cordis'`、`'../../src/dev/index.ts'`
换成 `'@ling2/ling-cordis/dev'` 即同款。

| 示例 | 一句话 | 运行 |
| --- | --- | --- |
| [`hello`](./hello) | 运行时最小链：Context + LoggerConsole + Timer + 自定义服务 | `pnpm smoke` |
| [`dev-app`](./dev-app) | **薄配置完整样**：一份 `ling.config.mjs` 跑起 dev 服务器——三相插件挂载（default/命名空间双出口）+ JSON-RPC 网关（登录 / 参数绑定 / 会话门）+ **跨模块前后端两腿**（前端换命名空间直调 demo1；demo2 `static inject` 依赖 demo1、面内穿透组合）+ 静态 SPA + healthz | `pnpm demo`（浏览器开 <http://127.0.0.1:8390/>）｜`pnpm demo:check`（自检档） |

dev-app 自检档一条命令验全链（进 CI）：

```bash
pnpm demo:check
# [demo] ✓ 登录发牌
# [demo] ✓ RPC 参数绑定（args 按名入参）
# [demo] ✓ 会话门拦未登录
# [demo] ✓ 前端跨模块：demo1 直调（/api/demo1/double）
# [demo] ✓ 后端跨模块：demo2.report 内部穿透 demo1.double
# [demo] ✓ healthz faces=3
# [demo] ✓ 静态 SPA 下发
```
