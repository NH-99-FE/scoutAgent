# Scout Agent

Scout Agent 是一个运行在 VS Code 中的轻量 AI Coding Agent。它以对话为入口，能够读取和检索项目、执行命令、修改文件，并用可恢复的会话树保存完整工作过程。

项目以 Pi Agent（本地对照仓库为 `../pi`）为行为参照，但刻意收窄了模型接入范围：目前只支持 **OpenAI** 和 **Anthropic**，且只支持 **API Key** 鉴权。

> 项目仍处于开发阶段，当前推荐从源码启动并通过 VS Code Extension Host 使用。

## 能做什么

### 编码与协作

- 流式展示回答、推理过程、工具调用和执行结果。
- 使用 `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls` 完成代码阅读、搜索、修改和验证。
- 在输入区通过 `@` 搜索并引用工作区文件，也可以从选择器添加文件或目录。
- 附加 PNG、JPEG、WebP 等图片作为多模态上下文；单张最大 2 MB，单次最多 6 张。
- 实时预览文件写入与编辑 diff，并在独立 Changes Review 面板中按 unified/split 模式审查本轮改动。
- 在模型回复期间发送 steering 消息或排队 follow-up，也可以停止当前生成与自动重试。

### 模型与运行策略

- 内置 OpenAI Responses 与 Anthropic Messages 适配器。
- 支持 OpenAI Chat Completions 形态的自定义模型和兼容端点。
- 可在会话中切换模型、推理强度和工具模式。
- 支持自定义 Base URL、Headers、兼容性声明、上下文窗口、输出上限、费用与推理等级映射。
- 支持 SSE、WebSocket、自动重试、上下文溢出恢复和自动压缩。

### 会话与历史

- 会话以 append-only JSONL 树持久化，可恢复、重命名、删除、导入和导出。
- 支持从历史消息分叉、切换树节点、给节点添加标签，以及为被放弃的分支生成摘要。
- 提供任务历史搜索、跨工作区会话列表和最近任务入口。
- 自动压缩长上下文，并在恢复、压缩或树导航后重建实际模型上下文。

### 可扩展资源

- 自动发现项目级和用户级 Skills，通过 `/skill-name` 显式调用，也可按配置注入模型上下文。
- 支持提示词模板和 slash command；内置 `/tree`、`/compact`、`/fork`。
- 支持 TypeScript/JavaScript 扩展注册事件处理器、工具和命令。
- 扩展可向 Webview 发起确认、选择、文本输入和通知请求；设置页内置 Permission Gate 示例模板。
- 项目级与全局级资源可分别配置，并支持额外路径和 package manifest 资源。

## 支持边界

| 能力 | 当前支持 |
| --- | --- |
| Provider | OpenAI、Anthropic |
| 鉴权 | API Key 或保存 API Key 的环境变量名 |
| API | `openai-responses`、`openai-completions`、`anthropic-messages` |
| 自定义端点 | 支持，需属于 OpenAI 或 Anthropic provider |
| OAuth / 云平台专用鉴权 | 不支持 |
| VS Code | `^1.120.0` |

Scout 不会把其它 provider 或鉴权方式隐式映射到现有实现。接入 OpenAI 协议兼容服务时，应在 OpenAI provider 下注册自定义 `openai-completions` 模型。

## 快速开始

### 1. 准备环境

- VS Code 1.120 或更高版本
- Node.js 与 Corepack
- pnpm 11.7.0

```bash
corepack enable
pnpm install
```

### 2. 启动开发模式

```bash
pnpm dev
```

该命令会同时启动：

- Webview Vite 开发服务器：`http://localhost:5173`
- Extension esbuild watch

随后在 VS Code 中按 `F5`，启动 Extension Development Host。打开 Activity Bar 中的 **Scout Agent** 即可进入任务首页。开发服务器不可用时，扩展会回退到已构建的本地 Webview 产物。

### 3. 配置模型

在命令面板执行 **Open Scout Settings**，进入“模型”页，为 OpenAI 或 Anthropic 填写 API Key，并选择默认模型。

API Key 字段可以填写：

