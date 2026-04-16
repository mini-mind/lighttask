import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import { listTasksUseCase } from "./list-tasks";
import type { CreateLightTaskOptions, LightTaskTask, ListTasksInput } from "./types";

export function listTasksByPlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: Omit<ListTasksInput, "planId"> = {},
): LightTaskTask[] {
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  return listTasksUseCase(options, {
    ...input,
    planId: normalizedPlanId,
  });
}
