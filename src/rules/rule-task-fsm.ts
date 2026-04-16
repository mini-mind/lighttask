import {
  type CoreError,
  DEFAULT_TASK_TERMINAL_STATUSES,
  type TaskLifecycleStatus,
  createCoreError,
} from "../data-structures";

export type TaskAction = string;

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

export interface TaskLifecyclePolicy {
  initialStatus: TaskLifecycleStatus;
  isTerminal(status: TaskLifecycleStatus): boolean;
  canTransition(currentStatus: TaskLifecycleStatus, action: TaskAction): boolean;
  getNextStatus(
    currentStatus: TaskLifecycleStatus,
    action: TaskAction,
  ): TaskLifecycleStatus | undefined;
  transition(currentStatus: TaskLifecycleStatus, action: TaskAction): TaskTransitionResult;
  listActions(currentStatus: TaskLifecycleStatus): TaskAction[];
  selectDefaultAction(currentStatus: TaskLifecycleStatus): TaskAction | undefined;
  resolveStepProgress(action: TaskAction): TaskStepProgressPolicy;
}

export interface CreateTaskLifecyclePolicyInput {
  initialStatus: TaskLifecycleStatus;
  transitionTable: Readonly<
    Record<TaskLifecycleStatus, Readonly<Partial<Record<TaskAction, TaskLifecycleStatus>>>>
  >;
  terminalStatuses: readonly TaskLifecycleStatus[];
  defaultActionPriority?: readonly TaskAction[];
  stepProgressByAction?: Readonly<Partial<Record<TaskAction, TaskStepProgressPolicy>>>;
  validateTransition?: (input: {
    currentStatus: TaskLifecycleStatus;
    action: TaskAction;
    nextStatus: TaskLifecycleStatus;
  }) => CoreError | undefined;
}

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

const DEFAULT_TASK_ACTION_PRIORITY: readonly TaskAction[] = [
  "dispatch",
  "start",
  "complete",
  "approve",
  "request_approval",
  "fail",
  "cancel",
];

const DEFAULT_TASK_STEP_PROGRESS_BY_ACTION = {
  dispatch: "advance_one",
  start: "advance_one",
  complete: "complete_all",
} satisfies Readonly<Partial<Record<TaskAction, TaskStepProgressPolicy>>>;

export function createTaskLifecyclePolicy(
  input: CreateTaskLifecyclePolicyInput,
): TaskLifecyclePolicy {
  const terminalStatuses = new Set(input.terminalStatuses);

  function isTerminal(status: TaskLifecycleStatus): boolean {
    return terminalStatuses.has(status);
  }

  function getNextStatus(
    currentStatus: TaskLifecycleStatus,
    action: TaskAction,
  ): TaskLifecycleStatus | undefined {
    if (isTerminal(currentStatus)) {
      return undefined;
    }

    // 规则层 FSM 必须保持纯函数：所有迁移仅由显式配置定义，不读取外部状态。
    return input.transitionTable[currentStatus]?.[action];
  }

  function transition(
    currentStatus: TaskLifecycleStatus,
    action: TaskAction,
  ): TaskTransitionResult {
    const nextStatus = getNextStatus(currentStatus, action);
    if (nextStatus === undefined) {
      return {
        ok: false,
        error: createCoreError("STATE_CONFLICT", "任务状态迁移冲突", {
          currentStatus,
          action,
        }),
      };
    }

    const validationError = input.validateTransition?.({
      currentStatus,
      action,
      nextStatus,
    });
    if (validationError) {
      return {
        ok: false,
        error: validationError,
      };
    }

    return {
      ok: true,
      status: nextStatus,
    };
  }

  function listActions(currentStatus: TaskLifecycleStatus): TaskAction[] {
    if (isTerminal(currentStatus)) {
      return [];
    }

    return Object.keys(input.transitionTable[currentStatus] ?? {});
  }

  function selectDefaultAction(currentStatus: TaskLifecycleStatus): TaskAction | undefined {
    const actionPriority = input.defaultActionPriority ?? [];
    return (
      actionPriority.find((action) => getNextStatus(currentStatus, action) !== undefined) ??
      listActions(currentStatus)[0]
    );
  }

  return {
    initialStatus: input.initialStatus,
    isTerminal,
    canTransition(currentStatus, action) {
      return getNextStatus(currentStatus, action) !== undefined;
    },
    getNextStatus,
    transition,
    listActions,
    selectDefaultAction,
    resolveStepProgress(action) {
      return input.stepProgressByAction?.[action] ?? "none";
    },
  };
}

export const defaultTaskLifecyclePolicy = createTaskLifecyclePolicy({
  initialStatus: "queued",
  transitionTable: TASK_TRANSITION_TABLE,
  terminalStatuses: DEFAULT_TASK_TERMINAL_STATUSES,
  defaultActionPriority: DEFAULT_TASK_ACTION_PRIORITY,
  stepProgressByAction: DEFAULT_TASK_STEP_PROGRESS_BY_ACTION,
});

export function canTaskTransition(currentStatus: TaskLifecycleStatus, action: TaskAction): boolean {
  return defaultTaskLifecyclePolicy.canTransition(currentStatus, action);
}

export function getNextTaskStatus(
  currentStatus: TaskLifecycleStatus,
  action: TaskAction,
): TaskLifecycleStatus | undefined {
  return defaultTaskLifecyclePolicy.getNextStatus(currentStatus, action);
}

export function transitionTaskStatus(
  currentStatus: TaskLifecycleStatus,
  action: TaskAction,
): TaskTransitionResult {
  return defaultTaskLifecyclePolicy.transition(currentStatus, action);
}

export function listTaskActions(currentStatus: TaskLifecycleStatus): TaskAction[] {
  return defaultTaskLifecyclePolicy.listActions(currentStatus);
}

export function selectDefaultTaskAction(
  currentStatus: TaskLifecycleStatus,
): TaskAction | undefined {
  return defaultTaskLifecyclePolicy.selectDefaultAction(currentStatus);
}

export function resolveTaskStepProgress(action: TaskAction): TaskStepProgressPolicy {
  return defaultTaskLifecyclePolicy.resolveStepProgress(action);
}
