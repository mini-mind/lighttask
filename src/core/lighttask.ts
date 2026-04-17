import { advanceOutputUseCase } from "./advance-output";
import { advanceRuntimeUseCase } from "./advance-runtime";
import { advanceTaskUseCase } from "./advance-task";
import { createOutputUseCase } from "./create-output";
import { createPlanUseCase } from "./create-plan";
import { createRuntimeUseCase } from "./create-runtime";
import { createTaskUseCase } from "./create-task";
import { deleteTaskUseCase } from "./delete-task";
import { getOutputUseCase } from "./get-output";
import { getPlanUseCase } from "./get-plan";
import { getPlanSchedulingFactsUseCase } from "./get-plan-scheduling-facts";
import { getRuntimeUseCase } from "./get-runtime";
import { getTaskUseCase } from "./get-task";
import { toLightTaskError } from "./lighttask-error";
import { listOutputsUseCase } from "./list-outputs";
import { listPlansUseCase } from "./list-plans";
import { listRuntimesUseCase } from "./list-runtimes";
import { listTasksUseCase } from "./list-tasks";
import { listTasksByPlanUseCase } from "./list-tasks-by-plan";
import type {
  AdvanceOutputInput,
  AdvanceRuntimeInput,
  AdvanceTaskInput,
  CreateLightTaskOptions,
  CreateOutputInput,
  CreatePlanInput,
  CreateRuntimeInput,
  CreateTaskInput,
  DeleteTaskInput,
  DeleteTaskResult,
  GetPlanSchedulingFactsResult,
  LightTaskKernel,
  LightTaskOutput,
  LightTaskPlan,
  LightTaskRuntime,
  LightTaskTask,
  ListOutputsInput,
  ListRuntimesInput,
  ListTasksInput,
  UpdatePlanInput,
  UpdateTaskInput,
} from "./types";
import { updatePlanUseCase } from "./update-plan";
import { updateTaskUseCase } from "./update-task";

class LightTaskKernelFacade implements LightTaskKernel {
  constructor(private readonly options: CreateLightTaskOptions) {}

  createTask(input: CreateTaskInput): LightTaskTask {
    return this.runWithErrorBoundary(() => createTaskUseCase(this.options, input));
  }

  listTasks(input?: ListTasksInput): LightTaskTask[] {
    return this.runWithErrorBoundary(() => listTasksUseCase(this.options, input));
  }

  listTasksByPlan(planId: string, input?: Omit<ListTasksInput, "planId">): LightTaskTask[] {
    return this.runWithErrorBoundary(() => listTasksByPlanUseCase(this.options, planId, input));
  }

  getTask(taskId: string): LightTaskTask | undefined {
    return this.runWithErrorBoundary(() => getTaskUseCase(this.options, taskId));
  }

  updateTask(taskId: string, input: UpdateTaskInput): LightTaskTask {
    return this.runWithErrorBoundary(() => updateTaskUseCase(this.options, taskId, input));
  }

  advanceTask(taskId: string, input: AdvanceTaskInput): LightTaskTask {
    return this.runWithErrorBoundary(() => advanceTaskUseCase(this.options, taskId, input));
  }

  deleteTask(taskId: string, input: DeleteTaskInput): DeleteTaskResult {
    return this.runWithErrorBoundary(() => deleteTaskUseCase(this.options, taskId, input));
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

  createRuntime(input: CreateRuntimeInput): LightTaskRuntime {
    return this.runWithErrorBoundary(() => createRuntimeUseCase(this.options, input));
  }

  listRuntimes(input?: ListRuntimesInput): LightTaskRuntime[] {
    return this.runWithErrorBoundary(() => listRuntimesUseCase(this.options, input));
  }

  getRuntime(runtimeId: string): LightTaskRuntime | undefined {
    return this.runWithErrorBoundary(() => getRuntimeUseCase(this.options, runtimeId));
  }

  advanceRuntime(runtimeId: string, input: AdvanceRuntimeInput): LightTaskRuntime {
    return this.runWithErrorBoundary(() => advanceRuntimeUseCase(this.options, runtimeId, input));
  }

  createOutput(input: CreateOutputInput): LightTaskOutput {
    return this.runWithErrorBoundary(() => createOutputUseCase(this.options, input));
  }

  listOutputs(input?: ListOutputsInput): LightTaskOutput[] {
    return this.runWithErrorBoundary(() => listOutputsUseCase(this.options, input));
  }

  getOutput(outputId: string): LightTaskOutput | undefined {
    return this.runWithErrorBoundary(() => getOutputUseCase(this.options, outputId));
  }

  advanceOutput(outputId: string, input: AdvanceOutputInput): LightTaskOutput {
    return this.runWithErrorBoundary(() => advanceOutputUseCase(this.options, outputId, input));
  }

  getPlanSchedulingFacts(planId: string): GetPlanSchedulingFactsResult {
    return this.runWithErrorBoundary(() => getPlanSchedulingFactsUseCase(this.options, planId));
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
