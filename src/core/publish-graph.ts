import { assertExpectedRevision } from "../rules";
import { clonePersistedGraph, toPublicGraph } from "./graph-snapshot";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishGraphPublishedEvent, resolveNotifyPublisher } from "./notify-event";
import type { CreateLightTaskOptions, LightTaskGraph, PublishGraphInput } from "./types";

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

  const draftGraph = getGraph(normalizedPlanId, DRAFT_GRAPH_SCOPE);
  if (!draftGraph) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到图草稿，无法发布图快照", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertExpectedRevision(draftGraph.revision, input.expectedRevision);

  // 发布边界只复制当前草稿快照，不在这一层引入物化、运行态或应用层字段。
  const nextPublishedGraph = clonePersistedGraph(draftGraph);
  const publishedGraph = getGraph(normalizedPlanId, PUBLISHED_GRAPH_SCOPE);

  if (!publishedGraph) {
    const createGraph = requireLightTaskFunction(
      options.graphRepository?.create,
      "graphRepository.create",
    );
    const created = createGraph(normalizedPlanId, nextPublishedGraph, PUBLISHED_GRAPH_SCOPE);

    if (!created.ok) {
      throwLightTaskError(created.error);
    }

    const publicGraph = toPublicGraph(created.graph);
    publishGraphPublishedEvent(publishEvent, normalizedPlanId, publicGraph);
    return publicGraph;
  }

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

  const publicGraph = toPublicGraph(saved.graph);
  publishGraphPublishedEvent(publishEvent, normalizedPlanId, publicGraph);
  return publicGraph;
}
