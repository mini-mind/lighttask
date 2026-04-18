import { assertExpectedRevision } from "../policies";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishPlanDeletedEvent, resolveNotifyPublisher } from "./notify-event";
import type { CreateLightTaskOptions, DeletePlanInput, DeletePlanResult } from "./types";

export function deletePlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: DeletePlanInput,
): DeletePlanResult {
  const publishEvent = resolveNotifyPublisher(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const deleteIfRevisionMatches = requireLightTaskFunction(
    options.planRepository?.deleteIfRevisionMatches,
    "planRepository.deleteIfRevisionMatches",
  );
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const normalizedPlanId = planId.trim();
  if (!normalizedPlanId) {
    throwLightTaskError(createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", { planId }));
  }

  const storedPlan = getPlan(normalizedPlanId);
  if (!storedPlan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划", { planId: normalizedPlanId }),
    );
  }

  assertExpectedRevision(storedPlan.revision, input.expectedRevision);
  const remainingTaskIds = listTasks()
    .filter((task) => task.planId === normalizedPlanId)
    .map((task) => task.id);
  if (remainingTaskIds.length > 0) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "默认只允许删除空计划", {
        planId: normalizedPlanId,
        remainingTaskIds,
      }),
    );
  }

  const deleted = deleteIfRevisionMatches(normalizedPlanId, storedPlan.revision);
  if (!deleted.ok) {
    throwLightTaskError(deleted.error);
  }

  const result: DeletePlanResult = {
    planId: normalizedPlanId,
  };
  publishPlanDeletedEvent(publishEvent, {
    result,
    occurredAt: storedPlan.updatedAt,
    revision: storedPlan.revision + 1,
  });
  return result;
}
