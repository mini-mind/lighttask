# Product Requirements Document: LightTask 面向替换上层核心逻辑的通用编排内核

**Version**: 1.0
**Date**: 2026-04-15
**Author**: Sarah (Product Owner)
**Quality Score**: 94/100

---

## Executive Summary

LightTask 当前已经从最小编排内核演进到了具备 task、plan、graph、runtime、notify 等核心能力的 workflow kernel，并已经形成 graph publish boundary、任务物化、计划启动、runtime 生命周期与单聚合领域事件的第一版闭环。当前问题不再是“核心对象是否存在”，而是这些对象能否进一步形成完整、通用、可插拔、可演进的协议层，以承接更复杂的图编辑、任务治理、运行关系、复合编排事件与产物抽象。

本 PRD 的目标，不是把 Linpo 或 TopoFlow 的数据结构搬进 LightTask，而是把 LightTask 提升为**面向替换上层核心逻辑**的通用编排内核。它必须能够支撑上层应用开发者在不复制核心逻辑的前提下，构建类似 Linpo 和 TopoFlow 的流程/任务系统，同时继续对平台、传输、Provider、UI 结构和具体调度策略保持解耦。

该能力建设的价值在于：统一核心协议，减少上层重复实现，降低集成复杂度，稳定长期演进边界，并使任务、计划、图、运行态、事件的生命周期全部落在一个一致的内核模型中。当前阶段的重点不是继续扩张应用语义，而是在已经形成的主干能力之上补齐治理层协议，并明确哪些决策应继续留在上层应用。 

---

## Problem Statement

**Current Situation**:  
LightTask 已具备较完整的编排主干：task / plan / graph / runtime / notify 的基础对象与核心 use case 已落地，且已经具备 graph publish boundary、materializePlanTasks、launchPlan 等能力。与当前代码现实和 `docs/architecture.md` 的分层边界对照后，真正尚未收敛的高阶缺口主要是：图的增量编辑语义不足、任务物化后的治理规则不足、runtime 关系模型偏弱、复合编排事件尚未形成协议、产物/输出抽象尚未进入内核。

**Proposed Solution**:  
将 LightTask 明确升级为“面向替换上层核心逻辑的通用 workflow / orchestration kernel”，继续补齐替换上层核心逻辑所需的剩余关键能力：图增量编辑、任务物化治理规则、runtime 关系增强、复合领域事件协议、产物/输出抽象。同时保持 core 只承载通用逻辑，应用层 transport、UI、platform/provider 适配以及调度策略一律通过上层应用与 ports/adapter 体系隔离。

**Business Impact**:  
- 减少 Linpo / TopoFlow 以及未来上层应用中的核心逻辑重复实现
- 稳定通用协议，降低后续扩展和集成成本
- 使新应用更容易基于 LightTask 构建，而不是复制其核心状态机、图规则、任务物化和运行态逻辑
- 提升维护效率，使内核维护者能够在单一代码库中迭代核心能力，同时避免被上层应用策略绑架

---

## Success Metrics

**Primary KPIs:**
- **核心闭环完备度**：LightTask 内核能够完整承接“计划/图/任务/运行态/基础事件”的通用主链，并为上层应用提供调度治理所需的稳定基础能力与 runnable candidate 计算能力；验收方式为对应 use case 与测试矩阵全部落地并通过
- **重复逻辑收敛度**：Linpo / TopoFlow 中原本属于核心逻辑的共性能力，可以迁移或映射到 LightTask，而不需要继续在上层重复维护；验收方式为能力映射清单中高优先级项全部被内核覆盖
- **协议稳定度**：task / plan / graph / runtime / event 的核心接口可稳定导出并通过 contract tests；验收方式为公共导出契约、API 契约、repo 契约、状态机契约全部通过
- **集成难度下降**：上层应用接入 LightTask 时，不再需要自行重建任务物化、计划推进、基础运行态和单聚合事件流；验收方式为集成示例/映射分析中胶水层显著减少

