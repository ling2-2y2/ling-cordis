#!/usr/bin/env node
/**
 * 假 vite——HMR 桥机制测试的替身子进程：解析 --port/--host 起最小 HTTP 服务
 * （任意 GET 200 回显路径），ws 升级应答 101 并回写标记行后收尾。
 * 真 vite 属使用方对等件，本仓零依赖；真 vite 全链验证由使用方 pnpm dev 真机承担。
 */
import { createServer } from 'node:http'

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const hostIdx = args.indexOf('--host')
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 5199
const host = hostIdx >= 0 ? String(args[hostIdx + 1]) : '127.0.0.1'
const CRLF = String.fromCharCode(13, 10)

const server = createServer((req, res) => {
  // __die=受控退出端点（测桥的"子进程退出→port 回落"语义；端口被占自败属
  // vite --strictPort 自身行为且 Windows 下 libuv 端口语义与 Unix 不同，不在此测）
  if (req.url === '/__die') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.once('finish', () => process.exit(0))
    res.end('dying')
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(`fake-vite ${req.url ?? ''}`)
})
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols' + CRLF + 'Upgrade: websocket' + CRLF + 'Connection: Upgrade' + CRLF + CRLF)
  socket.write(`fake-vite-upgrade:${req.url ?? ''}`)
  socket.end()
})
// 端口被占（--strictPort 语义模拟）等监听失败：确定性退出，桥侧回落 port=0
server.on('error', () => process.exit(1))
server.listen(port, host)
