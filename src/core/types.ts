import type {
  DomainEvent,
  DomainEventType,
  GraphEdgeRecord,
  GraphNodeRecord,
  PlanLifecycleStatus,
  RuntimeLifecycleStatus,
  RuntimeParentRef,
  StructuredEntityExtensions,
} from "../data-structures";
import type {
  ClockPort,
  GraphRepository,
  IdGeneratorPort,
  NotifyPort,
  PlanRepository,
  RuntimeRepository,
  TaskRepository,
} from "../ports";
import type { PlanAction, RuntimeAction, TaskAction, TaskLifecycleStatus } from "../rules";

export type TaskStage = "investigate" | "design" | "implement" | "verify" | "converge";

export type StepStatus = "todo" | "doing" | "done";

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
  status: TaskLifecycleStatus;
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
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
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
  idempotencyKey?: string;
}

export interface PersistedLightTask extends LightTaskTask {
  lastAdvanceFingerprint?: string;
}

export interface PersistedLightPlan extends LightTaskPlan {}

export interface PersistedLightGraph extends LightTaskGraph {}

export interface PersistedLightRuntime extends LightTaskRuntime {}

export interface CreateTaskInput {
  title: string;
  summary?: string;
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
  context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  extensions?: StructuredEntityExtensions;
}

export interface AdvanceTaskInput {
  action?: TaskAction;
  expectedRevision: number;
  idempotencyKey?: string;
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

export interface MaterializedPlanTaskSource extends Record<string, unknown> {
  graphScope: "published";
  graphRevision: number;
  nodeId: string;
  nodeTaskId: string;
}

export interface MaterializedPlanTaskProvenance extends Record<string, unknown> {
  kind: "materialized_plan_task";
  source: MaterializedPlanTaskSource;
}

export interface MaterializePlanTasksInput {
  expectedPublishedGraphRevision: number;
}

export interface MaterializePlanTasksResult {
  plan: LightTaskPlan;
  publishedGraph: LightTaskGraph;
  tasks: LightTaskTask[];
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
export type TaskAdvancedEvent = DomainEvent<"task.advanced", { task: LightTaskTask }>;
export type PlanCreatedEvent = DomainEvent<"plan.created", { plan: LightTaskPlan }>;
export type PlanUpdatedEvent = DomainEvent<"plan.updated", { plan: LightTaskPlan }>;
export type PlanAdvancedEvent = DomainEvent<"plan.advanced", { plan: LightTaskPlan }>;
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
export type RuntimeAdvancedEvent = DomainEvent<
  "runtime.advanced",
  { runtime: LightTaskRuntime }
>;

export type LightTaskDomainEvent =
  | TaskCreatedEvent
  | TaskAdvancedEvent
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | PlanAdvancedEvent
  | GraphSavedEvent
  | GraphPublishedEvent
  | RuntimeCreatedEvent
  | RuntimeAdvancedEvent;

type LazyValidatedPort<TPort> = {
  [K in keyof TPort]?: TPort[K];
};

export interface CreateLightTaskOptions {
  taskRepository: LazyValidatedPort<TaskRepository<PersistedLightTask>>;
  planRepository: LazyValidatedPort<PlanRepository<PersistedLightPlan>>;
  graphRepository: LazyValidatedPort<GraphRepository<PersistedLightGraph>>;
  runtimeRepository?: LazyValidatedPort<RuntimeRepository<PersistedLightRuntime>>;
  notify?: LazyValidatedPort<NotifyPort<LightTaskDomainEvent>>;
  clock: LazyValidatedPort<ClockPort>;
  idGenerator: LazyValidatedPort<IdGeneratorPort>;
}

export interface LightTaskKernel {
  createTask(input: CreateTaskInput): LightTaskTask;
  listTasks(): LightTaskTask[];
  listTasksByPlan(planId: string): LightTaskTask[];
  getTask(taskId: string): LightTaskTask | undefined;
  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask;
  createPlan(input: CreatePlanInput): LightTaskPlan;
  listPlans(): LightTaskPlan[];
  getPlan(planId: string): LightTaskPlan | undefined;
  updatePlan(planId: string, input: UpdatePlanInput): LightTaskPlan;
  advancePlan(planId: string, input: AdvancePlanInput): LightTaskPlan;
  createRuntime(input: CreateRuntimeInput): LightTaskRuntime;
  listRuntimes(): LightTaskRuntime[];
  getRuntime(runtimeId: string): LightTaskRuntime | undefined;
  advanceRuntime(runtimeId: string, input: AdvanceRuntimeInput): LightTaskRuntime;
  getGraph(planId: string): LightTaskGraph | undefined;
  saveGraph(planId: string, input: SaveGraphInput): LightTaskGraph;
  getPublishedGraph(planId: string): LightTaskGraph | undefined;
  publishGraph(planId: string, input: PublishGraphInput): LightTaskGraph;
  materializePlanTasks(
    planId: string,
    input: MaterializePlanTasksInput,
  ): MaterializePlanTasksResult;
  launchPlan(planId: string, input: LaunchPlanInput): LaunchPlanResult;
}
