import type { TaskAction, TaskStepProgressPolicy } from "../rules";
import { advanceTaskStepsOne, completeAllTaskSteps, resetTaskStepsToTodo } from "./task-snapshot";
import type { LightTaskStep } from "./types";

export function applyTaskStepProgress(
  steps: LightTaskStep[],
  policy: TaskStepProgressPolicy,
): LightTaskStep[] {
  if (policy === "complete_all") {
    return completeAllTaskSteps(steps);
  }

  if (policy === "advance_one") {
    return advanceTaskStepsOne(steps);
  }

  if (policy === "reset_all_to_todo") {
    return resetTaskStepsToTodo(steps);
  }

  return steps.map((step) => ({ ...step }));
}
