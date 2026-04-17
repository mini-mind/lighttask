# LightTask 应用层接入指南

说明：本指南描述的是当前实现已经采用的接入方式；如果你想看这轮重构的阶段拆解和验收口径，可继续参考 [docs/plan.md](plan.md)。

这份指南只回答一件事：

`应用层以后应该怎样在不依赖 Graph 的前提下接入 LightTask。`

## 1. 先记住四句话

1. `Plan` 只是任务分组容器
2. `Task` 是唯一真源对象
3. 依赖关系直接挂在 `Task` 上
4. `draft` 是任务正式进入待办前的编辑状态

如果换成产品语言去记：

- `Plan` 是一个任务篮子
- `Task` 是真实任务卡片
- `dependsOnTaskIds` 是卡片之间的依赖
- `draft` 表示卡片还没编辑完

再补两句必须记住的话：

- 每个 `Task` 必须属于且只属于一个 `Plan`
- 依赖只能发生在同一个 `Plan` 内

## 2. 应用层以后怎么组织自己的数据

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

## 3. 推荐接入主链

### 第一步：先建 `Plan`

```ts
lighttask.createPlan({
  id: "plan_alpha",
  title: "需求 Alpha",
});
```

以后 `Plan` 不再是“启动流程”的对象，只是这个需求下任务的分组容器。

### 第二步：先建 `draft` 任务

应用层把“还在编辑中的任务”直接建成 `draft`：

```ts
lighttask.createTask({
  planId: "plan_alpha",
  title: "起草方案",
  status: "draft",
  dependsOnTaskIds: [],
});
```

此时它：

- 已真实存在于系统中
- 但不能执行
- 也会阻塞依赖它的下游任务
- 创建入口本身也不应允许直接创建成 `todo` 或其他正式态

### 第三步：只在 `draft` 态编辑任务定义

应用层可以在 `draft` 态不断改这些字段：

- 标题
- 摘要
- 依赖
- 步骤定义
- 元数据
- 扩展字段

一旦任务脱离 `draft`，这些字段就不再允许应用层直接改。

其中步骤也要拆开理解：

- `steps[].id / title / stage` 属于任务定义
- `steps[].status` 属于运行留痕
- 所以应用层只能在 `draft` 态改步骤定义，正式态下步骤状态只能由 LightTask 推进
- 写接口里的 `idempotencyKey` 是请求级幂等参数，不是任务定义字段本身

### 第四步：编辑完成后，把任务从 `draft` 推到 `todo`

任务准备好了，再进入正式待办：

```ts
lighttask.advanceTask(taskId, {
  expectedRevision,
  action: "finalize",
});
```

以后不再需要：

- 先画 Graph
- 再发布 Graph
- 再物化任务
- 再启动计划

### 第五步：读取调度事实

```ts
const facts = lighttask.getPlanSchedulingFacts("plan_alpha");
```

应用层重点看这些信息：

- 哪些任务现在可以并行做
- 哪些任务还被上游阻塞
- 哪些任务是因为上游还在 `draft` 被阻塞
- 哪些任务虽然已经开始/完成，但因为上游返工而有风险

尤其要直接消费：

- `draftTaskIds / runnableTaskIds / blockedTaskIds / activeTaskIds / terminalTaskIds / riskTaskIds`
- `byTaskId[taskId].dependencyTaskIds / downstreamTaskIds`
- `byTaskId[taskId].blockReasonCodes / riskReasonCodes`
- `byTaskId[taskId].unmetDependencyTaskIds / missingDependencyTaskIds / riskyDependencyTaskIds`

这里要记住一条边界：

- 风险不是任务状态
- 阻塞也不是任务状态
- 它们都是调度视图里的解释信息

### 第六步：真正推进任务执行

正式执行态下，应用层不再改任务定义，只做状态推进和运行留痕推进。

## 4. `draft` 和 `todo` 应该怎么理解

### `draft`

表示：

- 这条任务还在编辑
- 不可执行
- 会阻塞后继
- 应用层可以改定义字段

### `todo`

表示：

- 这条任务已经编辑完成
- 正式进入待办
- 可以参与后续调度
- 定义字段不再允许应用层直接改

### `todo -> draft`

这是明确允许的返工路径。

应用层如果发现任务设计还得重做，可以把任务从 `todo` 打回 `draft`。

LightTask 会负责：

- 让这个任务重新不可执行
- 阻塞还没开始的下游任务
- 给已经开始或已经完成的下游任务打上“上游返工风险”标记

这里“已经开始”具体指：

- `dispatched`
- `running`
- `blocked_by_approval`

LightTask 不会负责：

- 自动回滚下游任务
- 自动删掉下游结果
- 自动决定用户界面怎么提示

这些都交给应用层处理。

## 5. 以后不该怎么接

以下接法以后不再推荐：

- 先把任务关系画成 Graph，再把 Graph 视为真源
- 依赖 `publishGraph`
- 依赖 `materializePlanTasks`
- 依赖 `launchPlan`
- 把“计划是否启动”当成调度开关

这些都会让接入链路更长，也会让应用层心智更重。

## 6. 删除任务的推荐理解

以后删除某个任务时：

- LightTask 自动解除同一 `Plan` 内其他任务对它的依赖
- LightTask 重新计算调度事实
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
- 被上游 `draft` 阻塞
- 被失败的上游阻塞
- 被取消的上游阻塞
- 自己仍是 `draft`

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

这些以后仍应留在应用层：

- 流程图编辑器
- 页面布局
- planner session
- provider / agent / instance 适配
- 外部执行心跳
- 文件落地产物扫描
- 产品级软删除/归档/恢复

LightTask 只负责稳定的公共编排语义，不负责替应用层做完整产品。

## 9. 一句话接入建议

以后应用层接 LightTask，推荐主链应当是：

```text
业务对象/草稿
  -> 映射为 Plan + draft Task
  -> 编辑 draft Task
  -> finalize 成 todo
  -> 读取调度事实
  -> 上层执行器挑 runnable Task 执行
  -> advanceTask 推进状态
  -> Runtime / Output 留痕
```

如果你发现自己的接入仍然离不开：

- Graph
- 发布图
- 物化任务
- 启动计划

那就说明还停留在旧心智里，应该继续收缩到“任务为中心”。
