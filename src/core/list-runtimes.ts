import { requireLightTaskFunction } from "./lighttask-error";
import { toPublicRuntime } from "./runtime-snapshot";
import type { CreateLightTaskOptions, LightTaskRuntime } from "./types";

export function listRuntimesUseCase(options: CreateLightTaskOptions): LightTaskRuntime[] {
  const listRuntimes = requireLightTaskFunction(
    options.runtimeRepository?.list,
    "runtimeRepository.list",
  );
  return listRuntimes().map((runtime) => toPublicRuntime(runtime));
}
