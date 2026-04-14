import { advanceTaskUseCase } from "./advance-task";
import { createPlanUseCase } from "./create-plan";
import { createTaskUseCase } from "./create-task";
import { getGraphUseCase } from "./get-graph";
import { getPlanUseCase } from "./get-plan";
import { getTaskUseCase } from "./get-task";
import { createLightTaskError, throwLightTaskError, toLightTaskError } from "./lighttask-error";
import { listTasksUseCase } from "./list-tasks";
import { saveGraphUseCase } from "./save-graph";
import type {
  AdvanceTaskInput,
  CreateLightTaskOptions,
  CreatePlanInput,
  CreateTaskInput,
  LightTaskGraph,
  LightTaskKernel,
  LightTaskPlan,
  LightTaskTask,
  SaveGraphInput,
} from "./types";

/**
 * 这里先只实现通用编排模型，不混入应用层的 UI、平台适配和持久化策略。
 */
class LightTaskKernelFacade implements LightTaskKernel {
  constructor(private readonly options: CreateLightTaskOptions) {}

  createTask(input: CreateTaskInput): LightTaskTask {
    return this.runWithErrorBoundary(() => createTaskUseCase(this.options, input));
  }

  listTasks(): LightTaskTask[] {
    return this.runWithErrorBoundary(() => listTasksUseCase(this.options));
  }

  getTask(taskId: string): LightTaskTask | undefined {
    return this.runWithErrorBoundary(() => getTaskUseCase(this.options, taskId));
  }

  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask {
    return this.runWithErrorBoundary(() => advanceTaskUseCase(this.options, taskId, input));
  }

  createPlan(input: CreatePlanInput): LightTaskPlan {
    return this.runWithErrorBoundary(() => createPlanUseCase(this.options, input));
  }

  getPlan(planId: string): LightTaskPlan | undefined {
    return this.runWithErrorBoundary(() => getPlanUseCase(this.options, planId));
  }

  getGraph(planId: string): LightTaskGraph | undefined {
    return this.runWithErrorBoundary(() => getGraphUseCase(this.options, planId));
  }

  saveGraph(planId: string, input: SaveGraphInput): LightTaskGraph {
    return this.runWithErrorBoundary(() => saveGraphUseCase(this.options, planId, input));
  }

  private runWithErrorBoundary<TResult>(runner: () => TResult): TResult {
    try {
      return runner();
    } catch (error) {
      throw toLightTaskError(error);
    }
  }
}

function assertFunction(value: unknown, path: string): void {
  if (typeof value === "function") {
    return;
  }

  throwLightTaskError(
    createLightTaskError("VALIDATION_ERROR", `${path} 必须是函数`, {
      path,
    }),
  );
}

function assertCreateLightTaskOptions(options: CreateLightTaskOptions): void {
  // 在 facade 边界先校验端口形状，避免缺失依赖直接泄漏原生 TypeError。
  assertFunction(options.taskRepository?.list, "taskRepository.list");
  assertFunction(options.taskRepository?.get, "taskRepository.get");
  assertFunction(options.taskRepository?.create, "taskRepository.create");
  assertFunction(
    options.taskRepository?.saveIfRevisionMatches,
    "taskRepository.saveIfRevisionMatches",
  );
  // 计划编排当前只落地 create/get，先不把预留用例的端口能力前置耦合到构造阶段。
  assertFunction(options.planRepository?.get, "planRepository.get");
  assertFunction(options.planRepository?.create, "planRepository.create");
  assertFunction(options.graphRepository?.get, "graphRepository.get");
  assertFunction(options.graphRepository?.create, "graphRepository.create");
  assertFunction(
    options.graphRepository?.saveIfRevisionMatches,
    "graphRepository.saveIfRevisionMatches",
  );
  assertFunction(options.clock?.now, "clock.now");
  assertFunction(options.idGenerator?.nextTaskId, "idGenerator.nextTaskId");
}

export function createLightTask(options: CreateLightTaskOptions): LightTaskKernel {
  try {
    assertCreateLightTaskOptions(options);
    return new LightTaskKernelFacade(options);
  } catch (error) {
    throw toLightTaskError(error);
  }
}
