/**
 * dev-app 演示入口——3 行薄壳同款（与 bsh 树 scripts/dev.mjs 同构）。
 * 用法：
 *   node --import tsx/esm examples/dev-app/boot.mjs           # 常驻（浏览器把玩）
 *   node --import tsx/esm examples/dev-app/boot.mjs --check   # 自检档：登录+RPC+会话门
 *                                                             #   +healthz+静态页打勾即退（CI）
 * @module @ling2/ling-cordis/examples/dev-app/boot
 */
import { runDevApp } from '../../src/dev/index.ts'
import config from './ling.config.mjs'

const app = await runDevApp(config)

if (process.argv.includes('--check')) {
  const base = `http://127.0.0.1:${config.port}`
  const post = (path, body, token) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { satoken: token }) },
    body: JSON.stringify(body),
  }).then((res) => res.json())
  const login = await post('/api/auth/login', { account: 'demo', password: '123456' })
  const hello = await post('/api/demo/hello', { args: { name: 'ling-cordis' } }, login.token)
  const denied = await post('/api/demo/hello', { args: {} })
  const healthz = await fetch(`${base}/healthz`).then((r) => r.json())
  const page = await fetch(`${base}/app/`).then((r) => r.text())
  const checks = [
    ['登录发牌', login.ok === true],
    ['RPC 参数绑定（args 按名入参）', hello.ok === true && hello.value === 'hello, ling-cordis!'],
    ['会话门拦未登录', denied.ok === false],
    ['healthz faces=1', healthz.ok === true && healthz.faces === 1],
    ['静态 SPA 下发', page.includes('dev-app demo')],
  ]
  let failed = 0
  for (const [name, pass] of checks) {
    console.log(`[demo] ${pass ? '✓' : '✗'} ${name}`)
    if (!pass) failed += 1
  }
  if (checks[1][1] !== true) console.log(`[demo]   RPC 实际应答：${JSON.stringify(hello)}`)
  await app.dispose()
  // 退出码置位而非 process.exit——dispose 后强退会撞 Windows libuv 收尾断言
  if (failed > 0) console.error(`[demo] 自检 ${failed} 项未过`)
  else console.log('[demo] 自检 5/5 全过')
  process.exitCode = failed > 0 ? 1 : 0
}
