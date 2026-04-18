import { bumpRevision } from "../models";
import { assertExpectedRevision, decideIdempotency } from "../policies";
import { cloneOptional } from "./clone";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishOutputAdvancedEvent, resolveNotifyPublisher } from "./notify-event";
import { normalizeOutputItems } from "./output-items";
import { clonePersistedOutput, toPublicOutput } from "./output-snapshot";
import type {
  AdvanceOutputInput,
  CreateLightTaskOptions,
  LightTaskOutput,
  PersistedLightOutput,
} from "./types";

function hasOwnField(input: AdvanceOutputInput, fieldName: keyof AdvanceOutputInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
}

function buildAdvanceOutputFingerprint(outputId: string, input: AdvanceOutputInput): string {
  return JSON.stringify({
    outputId,
    expectedRevision: input.expectedRevision,
    status: hasOwnField(input, "status") ? (input.status ?? null) : undefined,
    payload: hasOwnField(input, "payload") ? (input.payload ?? null) : undefined,
    items: hasOwnField(input, "items") ? (input.items ?? null) : undefined,
  });
}

export function advanceOutputUseCase(
  options: CreateLightTaskOptions,
  outputId: string,
  input: AdvanceOutputInput,
): LightTaskOutput {
  const publishEvent = resolveNotifyPublisher(options);
  const getOutput = requireLightTaskFunction(options.outputRepository?.get, "outputRepository.get");
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.outputRepository?.saveIfRevisionMatches,
    "outputRepository.saveIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const normalizedOutputId = outputId.trim();
  if (!normalizedOutputId) {
    throwLightTaskError(createLightTaskError("VALIDATION_ERROR", "输出 ID 不能为空", { outputId }));
  }

  const storedOutput = getOutput(normalizedOutputId);
  if (!storedOutput) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到输出", { outputId: normalizedOutputId }),
    );
  }

  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const fingerprint = buildAdvanceOutputFingerprint(normalizedOutputId, input);
  const idempotencyDecision = decideIdempotency({
    incomingIdempotencyKey: normalizedIdempotencyKey,
    storedIdempotencyKey: storedOutput.idempotencyKey,
    incomingFingerprint: fingerprint,
    storedFingerprint: storedOutput.lastAdvanceFingerprint,
  });
  if (idempotencyDecision.decision === "replay") {
    return toPublicOutput(storedOutput);
  }
  if (idempotencyDecision.decision === "conflict" && idempotencyDecision.error) {
    throwLightTaskError(idempotencyDecision.error);
  }

  assertExpectedRevision(storedOutput.revision, input.expectedRevision);
  if (
    hasOwnField(input, "status") &&
    input.status !== undefined &&
    input.status !== "open" &&
    input.status !== "sealed"
  ) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出状态只能是 open 或 sealed", {
        outputId: normalizedOutputId,
        status: input.status,
      }),
    );
  }
  if (storedOutput.status === "sealed") {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "当前输出没有可推进动作", {
        outputId: normalizedOutputId,
        currentStatus: storedOutput.status,
      }),
    );
  }

  const nextStatus = input.status ?? "sealed";
  const payloadProvided = hasOwnField(input, "payload");
  const itemsProvided = hasOwnField(input, "items");
  if (!payloadProvided && !itemsProvided && nextStatus === storedOutput.status) {
    throwLightTaskError(
      createLightTaskError(
        "VALIDATION_ERROR",
        "推进输出至少需要提供 payload、items 或 status 变更",
        {
          outputId: normalizedOutputId,
        },
      ),
    );
  }

  const nextRevision = bumpRevision(storedOutput, clockNow(), normalizedIdempotencyKey);
  const nextOutput: PersistedLightOutput = {
    ...clonePersistedOutput(storedOutput),
    status: nextStatus,
    payload: payloadProvided ? cloneOptional(input.payload ?? undefined) : storedOutput.payload,
    items: itemsProvided ? normalizeOutputItems(input.items) : storedOutput.items,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
    lastAdvanceFingerprint: fingerprint,
  };
  const saved = saveIfRevisionMatches(nextOutput, storedOutput.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicOutput = toPublicOutput(saved.output);
  publishOutputAdvancedEvent(publishEvent, publicOutput);
  return publicOutput;
}
