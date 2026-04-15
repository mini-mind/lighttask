import { type OutputOwnerRef, type OutputRuntimeRef, createOutputRecord } from "../data-structures";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishOutputCreatedEvent, resolveNotifyPublisher } from "./notify-event";
import { normalizeOutputItems } from "./output-items";
import { toPublicOutput } from "./output-snapshot";
import type {
  CreateLightTaskOptions,
  CreateOutputInput,
  LightTaskOutput,
  PersistedLightOutput,
} from "./types";

function normalizeOutputRuntimeRef(
  runtimeRef: CreateOutputInput["runtimeRef"],
): OutputRuntimeRef | undefined {
  if (!runtimeRef) {
    return undefined;
  }

  const id = typeof runtimeRef.id === "string" ? runtimeRef.id.trim() : "";

  // Output 首切片只保存运行时关系引用，不在这里引入跨仓储查验。
  if (!id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 runtimeRef.id 不能为空", {
        runtimeRef,
      }),
    );
  }

  return {
    ...runtimeRef,
    id,
  };
}

function normalizeOutputOwnerRef(
  ownerRef: CreateOutputInput["ownerRef"],
): OutputOwnerRef | undefined {
  if (!ownerRef) {
    return undefined;
  }

  const kind = typeof ownerRef.kind === "string" ? ownerRef.kind.trim() : "";
  const id = typeof ownerRef.id === "string" ? ownerRef.id.trim() : "";

  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ownerRef.kind 不能为空", {
        ownerRef,
      }),
    );
  }

  if (!id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ownerRef.id 不能为空", {
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

export function createOutputUseCase(
  options: CreateLightTaskOptions,
  input: CreateOutputInput,
): LightTaskOutput {
  const publishEvent = resolveNotifyPublisher(options);
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const createOutput = requireLightTaskFunction(
    options.outputRepository?.create,
    "outputRepository.create",
  );
  const outputId = input.id.trim();
  const kind = input.kind.trim();

  if (!outputId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ID 不能为空", {
        outputId: input.id,
      }),
    );
  }

  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 kind 不能为空", {
        kind: input.kind,
      }),
    );
  }

  const output: PersistedLightOutput = createOutputRecord({
    id: outputId,
    kind,
    createdAt: clockNow(),
    runtimeRef: normalizeOutputRuntimeRef(input.runtimeRef),
    ownerRef: normalizeOutputOwnerRef(input.ownerRef),
    payload: input.payload,
    items: normalizeOutputItems(input.items),
    metadata: input.metadata,
    extensions: input.extensions,
    idempotencyKey: input.idempotencyKey,
  });
  const created = createOutput(output);

  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicOutput = toPublicOutput(created.output);
  publishOutputCreatedEvent(publishEvent, publicOutput);
  return publicOutput;
}
