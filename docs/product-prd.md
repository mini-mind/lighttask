# LightTask 产品说明

## 1. 产品定位

LightTask 是通用任务编排内核，不是流程图产品，也不是完整工作流应用。

它负责：

- 任务定义
- 任务依赖
- 任务状态推进
- 调度事实计算
- 执行与结果留痕

它不负责：

- 流程图编辑器
- planner session
- provider / agent / instance 适配
- 产品级软删除、归档、恢复
- 业务专属 read model

## 2. 核心判断

1. `Task` 是唯一真源对象。
2. `Plan` 只是任务分组容器。
3. 依赖关系直接写在 `Task.dependsOnTaskIds` 上。
4. `draft` 是正式待办前的编辑状态。
5. 调度直接围绕 `Task` 集合工作。
6. `Runtime` 和 `Output` 只负责执行留痕。

## 3. 用户价值

### 对应用层开发者

- 不需要围绕图结构组织核心数据
- 可以直接把业务对象映射成任务集合
- 可以把调度、依赖校验和执行留痕交给统一内核

### 对产品用户

- 任务可以先以草稿存在，再进入正式待办
- 返工可以通过 `todo -> draft` 明确表达
- 上游返工不会强制把所有下游结果直接回滚

## 4. 核心对象

### `Plan`

职责：

- 承接任务分组边界
- 承接分组级元信息

### `Task`

职责：

- 承接任务定义
- 承接任务依赖
- 承接任务状态
- 承接步骤
- 承接扩展字段

关键字段：

- `id`
- `planId`
- `dependsOnTaskIds`
- `status`
- `title`
- `summary`
- `metadata`
- `extensions`
- `steps`
- `createdAt`
- `updatedAt`

### `Runtime`

- 记录执行上下文和运行过程

### `Output`

- 记录结构化结果和交付物

## 5. 状态模型

LightTask 使用单轴任务状态。

默认状态：

- `draft`
- `todo`
- `dispatched`
- `running`
- `blocked_by_approval`
- `completed`
- `failed`
- `cancelled`

关键语义：

- `draft`：编辑中，不可执行
- `todo`：设计完成，可进入待办
- `todo -> draft`：允许，用于返工
- 除 `todo -> draft` 外，不支持任意状态回退

补充边界：

- `TaskStatus` 是 `string`
- 状态是否合法由 `taskLifecycle` 注册表约束
- 默认状态集只是内置策略，不是唯一允许的状态集合

## 6. 编辑权限模型

应用层只能直接编辑 `draft` 任务的定义字段。

定义字段至少包括：

- `title`
- `summary`
- `dependsOnTaskIds`
- `steps`
- `metadata`
- `extensions`

任务脱离 `draft` 后：

- 应用层不能再直接修改任务定义字段
- 只能由 LightTask 推进任务状态、步骤和运行留痕

## 7. 调度模型

调度输入：

- 同一 `Plan` 下的全部任务
- 任务依赖
- 任务状态

调度输出：

- 哪些任务可执行
- 哪些任务被阻塞
- 哪些任务处于活跃态
- 哪些任务已终态
- 哪些任务存在返工风险

关键规则：

- `draft` 不可执行
- 未满足依赖的任务被阻塞
- 上游从 `todo` 回到 `draft` 后：
  - 未开始下游重新阻塞
  - 已开始或已完成下游标记风险
  - 不自动回滚下游任务

## 8. 删除模型

LightTask 对删除采取系统稳妥优先的策略。

内核负责：

- 删除任务时自动解除其他任务对它的依赖
- 删除后重新计算调度事实
- 对同一删除请求的重复重试提供稳定幂等结果

应用层负责：

- 是否允许删除
- 是否提示用户
- 是否做备份
- 是否做软删除、回收站或归档

## 9. 非目标

LightTask 不试图成为：

- 图编辑器 SDK
- Agent 执行框架
- 文件工作流引擎
- 产品级审批系统
- 产品级任务恢复站

它提供的是稳定的公共编排语义，而不是完整业务产品。
