#!/usr/bin/env node
/**
 * ling-cordis 发布流水线（2026-10-26 裁-6 用户裁定形态）——本地脚本编排：
 * **每个流程节点一个方法，串起来为一个自动流程**；不走 GitHub Actions 云端发布。
 *
 * 节点（单步可跑、全串 `all` 一发）：
 *   node scripts/release.mjs gates    # 门禁四连：typecheck / test / build / check:dts
 *   node scripts/release.mjs publish  # 发 npm（NODE_AUTH_TOKEN=.env npmjs_access_token；
 *                                      #   prepublishOnly 自动再跑 typecheck+test+build）
 *   node scripts/release.mjs push     # git 推双远端（origin=GitHub + gitee；凭据 .env）
 *   node scripts/release.mjs remote   # 129 上 docker build：上传构建上下文（tar 排除
 *                                      #   node_modules/dist/client）→ 解包 → 钉版本构建镜像
 *   node scripts/release.mjs run      # 129 上重建容器（docker rm -f + run -d，HOST=0.0.0.0）
 *   node scripts/release.mjs verify   # 探活三断言：healthz ok / 宿主页装载锚 / 子应用产物通道
 *   node scripts/release.mjs all      # 全串 gates→publish→push→remote→run→verify
 *
 * 旗标：--dry-run（publish/push 只打印不执行——外发动作保护）；--image-version <v>
 * （镜像钉版，缺省 latest 档=随 npm 最新走；全串 all 自动用 package.json 版本号）；
 * --remote-dir（129 工作目录，缺省 /opt/ling-cordis）。
 *
 * env（探测序：本仓 .env → bsh 树根 .env，gitignored 不入库）：npmjs_access_token /
 * GitHub_user / GitHub_password / gitee_user / gitee_password / DEPLOY_SSH_HOST /
 * DEPLOY_SSH_USER / DEPLOY_SSH_PW。远程通道=scripts/remote-exec.py（paramiko 薄桥，
 * 平移自 bsh 树部署先例）。本件纯 JS 零依赖（发布脚本不依赖 tsx/devDeps）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REMOTE_EXEC = join(dirname(fileURLToPath(import.meta.url)), 'remote-exec.py')

// ── env 装配（探测序：本仓 .env → bsh 树根 .env）────────────────────────────
function loadEnv() {
  const candidates = [join(repoRoot, '.env'), 'C:/workspace/deepseek-harness/scratch-plugin/bsh-scratch-plugin/.env']
  const file = candidates.find((p) => existsSync(p))
  const map = {}
  if (file === undefined) return map
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
  return map
}
const ENV = loadEnv()
const pkgVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : undefined
}
const DRY_RUN = argv.includes('--dry-run')
const REMOTE_DIR = argOf('--remote-dir') ?? '/opt/ling-cordis'
const CONTAINER = 'ling-hmr-react'
const PORT = '8391'

/** 节点输出头（统一前缀便于读流水）。 */
function step(name, detail) {
  console.log(`\n▶ [release:${name}] ${detail}`)
}

/** 打包构建上下文（examples/hmr-react 排除 node_modules/dist/client/.env → 仓根 dist/ 下 tgz）。
 *  坑知识（Windows 实证）：①不走 shell:true（反斜杠路径被拼接吃掉）；②tar 参数一律
 *  相对路径+cwd 进示例目录——GNU tar 把盘符冒号（C:\…）当远程主机（host:path 语法）
 *  报「Cannot connect to C:」；产物放仓根 dist/（gitignored 构建产物目录）天然无盘符。 */
function tarContext(root) {
  const outDir = join(root, 'dist')
  mkdirSync(outDir, { recursive: true })
  const fileName = `ling-cordis-rel-ctx-${Date.now()}.tgz`
  const run = spawnSync('tar', [
    '-czf', `../../dist/${fileName}`,
    // 排除项一律 ./ 根级锚定：GNU tar 的 --exclude 按成员名匹配任意层级——裸 'client'
    // 会把源码目录 src/client 一并排除（129 构建 esbuild 找不到入口实证）
    '--exclude', './node_modules', '--exclude', './dist', '--exclude', './client', '--exclude', './.env', '.',
  ], { cwd: join(root, 'examples', 'hmr-react') })
  if (run.status !== 0) throw new Error(`构建上下文打包失败（tar exit ${String(run.status)}：${String(run.stderr ?? '').slice(-300)}）`)
  return { file: join(outDir, fileName), bytes: statSync(join(outDir, fileName)).size }
}

