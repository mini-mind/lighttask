import { type CoreError, bumpRevision } from "../models";
import { assertExpectedRevision } from "../policies";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import {
  publishTaskDeletedEvent,
  publishTaskUpdatedEvent,
  resolveNotifyPublisher,
} from "./notify-event";
import { clonePersistedPlan } from "./plan-snapshot";
import { buildPlanSchedulingFacts } from "./task-dependency-snapshot";
import { requireTaskPolicyForPlan } from "./task-lifecycle";
import { clonePersistedTask, toPublicTask } from "./task-snapshot";
import type {
  CreateLightTaskOptions,
  DeleteTaskInput,
  DeleteTaskResult,
  LightTaskTask,
  PersistedLightPlan,
  PersistedLightTask,
} from "./types";

function buildDeleteTaskFingerprint(taskId: string, input: DeleteTaskInput): string {
  return JSON.stringify({
    taskId,
    expectedRevision: input.expectedRevision,
  });
}

function resolveDeleteTaskReplay(
  plans: PersistedLightPlan[],
  idempotencyKey: string,
  fingerprint: string,
  taskId: string,
): DeleteTaskResult | undefined {
  for (const plan of plans) {
    const replay = plan.deleteTaskReplayByIdempotencyKey?.[idempotencyKey];
    if (!replay) {
      continue;
    }
    if (replay.result.taskId !== taskId) {
      continue;
    }
    if (replay.fingerprint === fingerprint) {
      return structuredClone(replay.result);
    }
    throwLightTaskError(
      createLightTaskError(
        "STATE_CONFLICT",
        "相同 idempotencyKey 对应的请求内容不一致，拒绝处理。",
        {
          idempotencyKey,
          incomingFingerprint: fingerprint,
          storedFingerprint: replay.fingerprint,
        },
      ),
    );
  }
  return undefined;
}

function persistDeleteTaskReplay(input: {
  getPlan: (planId: string) => PersistedLightPlan | undefined;
  savePlanIfRevisionMatches: (
    plan: PersistedLightPlan,
    expectedRevision: number,
  ) =>
    | { ok: true; plan: PersistedLightPlan }
    | {
        ok: false;
        error: CoreError;
      };
  plan: PersistedLightPlan;
  idempotencyKey: string;
  fingerprint: string;
  result: DeleteTaskResult;
}): PersistedLightPlan | undefined {
  let currentPlan = input.plan;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextPlan: PersistedLightPlan = {
      ...clonePersistedPlan(currentPlan),
      // delete replay 只属于内部 sidecar，不应污染对外可见的 Plan revision/updatedAt。
      deleteTaskReplayByIdempotencyKey: {
        ...(currentPlan.deleteTaskReplayByIdempotencyKey ?? {}),
        [input.idempotencyKey]: {
          fingerprint: input.fingerprint,
          result: structuredClone(input.result),
        },
      },
    };
    const saved = input.savePlanIfRevisionMatches(nextPlan, currentPlan.revision);
    if (saved.ok) {
      return saved.plan;
    }
    if (saved.error.code !== "REVISION_CONFLICT") {
      throwLightTaskError(saved.error);
    }

    const latestPlan = input.getPlan(currentPlan.id);
    if (!latestPlan) {
      break;
    }
    currentPlan = latestPlan;
  }

  throwLightTaskError(
    createLightTaskError("REVISION_CONFLICT", "deleteTask 无法持久化幂等回放记录", {
      planId: input.plan.id,
      taskId: input.result.taskId,
      idempotencyKey: input.idempotencyKey,
    }),
  );
}

