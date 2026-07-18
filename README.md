# Scout Coding Agent

Scout Agent 是一个运行在 VS Code 中的轻量 AI Coding Agent。它以对话为入口，能够读取和检索项目、执行命令、修改文件，并用可恢复、可分支的会话树保存完整开发过程。

目前只支持 **OpenAI** 和 **Anthropic**，且只支持 **API Key** 鉴权。

> 项目核心功能已开发完成，可直接从 VS Code 插件市场安装，也可以使用仓库内提供的 VSIX 安装包离线安装。

## 核心设计

Scout 的目标，不是做一个只能连续对话的 AI 侧边栏，而是在 VS Code 中提供一套完整的 **coding-agent harness**。模型接入、上下文构建、工具执行、会话持久化、错误恢复和界面交互都由 Scout 统一组织，让 Agent 能够在真实项目中持续工作，而不是停留在一次问答或一次代码生成。

在执行层，我们用清晰的 Agent loop：每轮请求都将系统指令、当前 Runtime Context、可用工具和相关资源交给模型。模型可以直接回复，也可以发起工具调用；Scout 校验并执行工具，将结果记录到会话，再交给模型继续判断。这个循环会持续到任务完成、需要用户补充信息、发生无法恢复的错误或用户主动停止。

```text
Session Tree → 构建 Runtime Context → 模型推理 → 工具调用
      ↑                                      ↓
      └────────── 持久化消息与执行结果 ← 工具执行
```

在状态层，我们刻意将持久历史与模型上下文分开管理。Session Tree 以 append-only 方式保存用户消息、模型回复、工具调用、执行结果和压缩节点，是任务恢复、历史导航和分支追溯的事实来源；Runtime Context 则只表示下一次模型请求真正使用的消息集合，并根据当前树路径和运行状态构建。

选择这种分离，是因为长时间开发中的历史记录与模型当下需要看到的内容并不总是相同。基于这一设计，Tree 可以切换当前路径并重建上下文，Fork 可以从历史节点派生独立任务，Compact 可以用结构化摘要缩短运行态上下文而不删除原始记录。恢复会话、自动重试和上下文溢出恢复也只重建或调整 Runtime Context，不会回滚已经持久化的任务历史。Skills、模型配置和启用的工具，则会在每轮请求前按当前任务状态加入运行环境。

## 安装

### 从插件市场安装（推荐）

在 VS Code 扩展面板中搜索以下插件标识：

```text
lianglh.scout-coding-agent
```

