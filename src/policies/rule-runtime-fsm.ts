import {
  type CoreError,
  DEFAULT_RUNTIME_TERMINAL_STATUSES,
  type RuntimeLifecycleStatus,
  createCoreError,
} from "../models";

export type RuntimeAction = string;

export type RuntimeTransitionResult =
  | {
      ok: true;
      status: RuntimeLifecycleStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

export interface RuntimeLifecyclePolicy {
  initialStatus: RuntimeLifecycleStatus;
  isTerminal(status: RuntimeLifecycleStatus): boolean;
  canTransition(currentStatus: RuntimeLifecycleStatus, action: RuntimeAction): boolean;
  getNextStatus(
    currentStatus: RuntimeLifecycleStatus,
    action: RuntimeAction,
  ): RuntimeLifecycleStatus | undefined;
  transition(currentStatus: RuntimeLifecycleStatus, action: RuntimeAction): RuntimeTransitionResult;
  listActions(currentStatus: RuntimeLifecycleStatus): RuntimeAction[];
  selectDefaultAction(currentStatus: RuntimeLifecycleStatus): RuntimeAction | undefined;
}

export interface CreateRuntimeLifecyclePolicyInput {
  initialStatus: RuntimeLifecycleStatus;
  transitionTable: Readonly<
    Record<RuntimeLifecycleStatus, Readonly<Partial<Record<RuntimeAction, RuntimeLifecycleStatus>>>>
  >;
  terminalStatuses: readonly RuntimeLifecycleStatus[];
  defaultActionPriority?: readonly RuntimeAction[];
  validateTransition?: (input: {
    currentStatus: RuntimeLifecycleStatus;
    action: RuntimeAction;
    nextStatus: RuntimeLifecycleStatus;
  }) => CoreError | undefined;
}

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

const DEFAULT_RUNTIME_ACTION_PRIORITY: readonly RuntimeAction[] = ["start", "complete"];

export function createRuntimeLifecyclePolicy(
  input: CreateRuntimeLifecyclePolicyInput,
): RuntimeLifecyclePolicy {
  const terminalStatuses = new Set(input.terminalStatuses);

  function isTerminal(status: RuntimeLifecycleStatus): boolean {
    return terminalStatuses.has(status);
  }

  function getNextStatus(
    currentStatus: RuntimeLifecycleStatus,
    action: RuntimeAction,
  ): RuntimeLifecycleStatus | undefined {
    if (isTerminal(currentStatus)) {
      return undefined;
    }

    // 运行时首切片只保留最小生命周期，不引入 provider/session 专属语义。
    return input.transitionTable[currentStatus]?.[action];
  }

  function transition(
    currentStatus: RuntimeLifecycleStatus,
    action: RuntimeAction,
  ): RuntimeTransitionResult {
    const nextStatus = getNextStatus(currentStatus, action);
    if (nextStatus === undefined) {
      return {
        ok: false,
        error: createCoreError("STATE_CONFLICT", "运行时状态迁移冲突", {
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

  function listActions(currentStatus: RuntimeLifecycleStatus): RuntimeAction[] {
    if (isTerminal(currentStatus)) {
      return [];
    }

    return Object.keys(input.transitionTable[currentStatus] ?? {});
  }

  function selectDefaultAction(currentStatus: RuntimeLifecycleStatus): RuntimeAction | undefined {
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
  };
}

export const defaultRuntimeLifecyclePolicy = createRuntimeLifecyclePolicy({
  initialStatus: "queued",
  transitionTable: RUNTIME_TRANSITION_TABLE,
  terminalStatuses: DEFAULT_RUNTIME_TERMINAL_STATUSES,
  defaultActionPriority: DEFAULT_RUNTIME_ACTION_PRIORITY,
});

export function canRuntimeTransition(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): boolean {
  return defaultRuntimeLifecyclePolicy.canTransition(currentStatus, action);
}

export function getNextRuntimeStatus(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): RuntimeLifecycleStatus | undefined {
  return defaultRuntimeLifecyclePolicy.getNextStatus(currentStatus, action);
}

export function transitionRuntimeStatus(
  currentStatus: RuntimeLifecycleStatus,
  action: RuntimeAction,
): RuntimeTransitionResult {
  return defaultRuntimeLifecyclePolicy.transition(currentStatus, action);
}

export function listRuntimeActions(currentStatus: RuntimeLifecycleStatus): RuntimeAction[] {
  return defaultRuntimeLifecyclePolicy.listActions(currentStatus);
}

export function selectDefaultRuntimeAction(
  currentStatus: RuntimeLifecycleStatus,
): RuntimeAction | undefined {
  return defaultRuntimeLifecyclePolicy.selectDefaultAction(currentStatus);
}
