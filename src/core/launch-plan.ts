import { advancePlanUseCase } from "./advance-plan";
import { collectPublishedPlanTasks } from "./collect-published-plan-tasks";
import { runInConsistencyBoundary } from "./consistency-boundary";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishPlanLaunchedEvent, resolveNotifyPublisher } from "./notify-event";
import type { CreateLightTaskOptions, LaunchPlanInput, LaunchPlanResult } from "./types";

function assertPlanId(planId: string): string {
  const normalizedPlanId = planId.trim();

  if (!normalizedPlanId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "计划 ID 不能为空", {
        planId,
      }),
    );
  }

  return normalizedPlanId;
}

export function launchPlanUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: LaunchPlanInput,
): LaunchPlanResult {
  const publishEvent = resolveNotifyPublisher(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const normalizedPlanId = assertPlanId(planId);
  const storedPlan = getPlan(normalizedPlanId);

  if (!storedPlan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法发射计划", {
        planId: normalizedPlanId,
      }),
    );
  }

  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
        planId: normalizedPlanId,
      }),
    );
  }

  // 当前切片只关闭“ready 计划 -> 已发布图 -> 任务网络”的确认回路，不引入运行态语义。
  if (storedPlan.status !== "ready") {
    throwLightTaskError(
      createLightTaskError("STATE_CONFLICT", "只有 ready 状态的计划可以发射", {
        planId: normalizedPlanId,
        currentStatus: storedPlan.status,
      }),
    );
  }

  if (storedPlan.revision !== input.expectedRevision) {
    throwLightTaskError(
      createLightTaskError("REVISION_CONFLICT", "expectedRevision 与当前 revision 不一致", {
        currentRevision: storedPlan.revision,
        expectedRevision: input.expectedRevision,
      }),
    );
  }

  const { published, confirmedPlan } = runInConsistencyBoundary(
    options,
    `launchPlan:${normalizedPlanId}`,
    () => {
      const published = collectPublishedPlanTasks({
        options,
        planId: normalizedPlanId,
        expectedPublishedGraphRevision: input.expectedPublishedGraphRevision,
      });
      const confirmedPlan = advancePlanUseCase(options, normalizedPlanId, {
        expectedRevision: input.expectedRevision,
        action: "confirm",
      });

      return {
        published,
        confirmedPlan,
      };
    },
  );

  const result = {
    plan: confirmedPlan,
    publishedGraph: published.publishedGraph,
    tasks: published.tasks,
  };

  publishPlanLaunchedEvent(publishEvent, result);
  return result;
}
