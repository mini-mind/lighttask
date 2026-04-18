import { advanceOutputUseCase } from "./advance-output";
import { advanceRuntimeUseCase } from "./advance-runtime";
import { advanceTaskUseCase } from "./advance-task";
import { createOutputUseCase } from "./create-output";
import { createPlanUseCase } from "./create-plan";
import { createRuntimeUseCase } from "./create-runtime";
import { createTaskUseCase } from "./create-task";
import { deleteOutputUseCase } from "./delete-output";
import { deletePlanUseCase } from "./delete-plan";
import { deleteRuntimeUseCase } from "./delete-runtime";
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
import type {
  CreateLightTaskOptions,
  LightTaskKernel,
  LightTaskOutputsApi,
  LightTaskPlansApi,
  LightTaskRunsApi,
  LightTaskTasksApi,
} from "./types";
import { updatePlanUseCase } from "./update-plan";
import { updateTaskUseCase } from "./update-task";

export function createLightTask(options: CreateLightTaskOptions): LightTaskKernel {
  const runWithErrorBoundary = <TResult>(runner: () => TResult): TResult => {
    try {
      return runner();
    } catch (error) {
      throw toLightTaskError(error);
    }
  };

  const plans: LightTaskPlansApi = {
    create: (input) => runWithErrorBoundary(() => createPlanUseCase(options, input)),
    list: () => runWithErrorBoundary(() => listPlansUseCase(options)),
    get: (planId) => runWithErrorBoundary(() => getPlanUseCase(options, planId)),
    update: (planId, input) =>
      runWithErrorBoundary(() => updatePlanUseCase(options, planId, input)),
    remove: (planId, input) =>
      runWithErrorBoundary(() => deletePlanUseCase(options, planId, input)),
    schedule: (planId) =>
      runWithErrorBoundary(() => getPlanSchedulingFactsUseCase(options, planId)),
  };

  const tasks: LightTaskTasksApi = {
    create: (input) => runWithErrorBoundary(() => createTaskUseCase(options, input)),
    list: (input) => runWithErrorBoundary(() => listTasksUseCase(options, input)),
    get: (taskId) => runWithErrorBoundary(() => getTaskUseCase(options, taskId)),
    update: (taskId, input) =>
      runWithErrorBoundary(() => updateTaskUseCase(options, taskId, input)),
    move: (taskId, input) => runWithErrorBoundary(() => advanceTaskUseCase(options, taskId, input)),
    remove: (taskId, input) =>
      runWithErrorBoundary(() => deleteTaskUseCase(options, taskId, input)),
  };

  const runs: LightTaskRunsApi = {
    create: (input) => runWithErrorBoundary(() => createRuntimeUseCase(options, input)),
    list: (input) => runWithErrorBoundary(() => listRuntimesUseCase(options, input)),
    get: (runtimeId) => runWithErrorBoundary(() => getRuntimeUseCase(options, runtimeId)),
    update: (runtimeId, input) =>
      runWithErrorBoundary(() => advanceRuntimeUseCase(options, runtimeId, input)),
    remove: (runtimeId, input) =>
      runWithErrorBoundary(() => deleteRuntimeUseCase(options, runtimeId, input)),
  };

  const outputs: LightTaskOutputsApi = {
    create: (input) => runWithErrorBoundary(() => createOutputUseCase(options, input)),
    list: (input) => runWithErrorBoundary(() => listOutputsUseCase(options, input)),
    get: (outputId) => runWithErrorBoundary(() => getOutputUseCase(options, outputId)),
    update: (outputId, input) =>
      runWithErrorBoundary(() => advanceOutputUseCase(options, outputId, input)),
    remove: (outputId, input) =>
      runWithErrorBoundary(() => deleteOutputUseCase(options, outputId, input)),
  };

  // 公开实例面只保留分组短名，避免同时维护两套调用心智。
  return {
    plans,
    tasks,
    runs,
    outputs,
  };
}
