# ling-cordis

A standalone [cordis](https://github.com/koishijs/cordis)-lineage plugin runtime for TypeScript: composable **contexts**, lifecycle-managed **plugin fibers**, a typed **event bus**, **dependency-injected services**, **timer** mixins, **schema** validation (schemastery), and console **logging** — shipped as one dependency-free-to-consume ESM package.

> 简体中文文档见 [README.zh-CN.md](./README.zh-CN.md)。

## Features

- **Context tree** — proxy-based dependency container with prototypal scoping (`extend`, `isolate`, `intercept`).
- **Fibers** — every plugin runs in a fiber with epoch-based reload/unload, effect disposal, and config validation.
- **Event bus** — five dispatch modes (`emit` / `parallel` / `serial` / `bail` / `waterfall`) with typed event maps via module augmentation.
- **Services** — named APIs on `ctx` (`ctx.get(name)`), `@Inject()` decorator, callable services, intercept chains.
- **Timer** — `ctx.timeout` / `interval` / `throttle` / `debounce`, all owned by the surrounding fiber and disposed with it.
- **Schema** — the schemastery builder: declarative config schemas, standard-schema v1 interface, `Volatile` stable-reference configs.
- **Console logger** — leveled logging with colors, diff suffixes, and per-name palette.

## Requirements

- Node.js **≥ 22** (uses `Promise.withResolvers`)
- ESM only (`"type": "module"`); the browser logger entry ships as source but is not part of the published entry

## Install

```bash
npm install @ling2/ling-cordis
# or: pnpm add @ling2/ling-cordis
```

## Quick start

```ts
import { Context, LoggerConsole, Service, Timer } from '@ling2/ling-cordis'

// A plugin is a service named 'hello' exposed as ctx.hello
class Hello extends Service {
  static inject = [] as const
  constructor(ctx: Context) {
    super(ctx, 'hello')
    // timer mixins arrive with the Timer plugin; effects are
    // disposed together with the owning fiber
    ctx.setInterval(() => ctx.logger('hello').info('tick'), 1000)
  }
  greet(name = 'world') {
    return `hello, ${name}!`
  }
}

const ctx = new Context()
await ctx.plugin(LoggerConsole, { colors: false })
await ctx.plugin(Timer)
await ctx.plugin(Hello)

ctx.logger('app').info(ctx.get('hello').greet('cordis'))
await ctx.fiber.dispose() // runs every registered effect
```

A runnable version lives in [`examples/hello`](./examples/hello) (`pnpm smoke`).

## Modules

| Path | What it is | Upstream origin |
| --- | --- | --- |
| `src/core` | contexts, fibers, events, registry, services, logger | cordis |
| `src/kit` | array/string/time/type utilities, `Volatile` mechanism | cosmokit |
| `src/schema` | callable schema builder + validation | schemastery |
| `src/plugins/timer.ts` | timer mixins plugin | cordis-plugin-timer |
| `src/plugins/logger-console` | console exporter plugin | cordis-plugin-logger-console |

## Concepts

- **Context** — the root container and scope factory. Services, config layers, and isolation labels live on it; child scopes inherit prototypally.
- **Fiber** — one plugin activation: setup barriers, effects (disposers / promises / iterables), epoch-based `restart()` / `update()`.
- **Service** — a named singleton API on `ctx` (`ctx.get('hello')`); declare dependencies with `static inject` or the `@Inject()` decorator.
- **Events** — listeners are fiber-owned effects; augment the global `Events` interface to type your own events.
- **Schema** — describe plugin `Config` with `z.object({ port: z.number().default(3000) })`; validation runs before a fiber starts.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (39 cases)
pnpm build       # tsdown (bundled JS) + tsc (per-module d.ts tree)
pnpm check:dts   # compile the external-consumer type smoke against dist/
pnpm smoke       # boot examples/hello end-to-end
```

## License & attribution

MIT — see [LICENSE](./LICENSE). This project descends from Shigma's cordis
ecosystem (via an internal `@deepseek-ai/*` fork); the full provenance chain
and module mapping live in [NOTICE.md](./NOTICE.md).
