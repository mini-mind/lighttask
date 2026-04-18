# Changelog

## 0.1.0

- 以 `Plan + Task + Runtime + Output` 作为公开主模型，`Task` 是唯一真源对象
- 任务状态使用单轴 `status`
- 依赖统一落在 `Task.dependsOnTaskIds`
- `lighttask.tasks.remove` 删除任务时会自动解绑同 Plan 下游依赖
- `lighttask.tasks.remove` 的幂等重放改为持久化在 Plan 内部 sidecar，可跨实例复用
- `lighttask.plans.schedule` 提供 `editable / runnable / blocked / active / terminal / risky` 六类调度事实
- 新增 `consistency.run(scope, work)` 一致性边界端口
- 公开 `lighttask/adapters/memory` 子路径，提供最小启动用的内存适配器
- 补充 `defineTaskPolicy / defineTaskPolicies / createMemoryAdapters` 短名入口，作为推荐接入写法
- 公开事件面采用 `task / plan / runtime / output` 四类聚合事件
- `tasks.move / tasks.update / runs.update / outputs.update` 使用请求级幂等语义
- 包发布物只包含 `dist`
