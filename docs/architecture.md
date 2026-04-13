# LightTask 架构

## 分层定义

```text
[应用层 Application]
    |
    v
[编排层 Orchestration]
   / \
  v   v
[规则层 Rule Domain]    [端口层 Port Domain]
        \              /
         v            v
      [数据结构层 Data Structure]
```

```text
外部系统（DB/WS/Daemon/Provider） <--- 端口实现（Adapters，实现 Port Domain 接口）
```

## 职责

1. 数据结构层：实体、值对象、状态枚举、事件结构、错误结构、版本字段。
2. 规则层：Task/Plan 状态机、DAG 校验与拓扑、幂等与 revision 规则。
3. 端口层：Repository、Clock、IdGenerator 等接口。
4. 编排层：`enqueue/claim/start/complete/fail/approve/cancel` 用例流程，只消费规则与端口，不直接混入适配器实现。
5. 应用层：API/Façade 暴露与装配，DTO 映射、权限入口、协议组装，步骤展示文案也在这一层收口。

## 硬约束

1. 规则层禁止 import 端口层。
2. 端口层禁止 import 规则层。
3. 编排层是唯一同时依赖规则层与端口层的层。
4. 编排层允许依赖端口接口，不允许直接依赖端口实现。
5. 适配器只能实现端口接口，不能写领域规则。
6. 错误契约统一为 `LightTaskError` 风格：`code`、`message`、`details` 可稳定判别。

## 模块批次清单（共 5 批）

### 第 1 批（首批）：数据结构层
1. `ds-task`
2. `ds-plan`
3. `ds-graph`
4. `ds-status`
5. `ds-event`
6. `ds-error`
7. `ds-revision`

### 第 2 批：规则层
1. `rule-task-fsm`
2. `rule-plan-fsm`
3. `rule-graph`
4. `rule-idempotency`
5. `rule-revision`

### 第 3 批：端口层
1. 已落地：`port-task-repo`
2. 已落地：`port-system`
3. 预留：`port-plan-repo`
4. 预留：`port-graph-repo`
5. 预留：`port-runtime`
6. 预留：`port-policy`
7. 预留：`port-notify`
8. 预留：`port-telemetry`

### 第 4 批：编排层（TDD）
1. `uc-enqueue-claim-start-complete`
2. `uc-fail-cancel-timeout`
3. `uc-approval-gate`
4. `uc-dag-ready-check`
5. `uc-idempotent-replay`

### 第 5 批：应用层
1. `api-command`
2. `api-query`
3. `api-subscribe`
4. `adapter-db`
5. `adapter-runtime`
6. `adapter-realtime`
7. `adapter-provider`
