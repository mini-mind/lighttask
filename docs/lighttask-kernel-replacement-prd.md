# LightTask PRD

**版本**：4.0  
**日期**：2026-04-16  
**状态**：Task-only 终局已落地，可作为当前实现口径

## 1. 产品定位

LightTask 是通用任务中心编排内核，不是流程图产品，也不是完整工作流应用。

它要解决的是：

- 任务定义
- 任务依赖
- 任务状态推进
- 调度事实计算
- 执行与结果留痕

它不解决的是：

- 流程图编辑器
- planner session
- provider / agent / instance 适配
- 产品级软删除/归档/恢复
- 业务专属 read model

## 2. 核心产品判断

1. `Task` 是唯一真源对象
2. `Plan` 只是任务分组容器
3. 依赖关系直接写在 `Task` 上
4. `draft` 是正式待办之前的编辑状态
5. `Graph` 完全移除
6. 调度直接围绕 `Task` 集合工作

## 3. 为什么要继续收缩模型

上一轮 Task-first 虽然已经把 `Task` 拉成真源，但仍残留一条长链：

- 先维护 Graph
- 再发布 Graph
- 再同步 provenance
- 再启动计划

这仍然会带来这些问题：

- 应用层心智仍然被流程图牵着走
- 依赖关系编辑链路太长
- `Plan` 承担了太多不必要的生命周期含义
- 应用层很难获得“返工但不强制回滚”的柔性体验

因此终局方向不是“进一步弱化 Graph”，而是：

- 彻底把 Graph 退出主模型
- 让 `Task` 直接承接依赖与状态
- 让 `Plan` 退回分组意义

## 4. 目标用户价值

### 对应用层开发者

- 不再需要围绕 Graph 组织数据
- 不再需要理解 `publish / materialize / launch` 长链
- 可以直接把业务对象映射成任务集合

### 对产品用户

- 任务可以先以草稿态存在
- 编辑完成后再进入正式待办
- `todo -> draft` 返工有明确语义
- 不会因为上游返工就被系统粗暴回滚全部后继结果

## 5. 核心对象

### `Plan`

职责：

- 承接任务分组边界
- 承接分组级元信息

不再承担：

- 启动流程
- 冻结流程
- 确认流程版本

### `Task`

职责：

- 承接任务定义
- 承接任务依赖
- 承接任务状态
- 承接步骤
- 承接扩展字段
- 成为调度、审批、执行、审计的唯一主对象

建议关键字段：

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

补充冻结：

- `createTask` 初始只允许创建 `draft`
- `planId` 创建后不可迁移
- 风险不持久化到 `Task`，只在调度事实中表达

### `Runtime`

- 记录执行上下文

### `Output`

- 记录结果与交付物

### 对象关系

```text
Plan 1 --- n Task
Task n --- n Task   (dependsOnTaskIds，同 Plan 依赖)
Task 1 --- n SchedulingFactView
Task 1 --- n Runtime? / Output?   (通过 refs 建弱关联)
```

产品含义：

- `Plan` 只是任务分组容器
- `Task` 才是编排真源
- 调度事实只是读取视图，不是新的持久化真源
- `Runtime` / `Output` 只是执行留痕对象

## 6. 状态模型

终局使用单轴任务状态。

建议内置状态：

- `draft`
- `todo`
- `dispatched`
- `running`
- `blocked_by_approval`
- `completed`
- `failed`
- `cancelled`

### 关键语义

- `draft`：编辑中，不可执行
- `todo`：设计完成，正式待办
- `todo -> draft`：允许，用于返工
- 除这个例外外，不支持任意状态回退

### 产品原则

- 想返工未开始任务，可以 `todo -> draft`
- 想重做已开始或已完成任务，应新建 `Task`

## 7. 编辑权限模型

### 应用层权限

应用层只能直接编辑 `draft` 任务的定义字段。

定义字段至少包括：

- `title`
- `summary`
- `dependsOnTaskIds`
- `steps`
- `metadata`
- `extensions`

### LightTask 权限

任务脱离 `draft` 后：

- 应用层不能再改任务定义字段
- 只能由 LightTask 推进任务状态、步骤与运行留痕

补充理解：

- `steps[].id / title / stage` 属于定义
- `steps[].status` 属于运行留痕

这条边界是为了避免：

- 执行中任务被外层直接改定义
- 调度真相被 UI 或业务接口随意改写

## 8. 调度模型

调度以后只围绕某个 `Plan` 下的任务集合工作。

### 输入

- 全部任务
- 任务依赖
- 任务状态

### 输出

- 哪些任务现在可执行
- 哪些任务被阻塞
- 哪些任务已终态
- 哪些任务存在返工风险

这里的“调度输出”是读取视图，不是新的持久化对象。

### 关键规则

- `draft` 不可执行
- 依赖 `draft` 的任务被阻塞
- 未满足依赖的任务被阻塞
- 上游从 `todo` 回到 `draft` 后：
  - 未开始下游重新阻塞
  - 已开始/已完成下游不自动回滚
  - 但要打风险标记

## 9. 删除模型

LightTask 的删除策略是“系统稳妥优先，产品治理外置”。

### 内核必须做

- 删除任务时自动解除其他任务对它的依赖
- 删除后立刻重算调度事实

### 应用层自己决定

- 是否允许删除
- 是否提示用户
- 是否做备份
- 是否做软删除/回收站/归档

## 10. 成功标准

1. 应用层可以只围绕 `Task` 接入，不再依赖 `Graph`
2. `Plan` 被收缩为分组容器，不再承担流程生命周期
3. `draft` 成为真实任务状态，而不是额外治理开关
4. `todo -> draft` 返工路径具备清晰语义
5. 删除任务后系统依赖关系仍然稳定
6. 文档、实现、测试围绕同一套 `Task-only` 主链收口

## 11. 非目标

这一轮不是为了把 LightTask 做成：

- 图编辑器 SDK
- Agent 执行框架
- 文件工作流引擎
- 产品级审批系统
- 产品级任务恢复站

它只负责收口稳定的公共编排语义。

## 12. 结论

LightTask 的终局方向已经明确：

- 不再保留 Graph-first 甚至 Graph-assisted 的主链
- 直接改成 `Plan + Task + Runtime + Output`
- 用 `Task.status + Task.dependsOnTaskIds` 解释编排系统的大部分行为

这套文档冻结后，后续重构不应再反复回到“Graph 要不要保留”为讨论中心。
