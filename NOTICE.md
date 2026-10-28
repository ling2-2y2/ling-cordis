# NOTICE

This project is a standalone extraction and restructuring of the cordis plugin
framework runtime.

## Provenance

1. **cordis / cosmokit / schemastery** — originally created and copyrighted by
   Shigma and contributors (koishijs / cordis ecosystem), MIT License
   (`Copyright (c) 2021-present Shigma`). The upstream MIT license and
   copyright notice are retained in the root `LICENSE` file.

2. **`@deepseek-ai/*` fork** — the immediate source of the code in this
   repository is an internal fork of the packages above, published under the
   `@deepseek-ai` scope (deepseek-harness monorepo, baseline commit
   `40a29d87c1f548bb7cde508332cd836407bf40ef`, mirrored 2026-10-08). The fork
   adds a `Volatile` config-by-reference mechanism to cosmokit that is carried
   forward in `src/kit/volatile.ts`.

3. **This repository** — extracted, restructured (`src/core`, `src/kit`,
   `src/schema`, `src/plugins`), rebranded and republished as
   `@ling2/ling-coris`.

## Module mapping

| Path                       | Upstream package                             | Version       |
| -------------------------- | -------------------------------------------- | ------------- |
| `src/core`                 | @deepseek-ai/cordis                          | 4.0.5-alpha.1 |
| `src/kit`                  | @deepseek-ai/cosmokit                        | 1.8.6-alpha.1 |
| `src/schema`               | @deepseek-ai/schemastery                     | 3.18.5-alpha.1 |
| `src/plugins/timer.ts`     | @deepseek-ai/cordis-plugin-timer             | 1.1.7-alpha.1 |
| `src/plugins/logger-console` | @deepseek-ai/cordis-plugin-logger-console  | 1.0.5-alpha.1 |

No additional restrictions beyond the upstream MIT license apply.
