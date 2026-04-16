import { isDeepStrictEqual } from "node:util";
import { topologicalSort } from "../rules";
import { cloneOptional } from "./clone";
import { runInConsistencyBoundary } from "./consistency-boundary";
import { toPublicGraph } from "./graph-snapshot";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import {
  MATERIALIZED_TASK_NAMESPACE,
  createActiveMaterializedTaskProvenance,
  createOrphanedMaterializedTaskProvenance,
  readMaterializedTaskProvenance,
} from "./materialized-task-governance";
import { publishPlanTaskProvenanceSyncedEvent, resolveNotifyPublisher } from "./notify-event";
import { toPublicPlan } from "./plan-snapshot";
import { clonePersistedTask, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  MaterializePlanTasksInput,
  MaterializePlanTasksResult,
  MaterializeRemovedNodePolicy,
  PersistedLightTask,
} from "./types";

const PUBLISHED_GRAPH_SCOPE = "published" as const;
const DEFAULT_REMOVED_NODE_POLICY = "soft_delete" as const;

function assertPlanId(planId: string): string {
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  return normalizedPlanId;
}

function assertExpectedPublishedGraphRevision(
  currentPublishedGraphRevision: number,
  expectedPublishedGraphRevision: number,
): void {
  if (!Number.isInteger(expectedPublishedGraphRevision) || expectedPublishedGraphRevision < 1) {
    throwLightTaskError(
      createLightTaskError(
        "VALIDATION_ERROR",
        "expectedPublishedGraphRevision 必须是大于等于 1 的整数",
        {
          expectedPublishedGraphRevision,
        },
      ),
    );
  }

  if (currentPublishedGraphRevision !== expectedPublishedGraphRevision) {
    throwLightTaskError(
      createLightTaskError(
        "REVISION_CONFLICT",
        "expectedPublishedGraphRevision 与当前已发布图 revision 不一致",
        {
          currentPublishedGraphRevision,
          expectedPublishedGraphRevision,
        },
      ),
    );
  }
}

function resolveRemovedNodePolicy(input: MaterializePlanTasksInput): MaterializeRemovedNodePolicy {
  const removedNodePolicy = input.removedNodePolicy ?? DEFAULT_REMOVED_NODE_POLICY;

  if (removedNodePolicy !== DEFAULT_REMOVED_NODE_POLICY && removedNodePolicy !== "keep") {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "removedNodePolicy 仅支持 soft_delete 或 keep", {
        removedNodePolicy,
        supportedRemovedNodePolicies: [DEFAULT_REMOVED_NODE_POLICY, "keep"],
      }),
    );
  }

  return removedNodePolicy;
}

function buildMaterializedTaskExtensions(
  extensions: PersistedLightTask["extensions"],
  provenance: ReturnType<typeof createActiveMaterializedTaskProvenance>,
): PersistedLightTask["extensions"] {
  const nextExtensions = cloneOptional(extensions) ?? {};
  const nextNamespaces = cloneOptional(nextExtensions.namespaces) ?? {};

  return {
    ...nextExtensions,
    namespaces: {
      ...nextNamespaces,
      [MATERIALIZED_TASK_NAMESPACE]: provenance,
    },
  };
}

function mapMaterializedTasksByNodeId(
  tasks: PersistedLightTask[],
  planId: string,
): Map<string, PersistedLightTask> {
  const tasksByNodeId = new Map<string, PersistedLightTask>();

  for (const task of tasks) {
    const normalizedTask = clonePersistedTask(task);
    if (normalizedTask.planId !== planId) {
      continue;
    }

    const provenance = readMaterializedTaskProvenance(normalizedTask);
    if (!provenance) {
      continue;
    }

    const existed = tasksByNodeId.get(provenance.source.nodeId);
    if (existed) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "检测到重复的计划任务物化 provenance", {
          planId,
          nodeId: provenance.source.nodeId,
          taskIds: [existed.id, normalizedTask.id],
        }),
      );
    }

    tasksByNodeId.set(provenance.source.nodeId, normalizedTask);
  }

  return tasksByNodeId;
}

function mapPlanTasksByNodeId(
  tasks: PersistedLightTask[],
  planId: string,
  nodes: ReadonlyArray<{ id: string; taskId: string }>,
): Map<string, PersistedLightTask> {
  const tasksByNodeId = new Map<string, PersistedLightTask>();
  const directTasksById = new Map<string, PersistedLightTask>();

  for (const task of tasks) {
    const normalizedTask = clonePersistedTask(task);
    directTasksById.set(normalizedTask.id, normalizedTask);
  }

  for (const node of nodes) {
    const directTask = directTasksById.get(node.taskId);
    if (!directTask) {
      continue;
    }

    if (directTask.planId !== planId) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "图节点引用的任务未归属当前计划", {
          planId,
          nodeId: node.id,
          taskId: directTask.id,
          taskPlanId: directTask.planId,
        }),
      );
    }
    tasksByNodeId.set(node.id, directTask);
  }

  return tasksByNodeId;
}

function hasStructuralChanges(
  task: PersistedLightTask,
  nextExtensions: PersistedLightTask["extensions"],
): boolean {
  return !isDeepStrictEqual(task.extensions, nextExtensions);
}

function finalizeMaterializedTasksResult(
  tasks: MaterializePlanTasksResult["tasks"],
  removedNodePolicy: MaterializeRemovedNodePolicy,
): MaterializePlanTasksResult["tasks"] {
  switch (removedNodePolicy) {
    case "soft_delete":
    case "keep":
      // 两种策略都只返回当前图上的 active 任务；
      // soft_delete 会额外把已移除节点任务标记为 orphaned，由查询层决定是否默认隐藏。
      return tasks;
  }
}

