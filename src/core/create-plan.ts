import { createPlanSessionRecord } from "../data-structures";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { toPublicPlan } from "./plan-snapshot";
import type {
  CreateLightTaskOptions,
  CreatePlanInput,
  LightTaskPlan,
  PersistedLightPlan,
} from "./types";

export function createPlanUseCase(
  options: CreateLightTaskOptions,
  input: CreatePlanInput,
): LightTaskPlan {
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const createPlan = requireLightTaskFunction(
    options.planRepository?.create,
    "planRepository.create",
  );
  const planId = input.id.trim();
  const title = input.title.trim();

  if (!planId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId: input.id,
      }),
    );
  }

  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划标题不能为空", {
        title: input.title,
      }),
    );
  }

  const plan: PersistedLightPlan = createPlanSessionRecord({
    id: planId,
    title,
    createdAt: clockNow(),
    metadata: input.metadata,
  });
  const created = createPlan(plan);

  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  return toPublicPlan(created.plan);
}
