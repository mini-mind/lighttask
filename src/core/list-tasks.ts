import { requireLightTaskFunction } from "./lighttask-error";
import { shouldIncludeTask } from "./query-filters";
import { toPublicTask } from "./task-snapshot";
import type { CreateLightTaskOptions, LightTaskTask, ListTasksInput } from "./types";

export function listTasksUseCase(
  options: CreateLightTaskOptions,
  input: ListTasksInput = {},
): LightTaskTask[] {
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  return listTasks()
    .filter((task) => shouldIncludeTask(task, input))
    .map((task) => toPublicTask(task));
}
