# Webview 样式 Token 契约

Webview 样式遵循一条收窄的 token 链路：

`VS Code theme variables -> Scout semantic variables -> Tailwind v4 theme tokens -> component classes`

目标是把运行时主题输入、共享 UI 语义和 feature 私有样式分开。组件应该消费语义化 Tailwind class，而不是硬编码色板颜色或直接读取底层 CSS 变量。

## Token 分层

### VS Code 运行时输入

`--vscode-*` 变量是宿主/运行时输入。它们可以在 `theme.css`、基础全局规则中引用；当某个值属于 VS Code 编辑器基础能力时，比如 editor font size，也可以在 feature CSS 中引用。

当 CSS 文件引用 `--vscode-*` 变量时，`src/bridge/theme.ts` 必须同步该变量，以覆盖 preview 和宿主 webview 场景。bridge 测试会扫描 CSS/TS/TSX 源码，并验证同步列表覆盖了 bridge 自身之外所有被引用的 VS Code 变量。

### shadcn 核心 token

核心 token 用来保持 shadcn/Radix 组件与本地设计系统兼容：

- `background`, `foreground`
- `card`, `card-foreground`
- `popover`, `popover-foreground`
- `primary`, `primary-foreground`
- `secondary`, `secondary-foreground`
- `muted`, `muted-foreground`
- `accent`, `accent-foreground`
- `destructive`, `border`, `input`, `ring`

这些 token 定义在 `theme.css` 中，并通过 `@theme inline` 暴露。即使某个 token 当前调用点很少，也应该保留，因为生成的或未来新增的 shadcn 组件会依赖这层契约。

### Scout 语义 token

Scout 语义变量描述跨 surface 可复用的 UI 意图。它们在 `theme.css` 中以 `--scout-*` 变量定义，并通过 `--color-*` 或 `--shadow-*` 暴露为 Tailwind v4 token。

当前语义分组：

- `control-*`：用于可选中行、菜单项、分段按钮，以及 hover/selected 状态。
- `field-*`、`invalid-*`、`danger-*`、`switch-*`：用于表单控件。
- `diff-*`、`status-*`：用于 review 计数、warning 状态和 diff 标记。
- `surface-subtle`、`user-message`、`overlay-background`：用于共享 surface。

不要为了一次性的组件状态新增全局 Scout token。除非至少两个 surface 自然共享同一个语义，否则一次性值应留在 feature CSS 文件中。

### Feature 私有 token

Feature 私有变量只能留在所属 feature 内：

- `--scout-review-*` 属于 `styles/features/changes-review.css` 和 `surfaces/changes-review`。
- `--changes-review-*` 属于 `styles/features/changes-review.css` 和 `surfaces/changes-review`。
- `--scout-running-text-*` 属于 `styles/features/conversation.css`。

Feature 私有变量不应通过 `@theme inline` 暴露。所属 feature 之外的组件必须改用全局语义 Tailwind class。

## CSS 文件职责

- `index.css` 只负责 import。
- `theme.css` 负责主题 variant、VS Code fallback 映射、shadcn 核心 token 和全局 Scout 语义 token。
- `base.css` 负责 document 级规则和 focus 行为。
- `utilities.css` 负责跨 surface 的工具选择器，以及不承载颜色决策的动画。
- `styles/features/*.css` 只负责对应 feature 的复杂选择器和私有 token。

## 测试

`test/styles/css-token-governance.test.ts` 负责约束主要规则：

- TS/TSX view 代码不得使用原始色板 class、原始颜色字面量、`dark:*` 色彩覆盖，或原始 feature 变量 utility。
- 原始 CSS 颜色字面量只能出现在允许的 token 源文件中。
- Feature 私有变量不得泄漏到所属 feature 之外。
