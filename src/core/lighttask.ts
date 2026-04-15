import { advancePlanUseCase } from "./advance-plan";
import { advanceRuntimeUseCase } from "./advance-runtime";
import { advanceTaskUseCase } from "./advance-task";
import { createPlanUseCase } from "./create-plan";
import { createRuntimeUseCase } from "./create-runtime";
import { createTaskUseCase } from "./create-task";
import { getGraphUseCase } from "./get-graph";
import { getPlanUseCase } from "./get-plan";
import { getPublishedGraphUseCase } from "./get-published-graph";
import { getRuntimeUseCase } from "./get-runtime";
import { getTaskUseCase } from "./get-task";
import { launchPlanUseCase } from "./launch-plan";
import { toLightTaskError } from "./lighttask-error";
import { listPlansUseCase } from "./list-plans";
import { listRuntimesUseCase } from "./list-runtimes";
import { listTasksUseCase } from "./list-tasks";
import { listTasksByPlanUseCase } from "./list-tasks-by-plan";
import { materializePlanTasksUseCase } from "./materialize-plan-tasks";
import { publishGraphUseCase } from "./publish-graph";
import { saveGraphUseCase } from "./save-graph";
import type {
  AdvancePlanInput,
  AdvanceRuntimeInput,
  AdvanceTaskInput,
  CreateLightTaskOptions,
  CreatePlanInput,
  CreateRuntimeInput,
  CreateTaskInput,
  LaunchPlanInput,
  LaunchPlanResult,
  LightTaskGraph,
  LightTaskKernel,
  LightTaskPlan,
  LightTaskRuntime,
  LightTaskTask,
  MaterializePlanTasksInput,
  MaterializePlanTasksResult,
  PublishGraphInput,
  SaveGraphInput,
  UpdatePlanInput,
} from "./types";
import { updatePlanUseCase } from "./update-plan";

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

  listTasksByPlan(planId: string): LightTaskTask[] {
    return this.runWithErrorBoundary(() => listTasksByPlanUseCase(this.options, planId));
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

  listPlans(): LightTaskPlan[] {
    return this.runWithErrorBoundary(() => listPlansUseCase(this.options));
  }

  getPlan(planId: string): LightTaskPlan | undefined {
    return this.runWithErrorBoundary(() => getPlanUseCase(this.options, planId));
  }

  updatePlan(planId: string, input: UpdatePlanInput): LightTaskPlan {
    return this.runWithErrorBoundary(() => updatePlanUseCase(this.options, planId, input));
  }

  advancePlan(planId: string, input: AdvancePlanInput): LightTaskPlan {
    return this.runWithErrorBoundary(() => advancePlanUseCase(this.options, planId, input));
  }

  createRuntime(input: CreateRuntimeInput): LightTaskRuntime {
    return this.runWithErrorBoundary(() => createRuntimeUseCase(this.options, input));
  }

  listRuntimes(): LightTaskRuntime[] {
    return this.runWithErrorBoundary(() => listRuntimesUseCase(this.options));
  }

  getRuntime(runtimeId: string): LightTaskRuntime | undefined {
    return this.runWithErrorBoundary(() => getRuntimeUseCase(this.options, runtimeId));
  }

  advanceRuntime(runtimeId: string, input: AdvanceRuntimeInput): LightTaskRuntime {
    return this.runWithErrorBoundary(() => advanceRuntimeUseCase(this.options, runtimeId, input));
  }

  getGraph(planId: string): LightTaskGraph | undefined {
    return this.runWithErrorBoundary(() => getGraphUseCase(this.options, planId));
  }

  saveGraph(planId: string, input: SaveGraphInput): LightTaskGraph {
    return this.runWithErrorBoundary(() => saveGraphUseCase(this.options, planId, input));
  }

  getPublishedGraph(planId: string): LightTaskGraph | undefined {
    return this.runWithErrorBoundary(() => getPublishedGraphUseCase(this.options, planId));
  }

  publishGraph(planId: string, input: PublishGraphInput): LightTaskGraph {
    return this.runWithErrorBoundary(() => publishGraphUseCase(this.options, planId, input));
  }

  materializePlanTasks(
    planId: string,
    input: MaterializePlanTasksInput,
  ): MaterializePlanTasksResult {
    return this.runWithErrorBoundary(() =>
      materializePlanTasksUseCase(this.options, planId, input),
    );
  }

  launchPlan(planId: string, input: LaunchPlanInput): LaunchPlanResult {
    return this.runWithErrorBoundary(() => launchPlanUseCase(this.options, planId, input));
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
