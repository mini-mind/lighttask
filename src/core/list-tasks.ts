import { toPublicTask } from "./task-snapshot";
import type { CreateLightTaskOptions, LightTaskTask } from "./types";

export function listTasksUseCase(options: CreateLightTaskOptions): LightTaskTask[] {
  return options.taskRepository.list().map((task) => toPublicTask(task));
}
