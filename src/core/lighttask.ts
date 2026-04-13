import { randomUUID } from "node:crypto";
import type { ClockPort, IdGeneratorPort, TaskRepository } from "../ports";
import {
  type TaskAction,
  assertExpectedRevision,
  assertNextRevision,
  decideIdempotency,
  resolveTaskStepProgress,
  selectDefaultTaskAction,
  transitionTaskStatus,
} from "../rules";
import { createLightTaskError, throwLightTaskError, toLightTaskError } from "./lighttask-error";
import type {
  AdvanceTaskInput,
  CreateLightTaskOptions,
  CreateTaskInput,
  LightTaskKernel,
  LightTaskTask,
  PersistedLightTask,
  TaskStage,
} from "./types";

const DEFAULT_STAGES: ReadonlyArray<TaskStage> = [
  "investigate",
  "design",
  "implement",
  "verify",
  "converge",
];

class InMemoryTaskRepository implements TaskRepository<PersistedLightTask> {
  private readonly tasks: PersistedLightTask[] = [];

  list(): PersistedLightTask[] {
    return this.tasks.map((task) => clonePersistedTask(task));
  }

  get(taskId: string): PersistedLightTask | undefined {
    const task = this.tasks.find((item) => item.id === taskId);
    return task ? clonePersistedTask(task) : undefined;
  }

  create(task: PersistedLightTask) {
    const snapshot = clonePersistedTask(task);
    const existingTask = this.tasks.find((item) => item.id === snapshot.id);
    if (existingTask) {
      return {
        ok: false,
        error: createLightTaskError("STATE_CONFLICT", "任务 ID 已存在，禁止覆盖已有任务", {
          taskId: snapshot.id,
        }),
      } as const;
    }
    this.tasks.push(snapshot);
    return {
      ok: true,
      task: clonePersistedTask(snapshot),
    } as const;
  }

  saveIfRevisionMatches(task: PersistedLightTask, expectedRevision: number) {
    const snapshot = clonePersistedTask(task);
    const index = this.tasks.findIndex((item) => item.id === snapshot.id);
    if (index === -1) {
      return {
        ok: false,
        error: createLightTaskError("NOT_FOUND", "任务不存在，无法保存变更", {
          taskId: snapshot.id,
        }),
      } as const;
    }
    if (this.tasks[index].revision !== expectedRevision) {
      return {
        ok: false,
        error: createLightTaskError("REVISION_CONFLICT", "任务 revision 冲突，保存被拒绝", {
          taskId: snapshot.id,
          expectedRevision,
          actualRevision: this.tasks[index].revision,
        }),
      } as const;
    }
    this.tasks[index] = snapshot;
    return {
      ok: true,
      task: clonePersistedTask(snapshot),
    } as const;
  }
}

const SYSTEM_CLOCK: ClockPort = {
  now(): string {
    return new Date().toISOString();
  },
};

const TASK_ID_GENERATOR: IdGeneratorPort = {
  nextTaskId(): string {
    return `task_${randomUUID()}`;
  },
};

function clonePersistedTask(task: PersistedLightTask): PersistedLightTask {
  return {
    ...task,
    steps: task.steps.map((step) => ({ ...step })),
  };
}

/**
 * 这里先只实现通用编排模型，不混入应用层的 UI、平台适配和持久化策略。
 */
class InMemoryLightTask implements LightTaskKernel {
  constructor(
    private readonly taskRepository: TaskRepository<PersistedLightTask>,
    private readonly clock: ClockPort,
    private readonly idGenerator: IdGeneratorPort,
  ) {}

