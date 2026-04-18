import { requireLightTaskFunction } from "./lighttask-error";
import { shouldIncludeRuntime } from "./query-filters";
import { toPublicRuntime } from "./runtime-snapshot";
import type { CreateLightTaskOptions, LightTaskRuntime, ListRuntimesInput } from "./types";

export function listRuntimesUseCase(
  options: CreateLightTaskOptions,
  input: ListRuntimesInput = {},
): LightTaskRuntime[] {
  const listRuntimes = requireLightTaskFunction(
    options.runtimeRepository?.list,
    "runtimeRepository.list",
  );
  return listRuntimes()
    .filter((runtime) => shouldIncludeRuntime(runtime, input))
    .map((runtime) => toPublicRuntime(runtime));
}
