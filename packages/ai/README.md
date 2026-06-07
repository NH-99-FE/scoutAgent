# @scout-agent/ai

## 模型目录维护

内置模型维护在 `src/models.generated.ts`。Scout 只内置 API key 形态的 Anthropic 和 OpenAI：

- `anthropic` 使用 `anthropic-messages`
- `openai` 使用 `openai-responses`

新增或更新模型时直接修改 `src/models.generated.ts`，同步检查这些字段：

- `id` / `name` / `api` / `provider` / `baseUrl`
- `reasoning` / `thinkingLevelMap` / `compat`
- `input`
- `cost`
- `contextWindow` / `maxTokens`

不要把 Scout 不支持的 provider、OAuth、Azure、代理平台或其它 API 形态加入内置目录。需要兼容 OpenAI 协议代理时，通过运行时注册自定义 `openai-completions` 模型，而不是加入内置官方 OpenAI 目录。

修改后至少运行：

```bash
pnpm -C packages/ai test models.test.ts
pnpm -C packages/ai check-types
```
