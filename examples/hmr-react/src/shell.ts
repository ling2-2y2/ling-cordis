/**
 * 页面壳入口（ling-web 形态：index.html 的 module 入口，构建进 dist 资产）——
 * 先拉框架装载器（/__ling/boot.js=载体路由，运行时 URL 不进构建图），再装载面板。
 * dev 态同一路径可用（vite 服务 /src/shell.ts，React 前导自动注入 html）。
 * 无顶层 await：vite 缺省构建目标（es2020）不支持——承诺链同语义。
 * @module @ling2/ling-cordis/examples/hmr-react/src/shell
 */
type Boot = { lingLoadPanels?: (keys: string[]) => unknown[] }

const rawImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>

void rawImport('/__ling/boot.js')
  .then(() => {
    const boot = (window as unknown as Boot).lingLoadPanels
    if (boot === undefined) throw new Error('框架装载器未就绪（/__ling/boot.js 未定义 lingLoadPanels）')
    return Promise.all(boot(['demo']))
  })
  .catch((error: unknown) => {
    console.error('[shell] 装载失败', error)
    const root = document.getElementById('root')
    if (root !== null) root.textContent = `装载失败：${String((error as Error)?.message ?? error)}`
  })
