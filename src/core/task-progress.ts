import type { TaskAction } from "../rules";
import { advanceTaskStepsOne, completeAllTaskSteps, resetTaskStepsToTodo } from "./task-snapshot";
import type { LightTaskStep } from "./types";

export function applyTaskStepProgress(steps: LightTaskStep[], action: TaskAction): LightTaskStep[] {
  if (action === "complete") {
    return completeAllTaskSteps(steps);
  }

  if (action === "dispatch" || action === "start") {
    return advanceTaskStepsOne(steps);
  }

  if (action === "return_to_draft" || action === "finalize") {
    return resetTaskStepsToTodo(steps);
  }

  return steps.map((step) => ({ ...step }));
}
