import { advancePlanUseCase } from "./advance-plan";
import { advanceTaskUseCase } from "./advance-task";
import { createPlanUseCase } from "./create-plan";
import { createTaskUseCase } from "./create-task";
import { getGraphUseCase } from "./get-graph";
import { getPlanUseCase } from "./get-plan";
import { getTaskUseCase } from "./get-task";
import { toLightTaskError } from "./lighttask-error";
import { listTasksUseCase } from "./list-tasks";
import { saveGraphUseCase } from "./save-graph";
import type {
  AdvancePlanInput,
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

  advancePlan(planId: string, input: AdvancePlanInput): LightTaskPlan {
    return this.runWithErrorBoundary(() => advancePlanUseCase(this.options, planId, input));
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

export function createLightTask(options: CreateLightTaskOptions): LightTaskKernel {
  return new LightTaskKernelFacade(options);
}
