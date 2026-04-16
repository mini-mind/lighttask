export type TaskLifecycleStatus = string;

export const TASK_DESIGN_STATUSES = ["draft", "ready"] as const;

export type TaskDesignStatus = (typeof TASK_DESIGN_STATUSES)[number];

export type PlanLifecycleStatus = string;

export type RuntimeLifecycleStatus = string;

export const DEFAULT_TASK_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
export const DEFAULT_PLAN_TERMINAL_STATUSES = ["archived", "failed"] as const;
export const DEFAULT_RUNTIME_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function createTerminalStatusChecker(statuses: readonly string[]): (status: string) => boolean {
  const terminalStatuses = new Set(statuses);
  return (status) => terminalStatuses.has(status);
}

const isDefaultTaskTerminalStatus = createTerminalStatusChecker(DEFAULT_TASK_TERMINAL_STATUSES);
const isDefaultPlanTerminalStatus = createTerminalStatusChecker(DEFAULT_PLAN_TERMINAL_STATUSES);
const isDefaultRuntimeTerminalStatus = createTerminalStatusChecker(
  DEFAULT_RUNTIME_TERMINAL_STATUSES,
);
const taskDesignStatuses = new Set<string>(TASK_DESIGN_STATUSES);

export function isTaskDesignStatus(status: string): status is TaskDesignStatus {
  return taskDesignStatuses.has(status);
}

export function isTaskTerminalStatus(status: TaskLifecycleStatus): boolean {
  return isDefaultTaskTerminalStatus(status);
}

export function isPlanTerminalStatus(status: PlanLifecycleStatus): boolean {
  return isDefaultPlanTerminalStatus(status);
}

export function isRuntimeTerminalStatus(status: RuntimeLifecycleStatus): boolean {
  return isDefaultRuntimeTerminalStatus(status);
}
