import {
  type CoreError,
  type TaskLifecycleStatus,
  createCoreError,
  isTaskTerminalStatus,
} from "../data-structures";

export type TaskAction =
  | "dispatch"
  | "start"
  | "complete"
  | "approve"
  | "request_approval"
  | "fail"
  | "cancel";

export type TaskTransitionResult =
  | {
      ok: true;
      status: TaskLifecycleStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

export type TaskStepProgressPolicy = "none" | "advance_one" | "complete_all";

const TASK_ACTIONS: readonly TaskAction[] = [
  "dispatch",
  "start",
  "complete",
  "approve",
  "request_approval",
  "fail",
  "cancel",
];

const TASK_TRANSITION_TABLE: Readonly<
  Record<TaskLifecycleStatus, Readonly<Partial<Record<TaskAction, TaskLifecycleStatus>>>>
> = {
  queued: {
    dispatch: "dispatched",
    fail: "failed",
    cancel: "cancelled",
  },
  dispatched: {
    start: "running",
    fail: "failed",
    cancel: "cancelled",
  },
  running: {
    request_approval: "blocked_by_approval",
    complete: "completed",
    fail: "failed",
    cancel: "cancelled",
  },
  blocked_by_approval: {
    approve: "running",
    fail: "failed",
    cancel: "cancelled",
  },
  completed: {},
  failed: {},
  cancelled: {},
} as const;

function resolveTaskTransition(
  currentStatus: TaskLifecycleStatus,
  action: TaskAction,
): TaskLifecycleStatus | undefined {
  // 规则层 FSM 必须保持纯函数：所有迁移仅由静态表定义，不读取外部状态。
  return TASK_TRANSITION_TABLE[currentStatus][action];
}

export function canTaskTransition(currentStatus: TaskLifecycleStatus, action: TaskAction): boolean {
  return resolveTaskTransition(currentStatus, action) !== undefined;
}

export function getNextTaskStatus(
  currentStatus: TaskLifecycleStatus,
  action: TaskAction,
): TaskLifecycleStatus | undefined {
  return resolveTaskTransition(currentStatus, action);
}

export function transitionTaskStatus(
  currentStatus: TaskLifecycleStatus,
  action: TaskAction,
): TaskTransitionResult {
  const nextStatus = resolveTaskTransition(currentStatus, action);
  if (nextStatus === undefined) {
    return {
      ok: false,
      error: createCoreError("STATE_CONFLICT", "任务状态迁移冲突", {
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

export function listTaskActions(currentStatus: TaskLifecycleStatus): TaskAction[] {
  // 终态动作清单必须为空，防止调用方在 completed/failed/cancelled 后继续驱动流程。
  if (isTaskTerminalStatus(currentStatus)) {
    return [];
  }

  // 仅返回当前状态可执行动作，确保和 can/get/transition 三个 API 一致。
  return TASK_ACTIONS.filter((action) => canTaskTransition(currentStatus, action));
}

/**
 * 默认动作策略仍属于规则层，不放在 core，避免形成第二套状态机。
 */
const DEFAULT_TASK_ACTION_PRIORITY: readonly TaskAction[] = [
  "dispatch",
  "start",
  "complete",
  "approve",
  "request_approval",
  "fail",
  "cancel",
];

export function selectDefaultTaskAction(
  currentStatus: TaskLifecycleStatus,
): TaskAction | undefined {
  return DEFAULT_TASK_ACTION_PRIORITY.find((action) => canTaskTransition(currentStatus, action));
}

/**
 * 步骤推进策略由规则层统一给出，core 只负责执行，不再内置策略判断。
 */
export function resolveTaskStepProgress(action: TaskAction): TaskStepProgressPolicy {
  if (action === "complete") {
    return "complete_all";
  }
  if (action === "dispatch" || action === "start") {
    return "advance_one";
  }
  return "none";
}
