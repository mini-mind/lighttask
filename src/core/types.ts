import type {
  DomainEvent,
  DomainEventType,
  GraphEdgeRecord,
  GraphNodeRecord,
  OutputItemRecord,
  OutputItemStatus,
  OutputLifecycleStatus,
  OutputOwnerRef,
  OutputRuntimeRef,
  PlanLifecycleStatus,
  RuntimeLifecycleStatus,
  RuntimeOwnerRef,
  RuntimeParentRef,
  RuntimeRelatedRef,
  StructuredEntityExtensions,
} from "../data-structures";
import type {
  ClockPort,
  ConsistencyPort,
  GraphRepository,
  IdGeneratorPort,
  NotifyPort,
  OutputRepository,
  PlanRepository,
  RuntimeRepository,
  TaskRepository,
} from "../ports";
import type {
  GraphEditOperation,
  PlanAction,
  PlanLifecyclePolicy,
  RuntimeAction,
  RuntimeLifecyclePolicy,
  TaskAction,
  TaskLifecyclePolicy,
  TaskLifecycleStatus,
} from "../rules";

export type TaskStage = "investigate" | "design" | "implement" | "verify" | "converge";

export type StepStatus = "todo" | "doing" | "done";

export type TaskDesignStatus = import("../data-structures").TaskDesignStatus;

export type TaskExecutionStatus = TaskLifecycleStatus;

export interface LightTaskStep {
  id: string;
  title: string;
  stage: TaskStage;
  status: StepStatus;
}

