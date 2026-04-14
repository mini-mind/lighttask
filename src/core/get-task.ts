import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import { toPublicTask } from "./task-snapshot";
import type { CreateLightTaskOptions, LightTaskTask } from "./types";

export function getTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
): LightTaskTask | undefined {
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", {
        taskId,
      }),
    );
  }

  const task = options.taskRepository.get(normalizedTaskId);
  return task ? toPublicTask(task) : undefined;
}