export function deleteTaskUseCase(
  options: CreateLightTaskOptions,
  taskId: string,
  input: DeleteTaskInput,
): DeleteTaskResult {
  const publishEvent = resolveNotifyPublisher(options);
  const runInConsistency = requireLightTaskFunction(options.consistency?.run, "consistency.run");
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const listPlans = requireLightTaskFunction(options.planRepository?.list, "planRepository.list");
  const savePlanIfRevisionMatches = requireLightTaskFunction(
    options.planRepository?.saveIfRevisionMatches,
    "planRepository.saveIfRevisionMatches",
  );
  const getTask = requireLightTaskFunction(options.taskRepository?.get, "taskRepository.get");
  const listTasks = requireLightTaskFunction(options.taskRepository?.list, "taskRepository.list");
  const saveIfRevisionMatches = requireLightTaskFunction(
    options.taskRepository?.saveIfRevisionMatches,
    "taskRepository.saveIfRevisionMatches",
  );
  const deleteIfRevisionMatches = requireLightTaskFunction(
    options.taskRepository?.deleteIfRevisionMatches,
    "taskRepository.deleteIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const normalizedTaskId = taskId.trim();
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const fingerprint = buildDeleteTaskFingerprint(normalizedTaskId, input);
  if (!normalizedTaskId) {
    throwLightTaskError(createLightTaskError("VALIDATION_ERROR", "任务 ID 不能为空", { taskId }));
  }

  return runInConsistency("deleteTask", () => {
    const storedTask = getTask(normalizedTaskId);
    if (!storedTask && normalizedIdempotencyKey) {
      const replay = resolveDeleteTaskReplay(
        listPlans(),
        normalizedIdempotencyKey,
        fingerprint,
        normalizedTaskId,
      );
      if (replay) {
        return replay;
      }
    }
    if (!storedTask) {
      throwLightTaskError(
        createLightTaskError("NOT_FOUND", "未找到任务", { taskId: normalizedTaskId }),
      );
    }

    assertExpectedRevision(storedTask.revision, input.expectedRevision);
    const storedPlan = getPlan(storedTask.planId);
    if (!storedPlan) {
      throwLightTaskError(
        createLightTaskError("INVARIANT_VIOLATION", "任务所属计划不存在，无法删除任务", {
          taskId: storedTask.id,
          planId: storedTask.planId,
        }),
      );
    }

    const peerTasks = listTasks().filter(
      (task) => task.planId === storedTask.planId && task.id !== storedTask.id,
    );
    const nowIso = clockNow();
    const deletedAt = clockNow();
    const tasksToDetach = peerTasks.filter((task) => task.dependsOnTaskIds.includes(storedTask.id));
    const detachedFromTaskIds = tasksToDetach.map((task) => task.id).sort();
    const updatedPeerTasks: LightTaskTask[] = [];
    const result: DeleteTaskResult = {
      taskId: storedTask.id,
      planId: storedTask.planId,
      detachedFromTaskIds,
    };

    if (normalizedIdempotencyKey) {
      persistDeleteTaskReplay({
        getPlan,
        savePlanIfRevisionMatches,
        plan: storedPlan,
        idempotencyKey: normalizedIdempotencyKey,
        fingerprint,
        result,
      });
    }

    for (const peerTask of tasksToDetach) {
      const nextRevision = bumpRevision(peerTask, nowIso, undefined);
      const nextTask: PersistedLightTask = {
        ...clonePersistedTask(peerTask),
        dependsOnTaskIds: peerTask.dependsOnTaskIds.filter(
          (dependencyTaskId) => dependencyTaskId !== storedTask.id,
        ),
        revision: nextRevision.revision,
        updatedAt: nextRevision.updatedAt,
        idempotencyKey: undefined,
        lastUpdateFingerprint: undefined,
        lastAdvanceFingerprint: undefined,
      };
      const saved = saveIfRevisionMatches(nextTask, peerTask.revision);
      if (!saved.ok) {
        throwLightTaskError(saved.error);
      }
      updatedPeerTasks.push(toPublicTask(saved.task));
    }

    const deleted = deleteIfRevisionMatches(storedTask.id, storedTask.revision);
    if (!deleted.ok) {
      throwLightTaskError(deleted.error);
    }

    // 删除后不持久化调度事实，但在一致性边界内提前重建一次，确保兜底校验不会炸。
    buildPlanSchedulingFacts(
      storedTask.planId,
      listTasks(),
      requireTaskPolicyForPlan(options, storedPlan),
    );

    for (const updatedPeerTask of updatedPeerTasks) {
      publishTaskUpdatedEvent(publishEvent, updatedPeerTask);
    }
    publishTaskDeletedEvent(publishEvent, {
      result,
      occurredAt: deletedAt,
      revision: storedTask.revision + 1,
      idempotencyKey: normalizedIdempotencyKey,
    });
    return result;
  });
}
