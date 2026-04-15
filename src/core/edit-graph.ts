import { bumpRevision } from "../data-structures";
import {
  applyGraphEditOperations,
  assertExpectedRevision,
  assertNextRevision,
  normalizeGraphEditOperations,
  validateDagSnapshot,
} from "../rules";
import { toPublicGraph } from "./graph-snapshot";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishGraphSavedEvent, resolveNotifyPublisher } from "./notify-event";
import type {
  CreateLightTaskOptions,
  EditGraphInput,
  LightTaskGraph,
  PersistedLightGraph,
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

function assertEditedGraph(planId: string, graph: PersistedLightGraph): void {
  const validation = validateDagSnapshot({
    nodes: graph.nodes,
    edges: graph.edges,
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

export function editGraphUseCase(
  options: CreateLightTaskOptions,
  planId: string,
  input: EditGraphInput,
): LightTaskGraph {
  const publishEvent = resolveNotifyPublisher(options);
  const getPlan = requireLightTaskFunction(options.planRepository?.get, "planRepository.get");
  const getGraph = requireLightTaskFunction(options.graphRepository?.get, "graphRepository.get");
  const normalizedPlanId = assertPlanId(planId);
  const plan = getPlan(normalizedPlanId);

  if (!plan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法编辑图快照", {
        planId: normalizedPlanId,
      }),
    );
  }

  const storedGraph = getGraph(normalizedPlanId, DRAFT_GRAPH_SCOPE);
  if (!storedGraph) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到图草稿，无法编辑图快照", {
        planId: normalizedPlanId,
      }),
    );
  }

  assertExpectedRevision(storedGraph.revision, input.expectedRevision);
  assertNextRevision(storedGraph.revision, storedGraph.revision + 1);

  const normalizedOperations = normalizeGraphEditOperations(input.operations);
  const edited = applyGraphEditOperations(storedGraph, normalizedOperations);
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const nextRevision = bumpRevision(storedGraph, clockNow(), normalizedIdempotencyKey);
  const nextGraph: PersistedLightGraph = {
    ...edited,
    createdAt: storedGraph.createdAt,
    metadata: structuredClone(storedGraph.metadata),
    extensions: structuredClone(storedGraph.extensions),
    updatedAt: nextRevision.updatedAt,
    revision: nextRevision.revision,
    idempotencyKey: nextRevision.idempotencyKey,
  };

  // 增量编辑先在规则层顺序应用补丁，再统一对结果草稿做一次 DAG 校验。
  assertEditedGraph(normalizedPlanId, nextGraph);

  const saveIfRevisionMatches = requireLightTaskFunction(
    options.graphRepository?.saveIfRevisionMatches,
    "graphRepository.saveIfRevisionMatches",
  );
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
