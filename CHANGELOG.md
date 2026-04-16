# Changelog

## 0.1.0

- 切换到 Task-first 主模型，`Task` 成为唯一真源对象
- `Graph` 收口为依赖关系与约束关系视图
- 新增任务显式 `planId` 归属语义
- `materializePlanTasks` 收口为 provenance 同步，不再回写任务设计字段
- `launchPlan` 收口为任务快照收集 + 计划确认
- 新增 `consistency.run(scope, work)` 一致性边界端口
- 公开 `lighttask/ports/in-memory` 子路径，提供最小启动用的内存适配器
- 删除 `Task.status` 兼容别名，任务执行态统一为 `executionStatus`
- provenance 同步事件更名为 `plan.task_provenance_synced`
- 删除旧 provenance 治理块兼容读取与失效的 `materialization` 配置钩子
- 收口文档与发布配置，包发布物只包含 `dist`
