# Task-first 重构收敛记录

本文档记录 2026-04-16 这一轮 Task-first 重构的最终收敛结果。

## 已落地结论

1. `Task` 是唯一真源对象
2. `Graph` 收口为依赖关系与约束关系视图
3. `Task` 使用 `designStatus + executionStatus` 双轴
4. 调度直接基于任务集合与已发布关系视图计算
5. `publishGraph` 只发布依赖关系视图，不参与任务归属与任务设计同步
6. `materializePlanTasks` 只同步关系 provenance
7. `launchPlan` 只做任务快照收集 + 计划确认

## 本轮关键实现

### 阶段一：任务对象收口

- 任务支持显式 `planId`
- 任务公开模型补齐 `updatedAt`
- `updateTask` 支持显式绑定计划归属

### 阶段二：调度收口

- `getPlanSchedulingFacts` 只认图对任务的直接引用关系
- 草稿任务返回 `task_design_incomplete`
- 调度只接受已归属当前计划的真实任务

### 阶段三：Graph 收口

- 图节点必须引用当前计划的任务
- 同图内禁止一任务多节点分身
- 图只描述关系，不再影响任务设计字段

### 阶段四：关系同步 API 收口

- `publishGraph` 只发布关系视图快照并推进 `plan.revision`
- `materializePlanTasks` 只同步 `lighttask` provenance
- `launchPlan` 在一致性边界内完成任务快照收集和计划确认

### 阶段五：一致性边界

- 新增 `consistency.run(scope, work)` 端口
- `publishGraph` / `materializePlanTasks` / `launchPlan` 统一走一致性边界

### 阶段六：文档与发布

- README、架构、接入指南、PRD 已改为当前实现口径
- 包发布配置已收口为只发布 `dist`

### 阶段七：P3 最终收口

- 任务执行态统一收口为 `executionStatus`
- `listTasks` 查询参数统一收口为 `executionStatus`
- provenance 同步事件正式更名为 `plan.task_provenance_synced`
- README、接入指南、架构文档补齐对象关系的人话说明

## 验证

- 定向 API 回归通过
- `npm run check` 作为最终验收入口
- 发布物通过 `npm pack --dry-run` 复核
