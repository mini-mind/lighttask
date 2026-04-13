import type { ClockPort, IdGeneratorPort, TaskRepository } from "../ports";
import type { TaskLifecycleStatus } from "../rules";
import type { TaskAction } from "../rules";

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

export interface PersistedLightTask extends LightTaskTask {
  lastAdvanceFingerprint?: string;
}

export interface CreateTaskInput {
  title: string;
  summary?: string;
}

export interface AdvanceTaskInput {
  action?: TaskAction;
  expectedRevision: number;
  idempotencyKey?: string;
}

export interface CreateLightTaskOptions {
  taskRepository?: TaskRepository<PersistedLightTask>;
  clock?: ClockPort;
  idGenerator?: IdGeneratorPort;
}

export interface LightTaskKernel {
  createTask(input: CreateTaskInput): LightTaskTask;
  listTasks(): LightTaskTask[];
  getTask(taskId: string): LightTaskTask | undefined;
  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask;
}
