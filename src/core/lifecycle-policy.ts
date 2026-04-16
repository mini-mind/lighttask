import {
  defaultPlanLifecyclePolicy,
  defaultRuntimeLifecyclePolicy,
  defaultTaskLifecyclePolicy,
} from "../rules";
import { resolveTaskDesignStatus, resolveTaskExecutionStatus } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  PersistedLightTask,
  PlanSchedulingBlockReason,
  PlanSchedulingPolicy,
  PlanSchedulingPolicyContext,
} from "./types";

function resolveDefaultBlockReason(
  context: PlanSchedulingPolicyContext,
  taskLifecycleInitialStatus: string,
): PlanSchedulingBlockReason | undefined {
  if (context.isTerminal) {
    return undefined;
  }

  if (!context.isReady) {
    return {
      code: "waiting_for_prerequisites",
      unmetPrerequisites: context.prerequisiteNodeIds
        .filter((nodeId) => !context.completedNodeIdSet.has(nodeId))
        .map((nodeId) => ({
          nodeId,
          taskStatus: (() => {
            const prerequisiteTask = context.tasksByNodeId.get(nodeId);
            return prerequisiteTask ? resolveTaskExecutionStatus(prerequisiteTask) : undefined;
          })(),
        })),
    };
  }

  if (!context.task) {
    return {
      code: "missing_task",
    };
  }

  const taskDesignStatus = resolveTaskDesignStatus(context.task.designStatus);
  if (taskDesignStatus !== "ready") {
    return {
      code: "task_design_incomplete",
      taskDesignStatus,
    };
  }

  const taskExecutionStatus = resolveTaskExecutionStatus(context.task);
  if (taskExecutionStatus === taskLifecycleInitialStatus) {
    return undefined;
  }

  switch (taskExecutionStatus) {
    case "dispatched":
      return {
        code: "task_dispatched",
        taskStatus: "dispatched",
      };
    case "running":
      return {
        code: "task_running",
        taskStatus: "running",
      };
    case "blocked_by_approval":
      return {
        code: "task_blocked_by_approval",
        taskStatus: "blocked_by_approval",
      };
    default:
      return {
        code: "task_waiting_transition",
        taskStatus: taskExecutionStatus ?? taskLifecycleInitialStatus,
      };
  }
}

export function resolveTaskLifecyclePolicy(options: CreateLightTaskOptions) {
  return options.taskLifecycle ?? defaultTaskLifecyclePolicy;
}

export function resolvePlanLifecyclePolicy(options: CreateLightTaskOptions) {
  return options.planLifecycle ?? defaultPlanLifecyclePolicy;
}

export function resolveRuntimeLifecyclePolicy(options: CreateLightTaskOptions) {
  return options.runtimeLifecycle ?? defaultRuntimeLifecyclePolicy;
}

export function resolvePlanSchedulingPolicy(options: CreateLightTaskOptions): PlanSchedulingPolicy {
  const taskLifecycle = resolveTaskLifecyclePolicy(options);
  const policy = options.scheduling ?? {};

  return {
    isTaskCompleted:
      policy.isTaskCompleted ??
      ((task: PersistedLightTask) => resolveTaskExecutionStatus(task) === "completed"),
    isTaskTerminal:
      policy.isTaskTerminal ??
      ((task: PersistedLightTask) => taskLifecycle.isTerminal(resolveTaskExecutionStatus(task))),
    isTaskRunnable:
      policy.isTaskRunnable ??
      ((context: PlanSchedulingPolicyContext) => {
        if (!context.isReady || !context.task) {
          return false;
        }

        if (resolveTaskDesignStatus(context.task.designStatus) !== "ready") {
          return false;
        }

        return resolveTaskExecutionStatus(context.task) === taskLifecycle.initialStatus;
      }),
    resolveBlockReason:
      policy.resolveBlockReason ??
      ((context: PlanSchedulingPolicyContext) =>
        resolveDefaultBlockReason(context, taskLifecycle.initialStatus)),
  };
}
