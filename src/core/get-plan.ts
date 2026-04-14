import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import { toPublicPlan } from "./plan-snapshot";
import type { CreateLightTaskOptions, LightTaskPlan } from "./types";

export function getPlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
): LightTaskPlan | undefined {
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  const plan = options.planRepository.get(normalizedPlanId);
  return plan ? toPublicPlan(plan) : undefined;
}
