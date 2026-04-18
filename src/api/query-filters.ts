import type {
  ListOutputsInput,
  ListRuntimesInput,
  ListTasksInput,
  PersistedLightOutput,
  PersistedLightRuntime,
  PersistedLightTask,
} from "./types";

function matchesStatus<TStatus extends string>(
  actual: TStatus,
  expected: TStatus | { in: TStatus[] } | undefined,
): boolean {
  if (expected === undefined) {
    return true;
  }
  if (typeof expected === "string") {
    return actual === expected;
  }
  return expected.in.includes(actual);
}

export function shouldIncludeTask(task: PersistedLightTask, input: ListTasksInput): boolean {
  if (input.planId !== undefined && task.planId !== input.planId.trim()) {
    return false;
  }
  return matchesStatus(task.status, input.status);
}

export function shouldIncludeRuntime(
  runtime: PersistedLightRuntime,
  input: ListRuntimesInput,
): boolean {
  if (input.kind !== undefined && runtime.kind !== input.kind.trim()) {
    return false;
  }
  if (!matchesStatus(runtime.status, input.status)) {
    return false;
  }
  if (
    input.ownerRef &&
    (runtime.ownerRef?.kind !== input.ownerRef.kind || runtime.ownerRef?.id !== input.ownerRef.id)
  ) {
    return false;
  }
  if (
    input.parentRef &&
    (runtime.parentRef?.kind !== input.parentRef.kind ||
      runtime.parentRef?.id !== input.parentRef.id)
  ) {
    return false;
  }
  if (
    input.relatedRef &&
    !(runtime.relatedRefs ?? []).some(
      (relatedRef) =>
        relatedRef.kind === input.relatedRef?.kind && relatedRef.id === input.relatedRef?.id,
    )
  ) {
    return false;
  }
  return true;
}

export function shouldIncludeOutput(
  output: PersistedLightOutput,
  input: ListOutputsInput,
): boolean {
  if (input.kind !== undefined && output.kind !== input.kind.trim()) {
    return false;
  }
  if (!matchesStatus(output.status, input.status)) {
    return false;
  }
  if (input.runtimeRef && output.runtimeRef?.id !== input.runtimeRef.id) {
    return false;
  }
  if (
    input.ownerRef &&
    (output.ownerRef?.kind !== input.ownerRef.kind || output.ownerRef?.id !== input.ownerRef.id)
  ) {
    return false;
  }
  return true;
}
