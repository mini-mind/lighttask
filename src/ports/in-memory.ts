import { randomUUID } from "node:crypto";
import { createCoreError } from "../data-structures";
import type { GraphRepository } from "./port-graph-repo";
import type { PlanRepository } from "./port-plan-repo";
import type { ClockPort, IdGeneratorPort } from "./port-system";
import type { TaskRepository } from "./port-task-repo";

type KeyedRevisionRecord = {
  id: string;
  revision: number;
};

type RevisionRecord = {
  revision: number;
};

function cloneSnapshot<TRecord>(record: TRecord): TRecord {
  return structuredClone(record);
}

function createDuplicateIdError(entityName: string, entityIdLabel: string, entityId: string) {
  return createCoreError("STATE_CONFLICT", `${entityName} ID 已存在，禁止覆盖已有记录`, {
    [entityIdLabel]: entityId,
  });
}

function createMissingError(entityName: string, entityIdLabel: string, entityId: string) {
  return createCoreError("NOT_FOUND", `${entityName}不存在，无法保存变更`, {
    [entityIdLabel]: entityId,
  });
}

function createRevisionConflictError(
  entityName: string,
  entityIdLabel: string,
  entityId: string,
  expectedRevision: number,
  actualRevision: number,
) {
  return createCoreError("REVISION_CONFLICT", `${entityName} revision 冲突，保存被拒绝`, {
    [entityIdLabel]: entityId,
    expectedRevision,
    actualRevision,
  });
}

function createInMemoryKeyedRepository<TRecord extends KeyedRevisionRecord>(config: {
  entityName: string;
  entityIdLabel: string;
}) {
  const records: TRecord[] = [];

  return {
    list() {
      return records.map((record) => cloneSnapshot(record));
    },
    get(recordId: string) {
      const record = records.find((item) => item.id === recordId);
      return record ? cloneSnapshot(record) : undefined;
    },
    create(record: TRecord) {
      const snapshot = cloneSnapshot(record);
      const existed = records.some((item) => item.id === snapshot.id);

      if (existed) {
        return {
          ok: false as const,
          error: createDuplicateIdError(config.entityName, config.entityIdLabel, snapshot.id),
        };
      }

      records.push(snapshot);
      return {
        ok: true as const,
        record: cloneSnapshot(snapshot),
      };
    },
    saveIfRevisionMatches(record: TRecord, expectedRevision: number) {
      const snapshot = cloneSnapshot(record);
      const index = records.findIndex((item) => item.id === snapshot.id);

      if (index === -1) {
        return {
          ok: false as const,
          error: createMissingError(config.entityName, config.entityIdLabel, snapshot.id),
        };
      }

      if (records[index].revision !== expectedRevision) {
        return {
          ok: false as const,
          error: createRevisionConflictError(
            config.entityName,
            config.entityIdLabel,
            snapshot.id,
            expectedRevision,
            records[index].revision,
          ),
        };
      }

      records[index] = snapshot;
      return {
        ok: true as const,
        record: cloneSnapshot(snapshot),
      };
    },
  };
}

export function createInMemoryTaskRepository<
  TTask extends KeyedRevisionRecord,
>(): TaskRepository<TTask> {
  const repository = createInMemoryKeyedRepository<TTask>({
    entityName: "任务",
    entityIdLabel: "taskId",
  });

  return {
    list() {
      return repository.list();
    },
    get(taskId) {
      return repository.get(taskId);
    },
    create(task) {
      const created = repository.create(task);
      if (!created.ok) {
        return created;
      }

      return {
        ok: true as const,
        task: created.record,
      };
    },
    saveIfRevisionMatches(task, expectedRevision) {
      const saved = repository.saveIfRevisionMatches(task, expectedRevision);
      if (!saved.ok) {
        return saved;
      }

      return {
        ok: true as const,
        task: saved.record,
      };
    },
  };
}

export function createInMemoryPlanRepository<
  TPlan extends KeyedRevisionRecord,
>(): PlanRepository<TPlan> {
  const repository = createInMemoryKeyedRepository<TPlan>({
    entityName: "计划",
    entityIdLabel: "planId",
  });

  return {
    list() {
      return repository.list();
    },
    get(planId) {
      return repository.get(planId);
    },
    create(plan) {
      const created = repository.create(plan);
      if (!created.ok) {
        return created;
      }

      return {
        ok: true as const,
        plan: created.record,
      };
    },
    saveIfRevisionMatches(plan, expectedRevision) {
      const saved = repository.saveIfRevisionMatches(plan, expectedRevision);
      if (!saved.ok) {
        return saved;
      }

      return {
        ok: true as const,
        plan: saved.record,
      };
    },
  };
}

export function createInMemoryGraphRepository<
  TGraph extends RevisionRecord,
>(): GraphRepository<TGraph> {
  const graphs = new Map<string, TGraph>();

  return {
    get(planId) {
      const graph = graphs.get(planId);
      return graph ? cloneSnapshot(graph) : undefined;
    },
    create(planId, graph) {
      const snapshot = cloneSnapshot(graph);

      if (graphs.has(planId)) {
        return {
          ok: false as const,
          error: createDuplicateIdError("计划图", "planId", planId),
        };
      }

      graphs.set(planId, snapshot);
      return {
        ok: true as const,
        graph: cloneSnapshot(snapshot),
      };
    },
    saveIfRevisionMatches(planId, graph, expectedRevision) {
      const snapshot = cloneSnapshot(graph);
      const current = graphs.get(planId);

      if (!current) {
        return {
          ok: false as const,
          error: createMissingError("计划图", "planId", planId),
        };
      }

      if (current.revision !== expectedRevision) {
        return {
          ok: false as const,
          error: createRevisionConflictError(
            "计划图",
            "planId",
            planId,
            expectedRevision,
            current.revision,
          ),
        };
      }

      graphs.set(planId, snapshot);
      return {
        ok: true as const,
        graph: cloneSnapshot(snapshot),
      };
    },
  };
}

export function createSystemClock(): ClockPort {
  return {
    now() {
      return new Date().toISOString();
    },
  };
}

export function createTaskIdGenerator(): IdGeneratorPort {
  return {
    // CLI 与测试只需要稳定可用的本地 ID 生成器，因此实现放在 ports 层供组合侧复用。
    nextTaskId() {
      return `task_${randomUUID()}`;
    },
  };
}
