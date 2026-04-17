import { cloneValue } from "./clone";
import type { LightTaskRuntime, PersistedLightRuntime } from "./types";

export function clonePersistedRuntime(runtime: PersistedLightRuntime): PersistedLightRuntime {
  return cloneValue(runtime);
}

export function toPublicRuntime(runtime: PersistedLightRuntime): LightTaskRuntime {
  const {
    lastCreateFingerprint: _lastCreateFingerprint,
    lastAdvanceFingerprint: _lastAdvanceFingerprint,
    ...publicRuntime
  } = runtime;
  return cloneValue(publicRuntime);
}
