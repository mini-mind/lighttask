import { createPlanSessionRecord } from "../data-structures";
import { resolvePlanLifecyclePolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishPlanCreatedEvent, resolveNotifyPublisher } from "./notify-event";
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
  const publishEvent = resolveNotifyPublisher(options);
  const planLifecycle = resolvePlanLifecyclePolicy(options);
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
    status: planLifecycle.initialStatus,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const created = createPlan(plan);

  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicPlan = toPublicPlan(created.plan);
  publishPlanCreatedEvent(publishEvent, publicPlan);
  return publicPlan;
}
