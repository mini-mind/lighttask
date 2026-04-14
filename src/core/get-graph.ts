import { toPublicGraph } from "./graph-snapshot";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type { CreateLightTaskOptions, LightTaskGraph } from "./types";

export function getGraphUseCase(
  options: CreateLightTaskOptions,
  planId: string,
): LightTaskGraph | undefined {
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  const plan = options.planRepository.get(normalizedPlanId);
  if (!plan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法读取图快照", {
        planId: normalizedPlanId,
      }),
    );
  }

  const graph = options.graphRepository.get(normalizedPlanId);
  return graph ? toPublicGraph(graph) : undefined;
}
