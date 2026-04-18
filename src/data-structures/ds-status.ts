export type TaskStatus = string;

export type RuntimeLifecycleStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const DEFAULT_RUNTIME_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

const runtimeTerminalStatuses = new Set<string>(DEFAULT_RUNTIME_TERMINAL_STATUSES);

export function isTaskStatus(status: string): status is TaskStatus {
  return status.trim().length > 0;
}

export function isRuntimeTerminalStatus(status: RuntimeLifecycleStatus): boolean {
  return runtimeTerminalStatuses.has(status);
}
