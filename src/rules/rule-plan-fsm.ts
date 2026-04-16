import {
  type CoreError,
  DEFAULT_PLAN_TERMINAL_STATUSES,
  type PlanLifecycleStatus,
  createCoreError,
} from "../data-structures";

export type PlanAction = string;

export type PlanTransitionResult =
  | {
      ok: true;
      status: PlanLifecycleStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

export interface PlanLifecyclePolicy {
  initialStatus: PlanLifecycleStatus;
  isTerminal(status: PlanLifecycleStatus): boolean;
  canTransition(currentStatus: PlanLifecycleStatus, action: PlanAction): boolean;
  getNextStatus(
    currentStatus: PlanLifecycleStatus,
    action: PlanAction,
  ): PlanLifecycleStatus | undefined;
  transition(currentStatus: PlanLifecycleStatus, action: PlanAction): PlanTransitionResult;
  listActions(currentStatus: PlanLifecycleStatus): PlanAction[];
  selectDefaultAction(currentStatus: PlanLifecycleStatus): PlanAction | undefined;
}

export interface CreatePlanLifecyclePolicyInput {
  initialStatus: PlanLifecycleStatus;
  transitionTable: Readonly<
    Record<PlanLifecycleStatus, Readonly<Partial<Record<PlanAction, PlanLifecycleStatus>>>>
  >;
  terminalStatuses: readonly PlanLifecycleStatus[];
  defaultActionPriority?: readonly PlanAction[];
  validateTransition?: (input: {
    currentStatus: PlanLifecycleStatus;
    action: PlanAction;
    nextStatus: PlanLifecycleStatus;
  }) => CoreError | undefined;
}

const PLAN_TRANSITION_TABLE: Readonly<
  Record<PlanLifecycleStatus, Readonly<Partial<Record<PlanAction, PlanLifecycleStatus>>>>
> = {
  draft: {
    start_planning: "planning",
    fail: "failed",
  },
  planning: {
    mark_ready: "ready",
    fail: "failed",
  },
  ready: {
    confirm: "confirmed",
    fail: "failed",
  },
  confirmed: {
    archive: "archived",
    fail: "failed",
  },
  archived: {},
  failed: {},
} as const;

const DEFAULT_PLAN_ACTION_PRIORITY: readonly PlanAction[] = [
  "start_planning",
  "mark_ready",
  "confirm",
  "archive",
];

export function createPlanLifecyclePolicy(
  input: CreatePlanLifecyclePolicyInput,
): PlanLifecyclePolicy {
  const terminalStatuses = new Set(input.terminalStatuses);

  function isTerminal(status: PlanLifecycleStatus): boolean {
    return terminalStatuses.has(status);
  }

  function getNextStatus(
    currentStatus: PlanLifecycleStatus,
    action: PlanAction,
  ): PlanLifecycleStatus | undefined {
    if (isTerminal(currentStatus)) {
      return undefined;
    }

    // 表驱动可将“状态/动作/目标状态”关系集中管理，降低分支散落导致的回归风险。
    return input.transitionTable[currentStatus]?.[action];
  }

  function transition(
    currentStatus: PlanLifecycleStatus,
    action: PlanAction,
  ): PlanTransitionResult {
    const nextStatus = getNextStatus(currentStatus, action);
    if (nextStatus === undefined) {
      return {
        ok: false,
        error: createCoreError("STATE_CONFLICT", "计划状态迁移冲突", {
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

  function listActions(currentStatus: PlanLifecycleStatus): PlanAction[] {
    if (isTerminal(currentStatus)) {
      return [];
    }

    return Object.keys(input.transitionTable[currentStatus] ?? {});
  }

  function selectDefaultAction(currentStatus: PlanLifecycleStatus): PlanAction | undefined {
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

export const defaultPlanLifecyclePolicy = createPlanLifecyclePolicy({
  initialStatus: "draft",
  transitionTable: PLAN_TRANSITION_TABLE,
  terminalStatuses: DEFAULT_PLAN_TERMINAL_STATUSES,
  defaultActionPriority: DEFAULT_PLAN_ACTION_PRIORITY,
});

export function canPlanTransition(currentStatus: PlanLifecycleStatus, action: PlanAction): boolean {
  return defaultPlanLifecyclePolicy.canTransition(currentStatus, action);
}

export function getNextPlanStatus(
  currentStatus: PlanLifecycleStatus,
  action: PlanAction,
): PlanLifecycleStatus | undefined {
  return defaultPlanLifecyclePolicy.getNextStatus(currentStatus, action);
}

export function transitionPlanStatus(
  currentStatus: PlanLifecycleStatus,
  action: PlanAction,
): PlanTransitionResult {
  return defaultPlanLifecyclePolicy.transition(currentStatus, action);
}

export function listPlanActions(currentStatus: PlanLifecycleStatus): PlanAction[] {
  return defaultPlanLifecyclePolicy.listActions(currentStatus);
}

export function selectDefaultPlanAction(
  currentStatus: PlanLifecycleStatus,
): PlanAction | undefined {
  return defaultPlanLifecyclePolicy.selectDefaultAction(currentStatus);
}
