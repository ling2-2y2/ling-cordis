/**
 * vite HMR 桥——dev 服务器进程内代管 vite dev 子进程：HTTP 管道反代 + WebSocket
 * 升级透传。机制自生产树排障链原样上收，四修内建：
 * ① `--host 127.0.0.1` 显式对齐（vite 默认听 ::1，反代 upstream 连不通）；
 * ② ws 握手头在桥内一次性构造（逐请求重拼=闭包错）；
 * ③ `\r\n` 经 `String.fromCharCode(13, 10)` 拼接（模板串裸换行在脚本层禁用）；
 * ④ 就绪探针 30s 有界（150×200ms），子进程死亡由 port 回落表达、不悬挂。
 *
 * 未激活语义：vite 入口缺席 / 子进程退出 / dispose → `port === 0`，
 * proxyHttp/proxyUpgrade 一律返回 false——回落策略（静态 dist、断开）归调用方。
 * vite 是使用方的对等件（cwd/node_modules 自备），本桥只 spawn 不依赖。
 * @module @ling2/ling-cordis/dev/hmr
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect as netConnect } from 'node:net'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'

const CRLF = String.fromCharCode(13, 10)

/** HMR 桥构造项。 */
export interface ViteHmrOptions {
  /** vite 项目目录（缺省 vite 入口 = <cwd>/node_modules/vite/bin/vite.js）。 */
  cwd: string
  /** vite 端口，缺省 5174；`--strictPort`（被占即子进程自败，不漂端口）。 */
  port?: number
  /** 反代目标主机，缺省 127.0.0.1（vite 默认听 ::1 的坑）。 */
  host?: string
  /** 自定义 vite 入口脚本（缺省按 cwd 推定；文件缺席=桥不激活，port 恒 0）。 */
  viteBin?: string
  /** 就绪探针路径，缺省 '/'（fetch 跟随重定向亦计就绪）。 */
  readyPath?: string
  /** 日志出口（缺省静默——库不刷屏）。 */
  logger?: (level: 'info' | 'warn', message: string) => void
}

/** 运行中的 HMR 桥（未激活态 port 恒 0，proxy* 返回 false）。 */
export interface ViteHmrBridge {
  /** 当前生效端口；0 = 未激活（入口缺席 / 子进程退出 / dispose）。 */
  readonly port: number
  /** 就绪探针（首轮探通或 30s 窗口耗尽即 resolve；从不 reject——死亡由 port 回落表达）。 */
  readonly ready: Promise<void>
  /** HTTP 反代（返回 true = 已接管应答；false = 未激活，调用方自行兜底）。 */
  proxyHttp(req: IncomingMessage, res: ServerResponse, pathWithQuery: string): boolean
  /** ws 升级透传（返回 true = 已接管 socket；false = 未激活，调用方处置）。 */
  proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean
  /** 停止子进程（幂等；port 归 0）。 */
  dispose(): void
}

/** 建桥：vite 入口在场即 spawn 子进程并启动就绪探针；缺席即静止回落态。 */
export function createViteHmrBridge(options: ViteHmrOptions): ViteHmrBridge {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 5174
  const log = options.logger ?? (() => {})
  const viteBin = options.viteBin ?? join(options.cwd, 'node_modules', 'vite', 'bin', 'vite.js')

  let active = 0
  let child: ChildProcess | undefined
  if (existsSync(viteBin)) {
    active = port
    child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort', '--host', host], {
      cwd: options.cwd, stdio: 'ignore', shell: false,
    })
    child.on('exit', () => {
      active = 0
      log('warn', 'vite 子进程退出——HTTP/ws 回落（port=0）')
    })
  } else {
    log('warn', `vite 入口缺席（${viteBin}）——桥不激活，port 恒 0`)
  }

  // 就绪探针：30s 有界窗口；每拍前查活跃位，子进程已死即提前收束。
  const ready = (async () => {
    const probeUrl = `http://${host}:${port}${options.readyPath ?? '/'}`
    for (let i = 0; i < 150; i += 1) {
      if (active === 0) return
      if (await fetch(probeUrl).then(() => true, () => false)) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  })()

  function proxyHttp(req: IncomingMessage, res: ServerResponse, pathWithQuery: string): boolean {
    if (active === 0) return false
    const upstream = httpRequest({
      host, port: active, method: req.method, path: pathWithQuery,
      headers: { ...req.headers, host: `${host}:${active}` },
    }, (viteRes) => {
      res.writeHead(viteRes.statusCode ?? 502, viteRes.headers)
      viteRes.pipe(res)
    })
    upstream.on('error', () => {
      try {
        res.writeHead(502, { 'content-type': 'text/plain' })
        res.end('vite dev upstream unreachable')
      } catch { /* 头已写则放弃 */ }
    })
    req.pipe(upstream)
    return true
  }

  function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (active === 0) return false
    const upstream = netConnect(active, host)
    upstream.on('connect', () => {
      // 原始握手重写：请求行+逐头拼裸报文（\r\n 拼接见模块头注③），head 帧先行补写
      let rawHead = `${req.method} ${req.url} HTTP/1.1` + CRLF
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        rawHead += `${key}: ${Array.isArray(value) ? value.join(', ') : value}` + CRLF
      }
      rawHead += CRLF
      upstream.write(rawHead)
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    return true
  }

  let disposed = false
  return {
    get port() { return active },
    ready,
    proxyHttp,
    proxyUpgrade,
    dispose() {
      if (disposed) return
      disposed = true
      child?.kill()
      active = 0
    },
  }
}
