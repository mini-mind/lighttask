import { bumpRevision } from "../data-structures";
import { assertExpectedRevision, decideIdempotency, defaultRuntimeLifecyclePolicy } from "../rules";
import { cloneOptional } from "./clone";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishRuntimeAdvancedEvent, resolveNotifyPublisher } from "./notify-event";
import { clonePersistedRuntime, toPublicRuntime } from "./runtime-snapshot";
import type {
  AdvanceRuntimeInput,
  CreateLightTaskOptions,
  LightTaskRuntime,
  PersistedLightRuntime,
} from "./types";

function buildAdvanceRuntimeFingerprint(runtimeId: string, input: AdvanceRuntimeInput): string {
  return JSON.stringify({
    runtimeId,
    action: input.action,
    expectedRevision: input.expectedRevision,
    result: input.result ?? null,
  });
}

export function advanceRuntimeUseCase(
  options: CreateLightTaskOptions,
  runtimeId: string,
  input: AdvanceRuntimeInput,
): LightTaskRuntime {
  const publishEvent = resolveNotifyPublisher(options);
  const runtimeLifecycle = options.runtimeLifecycle ?? defaultRuntimeLifecyclePolicy;
  const getRuntime = requireLightTaskFunction(
    options.runtimeRepository?.get,
    "runtimeRepository.get",
  );
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.runtimeRepository?.saveIfRevisionMatches,
    "runtimeRepository.saveIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const normalizedRuntimeId = runtimeId.trim();
  if (!normalizedRuntimeId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ID 不能为空", { runtimeId }),
    );
  }

  const storedRuntime = getRuntime(normalizedRuntimeId);
  if (!storedRuntime) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到运行时", { runtimeId: normalizedRuntimeId }),
    );
  }

  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const fingerprint = buildAdvanceRuntimeFingerprint(normalizedRuntimeId, input);
  const idempotencyDecision = decideIdempotency({
    incomingIdempotencyKey: normalizedIdempotencyKey,
    storedIdempotencyKey: storedRuntime.idempotencyKey,
    incomingFingerprint: fingerprint,
    storedFingerprint: storedRuntime.lastAdvanceFingerprint,
  });
  if (idempotencyDecision.decision === "replay") {
    return toPublicRuntime(storedRuntime);
  }
  if (idempotencyDecision.decision === "conflict" && idempotencyDecision.error) {
    throwLightTaskError(idempotencyDecision.error);
  }

  assertExpectedRevision(storedRuntime.revision, input.expectedRevision);
  const action = input.action ?? runtimeLifecycle.selectDefaultAction(storedRuntime.status);
  if (!action) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "当前运行时没有可推进动作", {
        runtimeId: normalizedRuntimeId,
        currentStatus: storedRuntime.status,
      }),
    );
  }

  const transition = runtimeLifecycle.transition(storedRuntime.status, action);
  if (!transition.ok) {
    throwLightTaskError(transition.error);
  }

  const nextRevision = bumpRevision(storedRuntime, clockNow(), normalizedIdempotencyKey);
  const nextRuntime: PersistedLightRuntime = {
    ...clonePersistedRuntime(storedRuntime),
    status: transition.status,
    result: Object.prototype.hasOwnProperty.call(input, "result")
      ? cloneOptional(input.result ?? undefined)
      : storedRuntime.result,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
    lastAdvanceFingerprint: fingerprint,
  };
  const saved = saveIfRevisionMatches(nextRuntime, storedRuntime.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicRuntime = toPublicRuntime(saved.runtime);
  publishRuntimeAdvancedEvent(publishEvent, publicRuntime);
  return publicRuntime;
}
