# LightTask 生命周期策略

LightTask 用生命周期策略解释 `Task.status` 的含义、状态迁移边界和调度属性。

## 1. 基本原则

- `Task.status` 只有一个字段，不引入主轴 + 副轴的持久化模型
- `TaskStatus` 是 `string`
- `TaskAction` 也是 `string`
- 合法状态必须先在 `taskPolicy` 注册
- 合法动作也必须先在 `taskPolicy` 注册
- `taskPolicies` 是必填配置
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
只有出现在生命周期策略集合里的状态，才能参与创建、推进和调度。

### 2.2 状态集合

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
type TaskActionDefinition = {
  key: string;
  label?: string;
  requiresRunnable?: boolean;
  stepProgress?: "none" | "advance_one" | "complete_all" | "reset_all_to_todo";
};
```

其中：

- `requiresRunnable = true` 表示这个动作只能作用在当前可执行任务上
- `stepProgress` 用来声明这次动作应如何推动步骤留痕

### 2.4 转移定义

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

### 2.5 生命周期 hooks

```ts
type TaskLifecycleHooks = {
  guard?: (input: TaskLifecycleGuardInput) => CoreError | undefined;
  apply?: (input: TaskLifecycleApplyInput) => void;
  notify?: (input: TaskLifecycleNotifyInput) => void;
};
```

职责边界：

- `guard`：决定一次迁移是否允许发生
- `apply`：承接迁移成功前的轻量副作用
- `notify`：承接迁移成功后的轻量通知副作用

当前推荐理解：

- `guard` 是最核心的扩展点
- `apply / notify` 适合承接少量定制副作用
- revision、幂等、时间戳和一致性边界仍由内核统一兜底

## 3. 设计边界

LightTask 不再内置任何预设 Task 状态或动作。

这意味着：

- `draft / todo / running / completed` 不是内核事实
- `finalize / dispatch / complete` 也不是内核事实
- 这些词都只能出现在某个应用自己的生命周期配置里

## 4. 生命周期与调度的关系

LightTask 的调度不依赖某几个写死状态名，而是读取状态与动作定义上的属性：

- `editable = true`：当前状态允许应用层修改定义字段
- `schedulable = true`：满足依赖后可进入可执行集合
- `active = true`：会进入活跃执行集合
- `terminal = true`：会进入终态集合
- `completionOutcome`：用于区分依赖未完成、失败还是取消
- `requiresRunnable = true`：这个动作只能推进当前可执行任务

补充一条关键解释：

- 如果某状态同时 `schedulable = false`、`active = false`、`terminal = false`，它会被视为当前不可进入正式调度的状态

这意味着应用层即使不用 `todo / running / completed` 这些名字，只要状态与动作属性定义合理，调度仍然可以稳定工作。

## 5. 对应用层的接入建议

应用层总是需要先注册自己的 `taskPolicies`，再让 `Plan` 绑定对应 `taskPolicyId`。

接入时建议记住两条边界：

1. 状态名由应用层定义，但字段编辑边界、revision、幂等和一致性仍由 LightTask 统一兜底。
2. 如果业务需要更多语义，优先放在应用层字段里，而不是继续要求内核膨胀核心状态模型。

## 6. 最小示例

```ts
import { createLightTask } from "lighttask";
import { createMemoryAdapters } from "lighttask/adapters/memory";
import { defineTaskPolicy, defineTaskPolicies } from "lighttask/policies";

const taskPolicy = defineTaskPolicy({
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
  actionDefinitions: [
    { key: "start", requiresRunnable: true, stepProgress: "advance_one" },
    { key: "complete", stepProgress: "complete_all" },
  ],
  transitionDefinitions: [
    { from: "todo", action: "start", to: "in_progress" },
    { from: "in_progress", action: "complete", to: "done" },
  ],
  terminalStatuses: ["done"],
});

const lighttask = createLightTask(
  createMemoryAdapters({
    taskPolicies: defineTaskPolicies({
      policies: {
        default: taskPolicy,
      },
    }),
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
