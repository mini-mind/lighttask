import type { TaskLifecyclePolicy, TaskStatusDefinition } from "../rules";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type { CreateLightTaskOptions } from "./types";

export function resolveTaskLifecyclePolicy(options: CreateLightTaskOptions): TaskLifecyclePolicy {
  // Task 生命周期已经完全交给应用层注册，内核不再偷偷回退到预设状态机。
  if (options.taskLifecycle) {
    return options.taskLifecycle;
  }

  throwLightTaskError(
    createLightTaskError("VALIDATION_ERROR", "createLightTask 必须显式提供 taskLifecycle", {
      path: "taskLifecycle",
    }),
  );
}

export function requireTaskStatusDefinition(
  taskLifecycle: TaskLifecyclePolicy,
  status: string,
  details: Record<string, unknown>,
): TaskStatusDefinition {
  const definition = taskLifecycle.getStatusDefinition(status);
  if (definition) {
    return definition;
  }

  throwLightTaskError(
    createLightTaskError("INVARIANT_VIOLATION", "任务状态未注册到 taskLifecycle，拒绝继续处理", {
      ...details,
      status,
    }),
  );
}
