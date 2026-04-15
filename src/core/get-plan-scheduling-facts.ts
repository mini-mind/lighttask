import { isTaskTerminalStatus } from "../data-structures";
import { findReadyNodeIds, topologicalSort, validateDagSnapshot } from "../rules";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { readMaterializedTaskProvenance } from "./materialized-task-governance";
import type {
  CreateLightTaskOptions,
  GetPlanSchedulingFactsInput,
  GetPlanSchedulingFactsResult,
  PersistedLightTask,
  PlanSchedulingBlockReason,
  SchedulingFactUnmetPrerequisite,
} from "./types";

const PUBLISHED_GRAPH_SCOPE = "published" as const;

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

    if (provenance.governance?.state === "orphaned") {
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

function buildPrerequisiteNodeIdsByNode(
  orderedNodeIds: string[],
  normalizedEdges: ReturnType<typeof validateDagSnapshot>["normalizedEdges"],
): Map<string, string[]> {
  const prerequisiteNodeIdsByNode = new Map<string, string[]>();

  for (const nodeId of orderedNodeIds) {
    prerequisiteNodeIdsByNode.set(nodeId, []);
  }

  for (const edge of normalizedEdges) {
    prerequisiteNodeIdsByNode.get(edge.dependentNodeId)?.push(edge.prerequisiteNodeId);
  }

  return prerequisiteNodeIdsByNode;
}

function resolveBlockReason(input: {
  isReady: boolean;
  isTerminal: boolean;
  task: PersistedLightTask | undefined;
  prerequisiteNodeIds: string[];
  completedNodeIdSet: ReadonlySet<string>;
  tasksByNodeId: ReadonlyMap<string, PersistedLightTask>;
}): PlanSchedulingBlockReason | undefined {
  if (input.isTerminal) {
    return undefined;
  }

  if (!input.isReady) {
    const unmetPrerequisites: SchedulingFactUnmetPrerequisite[] = input.prerequisiteNodeIds
      .filter((nodeId) => !input.completedNodeIdSet.has(nodeId))
      .map((nodeId) => ({
        nodeId,
        taskStatus: input.tasksByNodeId.get(nodeId)?.status,
      }));

    return {
      code: "waiting_for_prerequisites",
      unmetPrerequisites,
    };
  }

  if (!input.task) {
    return {
      code: "missing_task",
    };
  }

  switch (input.task.status) {
    case "queued":
      return undefined;
    case "dispatched":
      return {
        code: "task_dispatched",
        taskStatus: "dispatched",
      };
    case "running":
      return {
        code: "task_running",
        taskStatus: "running",
      };
    case "blocked_by_approval":
      return {
        code: "task_blocked_by_approval",
        taskStatus: "blocked_by_approval",
      };
    case "completed":
    case "failed":
    case "cancelled":
      return undefined;
    default: {
      const exhaustiveStatus: never = input.task.status;
      return exhaustiveStatus;
    }
  }
}

export function getPlanSchedulingFactsUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: GetPlanSchedulingFactsInput,
): GetPlanSchedulingFactsResult {
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const getGraph = requireLightTaskFunction(options.graphRepository?.get, "graphRepository.get");
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const normalizedPlanId = assertPlanId(planId);
  const storedPlan = getPlan(normalizedPlanId);

  if (!storedPlan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法计算计划调度事实", {
        planId: normalizedPlanId,
      }),
    );
  }

  const publishedGraph = getGraph(normalizedPlanId, PUBLISHED_GRAPH_SCOPE);
  if (!publishedGraph) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到已发布图快照，无法计算计划调度事实", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertExpectedPublishedGraphRevision(
    publishedGraph.revision,
    input.expectedPublishedGraphRevision,
  );

  const orderedNodeIds = topologicalSort(publishedGraph);
  const validation = validateDagSnapshot(publishedGraph);
  const tasksByNodeId = mapMaterializedTasksByNodeId(listTasks(), normalizedPlanId);
  const completedNodeIdSet = new Set(
    orderedNodeIds.filter((nodeId) => tasksByNodeId.get(nodeId)?.status === "completed"),
  );
  const readyNodeIdSet = new Set(findReadyNodeIds(publishedGraph, completedNodeIdSet));
  const prerequisiteNodeIdsByNode = buildPrerequisiteNodeIdsByNode(
    orderedNodeIds,
    validation.normalizedEdges,
  );
  const nodesById = new Map(publishedGraph.nodes.map((node) => [node.id, node]));
  const byNodeId = Object.create(null) as GetPlanSchedulingFactsResult["byNodeId"];

  for (const nodeId of orderedNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }

    const task = tasksByNodeId.get(nodeId);
    const isTerminal = task ? isTaskTerminalStatus(task.status) : false;
    // ready 仅表示图依赖已经满足，terminal 节点不会再被视为 ready 候选。
    const isReady = readyNodeIdSet.has(nodeId) && !isTerminal;
    // runnable 进一步收窄为“图 ready 且已有 queued 任务”，不替上层做派发策略。
    const isRunnable = isReady && task?.status === "queued";
    const blockReason = resolveBlockReason({
      isReady,
      isTerminal,
      task,
      prerequisiteNodeIds: prerequisiteNodeIdsByNode.get(nodeId) ?? [],
      completedNodeIdSet,
      tasksByNodeId,
    });

    byNodeId[nodeId] = {
      nodeId,
      graphTaskId: node.taskId,
      taskId: task?.id,
      taskStatus: task?.status,
      isReady,
      isRunnable,
      isTerminal,
      blockReason,
    };
  }

  return {
    planId: storedPlan.id,
    planStatus: storedPlan.status,
    publishedGraphRevision: publishedGraph.revision,
    orderedNodeIds,
    readyNodeIds: orderedNodeIds.filter((nodeId) => byNodeId[nodeId]?.isReady),
    runnableNodeIds: orderedNodeIds.filter((nodeId) => byNodeId[nodeId]?.isRunnable),
    blockedNodeIds: orderedNodeIds.filter((nodeId) => {
      const facts = byNodeId[nodeId];
      return Boolean(facts && !facts.isTerminal && !facts.isRunnable);
    }),
    terminalNodeIds: orderedNodeIds.filter((nodeId) => byNodeId[nodeId]?.isTerminal),
    completedNodeIds: orderedNodeIds.filter(
      (nodeId) => byNodeId[nodeId]?.taskStatus === "completed",
    ),
    byNodeId,
  };
}
