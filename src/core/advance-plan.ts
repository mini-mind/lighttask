import { bumpRevision } from "../data-structures";
import { assertExpectedRevision, assertNextRevision } from "../rules";
import { resolvePlanLifecyclePolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishPlanAdvancedEvent, resolveNotifyPublisher } from "./notify-event";
import { clonePersistedPlan, toPublicPlan } from "./plan-snapshot";
import type {
  AdvancePlanInput,
  CreateLightTaskOptions,
  LightTaskPlan,
  PersistedLightPlan,
} from "./types";

function assertPlanId(planId: string): string {
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  return normalizedPlanId;
}

export function advancePlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: AdvancePlanInput,
): LightTaskPlan {
  const publishEvent = resolveNotifyPublisher(options);
  const planLifecycle = resolvePlanLifecyclePolicy(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.planRepository?.saveIfRevisionMatches,
    "planRepository.saveIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const normalizedPlanId = assertPlanId(planId);
  const storedPlan = getPlan(normalizedPlanId);

  if (!storedPlan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划", {
        planId: normalizedPlanId,
      }),
    );
  }

  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        planId: normalizedPlanId,
      }),
    );
  }

  const plan = clonePersistedPlan(storedPlan);
  const action = input.action ?? planLifecycle.selectDefaultAction(plan.status);

  if (!action) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "当前计划没有可推进动作", {
        planId: normalizedPlanId,
        currentStatus: plan.status,
      }),
    );
  }

  assertExpectedRevision(plan.revision, input.expectedRevision);
  assertNextRevision(plan.revision, plan.revision + 1);

  const transition = planLifecycle.transition(plan.status, action);
  if (!transition.ok) {
    throwLightTaskError(transition.error);
  }

  const nextRevision = bumpRevision(plan, clockNow(), plan.idempotencyKey);
  const nextPlan: PersistedLightPlan = {
    ...plan,
    status: transition.status,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = saveIfRevisionMatches(nextPlan, storedPlan.revision);

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicPlan = toPublicPlan(saved.plan);
  publishPlanAdvancedEvent(publishEvent, publicPlan);
  return publicPlan;
}
