## 代码生成规则

### 1. 适用边界

- zustand 仅用于**跨业务模块共享**、**需要被多个组件/页面复用**的状态。
- 单个组件可自洽的 UI 状态，优先使用 `useState`、`useReducer`、`useMemo`。
- 能通过 props、Context 清晰传递的状态，不要为了“省传参”直接升级为全局 store。
- 协议投影层可以通过 `useXStore.getState().actions` 写入 store；store 模块顶层不得注册 postMessage listener、发送协议请求或持有 VS Code API。

### 2. Store 设计原则

- 一个 store 只负责一个清晰的领域，不要做“万能全局仓库”。
- 状态结构尽量扁平，字段命名直接表达业务含义，避免多层嵌套对象。
- 推荐把领域数据与行为组织为 `{ domainState, actions: { ... } }`，让组件形成稳定使用模式：订阅数据用语义化数据 hook，触发事件用语义化 action hook。
- `actions` 必须保持稳定引用，不要在状态更新时替换整个 `actions` 对象。
- 将 `state`、`actions`、`selectors` 的职责拆开，命名保持稳定。
- action 使用动词命名，如 `setCurrentConversationId`、`resetConversationState`。
- 公共类型优先抽出，确保 store 对外暴露的接口清晰可读。

### 3. 可读性要求

- 同一个 store 内，推荐按“类型定义 → 初始状态 → store 实现 → 派生 hook”顺序组织。
- action 保持短小，一个 action 只做一类状态变更。
- 复杂业务判断不要堆进 selector；先抽纯函数，再在 selector 或 action 中复用。
- 对外暴露的 hook 应尽量语义化，减少业务方直接感知底层字段结构。

### 4. 性能要求

- 组件中**必须优先使用 selector 订阅最小必要状态**，不要直接订阅整个 store。
- 只需要触发事件的组件应订阅 `actions`，不要顺手订阅业务数据；只订阅稳定 `actions` 的组件不应因为业务数据更新而重渲染。
- selector 返回对象或数组时，必须显式考虑引用稳定性；确需组合返回值时优先配合 `shallow`。
- 不要在 selector 中临时创建大对象、大数组或做高成本计算。
- 派生值可以通过语义化 selector hook 暴露；selector 会在 store 更新时重新执行，轻量计算可以直接写，重计算逻辑应先抽纯函数并评估缓存或状态结构。
- 派生数据如果能通过现有状态即时计算，就不要重复存入 store，避免双写和额外刷新。
- 高频更新字段与低频更新字段尽量拆开，避免无关组件联动重渲染。

### 5. 易复用要求

- 优先暴露稳定的基础 selector 与 action hook，业务组合逻辑放在更上层自定义 hook 中。
- store 内尽量只保留通用状态和通用行为，不直接耦合具体页面组件。
- 异步流程可以写入 action，但输入输出边界要清晰，避免 action 内混入过多 UI 控制逻辑。
- 需要复位能力的 store，必须提供明确的 `reset` 方法，方便页面切换或会话销毁时复用。
- 新增字段时同步审视默认值、重置逻辑和 selector，避免“字段加了但生命周期没补齐”。

### 6. 推荐模式

```ts
import {create} from 'zustand';

interface Todo {
    id: string;
    title: string;
    completed: boolean;
}

interface TodoActions {
    addTodo: (title: string) => void;
    toggleTodo: (id: string) => void;
    reset: () => void;
}

interface TodoStore {
    todos: Todo[];
    actions: TodoActions;
}

const initialState = {
    todos: [] as Todo[],
};

export const useTodoStore = create<TodoStore>(set => ({
    ...initialState,
    actions: {
        addTodo: title =>
            set(state => ({
                todos: [
                    ...state.todos,
                    {
                        id: crypto.randomUUID(),
                        title,
                        completed: false,
                    },
                ],
            })),
        toggleTodo: id =>
            set(state => ({
                todos: state.todos.map(todo =>
                    todo.id === id ? {...todo, completed: !todo.completed} : todo,
                ),
            })),
        reset: () => set(initialState),
    },
}));

export const useTodos = () => useTodoStore(state => state.todos);

export const useTodoActions = () => useTodoStore(state => state.actions);

export const useIncompleteCount = () =>
    useTodoStore(state =>
        state.todos.reduce((count, todo) => count + (todo.completed ? 0 : 1), 0),
    );
```

组件内使用：

```tsx
const todos = useTodos();
const incompleteCount = useIncompleteCount();
const {addTodo} = useTodoActions();
```

### 7. 红线禁止事项

- 禁止直接 `useStore()` 订阅整个 store 后在渲染中读取多个字段。
- 禁止在 selector 中返回每次都会新建的匿名对象，却不做稳定性处理。
- 禁止在 action 中通过 `set` 替换 `actions` 对象，避免破坏 action 订阅组件的稳定渲染边界。
- 禁止把接口响应原样整包塞入全局 store，先做字段裁剪与语义化映射。
- 禁止把组件实例、DOM、JSX、回调 props 等非稳定引用放入 store。
- 禁止在 store 模块顶层执行请求、注册事件或触发副作用。
- 禁止多个业务共享同一份“模糊命名”的状态字段，如 `data`、`info`、`state`。
- 禁止为了临时需求新增不可回收字段，却不补 `reset`、清理时机和使用边界。
- 禁止在未评估影响范围前引入持久化、跨会话缓存或本地存储同步。
