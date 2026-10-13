/**
 * HMR 桥机制回归——spawn/就绪探针/HTTP 反代/ws 升级透传/缺席与退出回落/dispose 幂等。
 * 子进程用仓内 fake-vite 替身（见 ./fixtures/fake-vite.mjs）；组合方式照生产消费方
 * （壳 http 服务器先问桥、桥不认领走回落），认领优先序归壳、不归桥。
 * @module @ling2/ling-cordis/tests/dev-hmr
 */
import { createServer, request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createViteHmrBridge, type ViteHmrBridge } from '../src/dev/index.ts'

const viteBin = fileURLToPath(new URL('./fixtures/fake-vite.mjs', import.meta.url))
const bridges: ViteHmrBridge[] = []
const shells: Server[] = []

afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.dispose()
  for (const server of shells.splice(0)) await new Promise((resolve) => server.close(resolve))
})

/** 起壳服务器：HTTP/ws 都先交桥，桥不认领走 504/断开（照生产消费方组合方式）。 */
function shellOf(bridge: ViteHmrBridge): Promise<number> {
  const server = createServer((req, res) => {
    if (!bridge.proxyHttp(req, res, req.url ?? '/')) {
      res.statusCode = 504
      res.end('fallback')
    }
  })
  server.on('upgrade', (req, socket, head) => {
    if (!bridge.proxyUpgrade(req, socket, head)) socket.destroy()
  })
  shells.push(server)
  return listenPort(server)
}

/** 监听 0 端口取内核分配值（测试体量下取值后释放的竞态可忽略）。 */
function listenPort(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

async function freePort(): Promise<number> {
  const probe = createServer()
  const port = await listenPort(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

describe('createViteHmrBridge', () => {
  it('就绪探针通后 HTTP 反代生效（host 头重写、管道透传回显路径）', async () => {
    const vitePort = await freePort()
    const bridge = createViteHmrBridge({ cwd: '.', viteBin, port: vitePort })
    bridges.push(bridge)
    expect(bridge.port).toBe(vitePort)
    await bridge.ready
    const shellPort = await shellOf(bridge)
    const res = await fetch(`http://127.0.0.1:${shellPort}/app/?x=1`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('fake-vite /app/?x=1')
  })

  it('vite 入口缺席：port 恒 0、HTTP 不认领（回落归调用方）、warn 一条', async () => {
    const logs: string[] = []
    const bridge = createViteHmrBridge({
      cwd: join(tmpdir(), 'ling-cordis-no-vite-here'),
      logger: (level, message) => { if (level === 'warn') logs.push(message) },
    })
    bridges.push(bridge)
    await bridge.ready
    expect(bridge.port).toBe(0)
    expect(logs.some((message) => message.includes('缺席'))).toBe(true)
    const shellPort = await shellOf(bridge)
    const res = await fetch(`http://127.0.0.1:${shellPort}/app/`)
    expect(res.status).toBe(504)
  })

  it('ws 升级透传：原始握手重写后假 vite 应答 101 并回写标记行', async () => {
    const vitePort = await freePort()
    const bridge = createViteHmrBridge({ cwd: '.', viteBin, port: vitePort })
    bridges.push(bridge)
    await bridge.ready
    const shellPort = await shellOf(bridge)
    const payload = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port: shellPort, path: '/app/hmr',
        headers: {
          connection: 'Upgrade', upgrade: 'websocket',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13',
        },
      })
      req.on('upgrade', (res, socket, chunk) => {
        expect(res.statusCode).toBe(101)
        let data = chunk.toString()
        if (data.includes('fake-vite-upgrade')) { socket.destroy(); resolve(data); return }
        socket.on('data', (more) => {
          data += more.toString()
          if (data.includes('fake-vite-upgrade')) { socket.destroy(); resolve(data) }
        })
      })
      req.on('error', reject)
      req.end()
    })
    expect(payload).toContain('fake-vite-upgrade:/app/hmr')
  })

  it('子进程死亡（__die 受控退出）：port 回落 0、认领随即停止', async () => {
    const vitePort = await freePort()
    const bridge = createViteHmrBridge({ cwd: '.', viteBin, port: vitePort })
    bridges.push(bridge)
    await bridge.ready
    expect(bridge.port).toBe(vitePort)
    await fetch(`http://127.0.0.1:${vitePort}/__die`)
    const deadline = Date.now() + 3000
    while (bridge.port !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(bridge.port).toBe(0)
  })

  it('dispose 幂等且即时回落 port=0', async () => {
    const vitePort = await freePort()
    const bridge = createViteHmrBridge({ cwd: '.', viteBin, port: vitePort })
    bridges.push(bridge)
    await bridge.ready
    bridge.dispose()
    bridge.dispose()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(bridge.port).toBe(0)
  })
})
