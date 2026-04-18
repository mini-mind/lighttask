import type { TaskLifecyclePolicy, TaskStatusDefinition } from "../rules";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type {
  GetPlanSchedulingFactsResult,
  PersistedLightTask,
  PlanSchedulingBlockReasonCode,
  PlanSchedulingRiskReasonCode,
} from "./types";

function normalizeTaskIdList(fieldName: string, ids: string[] | undefined): string[] {
  if (ids === undefined) {
    return [];
  }

  if (!Array.isArray(ids)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", `${fieldName} 必须是字符串数组`, {
        [fieldName]: ids,
      }),
    );
  }

  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const rawId of ids) {
    if (typeof rawId !== "string") {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", `${fieldName} 只允许字符串条目`, {
          [fieldName]: ids,
        }),
      );
    }

    const normalizedId = rawId.trim();
    if (!normalizedId) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", `${fieldName} 不允许空白任务 ID`, {
          [fieldName]: ids,
        }),
      );
    }

    if (seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    normalizedIds.push(normalizedId);
  }

  return normalizedIds;
}

export function normalizeDependsOnTaskIds(dependsOnTaskIds: string[] | undefined): string[] {
  return normalizeTaskIdList("dependsOnTaskIds", dependsOnTaskIds);
}

function createTaskMap(tasks: PersistedLightTask[]): Map<string, PersistedLightTask> {
  return new Map(tasks.map((task) => [task.id, task]));
}

function requireTaskStatusDefinition(
  taskLifecycle: TaskLifecyclePolicy,
  task: PersistedLightTask,
): TaskStatusDefinition {
  const definition = taskLifecycle.getStatusDefinition(task.status);
  if (definition) {
    return definition;
  }

  throwLightTaskError(
    createLightTaskError("INVARIANT_VIOLATION", "任务状态未注册到 taskLifecycle，拒绝参与调度", {
      taskId: task.id,
      planId: task.planId,
      status: task.status,
    }),
  );
}

function isTaskEditable(taskLifecycle: TaskLifecyclePolicy, task: PersistedLightTask): boolean {
  return requireTaskStatusDefinition(taskLifecycle, task).editable;
}

function isTaskActive(taskLifecycle: TaskLifecyclePolicy, task: PersistedLightTask): boolean {
  return requireTaskStatusDefinition(taskLifecycle, task).active;
}

function isTaskTerminal(taskLifecycle: TaskLifecyclePolicy, task: PersistedLightTask): boolean {
  return requireTaskStatusDefinition(taskLifecycle, task).terminal;
}

function isTaskSchedulable(taskLifecycle: TaskLifecyclePolicy, task: PersistedLightTask): boolean {
  return requireTaskStatusDefinition(taskLifecycle, task).schedulable;
}

function getTaskCompletionOutcome(
  taskLifecycle: TaskLifecyclePolicy,
  task: PersistedLightTask,
): "success" | "failed" | "cancelled" | undefined {
  return requireTaskStatusDefinition(taskLifecycle, task).completionOutcome;
}

function isTaskNotSchedulable(
  taskLifecycle: TaskLifecyclePolicy,
  task: PersistedLightTask,
): boolean {
  const definition = requireTaskStatusDefinition(taskLifecycle, task);
  return !definition.schedulable && !definition.active && !definition.terminal;
}

function assertNoCycle(
  taskId: string,
  tasksById: ReadonlyMap<string, PersistedLightTask>,
  dependenciesByTaskId: ReadonlyMap<string, string[]>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(currentTaskId: string): void {
    if (visited.has(currentTaskId)) {
      return;
    }
    if (visiting.has(currentTaskId)) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "任务依赖存在环", {
          taskId,
          dependencyTaskId: currentTaskId,
        }),
      );
    }

    visiting.add(currentTaskId);
    for (const dependencyTaskId of dependenciesByTaskId.get(currentTaskId) ?? []) {
      if (tasksById.has(dependencyTaskId)) {
        visit(dependencyTaskId);
      }
    }
    visiting.delete(currentTaskId);
    visited.add(currentTaskId);
  }

  visit(taskId);
}

export function assertTaskDependencies(input: {
  taskId: string;
  planId: string;
  dependsOnTaskIds: string[];
  allTasks: PersistedLightTask[];
}): void {
  const { taskId, planId, dependsOnTaskIds, allTasks } = input;
  const tasksById = createTaskMap(allTasks);

  for (const dependencyTaskId of dependsOnTaskIds) {
    if (dependencyTaskId === taskId) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "任务不能依赖自己", {
          taskId,
        }),
      );
    }

    const dependencyTask = tasksById.get(dependencyTaskId);
    if (!dependencyTask) {
      throwLightTaskError(
        createLightTaskError("NOT_FOUND", "依赖任务不存在", {
          taskId,
          dependencyTaskId,
        }),
      );
    }

    if (dependencyTask.planId !== planId) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "不允许跨 Plan 依赖", {
          taskId,
          dependencyTaskId,
          planId,
          dependencyPlanId: dependencyTask.planId,
        }),
      );
    }
  }

  const dependenciesByTaskId = new Map<string, string[]>();
  for (const task of allTasks) {
    dependenciesByTaskId.set(task.id, task.dependsOnTaskIds);
  }
  dependenciesByTaskId.set(taskId, dependsOnTaskIds);
  assertNoCycle(taskId, tasksById, dependenciesByTaskId);
}

