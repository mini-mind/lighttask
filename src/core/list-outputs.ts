import { requireLightTaskFunction } from "./lighttask-error";
import { toPublicOutput } from "./output-snapshot";
import { shouldIncludeOutput } from "./query-filters";
import type { CreateLightTaskOptions, LightTaskOutput, ListOutputsInput } from "./types";

export function listOutputsUseCase(
  options: CreateLightTaskOptions,
  input: ListOutputsInput = {},
): LightTaskOutput[] {
  const listOutputs = requireLightTaskFunction(
    options.outputRepository?.list,
    "outputRepository.list",
  );
  return listOutputs()
    .filter((output) => shouldIncludeOutput(output, input))
    .map((output) => toPublicOutput(output));
}
