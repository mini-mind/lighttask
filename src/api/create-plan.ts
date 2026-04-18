import { createPlanRecord } from "../models";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishPlanCreatedEvent, resolveNotifyPublisher } from "./notify-event";
import { toPublicPlan } from "./plan-snapshot";
import { requireTaskPolicyById } from "./task-lifecycle";
import type {
  CreateLightTaskOptions,
  CreatePlanInput,
  LightTaskPlan,
  PersistedLightPlan,
} from "./types";

function buildCreatePlanFingerprint(input: {
  id: string;
  title: string;
  taskPolicyId: string;
  metadata?: Record<string, unknown>;
  extensions?: unknown;
}): string {
  return JSON.stringify(input);
}

export function createPlanUseCase(
  options: CreateLightTaskOptions,
  input: CreatePlanInput,
): LightTaskPlan {
  const publishEvent = resolveNotifyPublisher(options);
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const createPlan = requireLightTaskFunction(
    options.planRepository?.create,
    "planRepository.create",
  );
  const planId = input.id.trim();
  const title = input.title.trim();
  const taskPolicyId = input.taskPolicyId.trim();

  if (!planId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", { planId: input.id }),
    );
  }
  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划标题不能为空", { title: input.title }),
    );
  }
  if (!taskPolicyId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划必须绑定 taskPolicyId", {
        taskPolicyId: input.taskPolicyId,
      }),
    );
  }
  requireTaskPolicyById(options, taskPolicyId, { planId });

  const fingerprint = buildCreatePlanFingerprint({
    id: planId,
    title,
    taskPolicyId,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const existed = getPlan(planId);
  if (existed) {
    if (normalizedIdempotencyKey && existed.idempotencyKey === normalizedIdempotencyKey) {
      if (existed.lastCreateFingerprint === fingerprint) {
        return toPublicPlan(existed);
      }
      throwLightTaskError(
        createLightTaskError(
          "STATE_CONFLICT",
          "相同 idempotencyKey 对应的请求内容不一致，拒绝处理。",
          {
            idempotencyKey: normalizedIdempotencyKey,
            incomingFingerprint: fingerprint,
            storedFingerprint: existed.lastCreateFingerprint,
          },
        ),
      );
    }
  }

  const plan: PersistedLightPlan = {
    ...createPlanRecord({
      id: planId,
      title,
      taskPolicyId,
      createdAt: clockNow(),
      metadata: input.metadata,
      extensions: input.extensions,
      idempotencyKey: normalizedIdempotencyKey,
    }),
    lastCreateFingerprint: fingerprint,
  };
  const created = createPlan(plan);
  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicPlan = toPublicPlan(created.plan);
  publishPlanCreatedEvent(publishEvent, publicPlan);
  return publicPlan;
}
