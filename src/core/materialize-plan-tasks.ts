import { isDeepStrictEqual } from "node:util";
import { topologicalSort } from "../rules";
import { cloneOptional } from "./clone";
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
import { publishPlanTasksMaterializedEvent, resolveNotifyPublisher } from "./notify-event";
import { toPublicPlan } from "./plan-snapshot";
import { clonePersistedTask, createDefaultTaskSteps, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  MaterializePlanTasksInput,
  MaterializePlanTasksResult,
  MaterializeRemovedNodePolicy,
  MaterializedPlanTaskProvenance,
  PersistedLightTask,
} from "./types";

const PUBLISHED_GRAPH_SCOPE = "published" as const;
const DEFAULT_REMOVED_NODE_POLICY = "keep" as const;
const MATERIALIZED_TASK_SYNC_BOUNDARY = {
  // 这些字段由已发布图定义，重复物化时允许被结构性覆盖。
  syncable: ["planId", "title", "summary", "metadata", "extensions"] as const,
  // 这些字段属于任务实例自身，物化不应改写。
  protected: [
    "id",
    "status",
    "steps",
    "createdAt",
    "revision",
    "idempotencyKey",
    "lastAdvanceFingerprint",
  ] as const,
} as const;

type MaterializedTaskSyncableFields = Pick<
  PersistedLightTask,
  (typeof MATERIALIZED_TASK_SYNC_BOUNDARY.syncable)[number]
>;

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

  if (removedNodePolicy !== DEFAULT_REMOVED_NODE_POLICY) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "removedNodePolicy 仅支持 keep", {
        removedNodePolicy,
        supportedRemovedNodePolicies: [DEFAULT_REMOVED_NODE_POLICY],
      }),
    );
  }

  return removedNodePolicy;
}

function buildMaterializedTaskExtensions(
  extensions: PersistedLightTask["extensions"],
  provenance: MaterializedPlanTaskProvenance,
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
    if (task.planId !== planId) {
      continue;
    }

    const provenance = readMaterializedTaskProvenance(task);
    if (!provenance) {
      continue;
    }

    const existed = tasksByNodeId.get(provenance.source.nodeId);
    if (existed) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "检测到重复的计划任务物化 provenance", {
          planId,
          nodeId: provenance.source.nodeId,
          taskIds: [existed.id, task.id],
        }),
      );
    }

    tasksByNodeId.set(provenance.source.nodeId, task);
  }

  return tasksByNodeId;
}

function assertNodeTitle(planId: string, nodeId: string, label: string): string {
  const normalizedTitle = label.trim();

  if (!normalizedTitle) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "已发布图节点标签不能为空，无法物化计划任务", {
        planId,
        nodeId,
        label,
      }),
    );
  }

  return normalizedTitle;
}

function hasStructuralChanges(
  task: PersistedLightTask,
  nextTaskFields: MaterializedTaskSyncableFields,
): boolean {
  return (
    task.planId !== nextTaskFields.planId ||
    task.title !== nextTaskFields.title ||
    task.summary !== nextTaskFields.summary ||
    !isDeepStrictEqual(task.metadata, nextTaskFields.metadata) ||
    !isDeepStrictEqual(task.extensions, nextTaskFields.extensions)
  );
}

function applyMaterializedTaskSyncableFields(
  task: PersistedLightTask,
  nextTaskFields: MaterializedTaskSyncableFields,
): void {
  task.planId = nextTaskFields.planId;
  task.title = nextTaskFields.title;
  task.summary = nextTaskFields.summary;
  task.metadata = nextTaskFields.metadata;
  task.extensions = nextTaskFields.extensions;
}

function finalizeMaterializedTasksResult(
  tasks: MaterializePlanTasksResult["tasks"],
  removedNodePolicy: MaterializeRemovedNodePolicy,
): MaterializePlanTasksResult["tasks"] {
  switch (removedNodePolicy) {
    case "keep":
      // keep 策略下，返回结果只包含当前图上的 active 任务；
      // 已移除节点对应旧任务继续保留，但会被显式标记为 orphaned。
      return tasks;
  }
}

function markRemovedMaterializedTasksAsOrphaned(input: {
  options: CreateLightTaskOptions;
  tasksByNodeId: ReadonlyMap<string, PersistedLightTask>;
  publishedNodeIds: ReadonlySet<string>;
  publishedGraphRevision: number;
}): void {
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
  const tasksByNodeId = mapMaterializedTasksByNodeId(listTasks(), normalizedPlanId);
  const materializedTasks: MaterializePlanTasksResult["tasks"] = [];

  for (const nodeId of orderedNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }

    const nextTaskFields = {
      planId: normalizedPlanId,
      title: assertNodeTitle(normalizedPlanId, node.id, node.label),
      // 当前切片只从图节点映射稳定结构，不补充应用层摘要语义。
      summary: undefined,
      metadata: cloneOptional(node.metadata),
      extensions: buildMaterializedTaskExtensions(
        node.extensions,
        createActiveMaterializedTaskProvenance(publishedGraph.revision, node.id, node.taskId),
      ),
    } satisfies MaterializedTaskSyncableFields;
    const existedTask = tasksByNodeId.get(node.id);

    if (!existedTask) {
      const nextTaskId = requireLightTaskFunction(
        options.idGenerator?.nextTaskId,
        "idGenerator.nextTaskId",
      );
      const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
      const createTask = requireLightTaskFunction(
        options.taskRepository?.create,
        "taskRepository.create",
      );
      const taskId = nextTaskId().trim();

      if (!taskId) {
        throwLightTaskError(
          createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", {
            planId: normalizedPlanId,
            nodeId: node.id,
            taskId,
          }),
        );
      }

      const created = createTask({
        id: taskId,
        planId: normalizedPlanId,
        title: nextTaskFields.title,
        summary: nextTaskFields.summary,
        status: "queued",
        revision: 1,
        idempotencyKey: undefined,
        createdAt: clockNow(),
        steps: createDefaultTaskSteps(taskId),
        metadata: nextTaskFields.metadata,
        extensions: nextTaskFields.extensions,
      });

      if (!created.ok) {
        throwLightTaskError(created.error);
      }

      materializedTasks.push(toPublicTask(created.task));
      continue;
    }

    if (!hasStructuralChanges(existedTask, nextTaskFields)) {
      materializedTasks.push(toPublicTask(existedTask));
      continue;
    }

    const saveIfRevisionMatches = requireLightTaskFunction(
      options.taskRepository?.saveIfRevisionMatches,
      "taskRepository.saveIfRevisionMatches",
    );
    const nextTask = clonePersistedTask(existedTask);
    applyMaterializedTaskSyncableFields(nextTask, nextTaskFields);
    nextTask.revision = existedTask.revision + 1;

    const saved = saveIfRevisionMatches(nextTask, existedTask.revision);
    if (!saved.ok) {
      throwLightTaskError(saved.error);
    }

    materializedTasks.push(toPublicTask(saved.task));
  }

  markRemovedMaterializedTasksAsOrphaned({
    options,
    tasksByNodeId,
    publishedNodeIds,
    publishedGraphRevision: publishedGraph.revision,
  });

  const result = {
    plan: toPublicPlan(storedPlan),
    publishedGraph: toPublicGraph(publishedGraph),
    tasks: finalizeMaterializedTasksResult(materializedTasks, removedNodePolicy),
  };

  publishPlanTasksMaterializedEvent(publishEvent, result);
  return result;
}
