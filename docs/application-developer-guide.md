# LightTask 应用层接入指南

这份指南只回答一件事：

`应用层应该怎样把自己的产品对象接到 LightTask 上。`

## 1. 先记住四句话

1. `Plan` 只是任务分组容器
2. `Task` 是唯一真源对象
3. 依赖关系直接挂在 `Task` 上
4. `taskPolicies` 必须由应用层显式注册，且每个 `Plan` 都要绑定自己的 `taskPolicyId`

如果换成产品语言去记：

- `Plan` 是一个任务篮子
- `Task` 是真实任务卡片
- `dependsOnTaskIds` 是卡片之间的依赖
- 生命周期策略决定卡片何时可编辑、可调度、活跃或终结

再补两句必须记住的话：

- 每个 `Task` 必须属于且只属于一个 `Plan`
- 依赖只能发生在同一个 `Plan` 内

## 2. 应用层怎么组织自己的数据

推荐把应用层的数据理解为两层：

### 应用层对象

这些对象应该继续留在应用层自己管理：

- 流程草稿
- planner session
- planner messages
- lanes
- 页面布局
- provider / agent / instance 绑定

### LightTask 内核对象

这些对象应该交给 LightTask：

- `Plan`
- `Task`
- 调度事实
- 运行留痕
- 结果留痕

一句话理解：

- 应用层管“用户正在怎么编辑产品”
- LightTask 管“任务如何被稳定编排和推进”

再补一条边界：

- 应用层若需要更多业务状态语义，优先放在自己的字段中表达，而不是要求 LightTask 不断增加核心状态字段

## 3. 推荐接入主链

### 第一步：先建 `Plan`

```ts
lighttask.plans.create({
  id: "plan_alpha",
  title: "需求 Alpha",
  taskPolicyId: "default",
});
```

`Plan` 只是这个需求下任务的分组容器。

### 第二步：先注册任务策略，再建任务

`lighttask.tasks.create` 不接受任意 `status`。  
任务创建时会自动落到所属 `Plan.taskPolicyId` 对应策略的 `initialStatus`。

例如，应用层可以先注册一套自己的生命周期：

```ts
const taskPolicy = createTaskLifecyclePolicy({
  initialStatus: "draft",
  statusDefinitions: [
    { key: "draft", editable: true, schedulable: false, active: false, terminal: false },
    { key: "todo", editable: false, schedulable: true, active: false, terminal: false },
    { key: "done", editable: false, schedulable: false, active: false, terminal: true, completionOutcome: "success" },
  ],
  actionDefinitions: [
    { key: "finalize", stepProgress: "reset_all_to_todo" },
    { key: "complete", requiresRunnable: true, stepProgress: "complete_all" },
  ],
  transitionDefinitions: [
    { from: "draft", action: "finalize", to: "todo" },
    { from: "todo", action: "complete", to: "done" },
  ],
  terminalStatuses: ["done"],
});
```

然后再创建任务：

```ts
lighttask.tasks.create({
  planId: "plan_alpha",
  title: "起草方案",
  dependsOnTaskIds: [],
});
```

此时它：

- 已真实存在于系统中
- 但不能执行
- 也会阻塞依赖它的下游任务
- 创建入口本身不允许跳过 `initialStatus` 直接落到其他状态

### 第三步：只在 `editable = true` 的状态编辑任务定义

应用层可以在当前状态被注册为 `editable = true` 时，不断改这些字段：

- 标题
- 摘要
- 依赖
- 步骤定义
- 元数据
- 扩展字段

一旦任务进入 `editable = false` 的状态，这些字段就不再允许应用层直接改。

其中步骤也要拆开理解：

- `steps[].id / title / stage` 属于任务定义
- `steps[].status` 属于运行留痕
- 所以应用层只能在当前可编辑状态里改步骤定义，进入非编辑态后步骤状态只能由 LightTask 推进
- 写接口里的 `idempotencyKey` 是请求级幂等参数，不是任务定义字段本身

### 第四步：编辑完成后，把任务推进到正式可调度状态

任务准备好了，再进入正式待办：

```ts
lighttask.tasks.move(taskId, {
  expectedRevision,
  action: "finalize",
});
```

不需要：

- 先生成额外的中间编排对象
- 再把它们转换回任务
- 再单独触发额外流程开关

### 第五步：读取调度事实

```ts
const facts = lighttask.plans.schedule("plan_alpha");
```

应用层重点看这些信息：

- 哪些任务现在可以并行做
- 哪些任务还被上游阻塞
- 哪些任务是因为上游当前不可调度而被阻塞
- 哪些任务虽然已经开始/完成，但因为上游返工而有风险

尤其要直接消费：

- `editableTaskIds / runnableTaskIds / blockedTaskIds / activeTaskIds / terminalTaskIds / riskyTaskIds`
- `byTaskId[taskId].dependencyTaskIds / downstreamTaskIds`
- `byTaskId[taskId].blockReasonCodes / riskReasonCodes`
- `byTaskId[taskId].unmetDependencyTaskIds / missingDependencyTaskIds / riskyDependencyTaskIds`

