import { randomUUID } from "node:crypto";
import { createCoreError } from "../data-structures";
import type {
  DomainEvent,
  OutputRecord,
  PlanRecord,
  RuntimeRecord,
  StructuredEntityExtensions,
  TaskStage,
  TaskStatus,
  TaskStepStatus,
} from "../data-structures";
import type { ConsistencyPort } from "./port-consistency";
import type { NotifyPort } from "./port-notify";
import type { OutputRepository } from "./port-output-repo";
import type { PlanRepository } from "./port-plan-repo";
import type { RuntimeRepository } from "./port-runtime-repo";
import type { ClockPort, IdGeneratorPort } from "./port-system";
import type { TaskRepository } from "./port-task-repo";

type KeyedRevisionRecord = {
  id: string;
  revision: number;
};

export type InMemoryTaskStepRecord = {
  id: string;
  title: string;
  stage: TaskStage;
  status: TaskStepStatus;
};

export type InMemoryTaskRecord = KeyedRevisionRecord & {
  planId: string;
  title: string;
  summary?: string;
  status: TaskStatus;
  dependsOnTaskIds: string[];
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
  steps: InMemoryTaskStepRecord[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  lastCreateFingerprint?: string;
  lastUpdateFingerprint?: string;
  lastAdvanceFingerprint?: string;
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
      if (records.some((item) => item.id === snapshot.id)) {
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
    deleteIfRevisionMatches(recordId: string, expectedRevision: number) {
      const index = records.findIndex((item) => item.id === recordId);
      if (index === -1) {
        return {
          ok: false as const,
          error: createMissingError(config.entityName, config.entityIdLabel, recordId),
        };
      }
      if (records[index].revision !== expectedRevision) {
        return {
          ok: false as const,
          error: createRevisionConflictError(
            config.entityName,
            config.entityIdLabel,
            recordId,
            expectedRevision,
            records[index].revision,
          ),
        };
      }

      const [deleted] = records.splice(index, 1);
      return {
        ok: true as const,
        record: cloneSnapshot(deleted),
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
    deleteIfRevisionMatches(taskId, expectedRevision) {
      const deleted = repository.deleteIfRevisionMatches(taskId, expectedRevision);
      if (!deleted.ok) {
        return deleted;
      }
      return {
        ok: true as const,
        task: deleted.record,
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

export function createInMemoryRuntimeRepository<
  TRuntime extends KeyedRevisionRecord,
>(): RuntimeRepository<TRuntime> {
  const repository = createInMemoryKeyedRepository<TRuntime>({
    entityName: "运行时",
    entityIdLabel: "runtimeId",
  });

  return {
    list() {
      return repository.list();
    },
    get(runtimeId) {
      return repository.get(runtimeId);
    },
    create(runtime) {
      const created = repository.create(runtime);
      if (!created.ok) {
        return created;
      }
      return {
        ok: true as const,
        runtime: created.record,
      };
    },
    saveIfRevisionMatches(runtime, expectedRevision) {
      const saved = repository.saveIfRevisionMatches(runtime, expectedRevision);
      if (!saved.ok) {
        return saved;
      }
      return {
        ok: true as const,
        runtime: saved.record,
      };
    },
  };
}

export function createInMemoryOutputRepository<
  TOutput extends KeyedRevisionRecord,
>(): OutputRepository<TOutput> {
  const repository = createInMemoryKeyedRepository<TOutput>({
    entityName: "输出",
    entityIdLabel: "outputId",
  });

  return {
    list() {
      return repository.list();
    },
    get(outputId) {
      return repository.get(outputId);
    },
    create(output) {
      const created = repository.create(output);
      if (!created.ok) {
        return created;
      }
      return {
        ok: true as const,
        output: created.record,
      };
    },
    saveIfRevisionMatches(output, expectedRevision) {
      const saved = repository.saveIfRevisionMatches(output, expectedRevision);
      if (!saved.ok) {
        return saved;
      }
      return {
        ok: true as const,
        output: saved.record,
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
    nextTaskId() {
      return `task_${randomUUID()}`;
    },
  };
}

export function createNoopConsistencyPort(): ConsistencyPort {
  return {
    run(_scope, work) {
      return work();
    },
  };
}

export interface InMemoryNotifyCollector<TEvent extends DomainEvent = DomainEvent>
  extends NotifyPort<TEvent> {
  listPublished(): TEvent[];
  clear(): void;
}

export function createInMemoryNotifyCollector<
  TEvent extends DomainEvent = DomainEvent,
>(): InMemoryNotifyCollector<TEvent> {
  const publishedEvents: TEvent[] = [];

  return {
    publish(event) {
      publishedEvents.push(cloneSnapshot(event));
    },
    listPublished() {
      return publishedEvents.map((event) => cloneSnapshot(event));
    },
    clear() {
      publishedEvents.length = 0;
    },
  };
}

export interface InMemoryLightTaskPortsOptions<TTaskLifecycle = never> {
  taskRepository?: TaskRepository<InMemoryTaskRecord>;
  planRepository?: PlanRepository<PlanRecord>;
  runtimeRepository?: RuntimeRepository<RuntimeRecord>;
  outputRepository?: OutputRepository<OutputRecord>;
  taskLifecycle?: TTaskLifecycle;
  notify?: NotifyPort<DomainEvent>;
  consistency?: ConsistencyPort;
  clock?: ClockPort;
  idGenerator?: IdGeneratorPort;
}

export interface InMemoryLightTaskPorts<TTaskLifecycle = never> {
  taskRepository: TaskRepository<InMemoryTaskRecord>;
  planRepository: PlanRepository<PlanRecord>;
  runtimeRepository: RuntimeRepository<RuntimeRecord>;
  outputRepository: OutputRepository<OutputRecord>;
  taskLifecycle?: TTaskLifecycle;
  notify: NotifyPort<DomainEvent>;
  consistency: ConsistencyPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
}

export function createInMemoryLightTaskPorts<TTaskLifecycle = never>(
  overrides: InMemoryLightTaskPortsOptions<TTaskLifecycle> = {},
): InMemoryLightTaskPorts<TTaskLifecycle> {
  return {
    taskRepository: overrides.taskRepository ?? createInMemoryTaskRepository<InMemoryTaskRecord>(),
    planRepository: overrides.planRepository ?? createInMemoryPlanRepository<PlanRecord>(),
    runtimeRepository:
      overrides.runtimeRepository ?? createInMemoryRuntimeRepository<RuntimeRecord>(),
    outputRepository: overrides.outputRepository ?? createInMemoryOutputRepository<OutputRecord>(),
    taskLifecycle: overrides.taskLifecycle,
    notify: overrides.notify ?? createInMemoryNotifyCollector(),
    consistency: overrides.consistency ?? createNoopConsistencyPort(),
    clock: overrides.clock ?? createSystemClock(),
    idGenerator: overrides.idGenerator ?? createTaskIdGenerator(),
  };
}
