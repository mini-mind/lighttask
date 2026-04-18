# LightTask 生命周期策略

LightTask 用生命周期策略解释 `Task.status` 的含义、状态迁移边界和调度属性。

## 1. 基本原则

- `Task.status` 只有一个字段，不引入主轴 + 副轴的持久化模型
- `TaskStatus` 是 `string`
- 合法状态必须先在 `taskLifecycle` 注册
- 应用层若需要更多业务语义，优先放在自己的字段中扩展

一句话概括：

- LightTask 负责生命周期规则
- 应用层负责业务语义

## 2. 核心模型

### 2.1 `Task.status`

```ts
type TaskStatus = string;
```

这表示状态 key 可配置，但不表示任意字符串都自动合法。  
只有出现在生命周期策略注册表里的状态，才能参与创建、推进和调度。

### 2.2 状态注册表

```ts
type TaskStatusDefinition = {
  key: string;
  label?: string;
  editable: boolean;
  schedulable: boolean;
  active: boolean;
  terminal: boolean;
  completionOutcome?: "success" | "failed" | "cancelled";
};
```

这些字段用于回答几个稳定问题：

- 当前状态是否允许编辑任务定义
- 当前状态是否可参与调度
- 当前状态是否属于活跃执行态
- 当前状态是否属于终态
- 当前状态若为终态，对下游依赖意味着成功、失败还是取消

### 2.3 转移定义

```ts
type TaskStatusTransitionDefinition = {
  from: string;
  to: string;
  action: string;
  hooks?: TaskLifecycleHooks;
};
```

LightTask 采用稀疏边表表达合法转移，而不是预先生成一张全矩阵。  
这样更容易维护，也更适合让应用层定义自己的动作名和状态名。

### 2.4 生命周期 hooks

```ts
type TaskLifecycleHooks = {
  guard?: (input: TaskLifecycleGuardInput) => CoreError | undefined;
  apply?: (input: TaskLifecycleApplyInput) => void;
  notify?: (input: TaskLifecycleNotifyInput) => void;
};
```

职责边界：

- `guard`：决定一次迁移是否允许发生
- `apply`：决定迁移时要同步修改哪些系统字段
- `notify`：决定迁移成功后要发布哪些领域事件

当前推荐理解：

- `guard` 是最核心的扩展点
- `apply / notify` 适合承接少量定制副作用
- revision、幂等、时间戳和一致性边界仍由内核统一兜底

## 3. 默认生命周期策略

默认内置状态：

- `draft`
- `todo`
- `dispatched`
- `running`
- `blocked_by_approval`
- `completed`
- `failed`
- `cancelled`

默认动作：

- `finalize`
- `return_to_draft`
- `dispatch`
- `start`
- `request_approval`
- `approve`
- `complete`
- `fail`
- `cancel`

这套默认策略的目标很简单：

- 不需要额外配置就能直接使用
- 保持调度和编辑边界清晰
- 给常见的人机协作流程一个稳定起点

## 4. 生命周期与调度的关系

LightTask 的调度不依赖某几个写死状态名，而是读取状态定义上的属性：

- `editable = true`：会被视为定义态
- `schedulable = true`：满足依赖后可进入可执行集合
- `active = true`：会进入活跃执行集合
- `terminal = true`：会进入终态集合
- `completionOutcome`：用于区分依赖未完成、失败还是取消

这意味着应用层即使不用 `todo / running / completed` 这些默认名字，只要状态属性定义合理，调度仍然可以稳定工作。

## 5. 对应用层的接入建议

应用层通常有两种方式：

### 方式一：直接使用默认策略

适合：

- 希望快速接入
- 不需要重定义状态体系

### 方式二：注入自定义 `taskLifecycle`

适合：

- 已经有自己的产品状态体系
- 需要更少或更多的状态
- 希望自定义动作名和转移规则

接入时建议记住两条边界：

1. 状态名由应用层定义，但字段编辑边界、revision、幂等和一致性仍由 LightTask 统一兜底。
2. 如果业务需要更多语义，优先放在应用层字段里，而不是继续要求内核膨胀核心状态模型。

## 6. 最小示例

```ts
import { createLightTask } from "lighttask";
import { createInMemoryLightTaskPorts } from "lighttask/ports/in-memory";
import { createTaskLifecyclePolicy } from "lighttask/rules";

const taskLifecycle = createTaskLifecyclePolicy({
  initialStatus: "todo",
  statusDefinitions: [
    {
      key: "todo",
      editable: false,
      schedulable: true,
      active: false,
      terminal: false,
    },
    {
      key: "in_progress",
      editable: false,
      schedulable: false,
      active: true,
      terminal: false,
    },
    {
      key: "done",
      editable: false,
      schedulable: false,
      active: false,
      terminal: true,
      completionOutcome: "success",
    },
  ],
  transitionDefinitions: [
    { from: "todo", action: "start", to: "in_progress" },
    { from: "in_progress", action: "complete", to: "done" },
  ],
  terminalStatuses: ["done"],
});

const lighttask = createLightTask(
  createInMemoryLightTaskPorts({
    taskLifecycle,
  }),
);
```

## 7. 非目标

生命周期策略不是为了把 LightTask 做成：

- 通用对象状态平台
- 图编辑器状态机
- UI 状态建模器
- 审批系统建模平台

它的职责只有一个：为任务编排提供稳定、可配置、可验证的状态推进规则。