export interface LightTaskTask {
  id: string;
  planId?: string;
  title: string;
  summary?: string;
  designStatus?: TaskDesignStatus;
  executionStatus: TaskExecutionStatus;
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt?: string;
  steps: LightTaskStep[];
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface LightTaskPlan {
  id: string;
  title: string;
  status: PlanLifecycleStatus;
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface LightTaskGraph {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
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
  lastAdvanceFingerprint?: string;
}

export interface PersistedLightPlan extends LightTaskPlan {}

export interface PersistedLightGraph extends LightTaskGraph {}

export interface PersistedLightRuntime extends LightTaskRuntime {}

export interface PersistedLightOutput extends LightTaskOutput {}

export interface CreateTaskInput {
  title: string;
  summary?: string;
  planId?: string;
  designStatus?: TaskDesignStatus;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface CreatePlanInput {
  id: string;
  title: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
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
  action?: TaskAction;
  expectedRevision: number;
  idempotencyKey?: string;
}

export interface UpdateTaskInput {
  expectedRevision: number;
  planId?: string;
  title?: string;
  summary?: string | null;
  designStatus?: TaskDesignStatus;
  metadata?: Record<string, unknown> | null;
  extensions?: StructuredEntityExtensions | null;
}

export interface AdvancePlanInput {
  action?: PlanAction;
  expectedRevision: number;
}

export interface AdvanceRuntimeInput {
  action?: RuntimeAction;
  expectedRevision: number;
  result?: Record<string, unknown> | null;
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
}

export interface SaveGraphInput {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  expectedRevision?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface PublishGraphInput {
  expectedRevision: number;
}

export interface EditGraphInput {
  expectedRevision: number;
  operations: GraphEditOperation[];
  idempotencyKey?: string;
}

export interface MaterializedPlanTaskSource extends Record<string, unknown> {
  graphScope: "published";
  graphRevision: number;
  nodeId: string;
  nodeTaskId: string;
}

export type MaterializedPlanTaskGovernance =
  | {
      state: "active";
      orphanedAtGraphRevision?: undefined;
    }
  | {
      state: "orphaned";
      orphanedAtGraphRevision: number;
    };

export interface MaterializedPlanTaskProvenance extends Record<string, unknown> {
  kind: "materialized_plan_task";
  source: MaterializedPlanTaskSource;
  governance: MaterializedPlanTaskGovernance;
}

export type MaterializeRemovedNodePolicy = "soft_delete" | "keep";

export interface TaskExecutionStatusQuery {
  in: TaskLifecycleStatus[];
}

export interface TaskDesignStatusQuery {
  in: TaskDesignStatus[];
}

export interface MaterializedTaskSourceQuery {
  nodeId?: string;
  nodeTaskId?: string;
  graphRevision?: number;
  governanceState?: MaterializedPlanTaskGovernance["state"];
}

export interface ListTasksInput {
  planId?: string;
  executionStatus?: TaskLifecycleStatus | TaskExecutionStatusQuery;
  designStatus?: TaskDesignStatus | TaskDesignStatusQuery;
  materializedSource?: MaterializedTaskSourceQuery;
  includeOrphaned?: boolean;
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

export interface MaterializePlanTasksInput {
  expectedPublishedGraphRevision: number;
  /**
   * soft_delete：将已从图中移除的旧物化任务标记为 orphaned，并在默认查询中隐藏。
   * keep：保留旧任务当前治理状态，允许应用层自行接管后续治理。
   */
  removedNodePolicy?: MaterializeRemovedNodePolicy;
}

export interface MaterializePlanTasksResult {
  plan: LightTaskPlan;
  publishedGraph: LightTaskGraph;
  tasks: LightTaskTask[];
}

export interface GetPlanSchedulingFactsInput {
  expectedPublishedGraphRevision: number;
}

export interface SchedulingFactUnmetPrerequisite {
  nodeId: string;
  taskStatus?: TaskLifecycleStatus;
}

export type PlanSchedulingBlockReason =
  | {
      code: "waiting_for_prerequisites";
      unmetPrerequisites: SchedulingFactUnmetPrerequisite[];
    }
  | {
      code: "missing_task";
    }
  | {
      code: "task_design_incomplete";
      taskDesignStatus: TaskDesignStatus;
    }
  | {
      code: "task_dispatched";
      taskStatus: "dispatched";
    }
  | {
      code: "task_running";
      taskStatus: "running";
    }
  | {
      code: "task_blocked_by_approval";
      taskStatus: "blocked_by_approval";
    }
  | {
      code: "task_waiting_transition";
      taskStatus: TaskLifecycleStatus;
    };

export interface PlanSchedulingPolicyContext {
  nodeId: string;
  task?: PersistedLightTask;
  prerequisiteNodeIds: string[];
  completedNodeIdSet: ReadonlySet<string>;
  tasksByNodeId: ReadonlyMap<string, PersistedLightTask>;
  isReady: boolean;
  isTerminal: boolean;
}

export interface PlanSchedulingPolicy {
  isTaskCompleted(task: PersistedLightTask): boolean;
  isTaskTerminal(task: PersistedLightTask): boolean;
  isTaskRunnable(context: PlanSchedulingPolicyContext): boolean;
  resolveBlockReason(context: PlanSchedulingPolicyContext): PlanSchedulingBlockReason | undefined;
}

export interface PlanSchedulingNodeFacts {
  nodeId: string;
  graphTaskId: string;
  taskId?: string;
  taskDesignStatus?: TaskDesignStatus;
  taskStatus?: TaskLifecycleStatus;
  isReady: boolean;
  isRunnable: boolean;
  isTerminal: boolean;
  blockReason?: PlanSchedulingBlockReason;
}

export interface GetPlanSchedulingFactsResult {
  planId: string;
  planStatus: PlanLifecycleStatus;
  publishedGraphRevision: number;
  orderedNodeIds: string[];
  readyNodeIds: string[];
  runnableNodeIds: string[];
  blockedNodeIds: string[];
  terminalNodeIds: string[];
  completedNodeIds: string[];
  byNodeId: Record<string, PlanSchedulingNodeFacts>;
}

export interface LaunchPlanInput {
  expectedRevision: number;
  expectedPublishedGraphRevision: number;
}

export interface LaunchPlanResult {
  plan: LightTaskPlan;
  publishedGraph: LightTaskGraph;
  tasks: LightTaskTask[];
}

export type LightTaskDomainEventType = DomainEventType;

export type TaskCreatedEvent = DomainEvent<"task.created", { task: LightTaskTask }>;
export type TaskUpdatedEvent = DomainEvent<"task.updated", { task: LightTaskTask }>;
export type TaskAdvancedEvent = DomainEvent<"task.advanced", { task: LightTaskTask }>;
export type PlanCreatedEvent = DomainEvent<"plan.created", { plan: LightTaskPlan }>;
export type PlanUpdatedEvent = DomainEvent<"plan.updated", { plan: LightTaskPlan }>;
export type PlanAdvancedEvent = DomainEvent<"plan.advanced", { plan: LightTaskPlan }>;
export type PlanTaskProvenanceSyncedEvent = DomainEvent<
  "plan.task_provenance_synced",
  {
    plan: LightTaskPlan;
    publishedGraph: LightTaskGraph;
    tasks: LightTaskTask[];
  }
>;
export type PlanLaunchedEvent = DomainEvent<
  "plan.launched",
  {
    plan: LightTaskPlan;
    publishedGraph: LightTaskGraph;
    tasks: LightTaskTask[];
  }
>;
export type GraphSavedEvent = DomainEvent<
  "graph.saved",
  {
    scope: "draft";
    graph: LightTaskGraph;
  }
>;
export type GraphPublishedEvent = DomainEvent<
  "graph.published",
  {
    scope: "published";
    graph: LightTaskGraph;
  }
>;
export type RuntimeCreatedEvent = DomainEvent<"runtime.created", { runtime: LightTaskRuntime }>;
export type RuntimeAdvancedEvent = DomainEvent<"runtime.advanced", { runtime: LightTaskRuntime }>;
export type OutputCreatedEvent = DomainEvent<"output.created", { output: LightTaskOutput }>;
export type OutputAdvancedEvent = DomainEvent<"output.advanced", { output: LightTaskOutput }>;

export type LightTaskDomainEvent =
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskAdvancedEvent
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | PlanAdvancedEvent
  | PlanTaskProvenanceSyncedEvent
  | PlanLaunchedEvent
  | GraphSavedEvent
  | GraphPublishedEvent
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
  graphRepository: LazyValidatedPort<GraphRepository<PersistedLightGraph>>;
  runtimeRepository?: LazyValidatedPort<RuntimeRepository<PersistedLightRuntime>>;
  outputRepository?: LazyValidatedPort<OutputRepository<PersistedLightOutput>>;
  notify?: LazyValidatedPort<NotifyPort<LightTaskDomainEvent>>;
  consistency?: LazyValidatedPort<ConsistencyPort>;
  clock: LazyValidatedPort<ClockPort>;
  idGenerator: LazyValidatedPort<IdGeneratorPort>;
  taskLifecycle?: TaskLifecyclePolicy;
  planLifecycle?: PlanLifecyclePolicy;
  runtimeLifecycle?: RuntimeLifecyclePolicy;
  scheduling?: Partial<PlanSchedulingPolicy>;
}

export interface LightTaskKernel {
  createTask(input: CreateTaskInput): LightTaskTask;
  listTasks(input?: ListTasksInput): LightTaskTask[];
  listTasksByPlan(planId: string, input?: Omit<ListTasksInput, "planId">): LightTaskTask[];
  getTask(taskId: string): LightTaskTask | undefined;
  updateTask(taskId: string, input: UpdateTaskInput): LightTaskTask;
  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask;
  createPlan(input: CreatePlanInput): LightTaskPlan;
  listPlans(): LightTaskPlan[];
  getPlan(planId: string): LightTaskPlan | undefined;
  updatePlan(planId: string, input: UpdatePlanInput): LightTaskPlan;
  advancePlan(planId: string, input: AdvancePlanInput): LightTaskPlan;
  createRuntime(input: CreateRuntimeInput): LightTaskRuntime;
  listRuntimes(input?: ListRuntimesInput): LightTaskRuntime[];
  getRuntime(runtimeId: string): LightTaskRuntime | undefined;
  advanceRuntime(runtimeId: string, input: AdvanceRuntimeInput): LightTaskRuntime;
  createOutput(input: CreateOutputInput): LightTaskOutput;
  listOutputs(input?: ListOutputsInput): LightTaskOutput[];
  getOutput(outputId: string): LightTaskOutput | undefined;
  advanceOutput(outputId: string, input: AdvanceOutputInput): LightTaskOutput;
  getGraph(planId: string): LightTaskGraph | undefined;
  saveGraph(planId: string, input: SaveGraphInput): LightTaskGraph;
  editGraph(planId: string, input: EditGraphInput): LightTaskGraph;
  getPublishedGraph(planId: string): LightTaskGraph | undefined;
  publishGraph(planId: string, input: PublishGraphInput): LightTaskGraph;
  materializePlanTasks(
    planId: string,
    input: MaterializePlanTasksInput,
  ): MaterializePlanTasksResult;
  getPlanSchedulingFacts(
    planId: string,
    input: GetPlanSchedulingFactsInput,
  ): GetPlanSchedulingFactsResult;
  launchPlan(planId: string, input: LaunchPlanInput): LaunchPlanResult;
}
