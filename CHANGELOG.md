# Changelog

## 0.1.0

- 以 `Plan + Task + Runtime + Output` 作为公开主模型，`Task` 是唯一真源对象
- 任务状态使用单轴 `status`
- 依赖统一落在 `Task.dependsOnTaskIds`
- 新增 `deleteTask`，删除时自动解绑同 Plan 下游依赖
- `deleteTask` 的幂等重放改为持久化在 Plan 内部 sidecar，可跨实例复用
- `getPlanSchedulingFacts` 提供 `draft / runnable / blocked / active / terminal / risk` 六类调度事实
- 新增 `consistency.run(scope, work)` 一致性边界端口
- 公开 `lighttask/ports/in-memory` 子路径，提供最小启动用的内存适配器
- 公开事件面采用 `task / plan / runtime / output` 四类聚合事件
- `advanceTask / updateTask / advanceRuntime / advanceOutput` 使用请求级幂等语义
- 包发布物只包含 `dist`
