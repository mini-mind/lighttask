import { type OutputOwnerRef, type OutputRuntimeRef, createOutputRecord } from "../models";
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
  if (!id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 runtimeRef.id 不能为空", { runtimeRef }),
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
  if (!kind || !id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ownerRef 必须包含非空 kind/id", { ownerRef }),
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
  const getOutput = requireLightTaskFunction(options.outputRepository?.get, "outputRepository.get");
  const createOutput = requireLightTaskFunction(
    options.outputRepository?.create,
    "outputRepository.create",
  );
  const outputId = input.id.trim();
  const kind = input.kind.trim();
  if (!outputId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ID 不能为空", { outputId: input.id }),
    );
  }
  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 kind 不能为空", { kind: input.kind }),
    );
  }

  const fingerprint = JSON.stringify({
    id: outputId,
    kind,
    runtimeRef: input.runtimeRef,
    ownerRef: input.ownerRef,
    payload: input.payload,
    items: input.items,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const existed = getOutput(outputId);
  if (existed && normalizedIdempotencyKey && existed.idempotencyKey === normalizedIdempotencyKey) {
    if (existed.lastCreateFingerprint === fingerprint) {
      return toPublicOutput(existed);
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

  const output: PersistedLightOutput = {
    ...createOutputRecord({
      id: outputId,
      kind,
      createdAt: clockNow(),
      runtimeRef: normalizeOutputRuntimeRef(input.runtimeRef),
      ownerRef: normalizeOutputOwnerRef(input.ownerRef),
      payload: input.payload,
      items: normalizeOutputItems(input.items),
      metadata: input.metadata,
      extensions: input.extensions,
      idempotencyKey: normalizedIdempotencyKey,
    }),
    lastCreateFingerprint: fingerprint,
  };
  const created = createOutput(output);
  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicOutput = toPublicOutput(created.output);
  publishOutputCreatedEvent(publishEvent, publicOutput);
  return publicOutput;
}