- 实际 API Key；
- 环境变量名，例如 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`。

模型配置保存在 `~/.scout/agent/models.json`。例如：

```json
{
  "providers": {
    "openai": {
      "apiKey": "OPENAI_API_KEY"
    },
    "anthropic": {
      "apiKey": "ANTHROPIC_API_KEY"
    }
  }
}
```

如果填写的是环境变量名，需要确保启动 VS Code 的 Extension Host 能读取该变量。模型页也可以直接配置 Base URL、自定义模型和兼容参数，无需手动编辑 JSON。

### 4. 开始任务

1. 在任务首页输入需求，按 Enter 创建会话。
2. 使用 `@` 引用相关文件，或通过输入区左侧按钮添加文件、目录和图片。
3. 在发送前选择模型、推理强度和工具模式。
4. Agent 修改文件后，从输入区活动条或消息中的入口打开 Changes Review。
5. 使用 `/fork` 创建分支、`/tree` 浏览会话树、`/compact` 手动压缩上下文。

## 工具模式

Scout 内置两种工具 profile，也支持在设置中创建自定义 profile。

| 模式 | 工具 | 适用场景 |
| --- | --- | --- |
| 开发模式 `develop` | `read`、`bash`、`edit`、`write`，以及扩展注册工具 | 实现、修复、运行命令 |
| 审查模式 `review` | `read`、`grep`、`find`、`ls` | 只读分析、代码审查 |

自定义 profile 可以从所有已注册工具中选择工具。工具模式属于会话运行上下文，新会话可使用全局或项目设置中的默认值。

## 配置与数据目录

| 路径 | 用途 |
| --- | --- |
| `~/.scout/agent/models.json` | Provider API Key、端点和自定义模型 |
| `~/.scout/agent/settings.json` | 全局运行设置 |
| `<workspace>/.scout/settings.json` | 项目运行设置，覆盖全局设置 |
| `~/.scout/agent/sessions/` | 按工作目录分组的 JSONL 会话 |
| `~/.scout/agent/{skills,prompts,extensions}/` | 用户级资源 |
| `<workspace>/.scout/{skills,prompts,extensions}/` | 项目级资源 |
| `~/.agents/skills/`、`<workspace>/.agents/skills/` | 自动扫描的兼容 Skills 目录 |

项目设置会深度覆盖全局设置；数组类配置按 scope 整体覆盖，不会隐式拼接。设置页可以在 Global 与 Project 两个 scope 之间切换并查看最终生效值。

主要运行设置包括：

- 默认 provider、模型、推理强度和工具 profile；
- steering/follow-up 队列策略；
- compaction 与 branch summary token 预算；
- transport、超时、重试和 WebSocket 连接策略；
- shell 路径；
- packages、extensions、skills、prompts 资源路径。

## Skills、Prompts 与 Extensions

### Skills

Skill 使用 `SKILL.md` 和 frontmatter 描述名称与用途。设置页可以查看自动扫描目录、添加额外路径、启停 Skill、打开源文件，并检查无效 frontmatter、重名覆盖等诊断信息。

设置了 `disable-model-invocation: true` 的 Skill 不会自动出现在模型上下文中，但仍可通过 slash command 手动调用。

### Prompts

项目级或用户级 `prompts` 目录中的提示词模板会成为 slash command。选择后由 runtime 展开并提交，不需要 Webview 理解模板内部结构。

### Extensions

扩展可以监听 session、agent、message、tool 等生命周期事件，注册自定义工具和 slash command，并调用会话动作。扩展入口与当前 UI 能力边界见 [Scout Extension API](docs/extension-api.md)。

设置页可以：

- 查看项目级、用户级和额外路径中的扩展；
- 打开扩展源文件；
- 从模板创建扩展；
- 重新加载资源并查看加载错误。

## 架构

```text
shared（纯契约）
  ↑
ai（Provider / Model / Stream）
  ↑
agent（Agent loop / Harness / Session / Compaction）
  ↑
extension/core（Runtime / Retry / Context / Resources）
  ↑
extension/host（VS Code Host / Protocol Adapter）
  ↕ shared protocol
webview（React UI）
```

| 包 | 职责 |
| --- | --- |
| `packages/shared` | Extension、Webview 与 package 边界使用的稳定协议和数据契约 |
| `packages/ai` | 模型目录、provider 注册、请求适配和统一流式事件 |
| `packages/agent` | Agent 状态与循环、工具调用、harness、session tree、compaction |
| `packages/extension` | VS Code 宿主、session runtime、资源加载、协议服务与工具实现 |
| `packages/webview` | React 19、Vite、Tailwind CSS 驱动的聊天、设置、树和审查界面 |

依赖只能沿上述方向流动。Extension 与 Webview 只通过 `@scout-agent/shared` 中的消息协议通信；持久 session tree 与下一次 provider 请求使用的 runtime context 是两个职责明确、可短暂分叉的状态。

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Webview HMR 与 Extension watch |
| `pnpm build` | 构建 shared、ai、agent、webview，并打包 extension |
| `pnpm check-types` | 构建 shared 并检查 Extension/Webview 类型 |
| `pnpm test` | 运行所有 Vitest 项目 |
| `pnpm test:watch` | 监听模式运行测试 |
| `pnpm test:coverage` | 生成 V8 覆盖率报告 |
| `pnpm lint` | 运行 ESLint |
| `pnpm lint:fix` | 自动修复可修复的 lint 问题 |
| `pnpm format` | 使用 Prettier 格式化仓库 |
| `pnpm commit` | 通过 Commitizen 创建规范提交 |

常用包内命令：

```bash
pnpm -C packages/ai test
pnpm -C packages/agent test
pnpm -C packages/extension check-types
pnpm -C packages/extension package
pnpm -C packages/webview check-types
pnpm -C packages/webview test
```

AI E2E 测试会检测凭证；未配置相应 API Key 时自动跳过，不影响本地单元测试。

## 进一步阅读

- [Webview 协议边界](docs/webview-protocol.md)
- [Extension API 与 UI 子集](docs/extension-api.md)
- [文件、图片上下文与搜索](docs/composer-file-image-context-and-search.md)
- [Changes Review 与工具预览](docs/changes-review-tool-preview-followup.md)
- [Provider API 归一化说明](docs/provider-api-normalization-notes.md)
- [消息更新、停止与运行态展示](docs/message-update-pause-analysis.md)
