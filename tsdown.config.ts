import { defineConfig } from 'tsdown'

/**
 * JS 单入口打包（对齐上游 cordis 发布形态）；产物扩展名取 .js（type:module 下即 ESM）。
 * dts 不走打包器：相对路径模块增强（declare module './context.ts'）在单文件 dts 里会
 * 悬空失联——类型树改由 tsconfig.build.json 经 tsc 直出（dist 内相对路径自洽解析）。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: true,
  external: ['supports-color', '@standard-schema/spec'],
  outExtensions: () => ({ js: '.js' }),
})