**Validation**:  
通过以下方式验证：
- `npm run check` 全绿
- 对外导出契约测试与 API 测试全绿
- 完成一份“Linpo / TopoFlow 能力映射到 LightTask 的覆盖矩阵”并达到可接受覆盖率
- 对剩余延期项保持明确边界，不出现回退到应用耦合模型的设计漂移

---

## User Personas

### Primary: 上层应用开发者
- **Role**: 基于 LightTask 构建流程/任务系统的应用开发者
- **Goals**: 复用稳定的通用核心逻辑，而不是在应用中重复实现计划、图、任务、运行态与调度能力
- **Pain Points**: 当前仍需自己补图编辑边界、任务物化、运行态治理、复合事件与部分查询/治理逻辑
- **Technical Level**: Advanced

### Secondary: 内核维护者
- **Role**: 维护和演进 LightTask 本身的开发者
- **Goals**: 保持核心模型清晰、可测、可演进，并防止被单一应用的数据结构绑架
- **Pain Points**: 如果没有清晰 PRD 和边界，容易在新增能力时把应用语义、transport 语义、平台语义错误地下沉到 core
- **Technical Level**: Advanced

---

## User Stories & Acceptance Criteria

### Story 1: 统一核心对象与主链闭环

**As a** 上层应用开发者  
**I want to** 使用 LightTask 直接承接 task / plan / graph / runtime 的核心逻辑  
**So that** 我不必在应用层重复实现流程图、任务网、运行态和事件的内核能力

**Acceptance Criteria:**
- [ ] LightTask 提供完整的 task / plan / graph / runtime 核心对象与最小 CRUD/query 能力
- [ ] LightTask 提供计划到已发布图到任务网的完整主链闭环
- [ ] 上层应用不需要自行实现这些核心对象的基础生命周期逻辑

### Story 2: 保持通用性与可插拔边界

**As a** 内核维护者  
**I want to** 在增强能力的同时保持 LightTask 的通用性和可插拔性  
**So that** 它不会被 Linpo / TopoFlow 的专属结构绑架

**Acceptance Criteria:**
- [ ] core 中不出现 Linpo/TopoFlow 专属字段、session 命名、workspace 结构或 transport 协议
- [ ] Provider、平台集成、通知传输、策略层通过 ports/adapter 方式隔离
- [ ] 所有新增能力都能通过通用契约和测试表达，而不是依赖应用层假设

### Story 3: 降低集成和维护成本

**As a** 上层应用开发者  
**I want to** 以较少胶水代码把 LightTask 集成到应用中  
**So that** 我可以把更多工作集中在产品层而不是重复维护核心编排逻辑

**Acceptance Criteria:**
- [ ] 任务物化、计划启动、运行态推进、单聚合事件发布以及调度候选计算都由内核提供
- [ ] 上层只需补应用特有的 transport / UI / provider 适配，以及具体调度策略
- [ ] 契约测试能够清晰说明哪些能力属于内核、哪些能力明确留在应用层

### Story 4: 支撑多视图需求但不绑定视图实现

**As a** 上层应用开发者  
**I want to** 在看板、甘特图、流程图等视图中复用同一核心对象  
**So that** 我不需要为不同视图维护多套核心状态模型

**Acceptance Criteria:**
- [ ] task / plan / graph 支持结构化扩展槽位，而不是把所有字段都塞进无约束 metadata
- [ ] 扩展槽位仅表达通用承载能力，不带 UI 框架或页面实现语义
- [ ] 扩展字段经过快照隔离与公共类型对齐测试验证

---

## Functional Requirements

### Core Features

**Feature 1: 完整核心对象协议**
- Description: LightTask 必须提供 task / plan / graph / runtime 四类核心对象的稳定数据结构、状态机、repo 合约与最小 CRUD/query 能力
- User flow: 创建对象 -> 查询对象 -> 条件更新 -> 生命周期推进 -> 读取最新快照
- Edge cases: revision 冲突、对象不存在、坏依赖注入、快照污染、空白 ID / 非法输入
- Error handling: 统一通过 `LightTaskError` 暴露结构化错误

