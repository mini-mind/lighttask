import { readMaterializedTaskProvenance } from "./materialized-task-governance";
import { resolveTaskDesignStatus, resolveTaskExecutionStatus } from "./task-snapshot";
import type {
  ListOutputsInput,
  ListRuntimesInput,
  ListTasksInput,
  OutputRefQuery,
  PersistedLightOutput,
  PersistedLightRuntime,
  PersistedLightTask,
  RuntimeRefQuery,
} from "./types";

function matchesStatus<TStatus extends string>(
  status: TStatus,
  filter: TStatus | { in: TStatus[] } | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  if (typeof filter === "string") {
    return status === filter;
  }

  return filter.in.includes(status);
}

function matchesRef(
  candidate:
    | {
        kind: string;
        id: string;
      }
    | undefined,
  filter: RuntimeRefQuery | OutputRefQuery | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  return candidate?.kind === filter.kind && candidate.id === filter.id;
}

function matchesRuntimeRef(
  candidate:
    | {
        id: string;
      }
    | undefined,
  filter:
    | {
        id: string;
      }
    | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  return candidate?.id === filter.id;
}

export function shouldIncludeTask(task: PersistedLightTask, input: ListTasksInput = {}): boolean {
  if (input.planId && task.planId !== input.planId) {
    return false;
  }

  if (!matchesStatus(resolveTaskExecutionStatus(task), input.executionStatus)) {
    return false;
  }

  if (!matchesStatus(resolveTaskDesignStatus(task.designStatus), input.designStatus)) {
    return false;
  }

  const provenance = readMaterializedTaskProvenance(task);
  if (!input.includeOrphaned && provenance?.governance?.state === "orphaned") {
    return false;
  }

  if (!input.materializedSource) {
    return true;
  }

  if (!provenance) {
    return false;
  }

  if (
    input.materializedSource.nodeId &&
    provenance.source.nodeId !== input.materializedSource.nodeId
  ) {
    return false;
  }
  if (
    input.materializedSource.nodeTaskId &&
    provenance.source.nodeTaskId !== input.materializedSource.nodeTaskId
  ) {
    return false;
  }
  if (
    input.materializedSource.graphRevision !== undefined &&
    provenance.source.graphRevision !== input.materializedSource.graphRevision
  ) {
    return false;
  }
  if (
    input.materializedSource.governanceState &&
    provenance.governance?.state !== input.materializedSource.governanceState
  ) {
    return false;
  }

  return true;
}

export function shouldIncludeRuntime(
  runtime: PersistedLightRuntime,
  input: ListRuntimesInput = {},
): boolean {
  if (input.kind && runtime.kind !== input.kind) {
    return false;
  }

  if (!matchesStatus(runtime.status, input.status)) {
    return false;
  }

  if (!matchesRef(runtime.ownerRef, input.ownerRef)) {
    return false;
  }

  if (!matchesRef(runtime.parentRef, input.parentRef)) {
    return false;
  }

  if (input.relatedRef) {
    return (
      runtime.relatedRefs?.some((relatedRef) => matchesRef(relatedRef, input.relatedRef)) ?? false
    );
  }

  return true;
}

export function shouldIncludeOutput(
  output: PersistedLightOutput,
  input: ListOutputsInput = {},
): boolean {
  if (input.kind && output.kind !== input.kind) {
    return false;
  }

  if (!matchesStatus(output.status, input.status)) {
    return false;
  }

  if (!matchesRef(output.ownerRef, input.ownerRef)) {
    return false;
  }

  if (input.runtimeRef) {
    return matchesRuntimeRef(output.runtimeRef, input.runtimeRef);
  }

  return true;
}
