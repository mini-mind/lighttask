export type TaskLifecycleStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked_by_approval";

export type PlanLifecycleStatus =
  | "draft"
  | "planning"
  | "ready"
  | "confirmed"
  | "archived"
  | "failed";

export type RuntimeLifecycleStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const TASK_TERMINAL_STATUS: ReadonlySet<TaskLifecycleStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const PLAN_TERMINAL_STATUS: ReadonlySet<PlanLifecycleStatus> = new Set(["archived", "failed"]);
const RUNTIME_TERMINAL_STATUS: ReadonlySet<RuntimeLifecycleStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isTaskTerminalStatus(status: TaskLifecycleStatus): boolean {
  return TASK_TERMINAL_STATUS.has(status);
}

export function isPlanTerminalStatus(status: PlanLifecycleStatus): boolean {
  return PLAN_TERMINAL_STATUS.has(status);
}

export function isRuntimeTerminalStatus(status: RuntimeLifecycleStatus): boolean {
  return RUNTIME_TERMINAL_STATUS.has(status);
}
