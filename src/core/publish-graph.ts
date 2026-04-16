import { bumpRevision } from "../data-structures";
import { assertExpectedRevision } from "../rules";
import { assertGraphTaskReferences } from "./assert-graph-task-references";
import { runInConsistencyBoundary } from "./consistency-boundary";
import { clonePersistedGraph, toPublicGraph } from "./graph-snapshot";
import { resolvePlanLifecyclePolicy } from "./lifecycle-policy";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import {
  publishGraphPublishedEvent,
  publishPlanUpdatedEvent,
  resolveNotifyPublisher,
} from "./notify-event";
import { clonePersistedPlan, toPublicPlan } from "./plan-snapshot";
import type {
  CreateLightTaskOptions,
  LightTaskGraph,
  LightTaskPlan,
  PersistedLightPlan,
  PublishGraphInput,
} from "./types";

const DRAFT_GRAPH_SCOPE = "draft" as const;
const PUBLISHED_GRAPH_SCOPE = "published" as const;

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

function assertPlanAllowsPublish(
  options: CreateLightTaskOptions,
  planId: string,
  currentStatus: string,
): void {
  const planLifecycle = resolvePlanLifecyclePolicy(options);
  if (!planLifecycle.isTerminal(currentStatus) && currentStatus !== "confirmed") {
    return;
  }

  throwLightTaskError(
    createLightTaskError("STATE_CONFLICT", "当前计划状态不允许发布图快照", {
      planId,
      currentStatus,
    }),
  );
}

function bumpPlanRevisionForGraphPublish(input: {
  options: CreateLightTaskOptions;
  plan: PersistedLightPlan;
}): LightTaskPlan {
  const clockNow = requireLightTaskFunction(input.options.clock?.now, "clock.now");
  const saveIfRevisionMatches = requireLightTaskFunction(
    input.options.planRepository?.saveIfRevisionMatches,
    "planRepository.saveIfRevisionMatches",
  );
  const nextRevision = bumpRevision(input.plan, clockNow(), input.plan.idempotencyKey);
  const nextPlanBase = clonePersistedPlan(input.plan);
  const nextPlan: PersistedLightPlan = {
    ...nextPlanBase,
    revision: nextRevision.revision,
    updatedAt: nextRevision.updatedAt,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = saveIfRevisionMatches(nextPlan, input.plan.revision);

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  return toPublicPlan(saved.plan);
}

export function publishGraphUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: PublishGraphInput,
): LightTaskGraph {
  const publishEvent = resolveNotifyPublisher(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const getGraph = requireLightTaskFunction(options.graphRepository?.get, "graphRepository.get");
  const normalizedPlanId = assertPlanId(planId);
  const plan = getPlan(normalizedPlanId);

  if (!plan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法发布图快照", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertPlanAllowsPublish(options, normalizedPlanId, plan.status);
  const draftGraph = getGraph(normalizedPlanId, DRAFT_GRAPH_SCOPE);
  if (!draftGraph) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到图草稿，无法发布图快照", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertExpectedRevision(draftGraph.revision, input.expectedRevision);
  assertGraphTaskReferences({
    options,
    planId: normalizedPlanId,
    nodes: draftGraph.nodes,
    operation: "publish",
  });
  const { publicGraph, updatedPlan } = runInConsistencyBoundary(
    options,
    `publishGraph:${normalizedPlanId}`,
    () => {
      // 发布边界只复制当前草稿快照，不在这一层引入物化、运行态或应用层字段。
      const nextPublishedGraph = clonePersistedGraph(draftGraph);
      const publishedGraph = getGraph(normalizedPlanId, PUBLISHED_GRAPH_SCOPE);
      let publicGraph: LightTaskGraph;

      if (!publishedGraph) {
        const createGraph = requireLightTaskFunction(
          options.graphRepository?.create,
          "graphRepository.create",
        );
        const created = createGraph(normalizedPlanId, nextPublishedGraph, PUBLISHED_GRAPH_SCOPE);

        if (!created.ok) {
          throwLightTaskError(created.error);
        }

        publicGraph = toPublicGraph(created.graph);
      } else {
        const saveIfRevisionMatches = requireLightTaskFunction(
          options.graphRepository?.saveIfRevisionMatches,
          "graphRepository.saveIfRevisionMatches",
        );
        const saved = saveIfRevisionMatches(
          normalizedPlanId,
          nextPublishedGraph,
          publishedGraph.revision,
          PUBLISHED_GRAPH_SCOPE,
        );

        if (!saved.ok) {
          throwLightTaskError(saved.error);
        }

        publicGraph = toPublicGraph(saved.graph);
      }

      // 关系视图一旦发布成功，就推进计划 revision，要求上层重新确认这次依赖基线。
      const updatedPlan = bumpPlanRevisionForGraphPublish({
        options,
        plan,
      });

      return {
        publicGraph,
        updatedPlan,
      };
    },
  );

  publishPlanUpdatedEvent(publishEvent, updatedPlan);
  publishGraphPublishedEvent(publishEvent, normalizedPlanId, publicGraph);
  return publicGraph;
}
