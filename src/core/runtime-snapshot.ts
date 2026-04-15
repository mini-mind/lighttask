import { cloneValue } from "./clone";
import type { LightTaskRuntime, PersistedLightRuntime } from "./types";

export function clonePersistedRuntime(runtime: PersistedLightRuntime): PersistedLightRuntime {
  return cloneValue(runtime);
}

export function toPublicRuntime(runtime: PersistedLightRuntime): LightTaskRuntime {
  return clonePersistedRuntime(runtime);
}
