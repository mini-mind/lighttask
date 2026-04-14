import { requireLightTaskFunction } from "./lighttask-error";
import { toPublicTask } from "./task-snapshot";
import type { CreateLightTaskOptions, LightTaskTask } from "./types";

export function listTasksUseCase(options: CreateLightTaskOptions): LightTaskTask[] {
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  return listTasks().map((task) => toPublicTask(task));
}
