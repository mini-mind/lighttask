import { cloneValue } from "./clone";
import type { LightTaskGraph, PersistedLightGraph } from "./types";

export function clonePersistedGraph(graph: PersistedLightGraph): PersistedLightGraph {
  return cloneValue(graph);
}

export function toPublicGraph(graph: PersistedLightGraph): LightTaskGraph {
  // 图快照对外只暴露稳定结构，不把仓储内引用直接泄漏出去。
  return clonePersistedGraph(graph);
}
