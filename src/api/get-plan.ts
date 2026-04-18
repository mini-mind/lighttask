import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { toPublicPlan } from "./plan-snapshot";
import type { CreateLightTaskOptions, LightTaskPlan } from "./types";

export function getPlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
): LightTaskPlan | undefined {
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  const plan = getPlan(normalizedPlanId);
  return plan ? toPublicPlan(plan) : undefined;
}
