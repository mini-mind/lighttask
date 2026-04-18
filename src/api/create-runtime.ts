import {
  type RuntimeOwnerRef,
  type RuntimeParentRef,
  type RuntimeRelatedRef,
  createRuntimeRecord,
} from "../models";
import { defaultRuntimeLifecyclePolicy } from "../policies";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishRuntimeCreatedEvent, resolveNotifyPublisher } from "./notify-event";
import { toPublicRuntime } from "./runtime-snapshot";
import type {
  CreateLightTaskOptions,
  CreateRuntimeInput,
  LightTaskRuntime,
  PersistedLightRuntime,
} from "./types";

type RuntimeRelationRef = RuntimeParentRef | RuntimeOwnerRef | RuntimeRelatedRef;

function normalizeRuntimeRelationRef<TRef extends RuntimeRelationRef>(
  fieldName: string,
  ref: TRef | undefined,
): TRef | undefined {
  if (!ref) {
    return undefined;
  }

  const kind = typeof ref.kind === "string" ? ref.kind.trim() : "";
  const id = typeof ref.id === "string" ? ref.id.trim() : "";
  if (!kind || !id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", `${fieldName} 必须包含非空 kind/id`, {
        [fieldName]: ref,
      }),
    );
  }

  return {
    ...ref,
    kind,
    id,
  };
}

function normalizeRuntimeRelatedRefs(
  relatedRefs: CreateRuntimeInput["relatedRefs"],
): RuntimeRelatedRef[] | undefined {
  if (relatedRefs === undefined) {
    return undefined;
  }
  if (!Array.isArray(relatedRefs)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "relatedRefs 必须是数组", { relatedRefs }),
    );
  }
  return relatedRefs.map((relatedRef, index) => {
    const normalizedRef = normalizeRuntimeRelationRef(`relatedRefs[${index}]`, relatedRef);
    if (!normalizedRef) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "relatedRefs 不能为空", { relatedRef, index }),
      );
    }
    return normalizedRef;
  });
}

export function createRuntimeUseCase(
  options: CreateLightTaskOptions,
  input: CreateRuntimeInput,
): LightTaskRuntime {
  const publishEvent = resolveNotifyPublisher(options);
  const runtimeLifecycle = options.runtimeLifecycle ?? defaultRuntimeLifecyclePolicy;
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const getRuntime = requireLightTaskFunction(
    options.runtimeRepository?.get,
    "runtimeRepository.get",
  );
  const createRuntime = requireLightTaskFunction(
    options.runtimeRepository?.create,
    "runtimeRepository.create",
  );
  const runtimeId = input.id.trim();
  const kind = input.kind.trim();
  const title = input.title.trim();
  if (!runtimeId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ID 不能为空", { runtimeId: input.id }),
    );
  }
  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 kind 不能为空", { kind: input.kind }),
    );
  }
  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时标题不能为空", { title: input.title }),
    );
  }

  const fingerprint = JSON.stringify({
    id: runtimeId,
    kind,
    title,
    parentRef: input.parentRef,
    ownerRef: input.ownerRef,
    relatedRefs: input.relatedRefs,
    context: input.context,
    result: input.result,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const existed = getRuntime(runtimeId);
  if (existed && normalizedIdempotencyKey && existed.idempotencyKey === normalizedIdempotencyKey) {
    if (existed.lastCreateFingerprint === fingerprint) {
      return toPublicRuntime(existed);
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

  const runtime: PersistedLightRuntime = {
    ...createRuntimeRecord({
      id: runtimeId,
      kind,
      title,
      createdAt: clockNow(),
      status: runtimeLifecycle.initialStatus,
      parentRef: normalizeRuntimeRelationRef("parentRef", input.parentRef),
      ownerRef: normalizeRuntimeRelationRef("ownerRef", input.ownerRef),
      relatedRefs: normalizeRuntimeRelatedRefs(input.relatedRefs),
      context: input.context,
      result: input.result,
      metadata: input.metadata,
      extensions: input.extensions,
      idempotencyKey: normalizedIdempotencyKey,
    }),
    lastCreateFingerprint: fingerprint,
  };
  const created = createRuntime(runtime);
  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicRuntime = toPublicRuntime(created.runtime);
  publishRuntimeCreatedEvent(publishEvent, publicRuntime);
  return publicRuntime;
}
