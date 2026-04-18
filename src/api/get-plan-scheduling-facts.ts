import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { buildPlanSchedulingFacts } from "./task-dependency-snapshot";
import { requireTaskPolicyForPlan } from "./task-lifecycle";
import type { CreateLightTaskOptions, GetPlanSchedulingFactsResult } from "./types";

export function getPlanSchedulingFactsUseCase(
  options: CreateLightTaskOptions,
  planId: string,
): GetPlanSchedulingFactsResult {
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const normalizedPlanId = planId.trim();
  if (!normalizedPlanId) {
    throwLightTaskError(createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", { planId }));
  }

  const plan = getPlan(normalizedPlanId);
  if (!plan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划", { planId: normalizedPlanId }),
    );
  }

  return buildPlanSchedulingFacts(
    normalizedPlanId,
    listTasks(),
    requireTaskPolicyForPlan(options, plan),
  );
}
