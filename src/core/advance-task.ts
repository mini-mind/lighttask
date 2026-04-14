import {
  assertExpectedRevision,
  assertNextRevision,
  decideIdempotency,
  selectDefaultTaskAction,
  transitionTaskStatus,
} from "../rules";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import { applyTaskStepProgress } from "./task-progress";
import { buildAdvanceFingerprint, clonePersistedTask, toPublicTask } from "./task-snapshot";
import type { AdvanceTaskInput, CreateLightTaskOptions, LightTaskTask } from "./types";

function assertTaskId(taskId: string): string {
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", {
        taskId,
      }),
    );
  }

  return normalizedTaskId;
}

export function advanceTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
  input: AdvanceTaskInput,
): LightTaskTask {
  const normalizedTaskId = assertTaskId(taskId);
  const storedTask = options.taskRepository.get(normalizedTaskId);
  if (!storedTask) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到任务", {
        taskId: normalizedTaskId,
      }),
    );
  }

  const task = clonePersistedTask(storedTask);
  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        taskId: normalizedTaskId,
      }),
    );
  }

  const action = input.action ?? selectDefaultTaskAction(task.status);
  if (!action) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "任务没有可推进的进行中阶段", {
        taskId: normalizedTaskId,
        currentStatus: task.status,
      }),
    );
  }

  const expectedRevision = input.expectedRevision;
  const incomingFingerprint = buildAdvanceFingerprint(task.id, action, expectedRevision);
  // 先判定幂等语义，再进入 revision 与状态迁移，避免重复请求污染状态。
  const idempotencyDecision = decideIdempotency({
    incomingIdempotencyKey: input.idempotencyKey,
    storedIdempotencyKey: task.idempotencyKey,
    incomingFingerprint,
    storedFingerprint: task.lastAdvanceFingerprint,
  });
  if (idempotencyDecision.decision === "conflict") {
    throwLightTaskError(
      idempotencyDecision.error ??
        createLightTaskError("STATE_CONFLICT", idempotencyDecision.reason, {
          taskId: normalizedTaskId,
        }),
    );
  }
  if (idempotencyDecision.decision === "replay") {
    return toPublicTask(task);
  }

  const nextRevision = task.revision + 1;
  assertExpectedRevision(task.revision, expectedRevision);
  assertNextRevision(task.revision, nextRevision);

  const transition = transitionTaskStatus(task.status, action);
  if (!transition.ok) {
    throwLightTaskError(transition.error);
  }

  task.status = transition.status;
  task.revision = nextRevision;
  task.idempotencyKey = input.idempotencyKey?.trim() || task.idempotencyKey;
  task.lastAdvanceFingerprint = incomingFingerprint;
  applyTaskStepProgress(task, action);

  const saved = options.taskRepository.saveIfRevisionMatches(task, storedTask.revision);
  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  // 保存成功后统一返回仓储权威快照，避免内存中间态与持久化结果漂移。
  return toPublicTask(saved.task);
}
