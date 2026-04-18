export const TASK_STATUSES = [
  "draft",
  "todo",
  "dispatched",
  "running",
  "blocked_by_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = string;

export type RuntimeLifecycleStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const DEFAULT_TASK_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
export const DEFAULT_TASK_ACTIVE_STATUSES = [
  "dispatched",
  "running",
  "blocked_by_approval",
] as const;
export const DEFAULT_RUNTIME_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

const taskStatuses = new Set<string>(TASK_STATUSES);
const taskTerminalStatuses = new Set<string>(DEFAULT_TASK_TERMINAL_STATUSES);
const taskActiveStatuses = new Set<string>(DEFAULT_TASK_ACTIVE_STATUSES);
const runtimeTerminalStatuses = new Set<string>(DEFAULT_RUNTIME_TERMINAL_STATUSES);

export function isTaskStatus(status: string): status is TaskStatus {
  return status.trim().length > 0;
}

export function isDefaultTaskStatus(status: string): boolean {
  return taskStatuses.has(status);
}

export function isTaskTerminalStatus(status: TaskStatus): boolean {
  return taskTerminalStatuses.has(status);
}

export function isTaskActiveStatus(status: TaskStatus): boolean {
  return taskActiveStatuses.has(status);
}

export function isRuntimeTerminalStatus(status: RuntimeLifecycleStatus): boolean {
  return runtimeTerminalStatuses.has(status);
}
