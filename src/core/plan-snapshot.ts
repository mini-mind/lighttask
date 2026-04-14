import { cloneValue } from "./clone";
import type { LightTaskPlan, PersistedLightPlan } from "./types";

export function clonePersistedPlan(plan: PersistedLightPlan): PersistedLightPlan {
  return cloneValue(plan);
}

export function toPublicPlan(plan: PersistedLightPlan): LightTaskPlan {
  // 计划当前没有内部专属字段，但依然统一走快照转换，后续扩展时不用改 API 层调用方。
  return clonePersistedPlan(plan);
}
