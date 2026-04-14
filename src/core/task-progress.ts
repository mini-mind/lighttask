import type { TaskAction } from "../rules";
import { resolveTaskStepProgress } from "../rules";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type { PersistedLightTask } from "./types";

export function applyTaskStepProgress(task: PersistedLightTask, action: TaskAction): void {
  const progressPolicy = resolveTaskStepProgress(action);
  if (progressPolicy === "complete_all") {
    // completed 代表流程闭环，剩余步骤统一收敛为 done，避免状态和步骤语义错位。
    markAllRemainingStepsDone(task);
    return;
  }
  if (progressPolicy === "advance_one") {
    advanceOneStep(task);
  }
}

function advanceOneStep(task: PersistedLightTask): void {
  const currentStepIndex = task.steps.findIndex((step) => step.status === "doing");
  if (currentStepIndex === -1) {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "任务没有可推进的进行中阶段", {
        taskId: task.id,
      }),
    );
  }

  task.steps[currentStepIndex].status = "done";
  const nextStep = task.steps[currentStepIndex + 1];
  if (nextStep) {
    nextStep.status = "doing";
  }
}

function markAllRemainingStepsDone(task: PersistedLightTask): void {
  const currentStepIndex = task.steps.findIndex((step) => step.status === "doing");
  if (currentStepIndex === -1) {
    return;
  }
  for (let i = currentStepIndex; i < task.steps.length; i += 1) {
    task.steps[i].status = "done";
  }
}