function markRemovedMaterializedTasksAsOrphaned(input: {
  options: CreateLightTaskOptions;
  tasksByNodeId: ReadonlyMap<string, PersistedLightTask>;
  publishedNodeIds: ReadonlySet<string>;
  publishedGraphRevision: number;
}): void {
  const clockNow = requireLightTaskFunction(input.options.clock?.now, "clock.now");
  const saveIfRevisionMatches = requireLightTaskFunction(
    input.options.taskRepository?.saveIfRevisionMatches,
    "taskRepository.saveIfRevisionMatches",
  );

  for (const [nodeId, task] of input.tasksByNodeId.entries()) {
    if (input.publishedNodeIds.has(nodeId)) {
      continue;
    }

    const provenance = readMaterializedTaskProvenance(task);
    if (!provenance || provenance.governance?.state === "orphaned") {
      continue;
    }

    const nextExtensions = buildMaterializedTaskExtensions(
      task.extensions,
      createOrphanedMaterializedTaskProvenance(provenance, input.publishedGraphRevision),
    );
    if (isDeepStrictEqual(task.extensions, nextExtensions)) {
      continue;
    }

    const nextTask = clonePersistedTask(task);
    nextTask.extensions = nextExtensions;
    nextTask.updatedAt = clockNow();
    nextTask.revision = task.revision + 1;

    const saved = saveIfRevisionMatches(nextTask, task.revision);
    if (!saved.ok) {
      throwLightTaskError(saved.error);
    }
  }
}

export function materializePlanTasksUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: MaterializePlanTasksInput,
): MaterializePlanTasksResult {
  const publishEvent = resolveNotifyPublisher(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const getGraph = requireLightTaskFunction(options.graphRepository?.get, "graphRepository.get");
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const normalizedPlanId = assertPlanId(planId);
  const storedPlan = getPlan(normalizedPlanId);

  if (!storedPlan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法物化计划任务", {
        planId: normalizedPlanId,
      }),
    );
  }

  const removedNodePolicy = resolveRemovedNodePolicy(input);
  const publishedGraph = getGraph(normalizedPlanId, PUBLISHED_GRAPH_SCOPE);
  if (!publishedGraph) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到已发布图快照，无法物化计划任务", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertExpectedPublishedGraphRevision(
    publishedGraph.revision,
    input.expectedPublishedGraphRevision,
  );

  const nodesById = new Map(publishedGraph.nodes.map((node) => [node.id, node]));
  const publishedNodeIds = new Set(publishedGraph.nodes.map((node) => node.id));
  const orderedNodeIds = topologicalSort(publishedGraph);
  const listedTasks = listTasks();
  const materializedTasksByNodeId = mapMaterializedTasksByNodeId(listedTasks, normalizedPlanId);
  const tasksByNodeId = mapPlanTasksByNodeId(listedTasks, normalizedPlanId, publishedGraph.nodes);
  const materializedTasks = runInConsistencyBoundary(
    options,
    `materializePlanTasks:${normalizedPlanId}`,
    () => {
      const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
      const saveIfRevisionMatches = requireLightTaskFunction(
        options.taskRepository?.saveIfRevisionMatches,
        "taskRepository.saveIfRevisionMatches",
      );
      const materializedTasks: MaterializePlanTasksResult["tasks"] = [];

      for (const nodeId of orderedNodeIds) {
        const node = nodesById.get(nodeId);
        if (!node) {
          continue;
        }

        const existedTask = tasksByNodeId.get(node.id);
        if (!existedTask) {
          throwLightTaskError(
            createLightTaskError("NOT_FOUND", "图节点引用的任务不存在，无法同步计划任务", {
              planId: normalizedPlanId,
              nodeId: node.id,
              taskId: node.taskId,
            }),
          );
        }

        const nextExtensions = buildMaterializedTaskExtensions(
          cloneOptional(existedTask.extensions),
          createActiveMaterializedTaskProvenance(publishedGraph.revision, node.id, node.taskId),
        );

        if (!hasStructuralChanges(existedTask, nextExtensions)) {
          materializedTasks.push(toPublicTask(existedTask));
          continue;
        }

        const nextTask = clonePersistedTask(existedTask);
        // Task-first 下，同步只补充关系快照 provenance，不再允许 Graph 回写任务设计字段。
        nextTask.extensions = nextExtensions;
        nextTask.updatedAt = clockNow();
        nextTask.revision = existedTask.revision + 1;

        const saved = saveIfRevisionMatches(nextTask, existedTask.revision);
        if (!saved.ok) {
          throwLightTaskError(saved.error);
        }

        materializedTasks.push(toPublicTask(saved.task));
      }

      if (removedNodePolicy === "soft_delete") {
        markRemovedMaterializedTasksAsOrphaned({
          options,
          tasksByNodeId: materializedTasksByNodeId,
          publishedNodeIds,
          publishedGraphRevision: publishedGraph.revision,
        });
      }

      return materializedTasks;
    },
  );

  const result = {
    plan: toPublicPlan(storedPlan),
    publishedGraph: toPublicGraph(publishedGraph),
    tasks: finalizeMaterializedTasksResult(materializedTasks, removedNodePolicy),
  };

  publishPlanTaskProvenanceSyncedEvent(publishEvent, result);
  return result;
}