也可以直接访问 [VS Code Marketplace：Scout Coding Agent](https://marketplace.visualstudio.com/items?itemName=lianglh.scout-coding-agent) 安装。

### 使用仓库内安装包

项目在 [`packages/extension/scout-coding-agent-0.0.2.vsix`](packages/extension/scout-coding-agent-0.0.2.vsix) 提供了可直接安装的 VSIX 包。

在 VS Code 中打开命令面板，执行 **Extensions: Install from VSIX...**，选择该文件即可。也可以在仓库根目录运行：

```bash
code --install-extension packages/extension/scout-coding-agent-0.0.2.vsix
```

安装完成后，如未立即出现 Scout Agent 入口，请重新加载 VS Code 窗口。

## 核心能力：Tree、Fork 与 Compact

Scout 不会把一次开发任务压平成只能向前滚动的聊天记录。每条用户消息、模型回复、工具调用和上下文压缩都会进入 append-only 会话树；你可以随时回到一个决策点继续尝试，把其中一条路径拆成独立任务，并在长时间开发中压缩模型上下文而不丢失原始历史。

| 能力 | 解决的问题 | 执行结果 | 入口 |
| --- | --- | --- | --- |
| Tree（会话树） | 回看决策、切换节点、探索多个实现方向 | 在当前任务中形成新分支，原历史不变 | `/tree` 或 **Open Scout Tree** |
| Fork（分叉任务） | 从历史需求派生可独立演进的方案 | 创建继承分叉点上下文的新任务 | `/fork` 并选择历史用户消息 |
| Compact（上下文压缩） | 长任务接近模型上下文上限 | 用结构化摘要替代早期运行态上下文，保留近期消息和完整持久历史 | 自动触发或输入 `/compact` |

### Tree：把开发过程当作可导航的决策树

输入 `/tree` 可打开独立的会话树面板。你可以：

- 查看当前任务中的用户消息、模型回复、工具调用、压缩点与不同分支；
- 搜索节点，或按“无工具”“用户”“已标记”等视图筛选；
- 为关键节点添加标签，例如“重构前”“方案 A”“测试已通过”；
- 切换到任意历史节点，从该节点对应的上下文继续开发；
- 切换分支时选择不摘要、自动摘要被放弃的分支，或提供自定义摘要指令；
- 随时定位当前叶子，确认 Agent 当前实际沿哪条路径工作。

切换节点不会删除或覆盖原历史。后续消息会从目标节点生长为新分支，因此可以安全比较多个实现方向，并在失败后回到稳定节点继续。

### Fork：从历史需求派生独立任务

输入 `/fork` 会列出当前路径上的历史用户消息。选中一条消息后，Scout 会：

1. 从该用户消息之前的上下文创建独立任务；
2. 保留新任务与原任务的来源关系和分叉位置；
3. 将选中的原始需求回填到输入框，允许修改后再发送；
4. 保持原任务不变，两个任务之后可以独立演进。

即使长会话已经压缩，Fork 候选仍来自持久化的原始会话历史，因此仍可回到压缩点之前的需求。它适合并行探索不同架构、把临时实验拆出主任务，或基于同一上下文重新描述需求，而无需复制粘贴整段背景。

### Compact：让长时间开发保持连续

随着对话、代码读取和工具结果不断累积，模型上下文最终会接近窗口上限。Scout 的 Compaction 会将较早的工作整理为结构化上下文检查点，同时保留近期消息，让 Agent 能在有限的上下文窗口中继续开发。

压缩摘要会延续当前任务的关键信息，包括：

- 目标、约束与用户偏好；
- 已完成、进行中和受阻的工作；
- 关键技术决策及其原因；
- 下一步计划和继续任务所需的上下文；
- 精确的文件路径、命令、代码标识符和错误信息；
- 历史中读取、修改过的文件记录。

Compaction 提供三层保障：

- **阈值自动压缩**：默认启用，在上下文接近当前模型上限时自动生成摘要；
- **溢出恢复**：遇到上下文超限时，压缩运行态上下文并自动重试，避免任务直接中断；
- **手动压缩**：在 Agent 空闲时输入 `/compact`，可以主动为后续工作释放上下文空间。

压缩只改变下一次模型请求使用的 runtime context，不会删除 session tree 中的原始消息。压缩结果本身也会成为树节点；恢复任务、切换树节点或完成压缩后，Scout 会从持久历史重建实际模型上下文。因此压缩之后仍然可以查看早期过程、导航旧节点，或用 `/fork` 从压缩点之前的用户需求创建新任务。

自动压缩可在设置页启停，并可配置预留摘要预算和压缩后保留的近期 token 数。对于包含关键图片的长任务，建议同时提供文字描述；早期图片在被压缩后不会作为原始视觉内容继续发送给模型。

一个典型工作流是：先用 `/tree` 给稳定节点添加标签，再尝试高风险重构；上下文增长后由 Compact 维持任务连续性；如果需要长期保留两套方案，则用 `/fork` 将其中一个决策点拆成独立任务。

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

### 1. 安装插件

从 VS Code 插件市场搜索 `lianglh.scout-coding-agent`，或使用仓库内的 VSIX 安装包完成安装。Scout Coding Agent 要求 VS Code 1.120 或更高版本。

### 2. 配置模型

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

### 3. 开始任务

1. 打开 Activity Bar 中的 **Scout Agent**，在任务首页输入需求，按 Enter 创建会话。
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

以下内容面向需要从源码开发、调试或参与贡献的开发者。请先准备 Node.js、Corepack 和 pnpm 11.7.0，然后安装依赖：

```bash
corepack enable
pnpm install
```

运行 `pnpm dev` 会同时启动 Webview Vite 开发服务器与 Extension esbuild watch。随后在 VS Code 中按 `F5` 启动 Extension Development Host；开发服务器不可用时，扩展会回退到已构建的本地 Webview 产物。

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
