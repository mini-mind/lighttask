import { bumpRevision, createGraphSnapshot } from "../data-structures";
import { assertExpectedRevision, assertNextRevision, validateDagSnapshot } from "../rules";
import { cloneOptional, cloneValue } from "./clone";
import { publishGraphSavedEvent, resolveNotifyPublisher } from "./notify-event";
import { toPublicGraph } from "./graph-snapshot";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import type {
  CreateLightTaskOptions,
  LightTaskGraph,
  PersistedLightGraph,
  SaveGraphInput,
} from "./types";

const DRAFT_GRAPH_SCOPE = "draft" as const;

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

function assertGraphInput(planId: string, input: SaveGraphInput): void {
  const validation = validateDagSnapshot({
    nodes: input.nodes,
    edges: input.edges,
  });

  if (!validation.ok) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "图结构校验失败", {
        planId,
        errors: validation.errors,
      }),
    );
  }
}

export function saveGraphUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: SaveGraphInput,
): LightTaskGraph {
  const publishEvent = resolveNotifyPublisher(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const getGraph = requireLightTaskFunction(options.graphRepository?.get, "graphRepository.get");
  const normalizedPlanId = assertPlanId(planId);
  const plan = getPlan(normalizedPlanId);
  if (!plan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法保存图快照", {
        planId: normalizedPlanId,
      }),
    );
  }
  assertGraphInput(normalizedPlanId, input);

  const storedGraph = getGraph(normalizedPlanId, DRAFT_GRAPH_SCOPE);
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;

  if (!storedGraph) {
    const createGraph = requireLightTaskFunction(
      options.graphRepository?.create,
      "graphRepository.create",
    );
    const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
    if (input.expectedRevision !== undefined) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "首次保存图快照时不应传 expectedRevision", {
          planId: normalizedPlanId,
          expectedRevision: input.expectedRevision,
        }),
      );
    }

    const created = createGraph(
      normalizedPlanId,
      createGraphSnapshot({
        nodes: input.nodes,
        edges: input.edges,
        createdAt: clockNow(),
        metadata: input.metadata,
        extensions: input.extensions,
        idempotencyKey: normalizedIdempotencyKey,
      }),
      DRAFT_GRAPH_SCOPE,
    );

    if (!created.ok) {
      throwLightTaskError(created.error);
    }

    const publicGraph = toPublicGraph(created.graph);
    publishGraphSavedEvent(publishEvent, normalizedPlanId, publicGraph);
    return publicGraph;
  }

  if (input.expectedRevision === undefined) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "更新图快照时 expectedRevision 为必填字段", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertExpectedRevision(storedGraph.revision, input.expectedRevision);
  assertNextRevision(storedGraph.revision, storedGraph.revision + 1);

  const saveIfRevisionMatches = requireLightTaskFunction(
    options.graphRepository?.saveIfRevisionMatches,
    "graphRepository.saveIfRevisionMatches",
  );
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const nextRevision = bumpRevision(storedGraph, clockNow(), normalizedIdempotencyKey);
  const nextGraph: PersistedLightGraph = {
    nodes: cloneValue(input.nodes),
    edges: cloneValue(input.edges),
    createdAt: storedGraph.createdAt,
    metadata: cloneOptional(input.metadata),
    extensions: cloneOptional(input.extensions),
    updatedAt: nextRevision.updatedAt,
    revision: nextRevision.revision,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = saveIfRevisionMatches(
    normalizedPlanId,
    nextGraph,
    storedGraph.revision,
    DRAFT_GRAPH_SCOPE,
  );

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  const publicGraph = toPublicGraph(saved.graph);
  publishGraphSavedEvent(publishEvent, normalizedPlanId, publicGraph);
  return publicGraph;
}
