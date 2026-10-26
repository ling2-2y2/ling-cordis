# examples

可直接跑的三个示例。仓内演示走源码相对路径（免构建直跑）；消费者视角把
`'../../src/index.ts'` 换成 `'@ling2/ling-cordis'`、`'../../src/dev/index.ts'`
换成 `'@ling2/ling-cordis/dev'` 即同款。

| 示例 | 一句话 | 运行 |
| --- | --- | --- |
| [`hello`](./hello) | 运行时最小链：Context + LoggerConsole + Timer + 自定义服务 | 仓根 `pnpm smoke` |
| [`dev-app`](./dev-app) | **薄配置完整样**：一份 `ling.config.mjs` 跑起 dev 服务器——三相插件挂载（default/命名空间双出口）+ JSON-RPC 网关（登录 / 参数绑定 / 会话门）+ **跨模块前后端两腿**（前端换命名空间直调 demo1；demo2 `static inject` 依赖 demo1、面内穿透组合）+ 静态 SPA + healthz | 仓根 `pnpm demo`（浏览器开 <http://127.0.0.1:8390/>）｜`pnpm demo:check`（自检档） |
| [`hmr-react`](./hmr-react) | **前端 HMR 最小样（ling-web 形态）**：标准 `vite.config.ts` + 项目标配三命令——vite 内嵌同进程单端口、React Fast Refresh、子应用源码面（dev）/产物通道（产物） | 包内三命令（见下） |

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

## hmr-react：项目标配三命令

依赖自备（vite/@vitejs/plugin-react/esbuild 是使用方对等件——框架缺席即拒启
fail loud，不静默回落）：

```bash
cd examples/hmr-react && pnpm install --ignore-workspace

pnpm dev      # 开发环境（HMR）：http://127.0.0.1:8391/app/ ——改 src/client/DemoView.tsx
              #   即时热更（页面变、不刷新、计数器状态保持）；加 --check 跑 4 项自检
pnpm build    # 编译产物两件：子应用 client/client.js（子应用协议注册器）+ 壳 dist/
              #   （vite build；产物形态 staticApp 根）
pnpm start    # 产物形态启动（吃 build 产物、无 vite）；加 --check 跑 4 项自检
```

三命令各自的角色：`dev`=vite 内嵌 HMR 源码直载（改码即热更）；`build`=把源码
编译成可部署产物；`start`=跑产物（行为与 dev 同一页面、同一子应用协议装载面）。
