import { findReadyNodeIds, topologicalSort, validateDagSnapshot } from "../rules";
import { resolvePlanSchedulingPolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import {
  clonePersistedTask,
  resolveTaskDesignStatus,
  resolveTaskExecutionStatus,
} from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  GetPlanSchedulingFactsInput,
  GetPlanSchedulingFactsResult,
  PersistedLightTask,
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

export function getPlanSchedulingFactsUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: GetPlanSchedulingFactsInput,
): GetPlanSchedulingFactsResult {
  const schedulingPolicy = resolvePlanSchedulingPolicy(options);
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
  const tasksByNodeId = mapPlanTasksByNodeId(listTasks(), normalizedPlanId, publishedGraph.nodes);
  const completedNodeIdSet = new Set(
    orderedNodeIds.filter((nodeId) => {
      const task = tasksByNodeId.get(nodeId);
      return task ? schedulingPolicy.isTaskCompleted(task) : false;
    }),
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
    const isTerminal = task ? schedulingPolicy.isTaskTerminal(task) : false;
    // ready 仅表示图依赖已经满足，terminal 节点不会再被视为 ready 候选。
    const isReady = readyNodeIdSet.has(nodeId) && !isTerminal;
    // runnable 统一由调度策略计算，默认策略保持“ready + 初始状态任务”的判定语义。
    const context = {
      nodeId,
      task,
      prerequisiteNodeIds: prerequisiteNodeIdsByNode.get(nodeId) ?? [],
      completedNodeIdSet,
      tasksByNodeId,
      isReady,
      isTerminal,
    } as const;
    const isRunnable = schedulingPolicy.isTaskRunnable(context);
    const blockReason = schedulingPolicy.resolveBlockReason(context);

    byNodeId[nodeId] = {
      nodeId,
      graphTaskId: node.taskId,
      taskId: task?.id,
      taskDesignStatus: task ? resolveTaskDesignStatus(task.designStatus) : undefined,
      taskStatus: task ? resolveTaskExecutionStatus(task) : undefined,
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
    completedNodeIds: orderedNodeIds.filter((nodeId) => {
      const task = tasksByNodeId.get(nodeId);
      return task ? schedulingPolicy.isTaskCompleted(task) : false;
    }),
    byNodeId,
  };
}