// ── 远程桥（paramiko 薄桥：stdin JSON → stdout JSON）─────────────────────────
function remote(op, payload, timeoutMs = 600_000) {
  const run = spawnSync('python', [REMOTE_EXEC], {
    input: JSON.stringify({ op, ...payload }),
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  if (run.status !== 0 || run.stdout === undefined || run.stdout.trim() === '') {
    return { ok: false, error: `remote-exec.py 异常（exit ${String(run.status)}）：${(run.stderr ?? '').slice(-500)}` }
  }
  return JSON.parse(run.stdout)
}

// ── 节点①：门禁四连 ─────────────────────────────────────────────────────────
function gates() {
  step('gates', '门禁四连：typecheck / test / build / check:dts')
  for (const script of ['typecheck', 'test', 'build', 'check:dts']) {
    console.log(`  ▷ pnpm ${script}`)
    const run = spawnSync('pnpm', ['run', script], { cwd: repoRoot, stdio: 'inherit', shell: true })
    if (run.status !== 0) throw new Error(`门禁未过：pnpm ${script}（exit ${String(run.status)}）`)
  }
  console.log('  ✓ 门禁四连全绿')
}

// ── 节点②：发 npm ───────────────────────────────────────────────────────────
function publish() {
  const token = ENV.npmjs_access_token ?? ''
  if (token === '') throw new Error('.env 缺 npmjs_access_token——发 npm 需要凭据')
  step('publish', `发 npm @ling2/ling-cordis@${pkgVersion}（prepublishOnly 自动跑三连门禁）`)
  if (DRY_RUN) {
    console.log('  [dry-run] NODE_AUTH_TOKEN=*** pnpm publish --no-git-checks')
    return
  }
  const run = spawnSync('pnpm', ['publish', '--no-git-checks'], {
    cwd: repoRoot, stdio: 'inherit', shell: true,
    env: { ...process.env, NODE_AUTH_TOKEN: token },
  })
  if (run.status !== 0) throw new Error(`pnpm publish 失败（exit ${String(run.status)}）`)
  console.log(`  ✓ npm 已发布 @${pkgVersion}`)
}

// ── 节点③：git 推双远端 ─────────────────────────────────────────────────────
function push() {
  step('push', 'git 推双远端（origin=GitHub → gitee）')
  const authed = (user, pw, url, remoteName) => {
    if (user === undefined || pw === undefined) {
      console.warn(`  ⚠ .env 缺 ${remoteName} 凭据——该远端跳过`)
      return undefined
    }
    const m = /^https:\/\/([^/]+)\/(.*)$/u.exec(url)
    if (m === null) return undefined
    return `https://${encodeURIComponent(user)}:${encodeURIComponent(pw)}@${m[1]}/${m[2]}`
  }
  const targets = [
    ['origin', authed(ENV.GitHub_user, ENV.GitHub_password, 'https://github.com/ling2-2y2/ling-cordis.git', 'GitHub_user/GitHub_password')],
    ['gitee', authed(ENV.gitee_user, ENV.gitee_password, 'https://gitee.com/ling2/ling-cordis.git', 'gitee_user/gitee_password')],
  ]
  for (const [name, url] of targets) {
    if (url === undefined) continue
    if (DRY_RUN) { console.log(`  [dry-run] ${name}: git push <authed> main`); continue }
    console.log(`  ▷ push ${name}`)
    // 两段式：先裸 push（走系统凭据管理器——Windows credential manager 存有 PAT 时即通，
    // 实证 GitHub 侧此路通）；失败回落 .env 凭据 URL 注入（GitHub 已废账号密码认证，
    // 注入路仅在 password 实为 PAT 时可用）
    let run = spawnSync('git', ['push', name, 'main'], { cwd: repoRoot, stdio: 'inherit', shell: true })
    if (run.status !== 0 && url !== undefined) {
      console.log(`  ▷ 裸 push 未通，回落 .env 凭据注入`)
      run = spawnSync('git', ['push', url, 'main'], { cwd: repoRoot, stdio: 'inherit', shell: true })
    }
    if (run.status !== 0) throw new Error(`git push ${name} 失败（exit ${String(run.status)}）`)
  }
}

// ── 节点④：129 上 docker build ──────────────────────────────────────────────
function remoteBuild(imageVersion) {
  step('remote', `129 构建：打包上下文 → 上传 → docker build（钉 ${imageVersion}）`)
  const ctx = tarContext(repoRoot)
  console.log(`  ▷ 构建上下文 ${ctx.file}（${Math.round(ctx.bytes / 1024)} KB）`)
  const up = remote('put', { local: ctx.file, remote: `${REMOTE_DIR}/hmr-react-ctx.tgz` })
  rmSync(ctx.file, { force: true })
  if (!up.ok) throw new Error(`上下文上传失败：${up.error ?? ''}`)
  console.log('  ✓ 上下文已上传')
  const cmd = [
    `mkdir -p ${REMOTE_DIR}/hmr-react`,
    `&& tar xzf ${REMOTE_DIR}/hmr-react-ctx.tgz -C ${REMOTE_DIR}/hmr-react`,
    `&& docker build --build-arg LING_CORDIS_VERSION=${imageVersion} -t ling-cordis/hmr-react:${imageVersion} ${REMOTE_DIR}/hmr-react`,
  ].join(' ')
  console.log(`  ▷ docker build（钉 LING_CORDIS_VERSION=${imageVersion}）…`)
  const run = remote('exec', { cmd, tail: 8000 }, 900_000)
  if (run.stdout !== undefined && run.stdout !== '') console.log(run.stdout.split('\n').slice(-12).join('\n'))
  if (!run.ok) throw new Error(`远端 docker build 失败：${(run.stderr ?? run.error ?? '').slice(-800)}`)
  console.log(`  ✓ 镜像 ling-cordis/hmr-react:${imageVersion} 已在 129 构建`)
}

// ── 节点⑤：129 上重建容器 ───────────────────────────────────────────────────
function remoteRun(imageVersion) {
  step('run', `129 重建容器 ${CONTAINER}（HOST=0.0.0.0，宿主端口 ${PORT}）`)
  const cmd = [
    `docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`,
    `&& docker run -d --name ${CONTAINER} -p ${PORT}:${PORT} -e HOST=0.0.0.0 -e PORT=${PORT} --restart unless-stopped ling-cordis/hmr-react:${imageVersion}`,
  ].join(' ')
  const run = remote('exec', { cmd })
  if (!run.ok) throw new Error(`远端 docker run 失败：${(run.stderr ?? run.error ?? '').slice(-500)}`)
  console.log(`  ✓ 容器已启动（${String(run.stdout ?? '').trim().slice(0, 12)}…）`)
}

// ── 节点⑥：探活三断言 ───────────────────────────────────────────────────────
async function verify() {
  const host = ENV.DEPLOY_SSH_HOST ?? ''
  if (host === '') throw new Error('.env 缺 DEPLOY_SSH_HOST——探活需要目标地址')
  step('verify', `探活 http://${host}:${PORT}/ 三断言（healthz/宿主页装载锚/子应用产物通道）`)
  await new Promise((r) => setTimeout(r, 3000)) // 容器起身后短候
  const base = `http://${host}:${PORT}`
  const healthz = await fetch(`${base}/healthz`).then((r) => r.json()).catch(() => undefined)
  if (healthz?.ok !== true) throw new Error(`healthz 未过：${JSON.stringify(healthz)}`)
  console.log('  ✓ healthz ok（产物档应答，无 hmr 位）')
  const page = await fetch(`${base}/app/`).then((r) => r.text()).catch(() => '')
  if (!page.includes('__bootCount') || !page.includes('__ling/main.js')) throw new Error('宿主页断言未过（装载锚缺席）')
  console.log('  ✓ 宿主页下发（装载计数锚 + main.js 一行接线）')
  const subapp = await fetch(`${base}/packages/demo`).then((r) => r.text()).catch(() => '')
  if (!subapp.includes('window.__ModuleLoader__.load')) throw new Error('子应用产物通道断言未过（装载面缺席）')
  console.log('  ✓ 子应用产物通道（/packages/demo = 子应用协议注册器）')
}

// ── 编排 ────────────────────────────────────────────────────────────────────
const NODE = argv.find((a) => !a.startsWith('--')) ?? 'all'
const imageVersion = argOf('--image-version') ?? (NODE === 'all' ? pkgVersion : 'latest')
const flow = {
  gates, publish, push,
  remote: () => remoteBuild(imageVersion),
  run: () => remoteRun(imageVersion),
  verify,
  all: async () => {
    gates(); publish(); push(); remoteBuild(pkgVersion); remoteRun(pkgVersion); await verify()
    console.log(`\n✅ 发布流水线全串完成：npm@${pkgVersion} → 双远端已推 → 129 镜像/容器/探活全绿`)
  },
}
if (flow[NODE] === undefined) {
  console.error(`未知节点 '${NODE}'（可用：${Object.keys(flow).join(' / ')}）`)
  process.exitCode = 1
} else {
  try {
    await flow[NODE]()
  } catch (error) {
    console.error(`\n❌ [release:${NODE}] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
