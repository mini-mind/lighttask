import {
  type CoreError,
  type PlanLifecycleStatus,
  createCoreError,
  isPlanTerminalStatus,
} from "../data-structures";

export type PlanAction = "start_planning" | "mark_ready" | "confirm" | "archive" | "fail";

export type PlanTransitionResult =
  | {
      ok: true;
      status: PlanLifecycleStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

const PLAN_ACTIONS: readonly PlanAction[] = [
  "start_planning",
  "mark_ready",
  "confirm",
  "archive",
  "fail",
];

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

function resolvePlanTransition(
  currentStatus: PlanLifecycleStatus,
  action: PlanAction,
): PlanLifecycleStatus | undefined {
  // 表驱动可将“状态/动作/目标状态”关系集中管理，降低分支散落导致的回归风险。
  return PLAN_TRANSITION_TABLE[currentStatus][action];
}

export function canPlanTransition(currentStatus: PlanLifecycleStatus, action: PlanAction): boolean {
  return resolvePlanTransition(currentStatus, action) !== undefined;
}

export function getNextPlanStatus(
  currentStatus: PlanLifecycleStatus,
  action: PlanAction,
): PlanLifecycleStatus | undefined {
  return resolvePlanTransition(currentStatus, action);
}

export function transitionPlanStatus(
  currentStatus: PlanLifecycleStatus,
  action: PlanAction,
): PlanTransitionResult {
  const nextStatus = resolvePlanTransition(currentStatus, action);
  if (nextStatus === undefined) {
    return {
      ok: false,
      error: createCoreError("STATE_CONFLICT", "计划状态迁移冲突", {
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

export function listPlanActions(currentStatus: PlanLifecycleStatus): PlanAction[] {
  // 终态只允许读取，不允许继续发生业务动作。
  if (isPlanTerminalStatus(currentStatus)) {
    return [];
  }

  // 统一从动作全集过滤，保证动作枚举顺序稳定且和迁移判定一致。
  return PLAN_ACTIONS.filter((action) => canPlanTransition(currentStatus, action));
}

const DEFAULT_PLAN_ACTION_PRIORITY: readonly PlanAction[] = [
  "start_planning",
  "mark_ready",
  "confirm",
  "archive",
];

export function selectDefaultPlanAction(
  currentStatus: PlanLifecycleStatus,
): PlanAction | undefined {
  return DEFAULT_PLAN_ACTION_PRIORITY.find((action) => canPlanTransition(currentStatus, action));
}
