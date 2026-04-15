import { bumpRevision } from "../data-structures";
import { assertExpectedRevision, assertNextRevision } from "../rules";
import { cloneOptional } from "./clone";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishPlanUpdatedEvent, resolveNotifyPublisher } from "./notify-event";
import { clonePersistedPlan, toPublicPlan } from "./plan-snapshot";
import type {
  CreateLightTaskOptions,
  LightTaskPlan,
  PersistedLightPlan,
  UpdatePlanInput,
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

function hasOwnField(input: UpdatePlanInput, fieldName: keyof UpdatePlanInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
}

function assertUpdatableFields(planId: string, input: UpdatePlanInput): void {
  if (
    !hasOwnField(input, "title") &&
    !hasOwnField(input, "metadata") &&
    !hasOwnField(input, "extensions")
  ) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "更新计划时至少提供一个可变更字段", {
        planId,
      }),
    );
  }
}

export function updatePlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: UpdatePlanInput,
): LightTaskPlan {
  const publishEvent = resolveNotifyPublisher(options);
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

  assertUpdatableFields(normalizedPlanId, input);
  assertExpectedRevision(storedPlan.revision, input.expectedRevision);
  assertNextRevision(storedPlan.revision, storedPlan.revision + 1);

  const nextTitle = hasOwnField(input, "title") ? input.title?.trim() : storedPlan.title;
  if (!nextTitle) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划标题不能为空", {
        title: input.title,
      }),
    );
  }

  const nextRevision = bumpRevision(storedPlan, clockNow(), storedPlan.idempotencyKey);
  const nextPlanBase = clonePersistedPlan(storedPlan);

  // 更新接口只负责结构化资料，不跨越到生命周期状态机，避免与 advancePlan 语义重叠。
  const nextPlan: PersistedLightPlan = {
    ...nextPlanBase,
    title: nextTitle,
    metadata: hasOwnField(input, "metadata")
      ? cloneOptional(input.metadata ?? undefined)
      : nextPlanBase.metadata,
    extensions: hasOwnField(input, "extensions")
      ? cloneOptional(input.extensions ?? undefined)
      : nextPlanBase.extensions,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = saveIfRevisionMatches(nextPlan, storedPlan.revision);

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicPlan = toPublicPlan(saved.plan);
  publishPlanUpdatedEvent(publishEvent, publicPlan);
  return publicPlan;
}
