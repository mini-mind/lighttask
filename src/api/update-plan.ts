import { bumpRevision } from "../models";
import { assertExpectedRevision } from "../policies";
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

function hasOwnField(input: UpdatePlanInput, fieldName: keyof UpdatePlanInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
}

const FORBIDDEN_UPDATE_PLAN_FIELDS = [
  "id",
  "taskPolicyId",
  "revision",
  "createdAt",
  "updatedAt",
] as const;

function buildUpdatePlanFingerprint(planId: string, input: UpdatePlanInput): string {
  return JSON.stringify({
    planId,
    title: hasOwnField(input, "title") ? (input.title ?? null) : undefined,
    metadata: hasOwnField(input, "metadata") ? (input.metadata ?? null) : undefined,
    extensions: hasOwnField(input, "extensions") ? (input.extensions ?? null) : undefined,
  });
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
  const normalizedPlanId = planId.trim();
  if (!normalizedPlanId) {
    throwLightTaskError(createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", { planId }));
  }

  const storedPlan = getPlan(normalizedPlanId);
  if (!storedPlan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划", { planId: normalizedPlanId }),
    );
  }
  const rawInput = input as unknown as Record<string, unknown>;
  const forbiddenFields = FORBIDDEN_UPDATE_PLAN_FIELDS.filter((fieldName) =>
    Object.prototype.hasOwnProperty.call(rawInput, fieldName),
  );
  if (forbiddenFields.length > 0) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "updatePlan 不允许直接修改系统字段", {
        planId: normalizedPlanId,
        fields: forbiddenFields,
      }),
    );
  }

  assertExpectedRevision(storedPlan.revision, input.expectedRevision);
  const fingerprint = buildUpdatePlanFingerprint(normalizedPlanId, input);
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  if (input.idempotencyKey?.trim() && normalizedIdempotencyKey === storedPlan.idempotencyKey) {
    if (storedPlan.lastUpdateFingerprint === fingerprint) {
      return toPublicPlan(storedPlan);
    }
    if (storedPlan.lastUpdateFingerprint !== undefined) {
      throwLightTaskError(
        createLightTaskError(
          "STATE_CONFLICT",
          "相同 idempotencyKey 对应的请求内容不一致，拒绝处理。",
          {
            idempotencyKey: normalizedIdempotencyKey,
            incomingFingerprint: fingerprint,
            storedFingerprint: storedPlan.lastUpdateFingerprint,
          },
        ),
      );
    }
  }

  const nextTitle = hasOwnField(input, "title") ? input.title?.trim() : storedPlan.title;
  if (!nextTitle) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划标题不能为空", { title: input.title }),
    );
  }

  const nextRevision = bumpRevision(storedPlan, clockNow(), normalizedIdempotencyKey);
  const nextPlan: PersistedLightPlan = {
    ...clonePersistedPlan(storedPlan),
    title: nextTitle,
    metadata: hasOwnField(input, "metadata")
      ? cloneOptional(input.metadata ?? undefined)
      : storedPlan.metadata,
    extensions: hasOwnField(input, "extensions")
      ? cloneOptional(input.extensions ?? undefined)
      : storedPlan.extensions,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
    lastUpdateFingerprint: fingerprint,
  };
  const saved = saveIfRevisionMatches(nextPlan, storedPlan.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicPlan = toPublicPlan(saved.plan);
  publishPlanUpdatedEvent(publishEvent, publicPlan);
  return publicPlan;
}
