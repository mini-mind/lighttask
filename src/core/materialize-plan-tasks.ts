import { isDeepStrictEqual } from "node:util";
import { topologicalSort } from "../rules";
import { cloneOptional } from "./clone";
import { toPublicGraph } from "./graph-snapshot";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { toPublicPlan } from "./plan-snapshot";
import { clonePersistedTask, createDefaultTaskSteps, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  MaterializePlanTasksInput,
  MaterializePlanTasksResult,
  MaterializedPlanTaskProvenance,
  PersistedLightTask,
} from "./types";

const PUBLISHED_GRAPH_SCOPE = "published" as const;
const MATERIALIZE_NAMESPACE = "lighttask";
const MATERIALIZE_KIND = "materialized_plan_task" as const;

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
  if (
    !Number.isInteger(expectedPublishedGraphRevision) ||
    expectedPublishedGraphRevision < 1
  ) {
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

function createMaterializedTaskProvenance(
  graphRevision: number,
  nodeId: string,
  nodeTaskId: string,
): MaterializedPlanTaskProvenance {
  return {
    kind: MATERIALIZE_KIND,
    source: {
      graphScope: PUBLISHED_GRAPH_SCOPE,
      graphRevision,
      nodeId,
      nodeTaskId,
    },
  };
}

function readMaterializedTaskProvenance(
  task: PersistedLightTask,
): MaterializedPlanTaskProvenance | undefined {
  const namespaceValue = task.extensions?.namespaces?.[MATERIALIZE_NAMESPACE];
  if (typeof namespaceValue !== "object" || namespaceValue === null) {
    return undefined;
  }

  const candidate = namespaceValue as Partial<MaterializedPlanTaskProvenance>;
  if (candidate.kind !== MATERIALIZE_KIND) {
    return undefined;
  }

  const source = candidate.source;
  if (
    typeof source !== "object" ||
    source === null ||
    source.graphScope !== PUBLISHED_GRAPH_SCOPE ||
    !Number.isInteger(source.graphRevision) ||
    typeof source.nodeId !== "string" ||
    typeof source.nodeTaskId !== "string"
  ) {
    return undefined;
  }

  return {
    kind: MATERIALIZE_KIND,
    source: {
      graphScope: PUBLISHED_GRAPH_SCOPE,
      graphRevision: source.graphRevision,
      nodeId: source.nodeId,
      nodeTaskId: source.nodeTaskId,
    },
  };
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
      [MATERIALIZE_NAMESPACE]: provenance,
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
  nextTaskFields: Pick<PersistedLightTask, "planId" | "title" | "summary" | "metadata" | "extensions">,
): boolean {
  return (
    task.planId !== nextTaskFields.planId ||
    task.title !== nextTaskFields.title ||
    task.summary !== nextTaskFields.summary ||
    !isDeepStrictEqual(task.metadata, nextTaskFields.metadata) ||
    !isDeepStrictEqual(task.extensions, nextTaskFields.extensions)
  );
}

export function materializePlanTasksUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: MaterializePlanTasksInput,
): MaterializePlanTasksResult {
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
        createMaterializedTaskProvenance(publishedGraph.revision, node.id, node.taskId),
      ),
    } satisfies Pick<
      PersistedLightTask,
      "planId" | "title" | "summary" | "metadata" | "extensions"
    >;
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
    nextTask.planId = nextTaskFields.planId;
    nextTask.title = nextTaskFields.title;
    nextTask.summary = nextTaskFields.summary;
    nextTask.metadata = nextTaskFields.metadata;
    nextTask.extensions = nextTaskFields.extensions;
    nextTask.revision = existedTask.revision + 1;

    const saved = saveIfRevisionMatches(nextTask, existedTask.revision);
    if (!saved.ok) {
      throwLightTaskError(saved.error);
    }

    materializedTasks.push(toPublicTask(saved.task));
  }

  return {
    plan: toPublicPlan(storedPlan),
    publishedGraph: toPublicGraph(publishedGraph),
    tasks: materializedTasks,
  };
}