type MutableFact = {
  taskId: string;
  status: PersistedLightTask["status"];
  isEditable: boolean;
  isRunnable: boolean;
  isBlocked: boolean;
  isActive: boolean;
  isTerminal: boolean;
  isRisky: boolean;
  blockReasonCodes: PlanSchedulingBlockReasonCode[];
  riskReasonCodes: PlanSchedulingRiskReasonCode[];
  dependencyTaskIds: string[];
  downstreamTaskIds: string[];
  unmetDependencyTaskIds: string[];
  missingDependencyTaskIds: string[];
  riskyDependencyTaskIds: string[];
};

export function buildPlanSchedulingFacts(
  planId: string,
  tasks: PersistedLightTask[],
  taskLifecycle: TaskLifecyclePolicy,
): GetPlanSchedulingFactsResult {
  const planTasks = tasks
    .filter((task) => task.planId === planId)
    .slice()
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  const tasksById = createTaskMap(planTasks);
  const downstreamByTaskId = new Map<string, string[]>();

  for (const task of planTasks) {
    downstreamByTaskId.set(task.id, []);
  }
  for (const task of planTasks) {
    for (const dependencyTaskId of task.dependsOnTaskIds) {
      const downstreamTaskIds = downstreamByTaskId.get(dependencyTaskId);
      if (downstreamTaskIds) {
        downstreamTaskIds.push(task.id);
      }
    }
  }

  const editableTaskIds: string[] = [];
  const runnableTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const activeTaskIds: string[] = [];
  const terminalTaskIds: string[] = [];
  const riskyTaskIds: string[] = [];
  const byTaskId: Record<string, MutableFact> = {};

  for (const task of planTasks) {
    const dependencyTaskIds = [...task.dependsOnTaskIds];
    const downstreamTaskIds = [...(downstreamByTaskId.get(task.id) ?? [])].sort();
    const blockReasonCodes = new Set<PlanSchedulingBlockReasonCode>();
    const riskReasonCodes = new Set<PlanSchedulingRiskReasonCode>();
    const unmetDependencyTaskIds = new Set<string>();
    const missingDependencyTaskIds = new Set<string>();
    const riskyDependencyTaskIds = new Set<string>();

    if (isTaskNotSchedulable(taskLifecycle, task)) {
      blockReasonCodes.add("self_not_schedulable");
    }

    for (const dependencyTaskId of dependencyTaskIds) {
      const dependencyTask = tasksById.get(dependencyTaskId);
      if (!dependencyTask) {
        blockReasonCodes.add("dependency_missing");
        missingDependencyTaskIds.add(dependencyTaskId);
        unmetDependencyTaskIds.add(dependencyTaskId);
        continue;
      }

      if (isTaskNotSchedulable(taskLifecycle, dependencyTask)) {
        if (
          isTaskActive(taskLifecycle, task) ||
          getTaskCompletionOutcome(taskLifecycle, task) === "success"
        ) {
          riskReasonCodes.add("upstream_became_not_schedulable");
          riskyDependencyTaskIds.add(dependencyTaskId);
        } else {
          blockReasonCodes.add("dependency_not_schedulable");
          unmetDependencyTaskIds.add(dependencyTaskId);
        }
        continue;
      }

      if (getTaskCompletionOutcome(taskLifecycle, dependencyTask) === "failed") {
        blockReasonCodes.add("dependency_failed");
        unmetDependencyTaskIds.add(dependencyTaskId);
        continue;
      }

      if (getTaskCompletionOutcome(taskLifecycle, dependencyTask) === "cancelled") {
        blockReasonCodes.add("dependency_cancelled");
        unmetDependencyTaskIds.add(dependencyTaskId);
        continue;
      }

      if (getTaskCompletionOutcome(taskLifecycle, dependencyTask) !== "success") {
        blockReasonCodes.add("dependency_not_done");
        unmetDependencyTaskIds.add(dependencyTaskId);
      }
    }

    const isEditable = isTaskEditable(taskLifecycle, task);
    const isTerminal = isTaskTerminal(taskLifecycle, task);
    const isActive = isTaskActive(taskLifecycle, task);
    const isRunnable = isTaskSchedulable(taskLifecycle, task) && blockReasonCodes.size === 0;
    const isBlocked = !isEditable && !isRunnable && !isActive && !isTerminal;
    const isRisky = riskReasonCodes.size > 0;

    const fact: MutableFact = {
      taskId: task.id,
      status: task.status,
      isEditable,
      isRunnable,
      isBlocked,
      isActive,
      isTerminal,
      isRisky,
      blockReasonCodes: [...blockReasonCodes],
      riskReasonCodes: [...riskReasonCodes],
      dependencyTaskIds,
      downstreamTaskIds,
      unmetDependencyTaskIds: [...unmetDependencyTaskIds],
      missingDependencyTaskIds: [...missingDependencyTaskIds],
      riskyDependencyTaskIds: [...riskyDependencyTaskIds],
    };

    byTaskId[task.id] = fact;

    if (isEditable) {
      editableTaskIds.push(task.id);
    }
    if (isRunnable) {
      runnableTaskIds.push(task.id);
    } else if (isActive) {
      activeTaskIds.push(task.id);
    } else if (isTerminal) {
      terminalTaskIds.push(task.id);
    } else if (isBlocked) {
      blockedTaskIds.push(task.id);
    }

    if (isRisky) {
      riskyTaskIds.push(task.id);
    }
  }

  return {
    planId,
    editableTaskIds,
    runnableTaskIds,
    blockedTaskIds,
    activeTaskIds,
    terminalTaskIds,
    riskyTaskIds,
    byTaskId,
  };
}
