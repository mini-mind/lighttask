import { assertExpectedRevision } from "../policies";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishRuntimeDeletedEvent, resolveNotifyPublisher } from "./notify-event";
import type { CreateLightTaskOptions, DeleteRuntimeInput, DeleteRuntimeResult } from "./types";

export function deleteRuntimeUseCase(
  options: CreateLightTaskOptions,
  runtimeId: string,
  input: DeleteRuntimeInput,
): DeleteRuntimeResult {
  const publishEvent = resolveNotifyPublisher(options);
  const getRuntime = requireLightTaskFunction(
    options.runtimeRepository?.get,
    "runtimeRepository.get",
  );
  const deleteIfRevisionMatches = requireLightTaskFunction(
    options.runtimeRepository?.deleteIfRevisionMatches,
    "runtimeRepository.deleteIfRevisionMatches",
  );
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

  assertExpectedRevision(storedRuntime.revision, input.expectedRevision);
  const deleted = deleteIfRevisionMatches(normalizedRuntimeId, storedRuntime.revision);
  if (!deleted.ok) {
    throwLightTaskError(deleted.error);
  }

  const result: DeleteRuntimeResult = {
    runtimeId: normalizedRuntimeId,
  };
  publishRuntimeDeletedEvent(publishEvent, {
    result,
    occurredAt: storedRuntime.updatedAt,
    revision: storedRuntime.revision + 1,
  });
  return result;
}