这里要记住一条边界：

- 风险不是任务状态
- 阻塞也不是任务状态
- 它们都是调度视图里的解释信息

### 第六步：真正推进任务执行

正式执行态下，应用层不再改任务定义，只做状态推进和运行留痕推进。

## 4. `editable` 和“是否进入正式调度”要分开理解

- `editable` 是状态属性，表示应用层能不能继续改任务定义
- `schedulable` 是状态属性，表示这个状态在依赖满足后能不能进入可执行集合
- 如果某状态同时 `schedulable = false`、`active = false`、`terminal = false`，它会被视为当前不可进入正式调度的状态

这意味着：

- “草稿态”可以由应用层自己命名
- “可编辑”不等于“草稿态”
- 一个任务返回到不可调度状态后，下游会被重新阻塞或打上风险标记

LightTask 不会负责：

- 自动回滚下游任务
- 自动删掉下游结果
- 自动决定用户界面怎么提示

这些都交给应用层处理。

## 5. `taskPolicy` 应该怎样设计

你至少要明确注册 3 类东西：

- `statusDefinitions`
- `actionDefinitions`
- `transitionDefinitions`

接入方式：

```ts
import { createLightTask } from "lighttask";
import { createInMemoryLightTaskPorts } from "lighttask/adapters/memory";
import { createTaskLifecyclePolicy, createTaskPolicyRegistry } from "lighttask/policies";

const taskPolicy = createTaskLifecyclePolicy({
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
      key: "completed",
      editable: false,
      schedulable: false,
      active: false,
      terminal: true,
      completionOutcome: "success",
    },
  ],
  actionDefinitions: [{ key: "complete", requiresRunnable: true, stepProgress: "complete_all" }],
  transitionDefinitions: [
    { from: "todo", action: "complete", to: "completed" },
  ],
  terminalStatuses: ["completed"],
});

const lighttask = createLightTask(
  createInMemoryLightTaskPorts({
    taskPolicies: createTaskPolicyRegistry({
      policies: {
        default: taskPolicy,
      },
    }),
  }),
);
```

这里要记住两条边界：

- `taskPolicy` 已经可以驱动 `tasks.create / tasks.move / tasks.update / plans.schedule`
- `TaskStatus` 与 `TaskAction` 都已经放开成 `string`，但是否合法仍必须由你注册到某个 `taskPolicy`

## 6. 删除任务的推荐理解

删除某个任务时：

- LightTask 自动解除同一 `Plan` 内其他任务对它的依赖
- LightTask 会在一致性边界内重建一次调度结果，确保解绑后的系统状态仍然自洽
- 如果删除请求携带 `idempotencyKey`，重复重试同一请求时返回同一份删除结果摘要

应用层自己决定：

- 是否允许删
- 是否弹框
- 是否先备份
- 是否提供恢复站

也就是说：

- 内核只保证删了以后系统依赖关系不会炸
- 产品级治理由应用层自己承担

## 7. 应用层最需要关心的两个输出

### `blockReasonCodes`

告诉应用层：

- 为什么这个任务现在不能开始

尤其要能区分：

- 被普通未完成依赖阻塞
- 被上游当前不可调度阻塞
- 被失败的上游阻塞
- 被取消的上游阻塞
- 自己当前还不可调度

这里建议直接按“原因代码数组”消费，而不是假设永远只有一个原因。

### `riskReasonCodes`

告诉应用层：

- 这个任务虽然不一定被硬阻塞，但它的前提已经变脏了

最典型场景是：

- 上游已经从 `todo` 回到 `draft`
- 下游之前已经开始过或完成过

这类风险不应被误解为：

- 任务状态自动变了
- 系统已经替你决定要不要回滚

它只是告诉应用层：“这张任务卡目前带着脏前提，需要产品层自己决定怎么提示和治理”。

同样地，风险也应按“原因代码数组”理解，而不是假设只有单一风险标签。


## 8. 哪些能力不要往内核里塞

这些能力应留在应用层：

- 流程图编辑器
- 页面布局
- planner session
- provider / agent / instance 适配
- 外部执行心跳
- 文件落地产物扫描
- 产品级软删除/归档/恢复

LightTask 只负责稳定的公共编排语义，不负责替应用层做完整产品。

## 9. 一句话接入建议

应用层接 LightTask，推荐主链应当是：

```text
业务对象/草稿
  -> 映射为 Plan + 应用层定义的可编辑 Task
  -> 编辑这批可编辑 Task
  -> 通过 tasks.move 进入应用层定义的正式可调度状态
  -> 读取调度事实
  -> 上层执行器挑 runnable Task 执行
  -> tasks.move 推进状态
  -> Runtime / Output 留痕
```
