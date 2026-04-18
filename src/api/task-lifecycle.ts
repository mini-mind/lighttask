import type { PlanRecord } from "../models";
import type { TaskPolicies, TaskPolicy, TaskStatusDefinition } from "../policies";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type { CreateLightTaskOptions, PersistedLightTask } from "./types";

export function resolveTaskPolicies(options: CreateLightTaskOptions): TaskPolicies {
  // Task 策略已经完全交给应用层注册，内核不再偷偷回退到预设状态机。
  if (options.taskPolicies) {
    return options.taskPolicies;
  }

  throwLightTaskError(
    createLightTaskError("VALIDATION_ERROR", "createLightTask 必须显式提供 taskPolicies", {
      path: "taskPolicies",
    }),
  );
}

export function requireTaskStatusDefinition(
  taskPolicy: TaskPolicy,
  status: string,
  details: Record<string, unknown>,
): TaskStatusDefinition {
  const definition = taskPolicy.getStatusDefinition(status);
  if (definition) {
    return definition;
  }

  throwLightTaskError(
    createLightTaskError("INVARIANT_VIOLATION", "任务状态未注册到 taskPolicy，拒绝继续处理", {
      ...details,
      status,
    }),
  );
}

export function requireTaskPolicyById(
  options: CreateLightTaskOptions,
  taskPolicyId: string,
  details: Record<string, unknown>,
): TaskPolicy {
  const normalizedTaskPolicyId = taskPolicyId.trim();
  if (!normalizedTaskPolicyId) {
    throwLightTaskError(
      createLightTaskError("INVARIANT_VIOLATION", "Plan 缺少 taskPolicyId，拒绝继续处理", {
        ...details,
        taskPolicyId,
      }),
    );
  }

  const taskPolicy = resolveTaskPolicies(options).get(normalizedTaskPolicyId);
  if (taskPolicy) {
    return taskPolicy;
  }

  throwLightTaskError(
    createLightTaskError("INVARIANT_VIOLATION", "Plan 绑定的 taskPolicy 未注册，拒绝继续处理", {
      ...details,
      taskPolicyId: normalizedTaskPolicyId,
    }),
  );
}

export function requireTaskPolicyForPlan(
  options: CreateLightTaskOptions,
  plan: Pick<PlanRecord, "id" | "taskPolicyId">,
  details: Record<string, unknown> = {},
): TaskPolicy {
  return requireTaskPolicyById(options, plan.taskPolicyId, {
    ...details,
    planId: plan.id,
  });
}

export function requireTaskPolicyForTask(
  options: CreateLightTaskOptions,
  task: Pick<PersistedLightTask, "id" | "planId">,
): TaskPolicy {
  const getPlan = options.planRepository?.get;
  if (!getPlan) {
    throwLightTaskError(
      createLightTaskError(
        "INVARIANT_VIOLATION",
        "planRepository.get 未配置，无法按 Plan 解析 taskPolicy",
        {
          taskId: task.id,
          planId: task.planId,
        },
      ),
    );
  }

  const plan = getPlan(task.planId);
  if (!plan) {
    throwLightTaskError(
      createLightTaskError("INVARIANT_VIOLATION", "任务引用的 Plan 不存在，拒绝继续处理", {
        taskId: task.id,
        planId: task.planId,
      }),
    );
  }

  return requireTaskPolicyForPlan(options, plan, { taskId: task.id });
}
