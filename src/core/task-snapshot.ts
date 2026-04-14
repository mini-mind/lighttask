import type { TaskAction } from "../rules";
import type { LightTaskTask, PersistedLightTask, TaskStage } from "./types";

const DEFAULT_STAGES: ReadonlyArray<TaskStage> = [
  "investigate",
  "design",
  "implement",
  "verify",
  "converge",
];

export function clonePersistedTask(task: PersistedLightTask): PersistedLightTask {
  return {
    ...task,
    steps: task.steps.map((step) => ({ ...step })),
  };
}

export function toPublicTask(task: PersistedLightTask): LightTaskTask {
  const { lastAdvanceFingerprint: _lastAdvanceFingerprint, ...publicTask } = task;
  return {
    ...publicTask,
    steps: task.steps.map((step) => ({ ...step })),
  };
}

export function createDefaultTaskSteps(taskId: string): PersistedLightTask["steps"] {
  return DEFAULT_STAGES.map((stage) => ({
    id: `${taskId}_${stage}`,
    // 编排层只保留稳定 stage code，展示文案由应用层决定。
    title: stage,
    stage,
    status: stage === "investigate" ? "doing" : "todo",
  }));
}

export function buildAdvanceFingerprint(
  taskId: string,
  action: TaskAction,
  expectedRevision: number,
): string {
  return `${taskId}:${action}:${expectedRevision}`;
}
