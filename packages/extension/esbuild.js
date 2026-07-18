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
      process.stdout.write('[watch] build started\n');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      process.stdout.write('[watch] build finished\n');
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

      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
      process.stdout.write('[copy-webview] copied webview dist -> dist/webview\n');
    });
  },
};

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    banner: {
      js: "import { createRequire as __scoutCreateRequire } from 'node:module';\nconst require = __scoutCreateRequire(import.meta.url);",
    },
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin, copyWebviewPlugin],
  });
  if (watch) {
    await extensionCtx.watch();
  } else {
    await extensionCtx.rebuild();
    await extensionCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
