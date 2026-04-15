# Graph Incremental Editing Slice 1

## 目标

在现有 `draft graph / published graph` 边界之上，补齐第一阶段的图增量编辑能力：

- 新增 `editGraph(planId, input)` 公共 API
- 仅允许编辑 `draft` 图
- 通过 `expectedRevision` 做并发保护
- 使用显式 patch 操作序列修改内存中的草稿快照
- 在保存前对结果做完整 DAG 校验
- 不改变 `saveGraph` 的整快照替换语义
- 不改变 `publishGraph` 的 draft -> published 复制边界

## 最小契约

```ts
type GraphEditOperation =
  | { type: "upsert_node"; node: GraphNodeRecord }
  | { type: "remove_node"; nodeId: string }
  | { type: "upsert_edge"; edge: GraphEdgeRecord }
  | { type: "remove_edge"; edgeId: string };

interface EditGraphInput {
  expectedRevision: number;
  operations: GraphEditOperation[];
  idempotencyKey?: string;
}
```

## 行为约束

1. `editGraph` 必须要求计划存在且草稿图已存在；不负责首次建图。
2. patch 操作按输入顺序顺序执行，结果必须可重复推导。
3. `upsert_*` 使用整对象替换；若目标不存在则追加新记录。
4. `remove_node` 不做级联删除；若仍有边引用该节点必须显式报错。
5. `remove_node` / `remove_edge` 删除不存在目标时必须显式报错，不能静默 no-op。
6. patch 应用逻辑放在 `rules` 层纯函数中；`core` 只负责聚合读取、revision guard、保存与错误归一化。
7. 保存路径仍沿用 `graphRepository.get + saveIfRevisionMatches`，不新增 repo patch 原语。
8. 已发布图在再次 `publishGraph` 前不得受到草稿增量编辑影响。

## 非目标

- 不在本切片引入物化策略变更
- 不在本切片引入调度基础能力
- 不在本切片引入 runtime 关系增强
- 不在本切片引入复合事件或 artifact/output 抽象
