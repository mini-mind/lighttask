import { requireLightTaskFunction } from "./lighttask-error";
import { toPublicPlan } from "./plan-snapshot";
import type { CreateLightTaskOptions, LightTaskPlan } from "./types";

export function listPlansUseCase(options: CreateLightTaskOptions): LightTaskPlan[] {
  const listPlans = requireLightTaskFunction(options.planRepository?.list, "planRepository.list");
  return listPlans().map((plan) => toPublicPlan(plan));
}
