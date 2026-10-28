/**
 * vite 工程（ling-web 形态消费者——自带配置文件；零 vite.config 原型见
 * ling-harness-runner/README 与 ling-coris README「前端 HMR」节）：
 * dev=vite 内嵌件自然合并本文件（React 插件在此，hmr 勿再设 react:true 防双开）；
 * build=`vite build` 出 dist（产物形态 staticApp 根）。
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/app/',
  plugins: [react()],
})
