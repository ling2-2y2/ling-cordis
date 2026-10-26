# syntax=docker/dockerfile:1
# ling-cordis 标准消费者镜像（正典模板，2026-10-26 架构评审 O4 + 裁-2/裁-3 裁定形态）
#
# 形态口径：
# - 产物档（--product）：静态壳 dist/ + 子应用产物 client/client.js，运行镜像无 vite/esbuild/tsx；
# - npm 包形态（裁-3）：boot/ling.config/build 三处的演示形态相对 import（'../../src/dev/index.ts'）
#   在构建阶段重写为包出口（'@ling2/ling-cordis/dev'）——与真实使用方一字不差；
# - 基底 Debian 精简版（裁-2）：glibc 零原生模块兼容疑虑；
# - HOST=0.0.0.0 由 ling.config.mjs 薄壳读 env 传入 config.host——框架 /dev 出口零 env 纪律不破。
#
# 可复现性：LING_CORDIS_VERSION 钉版本（build/runtime 两阶段同值）。缺省 latest=
# CI 门禁档（只验可构建性，随 npm 最新走）；正式发布 `docker build --build-arg
# LING_CORDIS_VERSION=<新版本> .` 钉版（scripts/release.mjs 自动传新发布的版本号）。

# ── 阶段一：构建（全量 devDeps：vite / esbuild / plugin-react）─────────────────
FROM node:22-bookworm-slim AS build
ARG LING_CORDIS_VERSION=latest
WORKDIR /app
ENV CI=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 依赖层单独拷：源码改动不打湿依赖层（构建缓存的关键）；workspace.yaml=allowBuilds
# 门禁声明必须随依赖层进场（缺席=pnpm v10+ 以 ERR_PNPM_IGNORED_BUILDS 拒装，129 实证）
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
# 演示形态 → 消费方形态：三处相对 import 重写为 npm 包出口（本镜像正典=消费方形态）
RUN sed -i "s|from '../../src/dev/index.ts'|from '@ling2/ling-cordis/dev'|g" boot.mjs ling.config.mjs build.mjs \
  && corepack enable && pnpm add @ling2/ling-cordis@${LING_CORDIS_VERSION} \
  && pnpm build        # = node build.mjs：壳 dist/ + 子应用 client/client.js

# ── 阶段二：运行（仅产物与运行依赖；vite/esbuild/tsx 不进镜像）───────────────────
FROM node:22-bookworm-slim AS runtime
ARG LING_CORDIS_VERSION=latest
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8391
WORKDIR /app
# 重写后的 package.json（含钉版本的框架依赖）先落，再装运行依赖（pnpm add 只装该包，不装 devDeps）
COPY --from=build /app/package.json ./
RUN corepack enable && pnpm add @ling2/ling-cordis@${LING_CORDIS_VERSION}
# 重写后的消费方形态启动两件（从 build 阶段拷——上下文里是演示形态）
COPY --from=build /app/boot.mjs /app/ling.config.mjs ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/client ./client
USER node
EXPOSE 8391
# healthz 是 runDevApp 内建路由，零业务接线即可探活（产物档应答无 hmr 位）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>r.json()).then(j=>process.exit(j.ok===true?0:1)).catch(()=>process.exit(1))"
# docker stop → SIGTERM → runDevApp 有界停机（dispose 挂起 5s 强杀兜底）
CMD ["node", "boot.mjs", "--product"]
