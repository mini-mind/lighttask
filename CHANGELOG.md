# Changelog

说明：本页记录的是当前已实现并可打包发布的版本语义。若仓库历史里曾出现旧的 `Graph`、`executionStatus`、`materializePlanTasks`、`launchPlan` 等术语，它们都不再代表当前发布物的公开 API。

## 0.1.0

- 收口为 `Task-only` 主模型，`Task` 成为唯一真源对象
- 删除 `Graph`、`publishGraph`、`materializePlanTasks`、`launchPlan`、`advancePlan` 等历史主链
- 任务状态改为单轴 `status`，移除 `designStatus + executionStatus` 双轴口径
- 依赖统一落在 `Task.dependsOnTaskIds`
- 新增 `deleteTask`，删除时自动解绑同 Plan 下游依赖
- `deleteTask` 的幂等重放改为持久化在 Plan 内部 sidecar，可跨实例复用
- `getPlanSchedulingFacts` 收口为 `draft / runnable / blocked / active / terminal / risk` 六类调度事实
- 新增 `consistency.run(scope, work)` 一致性边界端口
- 公开 `lighttask/ports/in-memory` 子路径，提供最小启动用的内存适配器
- 公开事件面收口为 `task/plan/runtime/output` 四类聚合事件
- 收口 `advanceTask / updateTask / advanceRuntime / advanceOutput` 的请求级幂等语义，避免历史 key 污染后续无 key 请求
- 收口文档与发布配置，包发布物只包含 `dist`
