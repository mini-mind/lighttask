import {
  type CoreError,
  DEFAULT_TASK_TERMINAL_STATUSES,
  type TaskStatus,
  createCoreError,
} from "../data-structures";

export type TaskAction =
  | "finalize"
  | "return_to_draft"
  | "dispatch"
  | "start"
  | "request_approval"
  | "approve"
  | "complete"
  | "fail"
  | "cancel";

export type TaskTransitionResult =
  | {
      ok: true;
      status: TaskStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

export type TaskStepProgressPolicy = "none" | "advance_one" | "complete_all";

export interface TaskLifecyclePolicy {
  initialStatus: TaskStatus;
  isTerminal(status: TaskStatus): boolean;
  canTransition(currentStatus: TaskStatus, action: TaskAction): boolean;
  getNextStatus(currentStatus: TaskStatus, action: TaskAction): TaskStatus | undefined;
  transition(currentStatus: TaskStatus, action: TaskAction): TaskTransitionResult;
  listActions(currentStatus: TaskStatus): TaskAction[];
  resolveStepProgress(action: TaskAction): TaskStepProgressPolicy;
}

export interface CreateTaskLifecyclePolicyInput {
  initialStatus: TaskStatus;
  transitionTable: Readonly<Record<TaskStatus, Readonly<Partial<Record<TaskAction, TaskStatus>>>>>;
  terminalStatuses: readonly TaskStatus[];
  stepProgressByAction?: Readonly<Partial<Record<TaskAction, TaskStepProgressPolicy>>>;
  validateTransition?: (input: {
    currentStatus: TaskStatus;
    action: TaskAction;
    nextStatus: TaskStatus;
  }) => CoreError | undefined;
}

const TASK_TRANSITION_TABLE: Readonly<
  Record<TaskStatus, Readonly<Partial<Record<TaskAction, TaskStatus>>>>
> = {
  draft: {
    finalize: "todo",
  },
  todo: {
    return_to_draft: "draft",
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

const DEFAULT_TASK_STEP_PROGRESS_BY_ACTION = {
  finalize: "none",
  return_to_draft: "none",
  dispatch: "advance_one",
  start: "advance_one",
  complete: "complete_all",
} satisfies Readonly<Partial<Record<TaskAction, TaskStepProgressPolicy>>>;

export function createTaskLifecyclePolicy(
  input: CreateTaskLifecyclePolicyInput,
): TaskLifecyclePolicy {
  const terminalStatuses = new Set(input.terminalStatuses);

  function isTerminal(status: TaskStatus): boolean {
    return terminalStatuses.has(status);
  }

  function getNextStatus(currentStatus: TaskStatus, action: TaskAction): TaskStatus | undefined {
    if (isTerminal(currentStatus)) {
      return undefined;
    }

    return input.transitionTable[currentStatus]?.[action];
  }

  function transition(currentStatus: TaskStatus, action: TaskAction): TaskTransitionResult {
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

  function listActions(currentStatus: TaskStatus): TaskAction[] {
    if (isTerminal(currentStatus)) {
      return [];
    }

    return Object.keys(input.transitionTable[currentStatus] ?? {}) as TaskAction[];
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
    resolveStepProgress(action) {
      return input.stepProgressByAction?.[action] ?? "none";
    },
  };
}

export const defaultTaskLifecyclePolicy = createTaskLifecyclePolicy({
  initialStatus: "draft",
  transitionTable: TASK_TRANSITION_TABLE,
  terminalStatuses: DEFAULT_TASK_TERMINAL_STATUSES,
  stepProgressByAction: DEFAULT_TASK_STEP_PROGRESS_BY_ACTION,
});

export function canTaskTransition(currentStatus: TaskStatus, action: TaskAction): boolean {
  return defaultTaskLifecyclePolicy.canTransition(currentStatus, action);
}

export function getNextTaskStatus(
  currentStatus: TaskStatus,
  action: TaskAction,
): TaskStatus | undefined {
  return defaultTaskLifecyclePolicy.getNextStatus(currentStatus, action);
}

export function transitionTaskStatus(
  currentStatus: TaskStatus,
  action: TaskAction,
): TaskTransitionResult {
  return defaultTaskLifecyclePolicy.transition(currentStatus, action);
}

export function listTaskActions(currentStatus: TaskStatus): TaskAction[] {
  return defaultTaskLifecyclePolicy.listActions(currentStatus);
}

export function resolveTaskStepProgress(action: TaskAction): TaskStepProgressPolicy {
  return defaultTaskLifecyclePolicy.resolveStepProgress(action);
}
