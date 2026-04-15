import { cloneValue } from "./clone";
import type { LightTaskOutput, PersistedLightOutput } from "./types";

export function clonePersistedOutput(output: PersistedLightOutput): PersistedLightOutput {
  return cloneValue(output);
}

export function toPublicOutput(output: PersistedLightOutput): LightTaskOutput {
  return clonePersistedOutput(output);
}
