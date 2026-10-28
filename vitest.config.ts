/**
 * 自含 vitest 配置——测试一律相对导入 `../src/index.ts`，无需 paths 映射；
 * 内联标准 TS 装饰器预转换插件（registry 测试用真 `@Inject()` 语法，
 * Vite 默认解析器不认标准装饰器，须先经 ts.transpileModule 降级）。
 */
import ts from 'typescript'
import { defineConfig, type Plugin } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/** 在 Vite 默认解析器见到源码前，预转换标准 TS 装饰器。 */
function standardDecoratorPlugin(): Plugin {
  return {
    name: 'ling-coris-standard-decorators',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- 编译器合成的装饰器访问器无源行为 */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
