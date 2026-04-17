import { cloneValue } from "./clone";
import type { LightTaskPlan, PersistedLightPlan } from "./types";

export function clonePersistedPlan(plan: PersistedLightPlan): PersistedLightPlan {
  return cloneValue(plan);
}

export function toPublicPlan(plan: PersistedLightPlan): LightTaskPlan {
  const {
    lastCreateFingerprint: _lastCreateFingerprint,
    lastUpdateFingerprint: _lastUpdateFingerprint,
    deleteTaskReplayByIdempotencyKey: _deleteTaskReplayByIdempotencyKey,
    ...publicPlan
  } = plan;
  return cloneValue(publicPlan);
}
