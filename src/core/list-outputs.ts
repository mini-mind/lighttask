import { requireLightTaskFunction } from "./lighttask-error";
import { toPublicOutput } from "./output-snapshot";
import type { CreateLightTaskOptions, LightTaskOutput } from "./types";

export function listOutputsUseCase(options: CreateLightTaskOptions): LightTaskOutput[] {
  const listOutputs = requireLightTaskFunction(
    options.outputRepository?.list,
    "outputRepository.list",
  );
  return listOutputs().map((output) => toPublicOutput(output));
}
