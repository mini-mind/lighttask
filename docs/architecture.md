# LightTask 架构

## 1. 分层

```text
[上层应用]
     |
     v
[core 编排层]
   /         \
  v           v
[rules]     [ports]
     \       /
      v     v
[data-structures]
```

各层职责：

1. `data-structures`
   定义任务、计划、图、运行态、输出、事件、错误、revision 等基础结构。
2. `rules`
   定义状态迁移、DAG 校验、拓扑排序、幂等、revision 校验等纯规则。
3. `ports`
   定义仓储、通知、时钟、ID 生成器等端口契约，以及仅供本仓库测试和 CLI 复用的极简本地实现。
4. `core`
   组合 `data-structures`、`rules`、`ports`，对外提供稳定的公共编排 API。
5. 上层应用
   负责页面、交互、调度策略、外部系统集成和业务专属字段。

## 2. 核心原则

### 2.1 内核只承接通用编排语义

LightTask 只负责以下公共对象与主链能力：

- `Task`
- `Plan`
- `Graph`
- `Runtime`
- `Output`
- 计划图发布
- 任务物化
- 调度事实计算
- 领域事件发布

以下内容明确留在上层应用：

- 页面与视图
- 实时通道
- planner session
- provider / agent 适配
- 业务专属流程与字段

### 2.2 路径最小依赖

每个 use case 只校验当前调用路径真正需要的依赖，不把无关端口前置耦合进来。

例如：

- `createTask` 只依赖 `taskRepository.create`、`clock.now`、`idGenerator.nextTaskId`
- `getTask` 只依赖 `taskRepository.get`
- `listTasks` 只依赖 `taskRepository.list`
- `advanceTask` 只依赖 `taskRepository.get/saveIfRevisionMatches`
- `saveGraph` 按首次创建与更新分支分别要求最小写依赖
- `materializePlanTasks` 只在需要创建或更新任务时才继续要求对应写接口

### 2.3 规则与实现分离

- `rules` 保持纯函数，不读取仓储，不依赖平台能力。
- `ports` 只描述协作边界，不承载状态机与调度规则。
- `core` 是唯一允许同时依赖 `rules` 与 `ports` 的层。

### 2.4 稳定入口优先

- `core` 依赖 `ports` 时，只能走稳定入口或 `port-*` 契约文件。
- `core` 与 `ports` 不应深层导入 `data-structures/ds-*` 叶子模块，应通过稳定入口或本层私有封装访问。

## 3. 关键对象关系

### 3.1 Plan 与 Graph

- `Plan` 承接流程级生命周期。
- `Graph` 承接计划对应的流程结构。
- 图分为 `draft` 与 `published` 两个作用域：
  - `draft` 用于编辑
  - `published` 用于执行

### 3.2 Graph 与 Task

- 已发布图是任务物化的唯一结构来源。
- 节点决定物化任务的设计态信息。
- 依赖边决定调度事实计算所需的前置关系。

### 3.3 Runtime 与 Output

- `Runtime` 承接执行过程中的上下文、关系和结果。
- `Output` 承接结构化产物与交付结果。
- 两者都不替代 `Task`，而是补充执行与产物维度的信息。

## 4. 幂等、并发与发布边界

### 4.1 幂等

- 任务幂等目前只存在于 `advanceTask`。
- `idempotencyKey` 参与请求语义指纹判定：
  - 相同 key + 相同语义返回 replay 快照
  - 相同 key + 不同语义返回冲突

### 4.2 revision 并发保护

- 聚合更新统一通过显式 `expectedRevision` 保护并发写入。
- 计划、图、任务、运行态、输出都遵循同一类 revision 约束。

### 4.3 图发布边界

- `draft` 与 `published` 必须逻辑隔离。
- `publishGraph` 只复制当前草稿快照到已发布作用域，不引入应用层运行语义。
- 物化与调度事实统一基于 `published` 图计算。

## 5. 调度定位

LightTask 提供调度基础事实，但不内置应用层调度策略。

内核负责：

- DAG 结构校验
- 节点稳定顺序
- 前置依赖满足判定
- 可运行候选事实
- 阻塞原因基础表达

上层应用负责：

- 派发策略
- 优先级
- 审批策略
- 批量调度
- 外部执行器协同

## 6. 仓储与事件约束

### 6.1 仓储约束

- 读写快照必须与存储态隔离。
- 仓储写入不得原地修改调用方传入对象。
- 常规失败通过结构化结果返回。
- 直接抛异常只视为违约或防御路径。

### 6.2 事件约束

- 领域事件通过 `port-notify.publish(event)` 抽象。
- 当前事件边界覆盖：
  - task / plan / graph / runtime / output 单聚合事件
  - `plan.tasks_materialized`
  - `plan.launched`
- 具体传输方式由上层应用决定。

## 7. 当前公共 API 范围

当前 `core` 对外暴露的主 API 包括：

- 任务：`createTask`、`getTask`、`listTasks`、`listTasksByPlan`、`advanceTask`
- 计划：`createPlan`、`getPlan`、`listPlans`、`updatePlan`、`advancePlan`
- 图：`getGraph`、`saveGraph`、`editGraph`、`getPublishedGraph`、`publishGraph`
- 编排：`materializePlanTasks`、`getPlanSchedulingFacts`、`launchPlan`
- 运行态：`createRuntime`、`getRuntime`、`listRuntimes`、`advanceRuntime`
- 输出：`createOutput`、`getOutput`、`listOutputs`、`advanceOutput`

这些 API 的目标是形成稳定、通用、可扩展的编排入口，而不是吸收应用层产品能力。
