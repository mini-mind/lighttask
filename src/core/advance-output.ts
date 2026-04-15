import { bumpRevision } from "../data-structures";
import { assertExpectedRevision, assertNextRevision } from "../rules";
import { cloneOptional } from "./clone";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishOutputAdvancedEvent, resolveNotifyPublisher } from "./notify-event";
import { clonePersistedOutput, toPublicOutput } from "./output-snapshot";
import type {
  AdvanceOutputInput,
  CreateLightTaskOptions,
  LightTaskOutput,
  PersistedLightOutput,
} from "./types";

function assertOutputId(outputId: string): string {
  const normalizedOutputId = outputId.trim();

  if (!normalizedOutputId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ID 不能为空", {
        outputId,
      }),
    );
  }

  return normalizedOutputId;
}

function hasOwnField(input: AdvanceOutputInput, fieldName: keyof AdvanceOutputInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, fieldName);
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
  const normalizedOutputId = assertOutputId(outputId);
  const storedOutput = getOutput(normalizedOutputId);

  if (!storedOutput) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到输出", {
        outputId: normalizedOutputId,
      }),
    );
  }

  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        outputId: normalizedOutputId,
      }),
    );
  }

  const output = clonePersistedOutput(storedOutput);
  if (output.status === "sealed") {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "当前输出没有可推进动作", {
        outputId: normalizedOutputId,
        currentStatus: output.status,
      }),
    );
  }

  assertExpectedRevision(output.revision, input.expectedRevision);
  assertNextRevision(output.revision, output.revision + 1);

  const nextStatus = input.status ?? "sealed";
  const payloadProvided = hasOwnField(input, "payload");

  // 显式阻止无变化推进，避免 output revision 被当作无意义心跳滥用。
  if (!payloadProvided && nextStatus === output.status) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "推进输出至少需要提供 payload 或 status 变更", {
        outputId: normalizedOutputId,
      }),
    );
  }

  const nextRevision = bumpRevision(output, clockNow(), input.idempotencyKey);
  const nextOutput: PersistedLightOutput = {
    ...output,
    status: nextStatus,
    payload: payloadProvided ? cloneOptional(input.payload ?? undefined) : output.payload,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = saveIfRevisionMatches(nextOutput, storedOutput.revision);

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicOutput = toPublicOutput(saved.output);
  publishOutputAdvancedEvent(publishEvent, publicOutput);
  return publicOutput;
}
