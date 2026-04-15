import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { toPublicRuntime } from "./runtime-snapshot";
import type { CreateLightTaskOptions, LightTaskRuntime } from "./types";

export function getRuntimeUseCase(
  options: CreateLightTaskOptions,
  runtimeId: string,
): LightTaskRuntime | undefined {
  const getRuntime = requireLightTaskFunction(
    options.runtimeRepository?.get,
    "runtimeRepository.get",
  );
  const normalizedRuntimeId = runtimeId.trim();

  if (!normalizedRuntimeId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ID 不能为空", {
        runtimeId,
      }),
    );
  }

  const runtime = getRuntime(normalizedRuntimeId);
  return runtime ? toPublicRuntime(runtime) : undefined;
}
