import { bumpRevision } from "../data-structures";
import { assertExpectedRevision, assertNextRevision } from "../rules";
import { cloneOptional } from "./clone";
import { resolveRuntimeLifecyclePolicy } from "./lifecycle-policy";
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

function assertRuntimeId(runtimeId: string): string {
  const normalizedRuntimeId = runtimeId.trim();

  if (!normalizedRuntimeId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ID 不能为空", {
        runtimeId,
      }),
    );
  }

  return normalizedRuntimeId;
}

const RELATIONSHIP_FIELDS = ["parentRef", "ownerRef", "relatedRefs"] as const;

function hasOwnField(record: Record<string, unknown>, fieldName: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, fieldName);
}

function assertNoRelationshipMutation(runtimeId: string, input: AdvanceRuntimeInput): void {
  const inputRecord = input as unknown as Record<string, unknown>;
  const attemptedFields = RELATIONSHIP_FIELDS.filter((fieldName) => {
    return hasOwnField(inputRecord, fieldName);
  });

  if (attemptedFields.length === 0) {
    return;
  }

  // 关系字段只允许在创建时写入，推进阶段保持只读，避免 runtime 膨胀成通用关系子系统。
  throwLightTaskError(
    createLightTaskError("VALIDATION_ERROR", "advanceRuntime 不允许修改关系字段", {
      runtimeId,
      fields: attemptedFields,
    }),
  );
}

export function advanceRuntimeUseCase(
  options: CreateLightTaskOptions,
  runtimeId: string,
  input: AdvanceRuntimeInput,
): LightTaskRuntime {
  const publishEvent = resolveNotifyPublisher(options);
  const runtimeLifecycle = resolveRuntimeLifecyclePolicy(options);
  const getRuntime = requireLightTaskFunction(
    options.runtimeRepository?.get,
    "runtimeRepository.get",
  );
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.runtimeRepository?.saveIfRevisionMatches,
    "runtimeRepository.saveIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const normalizedRuntimeId = assertRuntimeId(runtimeId);
  const storedRuntime = getRuntime(normalizedRuntimeId);

  if (!storedRuntime) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到运行时", {
        runtimeId: normalizedRuntimeId,
      }),
    );
  }

  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        runtimeId: normalizedRuntimeId,
      }),
    );
  }

  assertNoRelationshipMutation(normalizedRuntimeId, input);

  const runtime = clonePersistedRuntime(storedRuntime);
  const action = input.action ?? runtimeLifecycle.selectDefaultAction(runtime.status);

  if (!action) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "当前运行时没有可推进动作", {
        runtimeId: normalizedRuntimeId,
        currentStatus: runtime.status,
      }),
    );
  }

  assertExpectedRevision(runtime.revision, input.expectedRevision);
  assertNextRevision(runtime.revision, runtime.revision + 1);

  const transition = runtimeLifecycle.transition(runtime.status, action);
  if (!transition.ok) {
    throwLightTaskError(transition.error);
  }

  const nextRevision = bumpRevision(runtime, clockNow(), runtime.idempotencyKey);
  const nextRuntime: PersistedLightRuntime = {
    ...runtime,
    status: transition.status,
    // 首切片只允许在推进时携带结果快照，不在这里引入额外策略字段。
    result: hasOwnField(input as unknown as Record<string, unknown>, "result")
      ? cloneOptional(input.result ?? undefined)
      : runtime.result,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = saveIfRevisionMatches(nextRuntime, storedRuntime.revision);

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicRuntime = toPublicRuntime(saved.runtime);
  publishRuntimeAdvancedEvent(publishEvent, publicRuntime);
  return publicRuntime;
}
