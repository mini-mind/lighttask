import type {
  MaterializedPlanTaskGovernance,
  MaterializedPlanTaskProvenance,
  PersistedLightTask,
} from "./types";

const PUBLISHED_GRAPH_SCOPE = "published" as const;
export const MATERIALIZED_TASK_NAMESPACE = "lighttask";
const MATERIALIZED_TASK_KIND = "materialized_plan_task" as const;

function readMaterializedTaskGovernance(
  governance: unknown,
): MaterializedPlanTaskGovernance | undefined {
  if (typeof governance !== "object" || governance === null) {
    return undefined;
  }

  const candidate = governance as Partial<MaterializedPlanTaskGovernance>;

  if (candidate.state === "active") {
    if (candidate.orphanedAtGraphRevision !== undefined) {
      return undefined;
    }

    return {
      state: "active",
    };
  }

  const orphanedAtGraphRevision = candidate.orphanedAtGraphRevision;
  if (
    candidate.state === "orphaned" &&
    typeof orphanedAtGraphRevision === "number" &&
    Number.isInteger(orphanedAtGraphRevision) &&
    orphanedAtGraphRevision >= 1
  ) {
    return {
      state: "orphaned",
      orphanedAtGraphRevision,
    };
  }

  return undefined;
}

export function createActiveMaterializedTaskProvenance(
  graphRevision: number,
  nodeId: string,
  nodeTaskId: string,
): MaterializedPlanTaskProvenance {
  return {
    kind: MATERIALIZED_TASK_KIND,
    source: {
      graphScope: PUBLISHED_GRAPH_SCOPE,
      graphRevision,
      nodeId,
      nodeTaskId,
    },
    governance: {
      state: "active",
    },
  };
}

export function createOrphanedMaterializedTaskProvenance(
  provenance: MaterializedPlanTaskProvenance,
  orphanedAtGraphRevision: number,
): MaterializedPlanTaskProvenance {
  if (provenance.governance?.state === "orphaned") {
    return provenance;
  }

  return {
    kind: MATERIALIZED_TASK_KIND,
    source: {
      ...provenance.source,
    },
    governance: {
      state: "orphaned",
      orphanedAtGraphRevision,
    },
  };
}

export function readMaterializedTaskProvenance(
  task: PersistedLightTask,
): MaterializedPlanTaskProvenance | undefined {
  const namespaceValue = task.extensions?.namespaces?.[MATERIALIZED_TASK_NAMESPACE];
  if (typeof namespaceValue !== "object" || namespaceValue === null) {
    return undefined;
  }

  const candidate = namespaceValue as Partial<MaterializedPlanTaskProvenance>;
  if (candidate.kind !== MATERIALIZED_TASK_KIND) {
    return undefined;
  }

  const source = candidate.source;
  if (
    typeof source !== "object" ||
    source === null ||
    source.graphScope !== PUBLISHED_GRAPH_SCOPE ||
    !Number.isInteger(source.graphRevision) ||
    typeof source.nodeId !== "string" ||
    typeof source.nodeTaskId !== "string"
  ) {
    return undefined;
  }

  const governance = readMaterializedTaskGovernance(candidate.governance);
  if (!governance) {
    return undefined;
  }

  return {
    kind: MATERIALIZED_TASK_KIND,
    source: {
      graphScope: PUBLISHED_GRAPH_SCOPE,
      graphRevision: source.graphRevision,
      nodeId: source.nodeId,
      nodeTaskId: source.nodeTaskId,
    },
    governance,
  };
}
