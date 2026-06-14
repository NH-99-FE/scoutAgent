# Scout Agent

AI Coding Agent — Chat-driven dev, code gen & edit, context-aware suggest, diagnose & fix.

## 项目结构

```
packages/
├── shared/       # Extension/Webview/package 边界协议契约
├── ai/           # Provider 与模型能力层
├── agent/        # Agent loop、harness、session tree、compaction
├── extension/    # VS Code 扩展宿主、core runtime、协议适配
└── webview/      # Webview UI（React + Vite + Tailwind）
```

Webview 与 Extension 通信边界见 [docs/webview-protocol.md](docs/webview-protocol.md)。

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发模式（webview dev server + extension watch）
pnpm dev
```

启动后 F5 调试扩展，侧边栏会自动通过 iframe 加载 Vite dev server（localhost:5173），支持 HMR 热更新。

> 如果没有启动 dev server，侧边栏会自动回退到本地构建产物，不会黑屏。

## 构建

```bash
# 生产构建（webview → extension/dist/webview + extension 压缩打包）
pnpm build
```

## 各包脚本

### packages/extension

| 命令 | 说明 |
|---|---|
| `pnpm compile` | 开发构建，生成 dist/extension.js（含 sourcemap） |
| `pnpm watch` | 监听模式，文件变更自动重编译，配合 F5 调试 |
| `pnpm package` | 生产构建，压缩 + 复制 webview 产物到 dist/ |
| `pnpm check-types` | 仅 TypeScript 类型检查，不输出文件 |

### packages/webview

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动 Vite dev server（localhost:5173），配合 extension watch 实现 HMR |
| `pnpm build` | 生产构建，输出到 ../extension/dist/webview/ |
| `pnpm preview` | 本地预览生产构建产物 |
