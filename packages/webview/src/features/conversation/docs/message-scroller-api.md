# API 参考

## MessageScroller.Provider

无头根组件。它拥有滚动状态和行为属性，并将它们提供给各个组件和钩子函数。它本身不渲染任何 DOM。

| 支柱 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| autoScroll | boolean | false | 只有当读者已处于阅读的最后阶段时，才会显示新内容。滚轮、触摸、键盘滚动和直接跳转都会释放新内容。 |
| defaultScrollPosition | "start" \| "end" \| "last-anchor" | "end" | 在第一个非空渲染中打开位置，仅应用一次。"last-anchor" 在最后一行打开，当转弯合适或没有锚点时 `scrollAnchor` 回退到 "end"。 |
| scrollEdgeThreshold | number | 8 | 距离任一边缘的距离，该距离仍被视为起点或终点。控制状态属性和滚动按钮的可见性。 |
| scrollMargin | number | 0 | 应用于对齐边缘的边距 `scrollToMessage`，用于可见性和程序化目标。 |
| scrollPreviousItemPeek | number | 64 | 当新添加的 `scrollAnchor` 项目定位时，会向 `scrollMargin` 添加额外的边距，以使前一个项目的一部分保持可见。 |

## MessageScroller.Root

框架和布局容器。它会填充其父元素，因此请在高度受限的布局中使用它，例如在 `<div>` 元素内 `MessageScroller.Provider`。

| 支柱 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| ...props | React.ComponentProps<"div"> | - | 道具扩散到框架元素。 |

根元素反映下面的滚动状态属性（视口也承载这些属性），因此您可以根据滚动状态设置容器样式，例如框架边缘淡入淡出效果。

| 数据属性 | 价值 | 描述 |
| --- | --- | --- |
| data-scrollable | "start" \| "end" \| "start end" \| 缺席 | 视口可以滚动到的边缘。查询其中一个边缘时 `[data-scrollable~="end"]`，如果缺少该边缘，则表示它适合滚动。 |
| data-autoscrolling | 展示 | 当视口通过程序滚动到最新消息时显示。 |

## MessageScroller.Viewport

可滚动视口。

| 支柱 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| preserveScrollOnPrepend | boolean | true | 在添加旧行时，保持第一个可见消息项稳定。 |
| role | string | "region" | 为带标签的可滚动转录文本视口提供地标作用。 |
| aria-label | string | "Messages" | 可滚动聊天记录的无障碍名称。 |
| tabIndex | number | 0 | 使转录文本视口可通过键盘滚动。 |
| ...props | React.ComponentProps<"div"> | - | 属性会传递到视口元素。 |

| 数据属性 | 价值 | 描述 |
| --- | --- | --- |
| data-scrollable | "start" \| "end" \| "start end" \| 缺席 | 视口可以滚动到的边缘。查询其中一个边缘时 `[data-scrollable~="end"]`，如果缺少该边缘，则表示它适合滚动。 |
| data-autoscrolling | 展示 | 当视口通过程序滚动到最新消息时显示。 |

## MessageScroller.Content

转录内容元素。每个直接子元素都应该是 `MessageScroller.Item`。

| 支柱 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| role | string | "log" | ARIA 角色已应用于实时公告的消息列表。 |
| aria-relevant | string | "additions" | 实时区域更新公告。默认仅发布新增的成绩单行。 |
| aria-busy | boolean | - | 如果需要，在进行轮播时，将实时区域标记为繁忙区域。 |
| spacerClassName | string | - | 用于为锚定行腾出空间的内部间隔符的类名。 |
| ...props | React.ComponentProps<"div"> | - | 属性会传递到内容元素。 |

## MessageScroller.Item

一行转录文本：可以是消息、标记、输入行、分隔符或加载更多行。

| 支柱 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| messageId | string | - | 稳定的行 ID 用于 `scrollToMessage` 可见性和前置保留。 |
| scrollAnchor | boolean | false | 将此行标记为转弯边界，可以锚定新添加的转弯。 |
| ...props | React.ComponentProps<"div"> | - | 属性会传递到物品元素。 |

| 数据属性 | 价值 | 描述 |
| --- | --- | --- |
| data-message-id | string | 如有配备，则配备镜子 `messageId`。 |
| data-scroll-anchor | "true" \| "false" | 镜子 `scrollAnchor`。 |

## MessageScroller.Button

一个用于滚动到文本开头或结尾的按钮。当文本中没有需要滚动的内容时，该按钮将失效并从标签顺序中移除。

| 支柱 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| behavior | ScrollBehavior | "smooth" | 当按钮滚动到目标边缘时，使用原生滚动行为。 |
| direction | "start" \| "end" | "end" | 按钮滚动到边缘。 |
| children | React.ReactNode | - | 自定义按钮内容。默认显示滚动图标和辅助功能标签。 |
| render | React.ReactElement \| render function | - | 自定义渲染目标。 |
| ...props | React.ComponentProps<"button"> | - | 道具散落在按钮处。 |

| 数据属性 | 价值 | 描述 |
| --- | --- | --- |
| data-direction | "start" \| "end" | 镜子 `direction`。 |
| data-active | "true" \| "false" | 此按钮目前是否可以滚动。 |

## 使用消息滚动条

关键的转录控制。

| 方法 | 类型 | 描述 |
| --- | --- | --- |
| scrollToMessage | (messageId: string, options?) => boolean | 滚动到已挂载的消息 ID。 |
| scrollToEnd | (options?) => boolean | 向下滚动查看最新消息。 |
| scrollToStart | (options?) => boolean | 滚动到顶部。 |

所有命令在无法执行时均返回 `false`。`scrollToStart` 仅当视口尚未挂载时才返回 `false`。`scrollToEnd` 当目标未挂载且无法排队时返回 `false`。`scrollToMessage` 当目标未挂载且无法排队时返回 `false`。

命令选项：

| 选项 | 类型 | 默认 | 描述 |
| --- | --- | --- | --- |
| align | "start" \| "center" \| "end" \| "nearest" | "start" | 消息目标在视口中的对齐方式。 |
| behavior | ScrollBehavior | "auto" | 该命令的原生滚动行为。 |
| scrollMargin | number | 提供商 `scrollMargin` | 此命令将边距应用于对齐的边缘。 |

## useMessageScrollerScrollable

对于需要在 JavaScript 中设置值的同级 UI，需要指定视口可以滚动到哪些边缘。建议使用 `data-scrollable` 属性来设置滚动条本身的样式。

| 价值 | 类型 | 描述 |
| --- | --- | --- |
| start | boolean | 视口是否可以滚动到开头。内容在上方（`!start` 即顶部）隐藏。 |
| end | boolean | 视口是否可以滚动到底部。内容隐藏在下方（`!end` 即底部）。 |

## useMessageScrollerVisibility

轮廓、搜索和活动页面 UI 的可见性状态。它与 `useMessageScrollerScrollable` 可见性功能独立订阅，因此只有在用户需要时才需要付费。

| 价值 | 类型 | 描述 |
| --- | --- | --- |
| currentAnchorId | string \| null | 当前锚定轮次，基于 `scrollAnchor` 阅读行上或上方的最后一个项目。 |
| visibleMessageIds | string[] | 按文档顺序，消息 ID 与视口相交。 |

`visibleMessageIds` 当您需要更精确的范围时，例如用户消息、锚定转弯或搜索结果，请在应用程序中使用筛选器。
