import {
  type CoreError,
  type RuntimeLifecycleStatus,
  createCoreError,
  isRuntimeTerminalStatus,
} from "../data-structures";

export type RuntimeAction = "start" | "complete" | "fail" | "cancel";

export type RuntimeTransitionResult =
  | {
      ok: true;
      status: RuntimeLifecycleStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

const RUNTIME_ACTIONS: readonly RuntimeAction[] = ["start", "complete", "fail", "cancel"];

const RUNTIME_TRANSITION_TABLE: Readonly<
  Record<RuntimeLifecycleStatus, Readonly<Partial<Record<RuntimeAction, RuntimeLifecycleStatus>>>>
> = {
  queued: {
    start: "running",
    fail: "failed",
    cancel: "cancelled",
  },
  running: {
    complete: "completed",
    fail: "failed",
    cancel: "cancelled",
  },
  completed: {},
  failed: {},
  cancelled: {},
} as const;

function resolveRuntimeTransition(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): RuntimeLifecycleStatus | undefined {
  // 运行时首切片只保留最小生命周期，不引入 provider/session 专属语义。
  return RUNTIME_TRANSITION_TABLE[currentStatus][action];
}

export function canRuntimeTransition(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): boolean {
  return resolveRuntimeTransition(currentStatus, action) !== undefined;
}

export function getNextRuntimeStatus(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): RuntimeLifecycleStatus | undefined {
  return resolveRuntimeTransition(currentStatus, action);
}

export function transitionRuntimeStatus(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): RuntimeTransitionResult {
  const nextStatus = resolveRuntimeTransition(currentStatus, action);
  if (nextStatus === undefined) {
    return {
      ok: false,
      error: createCoreError("STATE_CONFLICT", "运行时状态迁移冲突", {
        currentStatus,
        action,
      }),
    };
  }

  return {
    ok: true,
    status: nextStatus,
  };
}

export function listRuntimeActions(currentStatus: RuntimeLifecycleStatus): RuntimeAction[] {
  if (isRuntimeTerminalStatus(currentStatus)) {
    return [];
  }

  return RUNTIME_ACTIONS.filter((action) => canRuntimeTransition(currentStatus, action));
}

const DEFAULT_RUNTIME_ACTION_PRIORITY: readonly RuntimeAction[] = ["start", "complete"];

export function selectDefaultRuntimeAction(
  currentStatus: RuntimeLifecycleStatus,
): RuntimeAction | undefined {
  return DEFAULT_RUNTIME_ACTION_PRIORITY.find((action) =>
    canRuntimeTransition(currentStatus, action),
  );
}
