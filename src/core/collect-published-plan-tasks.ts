import { topologicalSort } from "../rules";
import { toPublicGraph } from "./graph-snapshot";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { clonePersistedTask, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  LightTaskGraph,
  LightTaskTask,
  PersistedLightTask,
} from "./types";

const PUBLISHED_GRAPH_SCOPE = "published" as const;

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
) {
  const tasksByNodeId = new Map<string, (typeof tasks)[number]>();
  const directTasksById = new Map<string, (typeof tasks)[number]>();

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
        createLightTaskError("STATE_CONFLICT", "图节点引用的任务未归属当前计划，无法发射计划", {
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

export function collectPublishedPlanTasks(input: {
  options: CreateLightTaskOptions;
  planId: string;
  expectedPublishedGraphRevision: number;
}): {
  publishedGraph: LightTaskGraph;
  tasks: LightTaskTask[];
} {
  const getGraph = requireLightTaskFunction(
    input.options.graphRepository?.get,
    "graphRepository.get",
  );
  const listTasks = requireLightTaskFunction(
    input.options.taskRepository?.list,
    "taskRepository.list",
  );
  const publishedGraph = getGraph(input.planId, PUBLISHED_GRAPH_SCOPE);

  if (!publishedGraph) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到已发布图快照，无法发射计划", {
        planId: input.planId,
      }),
    );
  }

  assertExpectedPublishedGraphRevision(
    publishedGraph.revision,
    input.expectedPublishedGraphRevision,
  );

  const tasksByNodeId = mapPlanTasksByNodeId(listTasks(), input.planId, publishedGraph.nodes);
  const nodesById = new Map(publishedGraph.nodes.map((node) => [node.id, node]));
  const tasks = topologicalSort(publishedGraph).map((nodeId) => {
    const node = nodesById.get(nodeId);
    const task = tasksByNodeId.get(nodeId);

    if (!node || !task) {
      throwLightTaskError(
        createLightTaskError("NOT_FOUND", "图节点引用的任务不存在，无法发射计划", {
          planId: input.planId,
          nodeId,
          taskId: node?.taskId,
        }),
      );
    }

    return toPublicTask(task);
  });

  return {
    publishedGraph: toPublicGraph(publishedGraph),
    tasks,
  };
}
