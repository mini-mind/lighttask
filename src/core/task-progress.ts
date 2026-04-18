import type { TaskAction, TaskStepProgressPolicy } from "../rules";
import { advanceTaskStepsOne, completeAllTaskSteps, resetTaskStepsToTodo } from "./task-snapshot";
import type { LightTaskStep } from "./types";

export function applyTaskStepProgress(
  steps: LightTaskStep[],
  action: TaskAction,
  policy: TaskStepProgressPolicy,
): LightTaskStep[] {
  if (policy === "complete_all") {
    return completeAllTaskSteps(steps);
  }

  if (policy === "advance_one") {
    return advanceTaskStepsOne(steps);
  }

  if (policy === "none" && (action === "finalize" || action === "return_to_draft")) {
    return resetTaskStepsToTodo(steps);
  }

  return steps.map((step) => ({ ...step }));
}
