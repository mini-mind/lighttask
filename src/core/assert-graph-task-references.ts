import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import type { CreateLightTaskOptions } from "./types";

type GraphNodeRef = {
  id: string;
  taskId: string;
};

export function assertGraphTaskReferences(input: {
  options: CreateLightTaskOptions;
  planId: string;
  nodes: ReadonlyArray<GraphNodeRef>;
  operation: "save" | "edit" | "publish";
}): void {
  const getTask = requireLightTaskFunction(input.options.taskRepository?.get, "taskRepository.get");
  const operationLabel =
    input.operation === "save"
      ? "保存图快照"
      : input.operation === "edit"
        ? "编辑图快照"
        : "发布图快照";

  for (const node of input.nodes) {
    const task = getTask(node.taskId);

    if (!task) {
      throwLightTaskError(
        createLightTaskError("NOT_FOUND", `图节点引用的任务不存在，无法${operationLabel}`, {
          planId: input.planId,
          nodeId: node.id,
          taskId: node.taskId,
        }),
      );
    }

    if (task.planId !== input.planId) {
      throwLightTaskError(
        createLightTaskError(
          "STATE_CONFLICT",
          `图节点引用的任务未归属当前计划，无法${operationLabel}`,
          {
            planId: input.planId,
            nodeId: node.id,
            taskId: task.id,
            taskPlanId: task.planId,
          },
        ),
      );
    }
  }
}
