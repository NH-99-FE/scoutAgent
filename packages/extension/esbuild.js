import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * esbuild 错误格式化插件，将构建错误输出为可点击的文件位置
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

/**
 * 复制 webview 构建产物到 dist/webview/（仅生产构建时执行）
 * @type {import('esbuild').Plugin}
 */
const copyWebviewPlugin = {
  name: 'copy-webview',

  setup(build) {
    build.onEnd(() => {
      if (!production) return;

      const src = path.resolve(import.meta.dirname, '../webview/dist');
      const dest = path.resolve(import.meta.dirname, 'dist/webview');

      if (!fs.existsSync(src)) {
        console.warn('[copy-webview] webview dist not found, skipping copy');
        return;
      }

      fs.cpSync(src, dest, { recursive: true });
      console.log('[copy-webview] copied webview dist → dist/webview');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode', 'jiti'],
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin, copyWebviewPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
