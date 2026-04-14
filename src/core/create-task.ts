import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import { createDefaultTaskSteps, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  CreateTaskInput,
  LightTaskTask,
  PersistedLightTask,
} from "./types";

export function createTaskUseCase(
  options: CreateLightTaskOptions,
  input: CreateTaskInput,
): LightTaskTask {
  const taskId = options.idGenerator.nextTaskId();
  const title = input.title.trim();
  const summary = input.summary?.trim() || undefined;
  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务标题不能为空", {
        title: input.title,
      }),
    );
  }

  const task: PersistedLightTask = {
    id: taskId,
    title,
    summary,
    status: "queued",
    revision: 1,
    idempotencyKey: undefined,
    createdAt: options.clock.now(),
    steps: createDefaultTaskSteps(taskId),
  };

  const created = options.taskRepository.create(task);
  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  // 以仓储返回的快照为准，避免持久化层规范化后的结果无法反映到 API 返回值。
  return toPublicTask(created.task);
}
