import type {
  DomainEvent,
  DomainEventType,
  OutputItemRecord,
  OutputItemStatus,
  OutputLifecycleStatus,
  OutputOwnerRef,
  OutputRuntimeRef,
  RuntimeLifecycleStatus,
  RuntimeOwnerRef,
  RuntimeParentRef,
  RuntimeRelatedRef,
  StructuredEntityExtensions,
  TaskStage,
  TaskStatus,
  TaskStepStatus,
} from "../data-structures";
import type {
  ClockPort,
  ConsistencyPort,
  IdGeneratorPort,
  NotifyPort,
  OutputRepository,
  PlanRepository,
  RuntimeRepository,
  TaskRepository,
} from "../ports";
import type { RuntimeAction, RuntimeLifecyclePolicy, TaskAction } from "../rules";

export interface LightTaskStep {
  id: string;
  title: string;
  stage: TaskStage;
  status: TaskStepStatus;
}

export interface TaskStepDefinitionInput {
  id: string;
  title: string;
  stage: TaskStage;
}

export interface LightTaskTask {
  id: string;
  planId: string;
  title: string;
  summary?: string;
  status: TaskStatus;
  dependsOnTaskIds: string[];
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  steps: LightTaskStep[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface LightTaskPlan {
  id: string;
  title: string;
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface LightTaskRuntime {
  id: string;
  kind: string;
  title: string;
  status: RuntimeLifecycleStatus;
  revision: number;
  parentRef?: RuntimeParentRef;
  ownerRef?: RuntimeOwnerRef;
  relatedRefs?: RuntimeRelatedRef[];
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export interface LightTaskOutput {
  id: string;
  kind: string;
  status: OutputLifecycleStatus;
  revision: number;
  runtimeRef?: OutputRuntimeRef;
  ownerRef?: OutputOwnerRef;
  payload?: Record<string, unknown>;
  items?: LightTaskOutputItem[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export type LightTaskOutputItem = OutputItemRecord;
export interface LightTaskOutputItemInput extends Omit<OutputItemRecord, "status"> {
  status?: OutputItemStatus;
}
export type LightTaskOutputItemStatus = OutputItemStatus;

export interface PersistedLightTask extends LightTaskTask {
  lastCreateFingerprint?: string;
  lastUpdateFingerprint?: string;
  lastAdvanceFingerprint?: string;
}

export interface PersistedLightPlan extends LightTaskPlan {
  lastCreateFingerprint?: string;
  lastUpdateFingerprint?: string;
  deleteTaskReplayByIdempotencyKey?: Record<
    string,
    {
      fingerprint: string;
      result: DeleteTaskResult;
    }
  >;
}

export interface PersistedLightRuntime extends LightTaskRuntime {
  lastCreateFingerprint?: string;
  lastAdvanceFingerprint?: string;
}

export interface PersistedLightOutput extends LightTaskOutput {
  lastCreateFingerprint?: string;
  lastAdvanceFingerprint?: string;
}

export interface CreateTaskInput {
  planId: string;
  title: string;
  status?: "draft";
  summary?: string;
  dependsOnTaskIds?: string[];
  steps?: TaskStepDefinitionInput[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export interface CreatePlanInput {
  id: string;
  title: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export interface CreateRuntimeInput {
  id: string;
  kind: string;
  title: string;
  parentRef?: RuntimeParentRef;
  ownerRef?: RuntimeOwnerRef;
  relatedRefs?: RuntimeRelatedRef[];
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export interface CreateOutputInput {
  id: string;
  kind: string;
  runtimeRef?: OutputRuntimeRef;
  ownerRef?: OutputOwnerRef;
  payload?: Record<string, unknown>;
  items?: LightTaskOutputItemInput[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export interface AdvanceTaskInput {
  action: TaskAction;
  expectedRevision: number;
  idempotencyKey?: string;
}

export interface UpdateTaskInput {
  expectedRevision: number;
  title?: string;
  summary?: string | null;
  dependsOnTaskIds?: string[];
  steps?: TaskStepDefinitionInput[] | null;
  metadata?: Record<string, unknown> | null;
  extensions?: StructuredEntityExtensions | null;
  idempotencyKey?: string;
}

export interface DeleteTaskInput {
  expectedRevision: number;
  idempotencyKey?: string;
}

export interface DeleteTaskResult {
  taskId: string;
  planId: string;
  detachedFromTaskIds: string[];
}

export interface AdvanceRuntimeInput {
  action?: RuntimeAction;
  expectedRevision: number;
  result?: Record<string, unknown> | null;
  idempotencyKey?: string;
}

export interface AdvanceOutputInput {
  expectedRevision: number;
  status?: OutputLifecycleStatus;
  payload?: Record<string, unknown> | null;
  items?: LightTaskOutputItemInput[] | null;
  idempotencyKey?: string;
}

export interface UpdatePlanInput {
  expectedRevision: number;
  title?: string;
  metadata?: Record<string, unknown> | null;
  extensions?: StructuredEntityExtensions | null;
  idempotencyKey?: string;
}

export interface TaskStatusQuery {
  in: TaskStatus[];
}

export interface ListTasksInput {
  planId?: string;
  status?: TaskStatus | TaskStatusQuery;
}

export interface RuntimeStatusQuery {
  in: RuntimeLifecycleStatus[];
}

export interface RuntimeRefQuery {
  kind: string;
  id: string;
}

export interface ListRuntimesInput {
  kind?: string;
  status?: RuntimeLifecycleStatus | RuntimeStatusQuery;
  ownerRef?: RuntimeRefQuery;
  parentRef?: RuntimeRefQuery;
  relatedRef?: RuntimeRefQuery;
}

export interface OutputStatusQuery {
  in: OutputLifecycleStatus[];
}

export interface OutputRefQuery {
  kind: string;
  id: string;
}

export interface ListOutputsInput {
  kind?: string;
  status?: OutputLifecycleStatus | OutputStatusQuery;
  runtimeRef?: OutputRuntimeRef;
  ownerRef?: OutputRefQuery;
}

export type PlanSchedulingBlockReasonCode =
  | "self_draft"
  | "dependency_in_draft"
  | "dependency_not_done"
  | "dependency_failed"
  | "dependency_cancelled"
  | "dependency_missing";

export type PlanSchedulingRiskReasonCode = "upstream_returned_to_draft";

export interface PlanSchedulingTaskFacts {
  taskId: string;
  status: TaskStatus;
  isDraft: boolean;
  isRunnable: boolean;
  isBlocked: boolean;
  isActive: boolean;
  isTerminal: boolean;
  isRisky: boolean;
  blockReasonCodes: PlanSchedulingBlockReasonCode[];
  riskReasonCodes: PlanSchedulingRiskReasonCode[];
  dependencyTaskIds: string[];
  downstreamTaskIds: string[];
  unmetDependencyTaskIds: string[];
  missingDependencyTaskIds: string[];
  riskyDependencyTaskIds: string[];
}

export interface GetPlanSchedulingFactsResult {
  planId: string;
  draftTaskIds: string[];
  runnableTaskIds: string[];
  blockedTaskIds: string[];
  activeTaskIds: string[];
  terminalTaskIds: string[];
  riskTaskIds: string[];
  byTaskId: Record<string, PlanSchedulingTaskFacts>;
}

export type LightTaskDomainEventType = DomainEventType;

export type TaskCreatedEvent = DomainEvent<"task.created", { task: LightTaskTask }>;
export type TaskUpdatedEvent = DomainEvent<"task.updated", { task: LightTaskTask }>;
export type TaskAdvancedEvent = DomainEvent<"task.advanced", { task: LightTaskTask }>;
export type TaskDeletedEvent = DomainEvent<"task.deleted", { result: DeleteTaskResult }>;
export type PlanCreatedEvent = DomainEvent<"plan.created", { plan: LightTaskPlan }>;
export type PlanUpdatedEvent = DomainEvent<"plan.updated", { plan: LightTaskPlan }>;
export type RuntimeCreatedEvent = DomainEvent<"runtime.created", { runtime: LightTaskRuntime }>;
export type RuntimeAdvancedEvent = DomainEvent<"runtime.advanced", { runtime: LightTaskRuntime }>;
export type OutputCreatedEvent = DomainEvent<"output.created", { output: LightTaskOutput }>;
export type OutputAdvancedEvent = DomainEvent<"output.advanced", { output: LightTaskOutput }>;

export type LightTaskDomainEvent =
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskAdvancedEvent
  | TaskDeletedEvent
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | RuntimeCreatedEvent
  | RuntimeAdvancedEvent
  | OutputCreatedEvent
  | OutputAdvancedEvent;

type LazyValidatedPort<TPort> = {
  [K in keyof TPort]?: TPort[K];
};

export interface CreateLightTaskOptions {
  taskRepository: LazyValidatedPort<TaskRepository<PersistedLightTask>>;
  planRepository: LazyValidatedPort<PlanRepository<PersistedLightPlan>>;
  runtimeRepository?: LazyValidatedPort<RuntimeRepository<PersistedLightRuntime>>;
  outputRepository?: LazyValidatedPort<OutputRepository<PersistedLightOutput>>;
  notify?: LazyValidatedPort<NotifyPort<LightTaskDomainEvent>>;
  consistency?: LazyValidatedPort<ConsistencyPort>;
  clock: LazyValidatedPort<ClockPort>;
  idGenerator: LazyValidatedPort<IdGeneratorPort>;
  runtimeLifecycle?: RuntimeLifecyclePolicy;
}

export interface LightTaskKernel {
  createTask(input: CreateTaskInput): LightTaskTask;
  listTasks(input?: ListTasksInput): LightTaskTask[];
  listTasksByPlan(planId: string, input?: Omit<ListTasksInput, "planId">): LightTaskTask[];
  getTask(taskId: string): LightTaskTask | undefined;
  updateTask(taskId: string, input: UpdateTaskInput): LightTaskTask;
  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask;
  deleteTask(taskId: string, input: DeleteTaskInput): DeleteTaskResult;
  createPlan(input: CreatePlanInput): LightTaskPlan;
  listPlans(): LightTaskPlan[];
  getPlan(planId: string): LightTaskPlan | undefined;
  updatePlan(planId: string, input: UpdatePlanInput): LightTaskPlan;
  createRuntime(input: CreateRuntimeInput): LightTaskRuntime;
  listRuntimes(input?: ListRuntimesInput): LightTaskRuntime[];
  getRuntime(runtimeId: string): LightTaskRuntime | undefined;
  advanceRuntime(runtimeId: string, input: AdvanceRuntimeInput): LightTaskRuntime;
  createOutput(input: CreateOutputInput): LightTaskOutput;
  listOutputs(input?: ListOutputsInput): LightTaskOutput[];
  getOutput(outputId: string): LightTaskOutput | undefined;
  advanceOutput(outputId: string, input: AdvanceOutputInput): LightTaskOutput;
  getPlanSchedulingFacts(planId: string): GetPlanSchedulingFactsResult;
}
