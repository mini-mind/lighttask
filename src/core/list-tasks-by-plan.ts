import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { toPublicTask } from "./task-snapshot";
import type { CreateLightTaskOptions, LightTaskTask } from "./types";

export function listTasksByPlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
): LightTaskTask[] {
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  return listTasks()
    .filter((task) => task.planId === normalizedPlanId)
    .map((task) => toPublicTask(task));
}
