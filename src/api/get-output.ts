import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { toPublicOutput } from "./output-snapshot";
import type { CreateLightTaskOptions, LightTaskOutput } from "./types";

export function getOutputUseCase(
  options: CreateLightTaskOptions,
  outputId: string,
): LightTaskOutput | undefined {
  const getOutput = requireLightTaskFunction(options.outputRepository?.get, "outputRepository.get");
  const normalizedOutputId = outputId.trim();

  if (!normalizedOutputId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 ID 不能为空", {
        outputId,
      }),
    );
  }

  const output = getOutput(normalizedOutputId);
  return output ? toPublicOutput(output) : undefined;
}