**Feature 2: Graph draft/publish 与计划主链**
- Description: LightTask 必须支持 draft graph 与 published graph 边界，并以 published graph 为唯一任务物化来源
- User flow: 保存草稿图 -> 发布图 -> 从已发布图物化任务 -> 启动计划
- Edge cases: published graph 缺失、published graph revision 不匹配、草稿更新但未发布、非法图结构
- Error handling: `NOT_FOUND` / `REVISION_CONFLICT` / `VALIDATION_ERROR`

**Feature 3: Materialize 与 Launch 编排**
- Description: 内核需要支持计划 -> 已发布图 -> 任务网 的通用编排闭环，并能以最小语义完成计划启动
- User flow: 计划 ready -> 读取 published graph -> 物化任务 -> confirm plan
- Edge cases: 已存在任务如何同步、未发布图不可 launch、计划状态不合法、graph 与 task 结构不一致
- Error handling: 严格 revision guard，禁止半吊子状态漂移

**Feature 4: 调度治理基础能力（MVP 内）**
- Description: 为替换 Linpo/TopoFlow 核心逻辑，LightTask 需要内置通用调度基础能力，但不内置具体调度策略。LightTask 负责提供可运行任务网络、状态机、图规则、运行态与事件基础，并能计算哪些任务当前可运行、哪些任务被阻塞以及稳定顺序；具体出队顺序、优先级、批量策略、人工审批介入策略等由上层应用定义，以保持内核灵活和不过度臃肿。
- User flow: 读取任务网 -> LightTask 计算 runnable / blocked / terminal 集合及其稳定顺序 -> 上层应用按自身策略选择执行顺序 -> 驱动任务与 runtime 状态更新
- Edge cases: 非法迁移、并发冲突、任务无可执行动作、重入调度、上层策略变更
- Error handling: 延续现有状态机与 revision 规则；内核只对核心一致性和候选任务计算负责，不下沉应用层 provider 或调度策略逻辑

**Feature 5: 通用 runtime 聚合**
- Description: runtime 必须作为独立聚合存在，用于承接运行态而不污染 task/plan 本体
- User flow: createRuntime -> get/list -> advanceRuntime
- Edge cases: parentRef 为空、ownerRef 非法空白、状态冲突、revision mismatch、运行态结果覆盖
- Error handling: 与其他聚合一致，基于条件写和统一错误面

**Feature 6: 基础领域事件通知**
- Description: 内核必须支持单聚合成功提交后的领域事件发布，不绑定 transport
- User flow: 聚合写入成功 -> publish(domain event)
- Edge cases: replay/no-op 不重复发布、发布事件快照污染、未注入 notify port 时行为保持兼容
- Error handling: 事件发布 contract 与核心写入时序保持一致

### Out of Scope
- 具体通知传输层（SSE / WebSocket / callback）
- telemetry / metrics / tracing / 审计系统
- policy 抽象与策略引擎
- Linpo planner session / TopoFlow workspace 等应用专属模型
- UI 页面、平台壳、provider 接入细节

---

## Technical Constraints

### Performance
- 核心对象操作和状态推进应保持同步、确定性、可测试
- 最小目标是保证内核 use case 在本地测试环境下快速可回归，不引入明显热路径膨胀
- 任务物化、图发布、runtime 推进需要保证可预测的复杂度和稳定顺序

### Security
- 公共错误面统一，不泄漏未规约的原生异常
- 不允许通过扩展字段或 transport 绑定破坏内核分层边界
- revision / optimistic concurrency 必须作为一致性保护基础能力
- 通知机制不能隐式绑定外部通道或回调行为

### Integration
- 所有应用特有能力必须通过 ports/adapter 进入，不直接进入 core
- 内核导出必须保持稳定：根入口 + `data-structures` / `rules` / `ports` 子入口
- 上层应用必须可以只依赖 LightTask 的通用契约，而不是内部实现细节

### Technology Stack
- TypeScript / CommonJS / Node >= 20
- 测试以 Node test + TypeScript build 产物为准
- 质量门包含 `typecheck`、`lint`、`format:check`、`arch:check`、`test`

