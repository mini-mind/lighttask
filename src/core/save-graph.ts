import { bumpRevision, createGraphSnapshot } from "../data-structures";
import { assertExpectedRevision, assertNextRevision, validateDagSnapshot } from "../rules";
import { cloneValue } from "./clone";
import { toPublicGraph } from "./graph-snapshot";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type {
  CreateLightTaskOptions,
  LightTaskGraph,
  PersistedLightGraph,
  SaveGraphInput,
} from "./types";

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
  const normalizedPlanId = assertPlanId(planId);
  const plan = options.planRepository.get(normalizedPlanId);
  if (!plan) {
    throwLightTaskError(
      createLightTaskError("NOT_FOUND", "未找到计划，无法保存图快照", {
        planId: normalizedPlanId,
      }),
    );
  }
  assertGraphInput(normalizedPlanId, input);

  const storedGraph = options.graphRepository.get(normalizedPlanId);
  const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;

  if (!storedGraph) {
    if (input.expectedRevision !== undefined) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "首次保存图快照时不应传 expectedRevision", {
          planId: normalizedPlanId,
          expectedRevision: input.expectedRevision,
        }),
      );
    }

    const created = options.graphRepository.create(
      normalizedPlanId,
      createGraphSnapshot({
        nodes: input.nodes,
        edges: input.edges,
        createdAt: options.clock.now(),
        idempotencyKey: normalizedIdempotencyKey,
      }),
    );

    if (!created.ok) {
      throwLightTaskError(created.error);
    }

    return toPublicGraph(created.graph);
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

  const nextRevision = bumpRevision(storedGraph, options.clock.now(), normalizedIdempotencyKey);
  const nextGraph: PersistedLightGraph = {
    nodes: cloneValue(input.nodes),
    edges: cloneValue(input.edges),
    createdAt: storedGraph.createdAt,
    updatedAt: nextRevision.updatedAt,
    revision: nextRevision.revision,
    idempotencyKey: nextRevision.idempotencyKey,
  };
  const saved = options.graphRepository.saveIfRevisionMatches(
    normalizedPlanId,
    nextGraph,
    storedGraph.revision,
  );

  if (!saved.ok) {
    throwLightTaskError(saved.error);
  }

  return toPublicGraph(saved.graph);
}
