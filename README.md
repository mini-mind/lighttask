# LightTask

LightTask 是面向上层业务应用的 TypeScript 编排内核。

它不是流程图引擎，也不是完整工作流应用。它提供的是一套稳定、可复用的任务编排核心：

- `Plan` 只是任务分组容器
- `Task` 是唯一真源对象
- 任务依赖直接写在 `Task` 上
- `draft` 是正式待办之前的草稿状态
- 调度直接围绕 `Task` 集合计算
- `Runtime` / `Output` 只负责执行与结果留痕

## 用产品人话理解

- `Plan` 像一个任务篮子，只负责把同一轮协作里的任务放在一起。
- `Task` 像真实任务卡片，标题、摘要、依赖、状态、步骤，都在它身上。
- `draft` 表示这张任务卡还在编辑，不能执行。
- `todo` 表示这张任务卡已经设计完成，可以进入正式调度。
- `Runtime` 像执行过程记录。
- `Output` 像这次执行留下来的结果物。

LightTask 不要求你先画一张 `Graph` 再开始工作。  
真正参与编排的只有一组 `Task`，系统直接根据这些 `Task` 的依赖关系计算：

- 现在谁可以并行开始
- 谁被上游阻塞
- 谁因为上游返工而存在风险

## 核心对象

### `Plan`

- 只是任务分组边界
- 不再承接“启动流程”“确认计划”“冻结流程图”这类职责

### `Task`

- 唯一真源对象
- 直接承接：
  - `planId`
  - `dependsOnTaskIds`
  - `status`
  - `title / summary / metadata / extensions`
  - `steps`
  - `createdAt / updatedAt`

### `Runtime` / `Output`

- `Runtime` 记录执行上下文
- 默认使用最小运行时状态机；如应用层确有必要，可在 `createLightTask({ runtimeLifecycle })` 中替换
- `Output` 记录结构化结果
- 它们不替代 `Task` 本身

## 对象关系

对象关系可以直接记成这一张图：

```text
Plan 1 --- n Task
Task n --- n Task   (通过 dependsOnTaskIds，且只能同 Plan)
Task 1 --- n SchedulingFactView
Task 1 --- n Runtime? / Output?   (通过 refs 建弱关联)
```

换成产品人话：

- `Plan` 只负责把一批任务装在一起
- `Task` 才是真正决定调度结果的卡片
- 任务之间的依赖直接写在任务自己身上
- 调度事实只是读取视图，不是新的持久化真源
- `Runtime` 和 `Output` 只是执行留痕，不反过来决定任务定义和依赖

## 状态模型

LightTask 使用单轴任务状态，并内置一套默认任务生命周期策略：

- `draft`
- `todo`
- `dispatched`
- `running`
- `blocked_by_approval`
- `completed`
- `failed`
- `cancelled`

其中：

- `draft`：任务仍在编辑，不能执行
- `todo`：任务设计完成，进入正式待办
- `todo -> draft`：允许，表示返工
- 默认策略下，`createTask` 初始只能创建 `draft`
- 一旦任务不再处于 `draft`，应用层不能再直接修改任务定义字段

补充说明：

- 默认状态集只是内置策略，不是运行时唯一允许的状态名集合
- `TaskStatus` 是 `string`，状态合法性由 `taskLifecycle` 注册表约束
- 应用层若需要额外业务语义，优先放在自己的字段中扩展，而不是要求 LightTask 新增副轴字段

## 生命周期策略

LightTask 支持两种接入方式：

- 直接使用内置默认 8 态策略
- 通过 `createLightTask({ taskLifecycle })` 注入自定义任务生命周期策略

这套策略对象会驱动：

- `createTask` 初始状态
- `advanceTask` 状态迁移与步骤推进策略
- `updateTask` 的可编辑状态边界
- `getPlanSchedulingFacts` 对 `draft / runnable / blocked / active / terminal / risk` 的分类

对应用层最重要的一点是：

- “默认 8 态”只是默认策略，不是 LightTask 主链里写死不变的一套判断

## 调度语义

调度以后只基于这些信息：

