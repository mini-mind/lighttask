import { assertExpectedRevision } from "../policies";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishOutputDeletedEvent, resolveNotifyPublisher } from "./notify-event";
import type { CreateLightTaskOptions, DeleteOutputInput, DeleteOutputResult } from "./types";

export function deleteOutputUseCase(
  options: CreateLightTaskOptions,
  outputId: string,
  input: DeleteOutputInput,
): DeleteOutputResult {
  const publishEvent = resolveNotifyPublisher(options);
  const getOutput = requireLightTaskFunction(options.outputRepository?.get, "outputRepository.get");
  const deleteIfRevisionMatches = requireLightTaskFunction(
    options.outputRepository?.deleteIfRevisionMatches,
    "outputRepository.deleteIfRevisionMatches",
  );
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

  assertExpectedRevision(storedOutput.revision, input.expectedRevision);
  const deleted = deleteIfRevisionMatches(normalizedOutputId, storedOutput.revision);
  if (!deleted.ok) {
    throwLightTaskError(deleted.error);
  }

  const result: DeleteOutputResult = {
    outputId: normalizedOutputId,
  };
  publishOutputDeletedEvent(publishEvent, {
    result,
    occurredAt: storedOutput.updatedAt,
    revision: storedOutput.revision + 1,
  });
  return result;
}