  createTask(input: CreateTaskInput): LightTaskTask {
    const taskId = this.idGenerator.nextTaskId();
    const title = input.title.trim();
    const summary = input.summary?.trim() || undefined;
    if (!title) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "任务标题不能为空", {
          title: input.title,
        }),
      );
    }

    const task: PersistedLightTask = {
      id: taskId,
      title,
      summary,
      status: "queued",
      revision: 1,
      idempotencyKey: undefined,
      createdAt: this.clock.now(),
      steps: DEFAULT_STAGES.map((stage) => ({
        id: `${taskId}_${stage}`,
        // 编排层只保留稳定 stage code，展示文案由应用层决定。
        title: stage,
        stage,
        status: stage === "investigate" ? "doing" : "todo",
      })),
    };

    const created = this.taskRepository.create(task);
    if (!created.ok) {
      throwLightTaskError(created.error);
    }
    return this.toPublicTask(task);
  }

  listTasks(): LightTaskTask[] {
    return this.taskRepository.list().map((task) => this.toPublicTask(task));
  }

  getTask(taskId: string): LightTaskTask | undefined {
    const task = this.taskRepository.get(taskId);
    return task ? this.toPublicTask(task) : undefined;
  }

  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask {
    const storedTask = this.taskRepository.get(taskId);
    if (!storedTask) {
      throwLightTaskError(
        createLightTaskError("NOT_FOUND", "未找到任务", {
          taskId,
        }),
      );
    }
    const task = clonePersistedTask(storedTask);
    if (input.expectedRevision === undefined) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "expectedRevision 为必填字段", {
          taskId,
        }),
      );
    }

    const action = input.action ?? selectDefaultTaskAction(task.status);
    if (!action) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "任务没有可推进的进行中阶段", {
          taskId,
          currentStatus: task.status,
        }),
      );
    }

    const expectedRevision = input.expectedRevision;
    const incomingFingerprint = this.buildAdvanceFingerprint(task.id, action, expectedRevision);
    const idempotencyDecision = decideIdempotency({
      incomingIdempotencyKey: input.idempotencyKey,
      storedIdempotencyKey: task.idempotencyKey,
      incomingFingerprint,
      storedFingerprint: task.lastAdvanceFingerprint,
    });
    if (idempotencyDecision.decision === "conflict") {
      throwLightTaskError(
        idempotencyDecision.error ??
          createLightTaskError("STATE_CONFLICT", idempotencyDecision.reason, {
            taskId,
          }),
      );
    }
    if (idempotencyDecision.decision === "replay") {
      return this.toPublicTask(task);
    }

    const nextRevision = task.revision + 1;
    try {
      assertExpectedRevision(task.revision, expectedRevision);
      assertNextRevision(task.revision, nextRevision);
    } catch (error) {
      throw toLightTaskError(error);
    }
    const transition = transitionTaskStatus(task.status, action);
    if (!transition.ok) {
      throwLightTaskError(transition.error);
    }

    task.status = transition.status;
    task.revision = nextRevision;
    task.idempotencyKey = input.idempotencyKey?.trim() || task.idempotencyKey;
    task.lastAdvanceFingerprint = incomingFingerprint;
    this.applyStepProgress(task, action);
    const saved = this.taskRepository.saveIfRevisionMatches(task, storedTask.revision);
    if (!saved.ok) {
      throwLightTaskError(saved.error);
    }
    return this.toPublicTask(task);
  }

  private applyStepProgress(task: PersistedLightTask, action: TaskAction): void {
    const progressPolicy = resolveTaskStepProgress(action);
    if (progressPolicy === "complete_all") {
      // completed 代表流程闭环，剩余步骤统一收敛为 done，避免状态和步骤语义错位。
      this.markAllRemainingStepsDone(task);
      return;
    }
    if (progressPolicy === "advance_one") {
      this.advanceOneStep(task);
    }
  }

  private advanceOneStep(task: PersistedLightTask): void {
    const currentStepIndex = task.steps.findIndex((step) => step.status === "doing");
    if (currentStepIndex === -1) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "任务没有可推进的进行中阶段", {
          taskId: task.id,
        }),
      );
    }

    task.steps[currentStepIndex].status = "done";
    const nextStep = task.steps[currentStepIndex + 1];
    if (nextStep) {
      nextStep.status = "doing";
    }
  }

  private markAllRemainingStepsDone(task: PersistedLightTask): void {
    const currentStepIndex = task.steps.findIndex((step) => step.status === "doing");
    if (currentStepIndex === -1) {
      return;
    }
    for (let i = currentStepIndex; i < task.steps.length; i += 1) {
      task.steps[i].status = "done";
    }
  }

  private buildAdvanceFingerprint(
    taskId: string,
    action: TaskAction,
    expectedRevision: number,
  ): string {
    return `${taskId}:${action}:${expectedRevision}`;
  }

  private toPublicTask(task: PersistedLightTask): LightTaskTask {
    const { lastAdvanceFingerprint: _lastAdvanceFingerprint, ...publicTask } = task;
    return {
      ...publicTask,
      steps: task.steps.map((step) => ({ ...step })),
    };
  }
}

export function createLightTask(options: CreateLightTaskOptions = {}): LightTaskKernel {
  return new InMemoryLightTask(
    options.taskRepository ?? new InMemoryTaskRepository(),
    options.clock ?? SYSTEM_CLOCK,
    options.idGenerator ?? TASK_ID_GENERATOR,
  );
}
