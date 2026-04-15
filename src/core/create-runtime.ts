import { type RuntimeOwnerRef, createRuntimeRecord } from "../data-structures";
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

function normalizeRuntimeOwnerRef(
  ownerRef: CreateRuntimeInput["ownerRef"],
): RuntimeOwnerRef | undefined {
  if (!ownerRef) {
    return undefined;
  }

  const kind = typeof ownerRef.kind === "string" ? ownerRef.kind.trim() : "";
  const id = typeof ownerRef.id === "string" ? ownerRef.id.trim() : "";

  // ownerRef 首切片只承担稳定关系标识，不在这里引入跨聚合查验或更复杂语义。
  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ownerRef.kind 不能为空", {
        ownerRef,
      }),
    );
  }

  if (!id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ownerRef.id 不能为空", {
        ownerRef,
      }),
    );
  }

  return {
    ...ownerRef,
    kind,
    id,
  };
}

export function createRuntimeUseCase(
  options: CreateLightTaskOptions,
  input: CreateRuntimeInput,
): LightTaskRuntime {
  const publishEvent = resolveNotifyPublisher(options);
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const createRuntime = requireLightTaskFunction(
    options.runtimeRepository?.create,
    "runtimeRepository.create",
  );
  const runtimeId = input.id.trim();
  const kind = input.kind.trim();
  const title = input.title.trim();

  if (!runtimeId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ID 不能为空", {
        runtimeId: input.id,
      }),
    );
  }

  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 kind 不能为空", {
        kind: input.kind,
      }),
    );
  }

  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时标题不能为空", {
        title: input.title,
      }),
    );
  }

  const ownerRef = normalizeRuntimeOwnerRef(input.ownerRef);
  const runtime: PersistedLightRuntime = createRuntimeRecord({
    id: runtimeId,
    kind,
    title,
    createdAt: clockNow(),
    parentRef: input.parentRef,
    ownerRef,
    context: input.context,
    result: input.result,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const created = createRuntime(runtime);

  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicRuntime = toPublicRuntime(created.runtime);
  publishRuntimeCreatedEvent(publishEvent, publicRuntime);
  return publicRuntime;
}