---

## MVP Scope & Phasing

### Phase 1: MVP（当前已形成的产品基线）
- task / plan / graph / runtime 四类核心对象协议
- 最小 CRUD / query
- graph draft / publish boundary
- `materializePlanTasks`
- `launchPlan`
- runtime 最小聚合
- 单聚合基础领域事件
- 结构化扩展槽位

**MVP Definition**:  
LightTask 已能够在不绑定上层应用数据结构的前提下，承接“计划 / 图 / 任务 / 运行态 / 基础事件”的通用主链，并为上层应用补充调度治理、复合事件和执行治理所需的进一步能力留出清晰边界。

### Phase 2: Next Critical Gaps（下一阶段关键缺口）
- graph patch / incremental edit 语义
- materialization reconciliation policy 的更细规则抽象
- runtime 关系模型增强（ownerRef / relatedRefs / 多层 runtime）
- 复合编排事件协议（如 materialized / launched）
- artifact / output 通用抽象
- 面向上层应用的调度治理支撑能力继续增强，但具体调度策略仍由上层定义

### Future Considerations
- 更细粒度的 graph mutation API
- 任务与运行态之间更丰富的关系约束
- 批量/复合领域事件协议
- 更强的执行治理与恢复能力

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| 继续把应用层语义错误地下沉到 core | Med | High | 通过 ports/adapter 边界与 PRD 非目标清单严格限制作用域 |
| runtime / graph / materialize 语义过度扩张，导致内核复杂度失控 | Med | High | 严格按聚合职责拆分，先保留通用闭环，再处理复合协议 |
| 扩展槽位变成新的“万能 metadata”黑洞 | High | Med | 为 extensions 建立结构化承载约束，并用契约测试锁住公共类型与快照隔离 |
| 通知模型过早绑定 transport 或 batch 语义 | Med | High | 当前仅实现单聚合成功提交事件，复合事件明确延后 |
| 过度追求一次性完整导致实现切片过大 | Med | Med | 在 PRD 范围完整的前提下，实施上仍按小切片分批落地 |

---

## Dependencies & Blockers

**Dependencies:**
- LightTask 当前已有的分层架构、测试基线与当前实现的主链能力
- task / plan / graph / runtime / notify 的现有实现和质量门
- 上层应用（Linpo / TopoFlow）源码与架构作为需求压力来源，而非数据结构模板
- 与 `docs/architecture.md` 保持一致：core 提供通用编排能力，不承载应用层策略、transport、平台壳或 provider 细节

**Known Blockers:**
- 复合编排事件协议目前尚未定义，不应混入当前基线能力
- graph patch / incremental edit 与 artifact/output 抽象虽然重要，但当前仍处于下一阶段设计题目，不能反向阻塞现有主链
- 架构文档当前仍将 `port-notify` 标记为预留项，而代码现实已经具备 notify 基础能力；后续需要补一次文档同步，避免架构真源与实现现状脱节

---

## Appendix

### Glossary
- **Task**: 核心任务聚合，承接任务状态、步骤、扩展槽位与归属信息
- **Plan**: 核心计划聚合，承接流程级生命周期与已发布图绑定能力
- **Graph**: 计划对应的 DAG 结构，包含 draft / published 边界
- **Runtime**: 独立运行态聚合，用于表示运行过程而非污染 task/plan 本体
- **Materialization**: 从已发布图生成/同步任务网的通用编排过程
- **Launch**: 以最小语义将计划从 ready 进入 confirmed，并闭合 plan -> graph -> task 主链
- **Notify**: 单聚合成功提交后的领域事件发布能力，不绑定具体传输通道

### References
- `README.md`
- `docs/architecture.md`
- Linpo: `docs/architecture.md`, `docs/prd.md`, `app/db/models.py`
- TopoFlow: `src/stores/workflow.js`

---

*This PRD was created through interactive requirements gathering with quality scoring to ensure comprehensive coverage of business, functional, UX, and technical dimensions.*