- 某个 `Plan` 下的全部 `Task`
- 每个 `Task` 的 `dependsOnTaskIds`
- 每个 `Task` 的 `status`

调度规则的人话版本：

- `draft` 自己不可执行
- 依赖某个 `draft` 任务的下游任务会被阻塞
- 如果某个上游任务从 `todo` 回到 `draft`：
  - 尚未开始的下游任务重新阻塞
  - 已经开始或已完成的下游任务不会被强制回滚
  - 但会被标记为“上游返工风险”

注意：

- `getPlanSchedulingFacts` 会返回 `draft / runnable / blocked / active / terminal / risk` 等调度事实，并在 `byTaskId` 中解释每个任务当前所处的可执行性与风险
- “阻塞”与“风险”都是调度事实，不是新的任务状态
- `getPlanSchedulingFacts` 读到的是即时视图，不是额外持久化的一张表

## 编辑权限边界

应用层不是“任何时候都能随便改任务”。

默认规则：

- 应用层只能编辑 `draft` 任务的定义字段
- 非 `draft` 状态下，应用层不能直接改任务定义字段
- 非 `draft` 状态下，LightTask 只允许通过状态推进、步骤推进、运行留痕去更新任务

进一步说清楚：

- `title / summary / dependsOnTaskIds / steps / metadata / extensions` 属于定义字段
- `steps[].id / title / stage` 属于步骤定义
- `steps[].status / status / revision / createdAt / updatedAt / idempotencyKey` 属于运行与并发控制字段
- `idempotencyKey` 仍可作为写请求的请求级幂等键传入，但它不是任务定义字段

## 删除语义

LightTask 对删除任务采取稳妥兜底：

- 删除某个 `Task` 时，自动解除同一 `Plan` 内其他任务对它的依赖
- 同一删除请求重复提交相同 `idempotencyKey` 时，返回同一份删除结果摘要，不重复产生解绑副作用
- 是否允许删除、是否提醒用户、是否备份记录，由应用层自己决定
- LightTask 不内置软删除、归档箱或恢复站

## 不采用的接入方式

下面这些接法不属于 LightTask 的公开主链：

- `Graph` 作为公开主对象
- `publishGraph`
- `materializePlanTasks`
- `launchPlan`
- “先发布图，再物化任务，再启动计划”这条长链

## 最小启动

如果你只是想把当前仓库里的现有实现先跑起来，可以继续使用公开的 `lighttask/ports/in-memory` 适配器：

```ts
import { createLightTask } from "lighttask";
import { createInMemoryLightTaskPorts } from "lighttask/ports/in-memory";

const lighttask = createLightTask(createInMemoryLightTaskPorts());
```

如果你需要替换默认任务生命周期策略，也可以直接把策略一并传进去：

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
      key: "completed",
      editable: false,
      schedulable: false,
      active: false,
      terminal: true,
      completionOutcome: "success",
    },
  ],
  transitionDefinitions: [
    { from: "todo", action: "complete", to: "completed" },
  ],
  terminalStatuses: ["completed"],
});

const lighttask = createLightTask(
  createInMemoryLightTaskPorts({
    taskLifecycle,
  }),
);
```

如果你想继续看设计约束与接入心智，优先阅读架构文档、应用层接入指南和生命周期策略说明。

## 文档导航

- [架构说明](https://github.com/mini-mind/lighttask/blob/main/docs/architecture.md)
- [应用层接入指南](https://github.com/mini-mind/lighttask/blob/main/docs/application-developer-guide.md)
- [生命周期策略](https://github.com/mini-mind/lighttask/blob/main/docs/task-lifecycle.md)
- [产品说明](https://github.com/mini-mind/lighttask/blob/main/docs/product-prd.md)
- [变更记录](https://github.com/mini-mind/lighttask/blob/main/CHANGELOG.md)

## 本地开发

```bash
npm install
npm run check
```

如果你是在当前仓库里做最小试跑，可参考 [`src/cli/smoke.ts`](https://github.com/mini-mind/lighttask/blob/main/src/cli/smoke.ts)。
