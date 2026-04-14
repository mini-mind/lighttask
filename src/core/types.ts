import type { GraphEdgeRecord, GraphNodeRecord, PlanLifecycleStatus } from "../data-structures";
import type {
  ClockPort,
  GraphRepository,
  IdGeneratorPort,
  PlanRepository,
  TaskRepository,
} from "../ports";
import type { PlanAction, TaskAction, TaskLifecycleStatus } from "../rules";

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
  title: string;
  summary?: string;
  status: TaskLifecycleStatus;
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
  steps: LightTaskStep[];
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
}

export interface LightTaskGraph {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  revision: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedLightTask extends LightTaskTask {
  lastAdvanceFingerprint?: string;
}

export interface PersistedLightPlan extends LightTaskPlan {}

export interface PersistedLightGraph extends LightTaskGraph {}

export interface CreateTaskInput {
  title: string;
  summary?: string;
}

export interface CreatePlanInput {
  id: string;
  title: string;
  metadata?: Record<string, unknown>;
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

export interface SaveGraphInput {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  expectedRevision?: number;
  idempotencyKey?: string;
}

type LazyValidatedPort<TPort> = {
  [K in keyof TPort]?: TPort[K];
};

export interface CreateLightTaskOptions {
  taskRepository: LazyValidatedPort<TaskRepository<PersistedLightTask>>;
  planRepository: LazyValidatedPort<PlanRepository<PersistedLightPlan>>;
  graphRepository: LazyValidatedPort<GraphRepository<PersistedLightGraph>>;
  clock: LazyValidatedPort<ClockPort>;
  idGenerator: LazyValidatedPort<IdGeneratorPort>;
}

export interface LightTaskKernel {
  createTask(input: CreateTaskInput): LightTaskTask;
  listTasks(): LightTaskTask[];
  getTask(taskId: string): LightTaskTask | undefined;
  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask;
  createPlan(input: CreatePlanInput): LightTaskPlan;
  getPlan(planId: string): LightTaskPlan | undefined;
  advancePlan(planId: string, input: AdvancePlanInput): LightTaskPlan;
  getGraph(planId: string): LightTaskGraph | undefined;
  saveGraph(planId: string, input: SaveGraphInput): LightTaskGraph;
}
